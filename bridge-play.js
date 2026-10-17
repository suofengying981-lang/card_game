/* 桥牌打牌 AI：开叫引牌规则 + 确定化蒙特卡洛（PIMC）推演。
   推演中随机补全看不见的两家手牌（遵守"缺门"与叫牌推断的点力/长度约束），
   再用启发式打法打完整副牌，选使本方平均赢墩最多的出牌。不使用任何真实未知手牌。 */
(function (root) {
  'use strict';
  const E = typeof require !== 'undefined' ? require('./bridge-engine.js') : root.BridgeEngine;
  const BB = typeof require !== 'undefined' ? require('./bridge-bid.js') : root.BridgeBid;
  const { suitOf, rankOf, mk, partner, side, legalPlays } = E;
  const FULL = 0x1fff;
  const HCP_BIT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]; // 位 9=J(1) 10=Q(2) 11=K(3) 12=A(4)

  const hi = (m) => 31 - Math.clz32(m);
  const lo = (m) => 31 - Math.clz32(m & -m);
  function pop(m) { m -= (m >>> 1) & 0x55555555; m = (m & 0x33333333) + ((m >>> 2) & 0x33333333); return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
  const above = (m, r) => m & ~((2 << r) - 1);        // 比 r 大的位

  // ---------- 推演用的紧凑状态 ----------
  // H[seat*4+suit] = 位图（位 r 对应点数 r+2）
  function makeState(b, hands4) {
    const p = b.play, c = b.contract;
    const H = new Int32Array(16), P = new Int32Array(4);
    for (let s = 0; s < 4; s++) for (const card of hands4[s]) H[s * 4 + suitOf(card)] |= 1 << (rankOf(card) - 2);
    for (const x of p.played) P[suitOf(x.card)] |= 1 << (rankOf(x.card) - 2);
    const st = {
      H, P, trump: c.strain, declarer: c.declarer, dummy: c.dummy,
      tSeat: [0, 0, 0, 0], tSuit: [0, 0, 0, 0], tRank: [0, 0, 0, 0], n: 0, led: -1,
      bestIdx: -1, turn: p.turn, declTricks: p.tricks[side(c.declarer)], tricksDone: p.tricksLog.length,
    };
    for (const t of p.trick) addTrick(st, t.seat, suitOf(t.card), rankOf(t.card) - 2, true);
    return st;
  }
  function copyState(st) {
    return {
      H: Int32Array.from(st.H), P: Int32Array.from(st.P), trump: st.trump, declarer: st.declarer, dummy: st.dummy,
      tSeat: st.tSeat.slice(), tSuit: st.tSuit.slice(), tRank: st.tRank.slice(), n: st.n, led: st.led, bestIdx: st.bestIdx,
      turn: st.turn, declTricks: st.declTricks, tricksDone: st.tricksDone,
    };
  }
  function beats(st, i, j) { // 第 i 张是否压过第 j 张
    const si = st.tSuit[i], sj = st.tSuit[j];
    if (si === sj) return st.tRank[i] > st.tRank[j];
    return si === st.trump && sj !== st.trump;
  }
  function addTrick(st, seat, suit, r, skipRemove) {
    const i = st.n;
    st.tSeat[i] = seat; st.tSuit[i] = suit; st.tRank[i] = r;
    if (!skipRemove) st.H[seat * 4 + suit] &= ~(1 << r);
    st.P[suit] |= 1 << r;
    if (i === 0) { st.led = suit; st.bestIdx = 0; } else if (beats(st, i, st.bestIdx)) st.bestIdx = i;
    st.n++;
  }
  // 出牌并推进；每墩结束结算
  function stepPlay(st, suit, r) {
    const seat = st.turn;
    addTrick(st, seat, suit, r);
    if (st.n < 4) { st.turn = (seat + 1) & 3; return; }
    const w = st.tSeat[st.bestIdx];
    if ((w & 1) === (st.declarer & 1)) st.declTricks++;
    st.tricksDone++;
    st.n = 0; st.led = -1; st.bestIdx = -1; st.turn = w;
  }

  // ---------- 启发式打法（推演与回退共用）----------
  function lowestBit(m) { return lo(m); }
  function knownMask(st, ctrl, suit) { return st.H[ctrl * 4 + suit] | st.H[st.dummy * 4 + suit]; }
  function isMaster(st, ctrl, suit, r) {
    const out = FULL & ~st.P[suit] & ~knownMask(st, ctrl, suit);
    return (out >> (r + 1)) === 0;
  }
  function policy(st) {
    const s = st.turn, base = s * 4;
    const ctrl = s === st.dummy ? st.declarer : s;
    const trump = st.trump;
    if (st.n === 0) return leadPolicy(st, s, ctrl);
    const L = st.led, m = st.H[base + L];
    const bi = st.bestIdx, bSeat = st.tSeat[bi], bSuit = st.tSuit[bi], bRank = st.tRank[bi];
    const partnerWins = (bSeat & 1) === (s & 1);
    if (m) {
      if (bSuit !== L) return [L, lo(m)];
      const ab = above(m, bRank);
      if (st.n === 3) return partnerWins || !ab ? [L, lo(m)] : [L, lo(ab)];
      if (st.n === 2) {
        if (partnerWins) {
          if (isMaster(st, ctrl, L, bRank)) return [L, lo(m)];
          // 搭档的牌可能被第四家压过：能压过更大的就出
          const out = FULL & ~st.P[L] & ~knownMask(st, ctrl, L);
          const topOut = out ? hi(out) : -1;
          const cover = above(m, topOut);
          if (cover && trump >= 4 || cover && trump < 4) return [L, lo(cover)];
          return [L, lo(m)];
        }
        if (ab) return [L, lo(ab)];
        return [L, lo(m)];
      }
      // 第二家：低出；荣誉牌引出时用更大的盖
      if (bRank >= 9 && ab && !partnerWins) return [L, lo(ab)];
      return [L, lo(m)];
    }
    // 缺门：将吃或垫牌
    if (trump < 4) {
      const tm = st.H[base + trump];
      if (tm) {
        let winning = partnerWins;
        if (winning && bSuit !== trump && st.n < 3 && !isMaster(st, ctrl, bSuit, bRank)) winning = false;
        if (!winning) {
          if (bSuit === trump) { const ab = above(tm, bRank); if (ab) return [trump, lo(ab)]; }
          else return [trump, lo(tm)];
        }
      }
    }
    return discard(st, s, ctrl);
  }
  function discard(st, s, ctrl) {
    const base = s * 4;
    let bestSuit = -1, bestScore = -1e9;
    for (let su = 0; su < 4; su++) {
      const m = st.H[base + su];
      if (!m) continue;
      if (su === st.trump && st.trump < 4) continue;
      const len = pop(m);
      const top = hi(m);
      let score = len * 2;
      if (isMaster(st, ctrl, su, top)) score -= 6 + pop(m) * 0.2;
      if (top >= 10) score -= 3;
      if (len === 1 && top >= 9) score -= 4;
      if (score > bestScore) { bestScore = score; bestSuit = su; }
    }
    if (bestSuit < 0) { // 只剩将牌
      for (let su = 0; su < 4; su++) if (st.H[base + su]) return [su, lo(st.H[base + su])];
    }
    return [bestSuit, lo(st.H[base + bestSuit])];
  }
  function leadPolicy(st, s, ctrl) {
    const base = s * 4, trump = st.trump;
    const declSide = (ctrl & 1) === (st.declarer & 1);
    // 其余看不见的将牌
    const outTrump = trump < 4 ? (FULL & ~st.P[trump] & ~knownMask(st, ctrl, trump)) : 0;
    if (declSide && trump < 4 && outTrump && st.H[base + trump]) {
      const ours = pop(st.H[st.declarer * 4 + trump]) + pop(st.H[st.dummy * 4 + trump]);
      if (ours > pop(outTrump)) return [trump, hi(st.H[base + trump])];
    }
    // 兑现大牌（最大的未出牌）
    let bestSuit = -1, bestN = 0;
    for (let su = 0; su < 4; su++) {
      const m = st.H[base + su];
      if (!m || (su === trump)) continue;
      const out = FULL & ~st.P[su] & ~knownMask(st, ctrl, su);
      if ((out >> (hi(m) + 1)) !== 0) continue;
      // 连续的大牌数
      let n = 0, mm = m;
      while (mm && (out >> (hi(mm) + 1)) === 0) { n++; mm &= ~(1 << hi(mm)); }
      if (n > bestN) { bestN = n; bestSuit = su; }
    }
    if (bestSuit >= 0) return [bestSuit, hi(st.H[base + bestSuit])];
    if (trump < 4 && st.H[base + trump] && (!declSide || !outTrump)) {
      // 防守方没有别的好牌时才考虑将牌；有就继续
    }
    // 长套低张（防守者用第四张最大）
    let pick = -1, pl = -1;
    for (let su = 0; su < 4; su++) {
      const m = st.H[base + su];
      if (!m || su === trump) continue;
      const len = pop(m);
      let sc = len * 3;
      // 连牌顶张加分
      const t = hi(m);
      if (t >= 10 && (m >> (t - 1)) & 1) sc += 6;
      if (!declSide && len >= 4) sc += 2;
      if (sc > pl) { pl = sc; pick = su; }
    }
    if (pick < 0) { // 只有将牌
      for (let su = 0; su < 4; su++) if (st.H[base + su]) return [su, hi(st.H[base + su])];
    }
    const m = st.H[base + pick], t = hi(m);
    if (t >= 10 && (m >> (t - 1)) & 1) return [pick, t];       // 连牌顶张
    if (!declSide && pop(m) >= 4) {
      // 第四大
      let mm = m; for (let i = 0; i < 3; i++) mm &= ~(1 << hi(mm));
      return [pick, hi(mm)];
    }
    return [pick, lo(m)];
  }

  function playout(st) {
    let guard = 0;
    while (st.tricksDone < 13 && guard++ < 60) {
      const mv = policy(st);
      stepPlay(st, mv[0], mv[1]);
    }
    return st.declTricks;
  }

  // ---------- 取样：补全两家看不见的牌 ----------
  function viewInfo(b, seat) {
    const c = b.contract, p = b.play;
    const ctrl = controllerOf(b, seat);
    const known = new Set();
    p.hands[ctrl].forEach((x) => known.add(x));
    if (p.played.length > 0 || true) p.hands[c.dummy].forEach((x) => known.add(x));
    // 已打出的牌
    const playedSet = new Set(p.played.map((x) => x.card));
    const unseen = [];
    for (let x = 0; x < 52; x++) if (!known.has(x) && !playedSet.has(x)) unseen.push(x);
    const unk = [0, 1, 2, 3].filter((s) => s !== ctrl && s !== c.dummy);
    return { ctrl, unk, unseen };
  }
  function controllerOf(b, seat) { return seat === b.contract.dummy ? b.contract.declarer : seat; }

  function makeSampler(b, seat, infos, rnd) {
    const p = b.play;
    const { ctrl, unk, unseen } = viewInfo(b, seat);
    const [a, bb] = unk;
    const na = p.hands[a].length, nb = p.hands[bb].length;
    const va = p.voids[a], vb = p.voids[bb];
    const forcedA = [], forcedB = [], free = [];
    for (const x of unseen) {
      const su = suitOf(x), voidA = va.indexOf(su) >= 0, voidB = vb.indexOf(su) >= 0;
      if (voidA && voidB) return null;
      if (voidA) forcedB.push(x); else if (voidB) forcedA.push(x); else free.push(x);
    }
    if (forcedA.length > na || forcedB.length > nb) return null;
    const needA = na - forcedA.length;
    const useInfo = !!infos;
    function ok(ha, hb) {
      if (!useInfo) return true;
      const cons = [[a, ha], [bb, hb]];
      for (const [s, h] of cons) {
        const inf = infos[s];
        if (!inf) continue;
        const hc = BB.hcpOf(h);
        if (hc < inf.lo - 1 || hc > inf.hi + 1) return false;
        const l = BB.lensOf(h);
        for (let k = 0; k < 4; k++) if (l[k] < inf.len[k] - (inf.preempt ? 0 : 0) && inf.len[k] > 0 && l[k] < inf.len[k]) return false;
        if (inf.nt && !BB.isBal(l)) return false;
      }
      return true;
    }
    return function sample() {
      for (let tries = 0; tries < 40; tries++) {
        const f = free.slice();
        for (let i = f.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = f[i]; f[i] = f[j]; f[j] = t; }
        const ha = forcedA.concat(f.slice(0, needA)), hb = forcedB.concat(f.slice(needA));
        if (ok(ha, hb) || tries === 39) { const hands = [null, null, null, null]; hands[a] = ha; hands[bb] = hb; return hands; }
      }
      return null;
    };
  }

  // ---------- 开叫引牌 ----------
  function openingLead(b, seat, infos) {
    const hand = b.hands[seat], c = b.contract;
    const L = BB.lensOf(hand), trump = c.strain;
    const part = partner(seat);
    const declSide = side(c.declarer);
    let best = null, bestScore = -1e9;
    for (let su = 0; su < 4; su++) {
      if (!L[su]) continue;
      const cards = hand.filter((x) => suitOf(x) === su).map(rankOf).sort((a, bq) => bq - a);
      let sc = 0;
      const top = cards[0], n = cards.length;
      const seq = n >= 2 && cards[0] - cards[1] === 1 && cards[0] >= 11;
      const seq3 = n >= 3 && seq && cards[1] - cards[2] <= 1;
      const akx = cards[0] === 14 && n >= 2 && cards[1] === 13;
      if (su === trump) sc -= 14;
      if (trump === 4) { sc += n * 3; if (n >= 5) sc += 4; if (seq || akx) sc += 8; if (seq3) sc += 4; if (top === 14 && n < 4 && !akx) sc -= 6; }
      else {
        sc += n >= 4 ? n : 0;
        if (seq || akx) sc += 10;
        if (n === 1 && top < 13) sc += 8 + (L[trump] >= 3 ? 3 : 0);
        if (n === 2 && top < 12) sc += 3;
        if (top === 14 && n >= 3 && !akx) sc -= 4;
        if (top === 13 && n >= 3 && !seq && cards[1] !== 12) sc -= 5;
      }
      // 叫牌提示
      const pinf = infos && infos[part];
      if (pinf && pinf.len[su] >= 4 && pinf.bids) sc += 12;
      if (infos) {
        for (const o of [c.declarer, c.dummy]) {
          const oi = infos[o];
          if (oi && oi.len[su] >= 4 && su !== trump) sc -= 8;
        }
      }
      if (sc > bestScore) { bestScore = sc; best = su; }
    }
    const cards = hand.filter((x) => suitOf(x) === best).sort((x, y) => rankOf(y) - rankOf(x));
    const rs = cards.map(rankOf);
    const n = rs.length;
    if (n >= 2 && rs[0] === 14 && rs[1] === 13) return cards[0];                // AK → A
    if (n >= 2 && rs[0] - rs[1] === 1 && rs[0] >= 11) return cards[0];          // 连牌 → 顶张
    if (n >= 3 && rs[0] >= 11 && rs[1] === rs[0] - 2 && rs[2] === rs[0] - 3) return cards[0]; // 破连牌
    if (n === 1) return cards[0];
    if (n === 2) return cards[0];                                              // 两张取大
    if (trump === 4 && n >= 4) return cards[3];                                 // 无将第四大
    if (n >= 4 && rs[0] >= 11) return cards[3];                                 // 有大牌的长套第四大
    if (n === 3 && rs[0] >= 11) return cards[2];                                // 三张带大牌 → 小
    if (n >= 4) return cards[3];
    return cards[n - 1 > 0 ? 1 : 0];                                           // 三张废牌取中间/大的小张
  }

  function dedupe(b, seat, legal) {
    const p = b.play;
    const out = [];
    const hand = p.hands[seat];
    const played = new Set(p.played.map((x) => x.card));
    const bySuit = {};
    for (const x of legal) (bySuit[suitOf(x)] = bySuit[suitOf(x)] || []).push(x);
    for (const su in bySuit) {
      const cs = bySuit[su].sort((x, y) => rankOf(x) - rankOf(y));
      let group = [cs[0]];
      for (let i = 1; i < cs.length; i++) {
        let connected = true;
        for (let r = rankOf(cs[i - 1]) + 1; r < rankOf(cs[i]); r++) {
          const card = mk(+su, r);
          if (!played.has(card) && hand.indexOf(card) < 0) { connected = false; break; }
        }
        if (connected) group.push(cs[i]); else { out.push(group[0]); group = [cs[i]]; }
      }
      out.push(group[0]);
    }
    return out;
  }

  /** 选择出牌。seat 是要出牌的座位（可能是明手，由庄家代打）。opts: {ms, minWorlds}*/
  function choosePlay(b, seat, rnd, opts) {
    opts = opts || {};
    const p = b.play, c = b.contract;
    const hand = p.hands[seat];
    const led = p.trick.length ? suitOf(p.trick[0].card) : -1;
    const legal = legalPlays(hand, led);
    if (legal.length === 1) return legal[0];
    const infos = BB.analyze(b.auction, b.dealer);
    if (p.played.length === 0) return openingLead(b, seat, infos);
    const cand = dedupe(b, seat, legal);
    if (cand.length === 1) return cand[0];
    const ctrl = controllerOf(b, seat);
    const sampler = makeSampler(b, seat, infos, rnd);
    const myDecl = side(ctrl) === side(c.declarer);
    // 备用：直接用启发式
    const fallback = () => {
      const st = makeState(b, p.hands.map((h, s) => (h && h.length ? h : [])));
      const mv = policy(st);
      return mk(mv[0], mv[1] + 2);
    };
    if (!sampler) return fallback();
    const t0 = Date.now(), budget = opts.ms || 450, minW = opts.minWorlds || 10, maxW = opts.maxWorlds || 200;
    const sums = new Float64Array(cand.length);
    let worlds = 0;
    while (worlds < maxW && (worlds < minW || Date.now() - t0 < budget)) {
      const w = sampler();
      if (!w) break;
      const hands4 = [];
      for (let s = 0; s < 4; s++) hands4.push(w[s] ? w[s] : p.hands[s]);
      const base = makeState(b, hands4);
      for (let i = 0; i < cand.length; i++) {
        const st = copyState(base);
        stepPlay(st, suitOf(cand[i]), rankOf(cand[i]) - 2);
        sums[i] += playout(st);
      }
      worlds++;
    }
    if (!worlds) return fallback();
    let bi = 0, bv = -1e9;
    for (let i = 0; i < cand.length; i++) {
      const v = myDecl ? sums[i] : -sums[i];
      if (v > bv + 1e-9) { bv = v; bi = i; }
    }
    return cand[bi];
  }

  const api = { choosePlay, openingLead, makeState, policy, playout, copyState, stepPlay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BridgePlay = api;
})(typeof self !== 'undefined' ? self : this);
