/* 桥牌（合约桥牌，复式计分）规则引擎：牌、叫牌合法性、打牌、计分。UMD，可在 Node 里测试。 */
(function (root) {
  'use strict';

  // 花色 0..3 = ♣♦♥♠（叫牌高低顺序），4 = 无将
  const SUIT_CH = ['♣', '♦', '♥', '♠', 'NT'];
  const SUIT_LT = ['C', 'D', 'H', 'S', 'NT'];
  const SEAT_NAME = ['北', '东', '南', '西'];       // 0..3 顺时针
  const SEAT_LT = ['N', 'E', 'S', 'W'];
  const RANK_CH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  // 牌 = suit*13 + (rank-2)，rank 2..14
  const suitOf = (c) => (c / 13) | 0;
  const rankOf = (c) => (c % 13) + 2;
  const mk = (s, r) => s * 13 + (r - 2);
  const cardName = (c) => SUIT_CH[suitOf(c)] + RANK_CH[rankOf(c)];
  const partner = (s) => (s + 2) & 3;
  const next = (s) => (s + 1) & 3;
  const side = (s) => s & 1;                         // 0 = 南北, 1 = 东西

  // 叫品：0 = 过，1 = 加倍，2 = 再加倍，>=5 为 level*5+strain
  const PASS = 0, DBL = 1, RDBL = 2;
  const bid = (level, strain) => level * 5 + strain;
  const lvlOf = (b) => (b / 5) | 0;
  const strainOf = (b) => b % 5;
  function callName(c) {
    if (c === PASS) return '过牌';
    if (c === DBL) return '加倍 X';
    if (c === RDBL) return '再加倍 XX';
    return lvlOf(c) + SUIT_CH[strainOf(c)];
  }
  function callShort(c) {
    if (c === PASS) return 'Pass';
    if (c === DBL) return 'X';
    if (c === RDBL) return 'XX';
    return lvlOf(c) + SUIT_CH[strainOf(c)];
  }

  // 16 副牌一轮的局况：庄家 N,E,S,W 轮转，身价（0 无，1 南北，2 东西，3 双方）
  const VUL_CYCLE = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
  const dealerOfBoard = (n) => (n - 1) & 3;
  const vulOfBoard = (n) => VUL_CYCLE[(n - 1) & 15];
  const isVul = (vul, seat) => (vul === 3) || (vul === 1 && side(seat) === 0) || (vul === 2 && side(seat) === 1);

  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function deal(rnd) {
    rnd = rnd || Math.random;
    const d = []; for (let i = 0; i < 52; i++) d.push(i);
    shuffle(d, rnd);
    const hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i & 3].push(d[i]);
    hands.forEach(sortHand);
    return hands;
  }
  // 手牌排序：花色高→低（♠♥♦♣），同花色牌点大→小
  function sortHand(h) { h.sort((a, b) => (suitOf(b) - suitOf(a)) || (rankOf(b) - rankOf(a))); return h; }

  // ---------- 叫牌 ----------
  function lastBidInfo(auction, dealer) {
    let bidIdx = -1;
    for (let i = auction.length - 1; i >= 0; i--) if (auction[i] >= 5) { bidIdx = i; break; }
    if (bidIdx < 0) return null;
    let dbl = 0;
    for (let i = bidIdx + 1; i < auction.length; i++) { if (auction[i] === DBL) dbl = 1; else if (auction[i] === RDBL) dbl = 2; }
    return { bid: auction[bidIdx], seat: (dealer + bidIdx) & 3, index: bidIdx, dbl };
  }
  function auctionOver(auction) {
    const n = auction.length;
    if (n >= 4 && auction[n - 1] === PASS && auction[n - 2] === PASS && auction[n - 3] === PASS) return true;
    return false;
  }
  function legalCalls(auction, dealer) {
    const cur = (dealer + auction.length) & 3;
    const lb = lastBidInfo(auction, dealer);
    const out = [PASS];
    const from = lb ? lb.bid + 1 : 5;
    for (let b = from; b <= 39; b++) out.push(b);
    if (lb) {
      if (lb.dbl === 0 && side(lb.seat) !== side(cur)) out.push(DBL);
      if (lb.dbl === 1 && side(lb.seat) === side(cur)) out.push(RDBL);
    }
    return out;
  }
  function isPassedOut(auction) { return auction.length >= 4 && auction.every((c) => c === PASS); }
  function finalContract(auction, dealer) {
    if (!auctionOver(auction) || isPassedOut(auction)) return null;
    const lb = lastBidInfo(auction, dealer);
    const strain = strainOf(lb.bid);
    let declarer = lb.seat;
    for (let i = 0; i < auction.length; i++) {
      const c = auction[i];
      if (c >= 5 && strainOf(c) === strain && side((dealer + i) & 3) === side(lb.seat)) { declarer = (dealer + i) & 3; break; }
    }
    return { level: lvlOf(lb.bid), strain, dbl: lb.dbl, declarer, dummy: partner(declarer) };
  }

  // ---------- 打牌 ----------
  function legalPlays(hand, ledSuit) {
    if (ledSuit < 0) return hand.slice();
    const f = hand.filter((c) => suitOf(c) === ledSuit);
    return f.length ? f : hand.slice();
  }
  // trick: [{seat, card}, ...]; trump: 0..3 或 4(无将)
  function trickWinner(trick, trump) {
    const led = suitOf(trick[0].card);
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) {
      const t = trick[i], bs = suitOf(best.card), ts = suitOf(t.card);
      if (ts === bs) { if (rankOf(t.card) > rankOf(best.card)) best = t; }
      else if (ts === trump && bs !== trump) best = t;
    }
    return best.seat;
  }

  // ---------- 计分（复式）----------
  function contractScore(c, tricksMade, vul) {
    // c: {level,strain,dbl}; vul: 庄家方是否身价；返回庄家方得分（负=宕）
    const need = c.level + 6;
    const mult = c.dbl === 2 ? 4 : c.dbl === 1 ? 2 : 1;
    if (tricksMade < need) {
      const down = need - tricksMade;
      let pen = 0;
      if (c.dbl === 0) pen = down * (vul ? 100 : 50);
      else {
        for (let i = 1; i <= down; i++) {
          if (vul) pen += (i === 1 ? 200 : 300);
          else pen += (i === 1 ? 100 : i <= 3 ? 200 : 300);
        }
        if (c.dbl === 2) pen *= 2;
      }
      return -pen;
    }
    const perTrick = c.strain >= 2 && c.strain <= 3 ? 30 : c.strain === 4 ? 30 : 20;
    const first = c.strain === 4 ? 40 : perTrick;
    const base = (first + (c.level - 1) * perTrick) * mult;
    let s = base;
    s += base >= 100 ? (vul ? 500 : 300) : 50;
    if (c.level === 6) s += vul ? 750 : 500;
    else if (c.level === 7) s += vul ? 1500 : 1000;
    const over = tricksMade - need;
    if (over > 0) {
      if (c.dbl === 0) s += over * perTrick;
      else s += over * (c.dbl === 1 ? (vul ? 200 : 100) : (vul ? 400 : 200));
    }
    if (c.dbl === 1) s += 50; else if (c.dbl === 2) s += 100;
    return s;
  }

  // ---------- 一副牌的完整状态机（供 UI 与 AI 自对弈使用）----------
  function newBoard(boardNo, rnd, hands) {
    return {
      no: boardNo, dealer: dealerOfBoard(boardNo), vul: vulOfBoard(boardNo),
      hands: hands || deal(rnd), auction: [], contract: null,
      play: null, done: false, result: null,
    };
  }
  function curBidder(b) { return (b.dealer + b.auction.length) & 3; }
  function makeCall(b, call) {
    b.auction.push(call);
    if (auctionOver(b.auction)) {
      if (isPassedOut(b.auction)) { b.done = true; b.result = { passedOut: true, score: 0 }; }
      else {
        b.contract = finalContract(b.auction, b.dealer);
        const c = b.contract;
        b.play = {
          hands: b.hands.map((h) => h.slice()),
          trump: c.strain, leader: next(c.declarer), turn: next(c.declarer),
          trick: [], tricks: [0, 0], played: [], tricksLog: [], voids: [[], [], [], []],
        };
      }
    }
  }
  // 当前该谁出牌（座位号）以及由谁操控（庄家代打明手）
  function controller(b, seat) {
    const c = b.contract;
    return seat === c.dummy ? c.declarer : seat;
  }
  function playCard(b, card) {
    const p = b.play, seat = p.turn;
    const h = p.hands[seat];
    const i = h.indexOf(card);
    if (i < 0) throw new Error('card not in hand');
    const led = p.trick.length ? suitOf(p.trick[0].card) : -1;
    if (led >= 0 && suitOf(card) !== led && h.some((c) => suitOf(c) === led)) throw new Error('must follow suit');
    if (led >= 0 && suitOf(card) !== led) { if (p.voids[seat].indexOf(led) < 0) p.voids[seat].push(led); }
    h.splice(i, 1);
    p.trick.push({ seat, card });
    p.played.push({ seat, card });
    if (p.trick.length < 4) { p.turn = next(seat); return null; }
    const w = trickWinner(p.trick, p.trump);
    p.tricks[side(w)]++;
    const done = { cards: p.trick.slice(), winner: w };
    p.tricksLog.push(done);
    p.trick = [];
    p.turn = w; p.leader = w;
    if (p.tricksLog.length === 13) finish(b);
    return done;
  }
  function finish(b) {
    const c = b.contract, p = b.play;
    const made = p.tricks[side(c.declarer)];
    const score = contractScore(c, made, isVul(b.vul, c.declarer));
    b.done = true;
    b.result = {
      made, need: c.level + 6, diff: made - (c.level + 6),
      declScore: score, nsScore: side(c.declarer) === 0 ? score : -score,
    };
  }

  const api = {
    SUIT_CH, SUIT_LT, SEAT_NAME, SEAT_LT, RANK_CH, PASS, DBL, RDBL,
    suitOf, rankOf, mk, cardName, partner, next, side, bid, lvlOf, strainOf, callName, callShort,
    dealerOfBoard, vulOfBoard, isVul, shuffle, deal, sortHand,
    lastBidInfo, auctionOver, legalCalls, isPassedOut, finalContract,
    legalPlays, trickWinner, contractScore,
    newBoard, curBidder, makeCall, controller, playCard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BridgeEngine = api;
})(typeof self !== 'undefined' ? self : this);
