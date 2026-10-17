/* 德州扑克引擎：牌力评估、整手牌流程（盲注/加注/全下/边池）、电脑决策。纯函数，浏览器与 Node 通用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Poker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RANK_CH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SUITS = ['♠', '♥', '♣', '♦'];
  const CAT_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

  // ---------- 牌 ----------
  function newDeck() {
    const d = [];
    for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) d.push({ r, s, id: (r - 2) * 4 + s });
    return d;
  }
  const ALL = newDeck();

  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 牌力评估（5~7 张牌，返回可直接比较大小的整数） ----------
  function enc(cat, ks) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 15 + (ks[i] || 0);
    return v;
  }
  function straightHigh(mask) {
    if (mask & (1 << 14)) mask |= 2; // A 当 1 用（A2345）
    for (let h = 14; h >= 5; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
    return 0;
  }

  const CNT = new Int8Array(15);
  function evaluate(cards) {
    CNT.fill(0);
    const suitMask = [0, 0, 0, 0];
    const suitCnt = [0, 0, 0, 0];
    let allMask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      CNT[c.r]++;
      suitMask[c.s] |= 1 << c.r;
      suitCnt[c.s]++;
      allMask |= 1 << c.r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (suitCnt[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sf = straightHigh(suitMask[flushSuit]);
      if (sf) return enc(8, [sf]);
    }
    let quad = 0;
    const trips = [], pairs = [];
    for (let r = 14; r >= 2; r--) {
      if (CNT[r] === 4) { if (!quad) quad = r; }
      else if (CNT[r] === 3) trips.push(r);
      else if (CNT[r] === 2) pairs.push(r);
    }
    const others = (...excl) => {
      const out = [];
      for (let r = 14; r >= 2; r--) if (CNT[r] > 0 && excl.indexOf(r) < 0) out.push(r);
      return out;
    };
    if (quad) return enc(7, [quad, others(quad)[0]]);
    if (trips.length && (trips.length >= 2 || pairs.length >= 1)) {
      const pr = Math.max(trips[1] || 0, pairs[0] || 0);
      return enc(6, [trips[0], pr]);
    }
    if (flushSuit >= 0) {
      const ks = [];
      for (let r = 14; r >= 2 && ks.length < 5; r--) if (suitMask[flushSuit] & (1 << r)) ks.push(r);
      return enc(5, ks);
    }
    const st = straightHigh(allMask);
    if (st) return enc(4, [st]);
    if (trips.length) return enc(3, [trips[0]].concat(others(trips[0]).slice(0, 2)));
    if (pairs.length >= 2) return enc(2, [pairs[0], pairs[1], others(pairs[0], pairs[1])[0]]);
    if (pairs.length === 1) return enc(1, [pairs[0]].concat(others(pairs[0]).slice(0, 3)));
    return enc(0, others().slice(0, 5));
  }

  function decode(score) {
    const ks = [];
    let v = score;
    for (let i = 0; i < 5; i++) { ks.unshift(v % 15); v = Math.floor(v / 15); }
    return { cat: v, ks };
  }
  function category(score) { return decode(score).cat; }
  function describe(score) {
    const { cat, ks } = decode(score);
    const R = (r) => RANK_CH[r];
    switch (cat) {
      case 8: return ks[0] === 14 ? '皇家同花顺' : '同花顺 ' + R(ks[0]) + '高';
      case 7: return '四条 ' + R(ks[0]);
      case 6: return '葫芦 ' + R(ks[0]) + '带' + R(ks[1]);
      case 5: return '同花 ' + R(ks[0]) + '高';
      case 4: return '顺子 ' + R(ks[0]) + '高';
      case 3: return '三条 ' + R(ks[0]);
      case 2: return '两对 ' + R(ks[0]) + '和' + R(ks[1]);
      case 1: return '一对 ' + R(ks[0]);
      default: return '高牌 ' + R(ks[0]);
    }
  }

  // ---------- 一手牌的完整流程 ----------
  /**
   * opts: {stacks:[], dealer, sb, bb, rnd, deck?}
   * stacks 里为 0 的座位视为不在本手牌中。事件写入 H.events，供界面逐步回放：
   *  blind / deal / action / street / showdown / award / end
   */
  function createHand(opts) {
    const rnd = opts.rnd || Math.random;
    const n = opts.stacks.length;
    const bb = opts.bb, sb = opts.sb;
    const deck = opts.deck ? opts.deck.slice() : shuffle(newDeck(), rnd);
    let di = 0;
    const H = {
      n, sb, bb, dealer: opts.dealer, board: [], street: 0, currentBet: 0, minRaise: bb,
      raises: 0, toAct: -1, done: false, events: [], result: null,
      p: opts.stacks.map((st, i) => ({
        seat: i, start: st, stack: st, bet: 0, total: 0, folded: st <= 0, out: st <= 0,
        allIn: false, acted: false, locked: false, hole: [],
      })),
    };
    const p = H.p;
    const potTotal = () => p.reduce((a, x) => a + x.total, 0);
    H.potTotal = potTotal;
    const nextLive = (s) => {
      for (let k = 1; k <= n; k++) { const i = (s + k) % n; if (!p[i].out) return i; }
      return s;
    };
    const nextToAct = (from) => {
      for (let k = 1; k <= n; k++) {
        const i = (from + k) % n;
        const x = p[i];
        if (!x.folded && !x.allIn && (!x.acted || x.bet < H.currentBet)) return i;
      }
      return -1;
    };
    const needsBetting = () => {
      const can = p.filter((x) => !x.folded && !x.allIn);
      if (can.length >= 2) return true;
      if (can.length === 1) return can[0].bet < H.currentBet;
      return false;
    };

    function post(seat, amt, kind) {
      const x = p[seat];
      const put = Math.min(amt, x.stack);
      x.stack -= put; x.bet += put; x.total += put;
      if (x.stack === 0) x.allIn = true;
      H.events.push({ t: 'blind', kind, seat, put, bet: x.bet, stack: x.stack, pot: potTotal() });
    }

    // 盲注与发牌
    const liveCount = p.filter((x) => !x.out).length;
    if (liveCount < 2) throw new Error('need at least two players');
    const sbSeat = liveCount === 2 ? H.dealer : nextLive(H.dealer);
    const bbSeat = nextLive(sbSeat);
    H.sbSeat = sbSeat; H.bbSeat = bbSeat;
    post(sbSeat, sb, 'sb');
    post(bbSeat, bb, 'bb');
    H.currentBet = Math.max(p[sbSeat].bet, p[bbSeat].bet);
    const order = [];
    for (let k = 0, s = sbSeat; k < liveCount; k++, s = nextLive(s)) order.push(s);
    for (let round = 0; round < 2; round++) for (const s of order) p[s].hole.push(deck[di++]);
    H.events.push({ t: 'deal', dealer: H.dealer, sb: sbSeat, bb: bbSeat });

    const first = liveCount === 2 ? sbSeat : nextLive(bbSeat);
    if (needsBetting()) H.toAct = nextToAct((first - 1 + n) % n);
    else advanceStreet();

    // ----- 内部流程 -----
    function endStreet() {
      for (const x of p) { x.bet = 0; x.acted = false; x.locked = false; }
      H.currentBet = 0; H.minRaise = bb; H.raises = 0;
      advanceStreet();
    }

    function advanceStreet() {
      H.toAct = -1;
      for (;;) {
        if (H.street === 3) { showdown(); return; }
        H.street++;
        const cnt = H.street === 1 ? 3 : 1;
        const cards = deck.slice(di, di + cnt);
        di += cnt;
        for (const c of cards) H.board.push(c);
        H.events.push({ t: 'street', name: ['flop', 'turn', 'river'][H.street - 1], cards, pot: potTotal() });
        if (needsBetting()) { H.toAct = nextToAct(H.dealer); return; }
      }
    }

    function buildPots() {
      const alive = p.filter((x) => !x.folded);
      const levels = Array.from(new Set(alive.map((x) => x.total))).filter((v) => v > 0).sort((a, b) => a - b);
      const pots = [];
      let prev = 0;
      for (const L of levels) {
        let amount = 0;
        for (const x of p) amount += Math.min(x.total, L) - Math.min(x.total, prev);
        const eligible = alive.filter((x) => x.total >= L).map((x) => x.seat);
        if (amount > 0) pots.push({ amount, eligible });
        prev = L;
      }
      // 理论上不会出现的残余筹码，并入最后一个池，保证守恒
      let rest = 0;
      for (const x of p) rest += x.total - Math.min(x.total, prev);
      if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
      return pots;
    }

    function finish(showdownHappened, winnersInfo) {
      H.done = true;
      H.toAct = -1;
      const net = p.map((x) => x.stack - x.start);
      H.result = { net, showdown: showdownHappened, pot: potTotal(), winners: winnersInfo };
      H.events.push({ t: 'end', net });
    }

    function showdown() {
      const alive = p.filter((x) => !x.folded);
      const hands = alive.map((x) => {
        const score = evaluate(x.hole.concat(H.board));
        return { seat: x.seat, hole: x.hole, score, name: describe(score) };
      });
      H.events.push({ t: 'showdown', hands });
      const byseat = {};
      for (const h of hands) byseat[h.seat] = h;
      const pots = buildPots();
      const winnersInfo = [];
      pots.forEach((pot, idx) => {
        if (pot.eligible.length === 1) {
          const x = p[pot.eligible[0]];
          x.stack += pot.amount;
          H.events.push({ t: 'award', seat: x.seat, amount: pot.amount, kind: 'refund', pot: idx, stack: x.stack });
          return;
        }
        let best = -1;
        for (const s of pot.eligible) best = Math.max(best, byseat[s].score);
        const winners = pot.eligible.filter((s) => byseat[s].score === best);
        // 按庄家左手边起算，余数筹码依次分给赢家
        winners.sort((a, b) => ((a - H.dealer - 1 + n) % n) - ((b - H.dealer - 1 + n) % n));
        const share = Math.floor(pot.amount / winners.length);
        let extra = pot.amount - share * winners.length;
        for (const s of winners) {
          const amt = share + (extra-- > 0 ? 1 : 0);
          p[s].stack += amt;
          winnersInfo.push({ seat: s, amount: amt, name: byseat[s].name, pot: idx });
          H.events.push({ t: 'award', seat: s, amount: amt, kind: winners.length > 1 ? 'split' : 'win', pot: idx, name: byseat[s].name, stack: p[s].stack });
        }
      });
      finish(true, winnersInfo);
    }

    function finishUncontested(seat) {
      const x = p[seat];
      const total = potTotal();
      x.stack += total;
      H.events.push({ t: 'award', seat, amount: total, kind: 'win', pot: 0, uncontested: true, stack: x.stack });
      finish(false, [{ seat, amount: total, name: '', pot: 0 }]);
    }

    function afterAction(s) {
      const alive = p.filter((x) => !x.folded);
      if (alive.length === 1) { finishUncontested(alive[0].seat); return; }
      const nx = nextToAct(s);
      if (nx >= 0) { H.toAct = nx; return; }
      endStreet();
    }

    // ----- 对外接口 -----
    H.legal = function () {
      if (H.done || H.toAct < 0) return null;
      const x = p[H.toAct];
      const fullToCall = Math.max(0, H.currentBet - x.bet);
      const maxTo = x.bet + x.stack;
      return {
        seat: x.seat, bet: x.bet, stack: x.stack, bb, currentBet: H.currentBet, pot: potTotal(),
        fullToCall, toCall: Math.min(fullToCall, x.stack),
        canCheck: fullToCall === 0, canCall: fullToCall > 0,
        canRaise: !x.locked && x.stack > fullToCall,
        minTo: Math.min(H.currentBet + H.minRaise, maxTo), maxTo,
      };
    };

    /** type: fold | check | call | raise(amount=加注到的总额) | allin */
    H.act = function (type, amount) {
      if (H.done || H.toAct < 0) throw new Error('no action expected');
      const s = H.toAct;
      const x = p[s];
      const toCall = H.currentBet - x.bet;
      if (type === 'allin') {
        if (x.stack + x.bet <= H.currentBet) type = 'call';
        else { type = 'raise'; amount = x.bet + x.stack; }
      }
      let a, put = 0;
      if (type === 'fold') {
        x.folded = true; a = 'fold';
      } else if (type === 'check') {
        if (toCall > 0) throw new Error('cannot check');
        x.acted = true; a = 'check';
      } else if (type === 'call') {
        if (toCall <= 0) throw new Error('nothing to call');
        put = Math.min(toCall, x.stack);
        x.stack -= put; x.bet += put; x.total += put;
        x.acted = true; a = 'call';
      } else if (type === 'raise') {
        if (x.locked) throw new Error('raise not allowed');
        const maxTo = x.bet + x.stack;
        const to = Math.min(Math.floor(amount), maxTo);
        if (!(to > H.currentBet)) throw new Error('raise must exceed current bet');
        const size = to - H.currentBet;
        const full = size >= H.minRaise;
        if (!full && to < maxTo) throw new Error('raise below minimum');
        a = H.currentBet === 0 ? 'bet' : 'raise';
        put = to - x.bet;
        x.stack -= put; x.bet = to; x.total += put;
        x.acted = true;
        for (const y of p) {
          if (y === x || y.folded || y.allIn) continue;
          if (full) { y.acted = false; y.locked = false; }
          else if (y.acted) { y.acted = false; y.locked = true; }
        }
        if (full) H.minRaise = size;
        H.currentBet = to;
        H.raises++;
      } else throw new Error('unknown action ' + type);
      if (x.stack === 0 && !x.folded) x.allIn = true;
      H.events.push({ t: 'action', seat: s, a, put, bet: x.bet, stack: x.stack, pot: potTotal(), allin: x.allIn });
      afterAction(s);
    };

    return H;
  }

  // ---------- 胜率估算与电脑决策 ----------
  function equity(hole, board, nOpp, iters, rnd) {
    rnd = rnd || Math.random;
    const used = new Set();
    for (const c of hole) used.add(c.id);
    for (const c of board) used.add(c.id);
    const rest = ALL.filter((c) => !used.has(c.id));
    const m = rest.length;
    const need = 5 - board.length + 2 * nOpp;
    let win = 0;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rnd() * (m - i));
        const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
      }
      const full = board.concat(rest.slice(0, 5 - board.length));
      const mine = evaluate(hole.concat(full));
      let idx = 5 - board.length, better = false, tie = 1;
      for (let o = 0; o < nOpp; o++) {
        const sc = evaluate([rest[idx++], rest[idx++]].concat(full));
        if (sc > mine) { better = true; break; }
        if (sc === mine) tie++;
      }
      if (!better) win += 1 / tie;
    }
    return win / iters;
  }

  const PERSONAS = [
    { name: '老王', tight: 0.03, aggr: 1.1, bluff: 0.04 },   // 紧凶
    { name: '小李', tight: -0.02, aggr: 1.3, bluff: 0.10 },  // 松凶
    { name: '阿杰', tight: -0.03, aggr: 0.7, bluff: 0.02 },  // 爱跟注
    { name: '陈姐', tight: 0.01, aggr: 1.0, bluff: 0.06 },   // 稳健
  ];

  /** 返回 {type, amount?}，type 为 fold/check/call/raise/allin */
  function aiDecide(H, seat, persona, rnd) {
    rnd = rnd || Math.random;
    persona = persona || PERSONAS[3];
    const L = H.legal();
    const me = H.p[seat];
    const nOpp = H.p.filter((x) => !x.folded).length - 1;
    const pot = L.pot;
    const eq = equity(me.hole, H.board, nOpp, H.street === 0 ? 500 : 600, rnd);
    const fair = 1 / (nOpp + 1);

    // 对手在下注/加注时，范围会比随机牌更强
    let adj = 0;
    if (L.fullToCall > 0) {
      const before = Math.max(1, pot - L.fullToCall);
      adj = Math.min(0.15, 0.09 * (L.fullToCall / before) + 0.03 * Math.min(2, H.raises));
      if (H.street === 0 && H.raises === 0) adj *= 0.3; // 只是面对大盲
    }
    const e = eq - adj - persona.tight + (rnd() - 0.5) * 0.05;
    const spread = 1 - fair;
    const valueT = fair + spread * 0.36;
    const betT = fair + spread * (H.street === 0 ? 0.14 : 0.2);
    const potOdds = L.toCall / (pot + L.toCall);

    const unit = Math.max(1, Math.floor(H.bb / 2));
    const sizeTo = (frac) => {
      let to = L.currentBet + Math.max(H.minRaise, frac * pot);
      to = Math.round(to / unit) * unit;
      to = Math.max(L.minTo, Math.min(L.maxTo, to));
      if (to >= 0.6 * L.maxTo) return { type: 'allin' };
      return { type: 'raise', amount: to };
    };
    const jitter = (lo, hi) => lo + rnd() * (hi - lo);

    if (L.canCheck) {
      if (L.canRaise) {
        if (e >= valueT && rnd() > 0.12) return sizeTo(jitter(0.6, 0.95));
        if (e >= betT && rnd() < 0.8 * persona.aggr) return sizeTo(jitter(0.4, 0.7));
        if (nOpp <= 2 && eq < fair && rnd() < persona.bluff) return sizeTo(jitter(0.5, 0.7));
      }
      return { type: 'check' };
    }
    // 翻牌前还没人加注：手牌够好就主动加注入池
    if (H.street === 0 && H.raises === 0 && L.canRaise && e >= betT && rnd() < 0.85 * persona.aggr) return sizeTo(jitter(0.9, 1.6));
    if (e >= valueT && L.canRaise && rnd() < 0.55 * persona.aggr + 0.2) return sizeTo(jitter(0.75, 1.1));
    if (e >= potOdds + 0.04) return { type: 'call' };
    if (L.toCall <= H.bb && e >= potOdds - 0.02) return { type: 'call' };
    return { type: 'fold' };
  }


  // ---------- 出牌建议（给人类玩家的提示） ----------

  /** Chen 公式：翻牌前起手牌评分 */
  function chenScore(h) {
    const hi = Math.max(h[0].r, h[1].r), lo = Math.min(h[0].r, h[1].r);
    const pts = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
    let sc = pts(hi);
    if (hi === lo) return Math.max(5, Math.ceil(sc * 2));
    if (h[0].s === h[1].s) sc += 2;
    const gap = hi - lo - 1;
    sc -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 12) sc += 1;
    return Math.ceil(sc);
  }
  function startingTier(h) {
    const c = chenScore(h);
    return c >= 12 ? '顶级起手牌' : c >= 9 ? '强牌' : c >= 7 ? '不错的牌' : c >= 5 ? '可玩的投机牌' : '弱牌，翻牌前多数应弃';
  }

  /** 统计补牌：翻牌/转牌时，下一张牌能把牌型升级的张数，按升级后的牌型分组 */
  function countOuts(hole, board) {
    if (board.length < 3 || board.length > 4) return null;
    const cur = category(evaluate(hole.concat(board)));
    if (cur >= 4) return null; // 已经是顺子以上
    const used = new Set(hole.concat(board).map((c) => c.id));
    const groups = {};
    let total = 0;
    for (const c of ALL) {
      if (used.has(c.id)) continue;
      const cat = category(evaluate(hole.concat(board, [c])));
      if (cat > cur && cat >= 2) { groups[cat] = (groups[cat] || 0) + 1; total++; }
    }
    const unseen = 52 - hole.length - board.length;
    const left = 5 - board.length;
    let pct;
    if (left === 2) pct = 1 - ((unseen - total) / unseen) * ((unseen - total - 1) / (unseen - 1));
    else pct = total / unseen;
    const list = Object.keys(groups).map((k) => ({ cat: +k, name: CAT_NAMES[k], n: groups[k] })).sort((a, b) => b.n - a.n);
    return { total, pct, groups: list, cur };
  }

  /**
   * 给出建议。opts: {hole, board, nOpp, pot, toCall, raises, street, rnd, iters}
   * 返回 {eq, eqAdj, need, action, reason, outs, tier}
   */
  function advise(o) {
    const nOpp = Math.max(1, o.nOpp);
    const eq = equity(o.hole, o.board, nOpp, o.iters || 1200, o.rnd);
    const fair = 1 / (nOpp + 1);
    const toCall = o.toCall;
    const pot = o.pot;
    let adj = 0;
    if (toCall > 0) {
      const before = Math.max(1, pot - toCall);
      adj = Math.min(0.15, 0.09 * (toCall / before) + 0.03 * Math.min(2, o.raises || 0));
      if (o.street === 0 && !o.raises) adj *= 0.3;
    }
    const eqAdj = eq - adj;
    const need = toCall > 0 ? toCall / (pot + toCall) : 0;
    const outs = countOuts(o.hole, o.board);
    const pc = (x) => Math.round(x * 100) + '%';
    let action, reason;
    if (toCall <= 0) {
      if (eqAdj >= fair + 0.28 * (1 - fair)) { action = 'raise'; reason = '胜率 ' + pc(eq) + '，牌力领先，下注收取价值'; }
      else { action = 'check'; reason = '胜率 ' + pc(eq) + '，牌力一般，免费看牌'; }
    } else {
      const strong = Math.max(need + 0.2, fair + 0.3 * (1 - fair));
      if (eqAdj >= strong) { action = 'raise'; reason = '有效胜率 ' + pc(eqAdj) + ' 远高于所需 ' + pc(need) + '，可以加注'; }
      else if (eqAdj >= need) { action = 'call'; reason = '有效胜率 ' + pc(eqAdj) + ' ≥ 所需 ' + pc(need) + '，跟注划算'; }
      else if (outs && outs.pct >= need - 0.02 && outs.total >= 8) { action = 'call'; reason = '听牌：补牌概率 ' + pc(outs.pct) + ' 接近所需 ' + pc(need) + '，可以跟'; }
      else { action = 'fold'; reason = '有效胜率 ' + pc(eqAdj) + ' < 所需 ' + pc(need) + '，不划算'; }
    }
    return { eq, eqAdj, need, action, reason, outs, tier: o.board.length === 0 ? startingTier(o.hole) : '' };
  }

  return {
    RANK_CH, SUITS, CAT_NAMES, PERSONAS,
    newDeck, shuffle, evaluate, describe, category, decode, createHand, equity, aiDecide, advise, chenScore, countOuts,
  };
});
