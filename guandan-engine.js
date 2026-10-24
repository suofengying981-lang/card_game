/* 掼蛋规则引擎 + 电脑 AI。UMD，可在 Node 里测试。
 * 两副牌 108 张；座位 0..3，0 与 2 是一家（0 = 你）；逢人配 = 红桃级牌。
 * 牌 id = 副*54 + k：k<52 为 花色*13 + (点数-2)，52 小王，53 大王。
 */
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♣', '♦'];
  const rankOf = (c) => { const k = c % 54; return k >= 52 ? (k === 52 ? 16 : 17) : (k % 13) + 2; };
  const suitOf = (c) => { const k = c % 54; return k >= 52 ? -1 : Math.floor(k / 13); };
  const isWild = (c, L) => suitOf(c) === 1 && rankOf(c) === L;
  const ov = (rank, L) => (rank === L ? 15 : rank);          // 单牌/对子等的大小（级牌仅次于大小王）
  const RANK_CH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王' };
  const cardName = (c) => (rankOf(c) >= 16 ? RANK_CH[rankOf(c)] : SUITS[suitOf(c)] + RANK_CH[rankOf(c)]);

  const BOMB_TIER = { 4: 1, 5: 2, 6: 4, 7: 5, 8: 6 };
  const TYPE_NAME = { single: '单张', pair: '对子', triple: '三张', full: '三带二', straight: '顺子', pairs3: '木板', plate: '钢板', bomb4: '炸弹', bomb5: '五张炸', sf: '同花顺', bomb6: '六张炸', bomb7: '七张炸', bomb8: '八张炸', rocket: '天王炸' };

  // ---------- 牌型识别 ----------
  /** 序列中的取值：A 既可当 14 也可当 1 */
  function seqValue(k, start, len) {
    if (k === 14) return start === 1 ? 1 : 14;
    return k;
  }
  function fitSeq(cnt, start, len, per) {
    const vc = {};
    for (const key in cnt) {
      const k = +key;
      if (k >= 16) return false;
      const v = seqValue(k, start, len);
      if (v < start || v > start + len - 1) return false;
      vc[v] = (vc[v] || 0) + cnt[k];
      if (vc[v] > per) return false;
    }
    return true;
  }

  /** 返回这组牌所有可能的牌型解释 [{type,main,tier}]；非法则空数组。 */
  function interp(cards, L) {
    const n = cards.length;
    const res = [];
    let w = 0;
    const cnt = {};
    const suits = new Set();
    let nat = 0;
    for (const c of cards) {
      if (isWild(c, L)) { w++; continue; }
      const r = rankOf(c);
      cnt[r] = (cnt[r] || 0) + 1;
      nat++;
      suits.add(suitOf(c));
    }
    const keys = Object.keys(cnt).map(Number);
    const hasJoker = keys.some((k) => k >= 16);
    if (n === 4 && cnt[16] === 2 && cnt[17] === 2) res.push({ type: 'rocket', tier: 7, main: 99 });
    if (n === 1) res.push({ type: 'single', tier: 0, main: keys.length ? ov(keys[0], L) : 15 });
    if (n === 2) {
      if (keys.length === 1 && (!hasJoker || cnt[keys[0]] === 2)) res.push({ type: 'pair', tier: 0, main: ov(keys[0], L) });
      else if (keys.length === 0) res.push({ type: 'pair', tier: 0, main: 15 });
    }
    if (n === 3 && keys.length === 1 && !hasJoker) res.push({ type: 'triple', tier: 0, main: ov(keys[0], L) });
    if (n >= 4 && n <= 8 && keys.length === 1 && !hasJoker) {
      res.push({ type: 'bomb' + n, tier: BOMB_TIER[n], main: ov(keys[0], L) });
    }
    if (n === 5) {
      // 三带二
      for (let a = 2; a <= 14; a++) {
        for (let b = 2; b <= 17; b++) {
          if (a === b) continue;
          if (keys.some((k) => k !== a && k !== b)) continue;
          const ca = cnt[a] || 0, cb = cnt[b] || 0;
          if (ca > 3 || cb > 2) continue;
          const needA = 3 - ca, needB = 2 - cb;
          if (b >= 16 && needB > 0) continue;
          if (needA + needB === w) res.push({ type: 'full', tier: 0, main: ov(a, L) });
        }
      }
      // 顺子 / 同花顺
      const flush = suits.size === 1 && !hasJoker && nat >= 1;
      for (let s = 1; s <= 10; s++) {
        if (!fitSeq(cnt, s, 5, 1)) continue;
        res.push({ type: 'straight', tier: 0, main: s + 4 });
        if (flush) res.push({ type: 'sf', tier: 3, main: s + 4 });
      }
    }
    if (n === 6) {
      for (let s = 1; s <= 12; s++) if (fitSeq(cnt, s, 3, 2)) res.push({ type: 'pairs3', tier: 0, main: s + 2 });
      for (let s = 1; s <= 13; s++) if (fitSeq(cnt, s, 2, 3)) res.push({ type: 'plate', tier: 0, main: s + 1 });
    }
    return res;
  }

  const strength = (i) => i.tier * 1000 + i.main;
  const best = (list) => list.reduce((a, b) => (a && strength(a) >= strength(b) ? a : b), null);

  /** a 能否压过 b（都是解释对象） */
  function beats(a, b) {
    if (a.tier || b.tier) {
      if (a.tier !== b.tier) return a.tier > b.tier;
      return a.main > b.main;
    }
    return a.type === b.type && a.main > b.main;
  }

  /** 从一组牌里选出合法解释：lead 时取最强；跟牌时取能压住台面的最强。无则 null。 */
  function chooseInterp(cards, tableIns, L) {
    const ins = interp(cards, L);
    if (!ins.length) return null;
    if (!tableIns) return best(ins);
    return best(ins.filter((i) => beats(i, tableIns)));
  }

  // ---------- 候选出牌生成（AI / 提示用） ----------
  function genPlays(hand, L) {
    const wilds = hand.filter((c) => isWild(c, L));
    const byRank = {};
    const bySuitRank = {};
    for (const c of hand) {
      if (isWild(c, L)) continue;
      const r = rankOf(c);
      (byRank[r] = byRank[r] || []).push(c);
      const s = suitOf(c);
      if (s >= 0) { const k = s + ':' + r; (bySuitRank[k] = bySuitRank[k] || []).push(c); }
    }
    const W = wilds.length;
    const out = [];
    const seen = new Set();
    const add = (cards) => {
      const key = cards.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      const ins = interp(cards, L);
      if (ins.length) out.push({ cards, ins, best: best(ins), wilds: cards.filter((c) => isWild(c, L)).length });
    };
    const ranks = Object.keys(byRank).map(Number);
    const cnt = (r) => (byRank[r] ? byRank[r].length : 0);

    for (const r of ranks) add([byRank[r][0]]);
    if (W) add([wilds[0]]);
    for (const r of ranks) {
      if (cnt(r) >= 2) add(byRank[r].slice(0, 2));
      else if (r < 16 && W) add([byRank[r][0], wilds[0]]);
    }
    if (W === 2) add([wilds[0], wilds[1]]);
    for (const r of ranks) {
      if (r >= 16) continue;
      const k = cnt(r);
      if (k >= 3) add(byRank[r].slice(0, 3));
      else if (k + W >= 3) add(byRank[r].concat(wilds).slice(0, 3));
    }
    for (let n = 4; n <= 8; n++) {
      for (const r of ranks) {
        if (r >= 16) continue;
        const k = Math.min(cnt(r), n);
        if (k + W >= n && k >= 1) add(byRank[r].slice(0, k).concat(wilds.slice(0, n - k)));
      }
    }
    if (cnt(16) >= 2 && cnt(17) >= 2) add(byRank[16].slice(0, 2).concat(byRank[17].slice(0, 2)));

    // 三带二
    const trip = [], pr = [];
    for (let r = 2; r <= 14; r++) {
      const k = cnt(r);
      if (k >= 1) trip.push({ r, nat: byRank[r].slice(0, Math.min(3, k)), need: Math.max(0, 3 - k) });
    }
    for (let r = 2; r <= 17; r++) {
      const k = cnt(r);
      if (k >= 2) pr.push({ r, nat: byRank[r].slice(0, 2), need: 0 });
      else if (k === 1 && r <= 14) pr.push({ r, nat: byRank[r].slice(0, 1), need: 1 });
    }
    for (const t of trip) for (const p of pr) {
      if (t.r === p.r || t.need + p.need > W) continue;
      add(t.nat.concat(p.nat, wilds.slice(0, t.need + p.need)));
    }
    // 顺子 / 同花顺 / 木板 / 钢板
    const seqCards = (start, len, per, pick) => {
      const cards = [];
      let need = 0;
      for (let v = start; v < start + len; v++) {
        const r = v === 1 ? 14 : v;
        const have = pick(r);
        const take = have.slice(0, per);
        cards.push(...take);
        need += per - take.length;
      }
      return need <= W ? cards.concat(wilds.slice(0, need)) : null;
    };
    for (let s = 1; s <= 10; s++) {
      const c = seqCards(s, 5, 1, (r) => byRank[r] || []);
      if (c) add(c);
      for (let su = 0; su < 4; su++) {
        const f = seqCards(s, 5, 1, (r) => bySuitRank[su + ':' + r] || []);
        if (f) add(f);
      }
    }
    for (let s = 1; s <= 12; s++) { const c = seqCards(s, 3, 2, (r) => byRank[r] || []); if (c) add(c); }
    for (let s = 1; s <= 13; s++) { const c = seqCards(s, 2, 3, (r) => byRank[r] || []); if (c) add(c); }
    return out;
  }

  function followPlays(plays, tableIns) {
    const res = [];
    for (const p of plays) {
      const ok = p.ins.filter((i) => beats(i, tableIns));
      if (ok.length) res.push({ cards: p.cards, ins: p.best && ok.includes(p.best) ? p.best : best(ok), wilds: p.wilds });
    }
    return res;
  }

  // ---------- 牌局 ----------
  const partnerOf = (s) => (s + 2) & 3;
  const teamOf = (s) => s & 1;

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function sortHand(hand, L) {
    const key = (c) => {
      if (isWild(c, L)) return 1000;
      const o = ov(rankOf(c), L);
      return o * 10 + (suitOf(c) < 0 ? 0 : 3 - suitOf(c));
    };
    hand.sort((a, b) => key(b) - key(a) || a - b);
  }

  function newMatch() {
    return { teamLevel: [2, 2], round: 0, prev: null, gameWinner: -1 };
  }

  /** 发牌并开始新的一局。match.prev 里有上局名次时按规则进贡/还贡。返回牌局状态。 */
  function newRound(match) {
    const prev = match.prev;
    const L = prev ? match.teamLevel[teamOf(prev.order[0])] : 2;
    const deck = shuffle(Array.from({ length: 108 }, (_, i) => i));
    const hands = [0, 1, 2, 3].map((p) => deck.slice(p * 27, p * 27 + 27));
    const st = {
      L, hands, table: null, turn: 0, leader: 0, responders: [], passedBy: [], finished: [], lastPlays: [null, null, null, null],
      tribute: null, over: false, result: null, plays: 0, played: [],
    };
    match.round++;
    if (prev) doTribute(st, prev);
    else st.leader = st.turn = Math.floor(Math.random() * 4);
    hands.forEach((h) => sortHand(h, L));
    return st;
  }

  function doTribute(st, prev) {
    const { L, hands } = st;
    const order = prev.order;                                  // [头游, 二游, 三游, 末游]
    const doubleUp = teamOf(order[0]) === teamOf(order[1]);
    const givers = doubleUp ? [order[2], order[3]] : [order[3]];
    const takers = doubleUp ? [order[0], order[1]] : [order[0]];
    const bigJokers = givers.reduce((s, g) => s + hands[g].filter((c) => rankOf(c) === 17).length, 0);
    if (bigJokers >= 2) {                                      // 抗贡
      st.tribute = { anti: true, givers, takers, moves: [] };
      st.leader = st.turn = order[0];
      return;
    }
    const top = (h) => h.filter((c) => !isWild(c, L)).sort((a, b) => ov(rankOf(b), L) - ov(rankOf(a), L) || a - b)[0];
    const moves = [];
    const picks = givers.map((g) => ({ g, c: top(hands[g]) }));
    if (doubleUp) {
      picks.sort((a, b) => ov(rankOf(b.c), L) - ov(rankOf(a.c), L));       // 大的给头游
    }
    picks.forEach((p, i) => moves.push({ from: p.g, to: takers[i], card: p.c }));
    for (const m of moves) {
      hands[m.from].splice(hands[m.from].indexOf(m.card), 1);
      hands[m.to].push(m.card);
    }
    // 还贡：收到贡牌的人还一张不大于 10 的牌（取最小）
    for (const m of moves) {
      const cand = hands[m.to].filter((c) => !isWild(c, L) && rankOf(c) <= 10 && c !== m.card).sort((a, b) => ov(rankOf(a), L) - ov(rankOf(b), L) || a - b);
      const back = cand[0] !== undefined ? cand[0] : hands[m.to].filter((c) => c !== m.card).sort((a, b) => ov(rankOf(a), L) - ov(rankOf(b), L))[0];
      hands[m.to].splice(hands[m.to].indexOf(back), 1);
      hands[m.from].push(back);
      m.back = back;
    }
    st.tribute = { anti: false, givers, takers, moves };
    st.leader = st.turn = moves[0].from;                       // 进贡中贡牌最大的人先出
  }

  const active = (st, p) => !st.finished.includes(p) && st.hands[p].length > 0;
  const nextActive = (st, p) => { for (let i = 1; i <= 4; i++) { const q = (p + i) & 3; if (active(st, q)) return q; } return -1; };

  /** 出牌：cards 必须来自该玩家手牌，ins 为选定的牌型解释。返回 {ok, msg} */
  function play(st, p, cards, ins) {
    if (st.over || st.turn !== p) return { ok: false, msg: '还没轮到' };
    if (st.table && !beats(ins, st.table.ins)) return { ok: false, msg: '压不住上家' };
    for (const c of cards) { const i = st.hands[p].indexOf(c); if (i < 0) return { ok: false, msg: '没有这张牌' }; }
    for (const c of cards) st.hands[p].splice(st.hands[p].indexOf(c), 1);
    if (!st.table) st.lastPlays = [null, null, null, null];     // 新一轮开始，清掉上一轮的台面
    st.table = { player: p, cards: cards.slice(), ins };
    st.lastPlays[p] = { cards: cards.slice(), ins };
    st.plays++;
    for (const c of cards) st.played.push(c);
    if (!st.hands[p].length) st.finished.push(p);
    st.responders = [0, 1, 2, 3].filter((q) => q !== p && active(st, q));
    st.passedBy = [];
    if (checkEnd(st)) return { ok: true };
    advance(st);
    return { ok: true };
  }

  function pass(st, p) {
    if (st.over || st.turn !== p || !st.table) return { ok: false, msg: '先手不能不出' };
    st.lastPlays[p] = { pass: true };
    st.passedBy.push(p);
    advance(st);
    return { ok: true };
  }

  function advance(st) {
    if (!st.table) { st.turn = st.leader; return; }
    const pending = st.responders.filter((q) => active(st, q) && !st.passedBy.includes(q));
    if (!pending.length) {
      // 本轮所有该应的人都已不要 → 这一轮结束，赢家（或其队友/下家）接着出
      const w = st.table.player;
      let lead = w;
      if (!active(st, w)) { const pt = partnerOf(w); lead = active(st, pt) ? pt : nextActive(st, w); }
      st.table = null; st.leader = lead; st.turn = lead; st.passedBy = []; st.responders = [];
      return;
    }
    for (let i = 1; i <= 4; i++) {
      const q = (st.turn + i) & 3;
      if (pending.includes(q)) { st.turn = q; return; }
    }
  }

  function checkEnd(st) {
    const f = st.finished;
    const sameTeam = f.length >= 2 && teamOf(f[0]) === teamOf(f[1]);
    if (f.length === 3 || sameTeam) {
      const order = f.slice();
      for (const p of nextOrder(st, order)) order.push(p);
      st.over = true;
      const t = teamOf(order[0]);
      let up;
      if (teamOf(order[1]) === t) up = 3;
      else if (teamOf(order[2]) === t) up = 2;
      else up = 1;
      st.result = { order, winTeam: t, up };
      return true;
    }
    return false;
  }

  /** 剩下的人按手牌数少的在前排名 */
  function nextOrder(st, order) {
    return [0, 1, 2, 3].filter((p) => !order.includes(p)).sort((a, b) => st.hands[a].length - st.hands[b].length);
  }

  /** 局结束后结算升级。返回 {upgraded, newLevel, gameWon} */
  function settle(match, st) {
    const r = st.result;
    const t = r.winTeam;
    let lvl = match.teamLevel[t];
    let gameWon = false;
    if (lvl >= 14) {
      if (r.up >= 2) gameWon = true;
    } else {
      lvl = Math.min(14, lvl + r.up);
    }
    match.teamLevel[t] = lvl;
    match.prev = { order: r.order };
    if (gameWon) match.gameWinner = t;
    return { team: t, up: r.up, newLevel: lvl, gameWon };
  }

  // ---------- 电脑 AI ----------
  function aiChoose(st, p, level) {
    const L = st.L;
    const hand = st.hands[p];
    const plays = genPlays(hand, L);
    const partner = partnerOf(p);
    const foes = [(p + 1) & 3, (p + 3) & 3];
    const minFoe = Math.min(...foes.filter((q) => st.hands[q].length > 0).map((q) => st.hands[q].length), 99);
    const cnt = {};
    for (const c of hand) if (!isWild(c, L)) cnt[rankOf(c)] = (cnt[rankOf(c)] || 0) + 1;

    const breaks = (pl) => {
      if (pl.best.tier) return 0;
      let b = 0;
      const used = {};
      for (const c of pl.cards) if (!isWild(c, L)) used[rankOf(c)] = (used[rankOf(c)] || 0) + 1;
      for (const r in used) if (cnt[r] >= 4 && used[r] < cnt[r]) b++;
      return b;
    };
    const cost = (pl) => {
      const i = pl.best;
      const size = pl.cards.length;
      let s = size * 3 - (i.tier ? 0 : i.main * 0.9);
      if (i.type === 'single' || i.type === 'pair') s -= 0;
      s -= breaks(pl) * 9;
      s -= pl.wilds * 3.5;
      if (i.tier) s -= 25 + i.tier * 4;
      return s;
    };
    const finishesNow = (pl) => pl.cards.length === hand.length;

    if (!st.table) {
      // 先手
      const all = plays.filter((pl) => finishesNow(pl)).concat(plays.filter((pl) => !pl.best.tier));
      if (!all.length) return plays.length ? { cards: plays[0].cards, ins: plays[0].best } : null;
      if (all.some(finishesNow)) { const f = all.find(finishesNow); return { cards: f.cards, ins: f.best }; }
      let cands = all;
      if (minFoe <= 2) cands = all.filter((pl) => pl.cards.length > 1 || pl.best.main >= 14).concat(all.filter((pl) => pl.cards.length === 1 && pl.best.main >= 13));
      if (!cands.length) cands = all;
      cands.sort((a, b) => cost(b) - cost(a));
      const top = level === 0 ? cands[Math.floor(Math.random() * Math.min(3, cands.length))] : cands[0];
      return { cards: top.cards, ins: top.best };
    }

    // 跟牌
    const tIns = st.table.ins;
    const fl = followPlays(plays, tIns);
    if (!fl.length) return null;
    const byPartner = st.table.player === partner;
    const fin = fl.find((x) => x.cards.length === hand.length);
    if (fin) return { cards: fin.cards, ins: fin.ins };
    if (byPartner) {
      // 队友在领先：除非我能出完，否则不要，但队友出的是小牌且我快走完时可接
      return null;
    }
    const normal = fl.filter((x) => !x.ins.tier).map((x) => ({ x, c: x.cards.length * 0 - x.ins.main + (x.wilds ? -4 * x.wilds : 0) - breaks({ best: x.ins, cards: x.cards, wilds: x.wilds }) * 6 }));
    const bombs = fl.filter((x) => x.ins.tier).sort((a, b) => strength(a.ins) - strength(b.ins));
    const urgent = minFoe <= 4 || st.hands[st.table.player].length <= 3;
    if (normal.length) {
      normal.sort((a, b) => b.c - a.c);
      const pick = normal[0].x;
      // 不为了压小牌而白白打出很大的牌（除非对手快走完了）
      if (!urgent && level >= 1 && pick.ins.main >= 14 && st.hands[st.table.player].length > 10 && st.table.ins.main < 10) return null;
      return { cards: pick.cards, ins: pick.ins };
    }
    if (bombs.length && (urgent || hand.length <= 8 || (level === 0 && Math.random() < 0.3))) return { cards: bombs[0].cards, ins: bombs[0].ins };
    return null;
  }

  const api = {
    SUITS, RANK_CH, TYPE_NAME, rankOf, suitOf, isWild, ov, cardName, interp, beats, chooseInterp, best, strength, genPlays, followPlays,
    partnerOf, teamOf, sortHand, newMatch, newRound, play, pass, settle, aiChoose, active,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GuandanEngine = api;
})(typeof self !== 'undefined' ? self : this);
