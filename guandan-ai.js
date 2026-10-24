/* 掼蛋电脑 AI（困难 / 专家）+ 提示。UMD，可在 Node 里测试。
 *
 * 核心是「拆牌评估」evalHand：把一手牌拆成尽量少的出牌回合（顺子/木板/钢板/三带二/炸弹/对/单，
 * 百搭参与补位），每个回合按其强度折算成本（强牌回合更便宜，因为能夺回出牌权）。
 * 出牌 = 选「出完后剩余手牌成本最低」的方案；跟牌则看是否值得花掉这一手。
 * 只使用本家手牌 + 公开信息（各家剩牌数、已出的牌），不看别人的牌。
 */
(function (root) {
  'use strict';
  const G = (typeof module !== 'undefined' && module.exports) ? require('./guandan-engine.js') : root.GuandanEngine;
  const { rankOf, isWild, genPlays, followPlays, partnerOf, teamOf, strength, TYPE_NAME } = G;

  // ---------- 拆牌评估 ----------
  /** 索引：2..14 为点数，15 小王，16 大王 */
  const idxOf = (c) => { const r = rankOf(c); return r >= 16 ? r - 1 : r; };

  function makeSolver(L, K) {
    const memo = new Map();
    const sb = (i) => {                       // 单张强度加成
      if (i === 16) return 4;
      if (i === 15) return 3.5;
      if (i === L) return 3;
      if (i === 14) return 2.2;
      if (i === 13) return 1.2;
      if (i === 12) return 0.5;
      if (i >= 10) return 0;
      return -(10 - i) * 0.4;
    };
    const cSingle = (i) => 10 - K * sb(i);
    const cPair = (i) => 10 - K * 0.8 * sb(i);
    const cTrip = (i) => 10 - K * 0.9 * sb(i);
    const cBomb = (n, i) => 10 - K * (5 + (n - 4) * 1.3 + (i === L ? 1 : i / 15));
    const cSeq = (top) => 10 - (top - 9) * 0.3;
    const cWood = (top) => 10 - (top - 8) * 0.25;
    const cPlate = (top) => 10 - (top - 8) * 0.25;

    const rec = (cnt, W, u, from) => {
      let r = from;
      while (r <= 16 && cnt[r] === 0) r++;
      if (r > 16) {
        let add = 0, uu = u;
        if (W === 1) add = 7;
        else if (W >= 2) { add = 10 - 0.8 * 3 - 10; uu = u - 1; }
        return add - 10 * Math.min(uu, 0);
      }
      let key = '';
      for (let i = r; i <= 16; i++) key += cnt[i];
      key += '|' + r + '|' + W + '|' + u;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;

      let best = Infinity;
      const c = cnt[r];
      const joker = r >= 15;
      const go = (takes, w, cost, du) => {
        for (let k = 0; k < takes.length; k += 2) cnt[takes[k]] -= takes[k + 1];
        const v = cost + rec(cnt, W - w, u + du, r);
        for (let k = 0; k < takes.length; k += 2) cnt[takes[k]] += takes[k + 1];
        if (v < best) best = v;
      };
      if (c >= 4) go([r, c], 0, cBomb(c, r), 0);
      else if (!joker && c >= 1 && W >= 4 - c) go([r, c], 4 - c, cBomb(4, r), 0);
      if (c === 3 && !joker) go([r, 3], 0, cTrip(r), 1);
      if (c === 2) {
        go([r, 2], 0, cPair(r) - 10, -1);
        if (!joker && W >= 1) go([r, 2], 1, cTrip(r), 1);
      }
      if (c === 1) {
        go([r, 1], 0, cSingle(r), 0);
        if (!joker && W >= 1) go([r, 1], 1, cPair(r) - 10, -1);
      }
      if (c === 3 && !joker) { /* 三张也可拆成对子+单张，罕见，略 */ }
      if (!joker) {
        // 顺子（5 张）：以最低点 r 起；也试 A 当 1 的 A2345
        if (r <= 10) {
          let miss = 0;
          for (let k = r; k < r + 5; k++) if (cnt[k] === 0) miss++;
          if (miss <= W) {
            const t = [];
            for (let k = r; k < r + 5; k++) if (cnt[k] > 0) t.push(k, 1);
            go(t, miss, cSeq(r + 4), 0);
          }
        }
        if (r <= 5) {
          const ks = [14, 2, 3, 4, 5];
          let miss = 0;
          for (const k of ks) if (cnt[k] === 0) miss++;
          if (miss <= W) {
            const t = [];
            for (const k of ks) if (cnt[k] > 0) t.push(k, 1);
            go(t, miss, cSeq(5) - 0.6, 0);
          }
        }
        if (r <= 12) {                                    // 木板：三连对
          let miss = 0;
          for (let k = r; k < r + 3; k++) miss += Math.max(0, 2 - cnt[k]);
          if (miss <= W && cnt[r] >= 1) {
            const t = [];
            for (let k = r; k < r + 3; k++) if (cnt[k] > 0) t.push(k, Math.min(2, cnt[k]));
            go(t, miss, cWood(r + 2), 0);
          }
        }
        if (r <= 13) {                                    // 钢板：二连三
          let miss = 0;
          for (let k = r; k < r + 2; k++) miss += Math.max(0, 3 - cnt[k]);
          if (miss <= W && cnt[r] >= 1) {
            const t = [];
            for (let k = r; k < r + 2; k++) if (cnt[k] > 0) t.push(k, Math.min(3, cnt[k]));
            go(t, miss, cPlate(r + 1), 0);
          }
        }
      }
      if (memo.size > 400000) memo.clear();
      memo.set(key, best);
      return best;
    };

    /** cnt: 长度 17 的数组（索引 2..16），W: 百搭张数 */
    return function solve(cnt, W) {
      let extra = 0;
      if (cnt[15] === 2 && cnt[16] === 2) { cnt = cnt.slice(); cnt[15] = 0; cnt[16] = 0; extra = 1; }
      return extra + rec(cnt, W, 0, 2);
    };
  }

  const solvers = {};
  const solverFor = (L, K) => { K = K === undefined ? PARAMS.scale : K; const k = L + ':' + K; return solvers[k] || (solvers[k] = makeSolver(L, K)); };

  function countsOf(hand, L) {
    const cnt = new Array(17).fill(0);
    let W = 0;
    for (const c of hand) { if (isWild(c, L)) W++; else cnt[idxOf(c)]++; }
    return { cnt, W };
  }
  /** 手牌成本（越低越好）。大致 = 10 × 回合数 − 强牌折扣 */
  function evalHand(hand, L) { const o = countsOf(hand, L); return solverFor(L)(o.cnt, o.W); }
  function evalAfter(base, cards, L, K) {
    const cnt = base.cnt.slice();
    let W = base.W;
    for (const c of cards) { if (isWild(c, L)) W--; else cnt[idxOf(c)]--; }
    return solverFor(L, K)(cnt, W);
  }

  // ---------- 公开信息 ----------
  function unseenCards(st, p) {
    const known = new Set(st.hands[p]);
    for (const c of st.played) known.add(c);
    const out = [];
    for (let c = 0; c < 108; c++) if (!known.has(c)) out.push(c);
    return out;
  }
  /** 这手 ins 是否可能被未见过的牌用同牌型压过（不算炸弹） */
  function beatableByUnseen(ins, unseen, L) {
    if (ins.tier) return false;
    if (!['single', 'pair', 'triple'].includes(ins.type)) return true;
    const need = ins.type === 'single' ? 1 : ins.type === 'pair' ? 2 : 3;
    const byR = {};
    let w = 0;
    for (const c of unseen) { if (isWild(c, L)) w++; else { const r = rankOf(c); byR[r] = (byR[r] || 0) + 1; } }
    for (const r in byR) {
      const R = +r;
      if (G.ov(R, L) <= ins.main) continue;
      if (R >= 16 ? byR[r] >= need : byR[r] + w >= need) return true;
    }
    return w >= need && 15 > ins.main;
  }

  /** 手里天然的同花顺（5 连同花色，不含百搭）里的牌 id 集合 */
  function sfCardSet(hand, L) {
    const bySuit = [{}, {}, {}, {}];
    for (const c of hand) { if (isWild(c, L)) continue; const su = G.suitOf(c); if (su >= 0) bySuit[su][rankOf(c)] = c; }
    const out = new Set();
    for (let su = 0; su < 4; su++) {
      const m = bySuit[su];
      for (let s0 = 1; s0 <= 10; s0++) {
        const ids = [];
        for (let k = s0; k < s0 + 5; k++) { const r = k === 1 ? 14 : k; if (m[r] === undefined) { ids.length = 0; break; } ids.push(m[r]); }
        if (ids.length === 5) ids.forEach((x) => out.add(x));
      }
    }
    return out;
  }


  const PARAMS = { tau: 4, tight: 3, pairBad: 7, single1: 9, sfPen: 0, scale: 1, sizeBonus: 0, bombLeft: 6, bombGate: 3, bombDelta: 4 };

  // ---------- 决策 ----------
  /**
   * 返回 { move: {cards, ins} | null(不出), reason, ranked: [{cards, ins, pass, score, note}] }
   * opts.tau：跟牌时「值得花掉一手」的门槛（越高越保守）
   */
  function decide(st, p, opts) {
    opts = Object.assign({}, PARAMS, opts || {});
    const L = st.L;
    const hand = st.hands[p];
    const partner = partnerOf(p);
    const foes = [(p + 1) & 3, (p + 3) & 3];
    const act = (q) => G.active(st, q);
    const liveFoes = foes.filter(act);
    const foeCnt = liveFoes.map((q) => st.hands[q].length);
    const minFoe = foeCnt.length ? Math.min(...foeCnt) : 99;
    const partnerLeft = act(partner) ? st.hands[partner].length : 0;
    const partnerOut = !act(partner);
    const base = countsOf(hand, L);
    const here = solverFor(L, opts.scale)(base.cnt.slice(), base.W);
    const plays = genPlays(hand, L);
    const unseen = unseenCards(st, p);
    const TAU = opts.tau;
    const sfSet = opts.sfPen ? sfCardSet(hand, L) : null;
    const ranked = [];
    const note = (x, s) => { x.note = s; return x; };

    // ---- 先手 ----
    if (!st.table) {
      let cands = plays.filter((pl) => !pl.best.tier);
      const fin = plays.find((pl) => pl.cards.length === hand.length);
      if (fin) return { move: { cards: fin.cards, ins: fin.best }, reason: '能一次出完，直接出完', ranked: [{ cards: fin.cards, ins: fin.best, score: -999, note: '出完' }] };
      if (!cands.length) cands = plays;
      for (const pl of cands) {
        const i = pl.best;
        let s = evalAfter(base, pl.cards, L, opts.scale) - opts.sizeBonus * pl.cards.length;
        let why = '';
        const n = pl.cards.length;
        if (!i.tier) {
          // 对手只剩 k 张时，别领 k 张的牌型（一手就被出完）；只剩 1 张时别领不是顶大的单张
          for (const fc of foeCnt) {
            if (fc <= 5 && n === fc) { s += opts.pairBad; why = '对手只剩' + fc + '张，避开同张数牌型'; }
          }
          if (minFoe === 1 && n === 1 && beatableByUnseen(i, unseen, L)) { s += opts.single1; why = '对手只剩 1 张，不能领小单张'; }
          if (partnerLeft === 1 && n === 1 && i.main <= 10 && !partnerOut) { s -= 2; why = '队友只剩 1 张，领小单张送他接'; }
        }
        if (sfSet && sfSet.size && !i.tier && pl.cards.some((c) => sfSet.has(c))) s += opts.sfPen;
        s += strength(i) * 0.002;
        ranked.push(note({ cards: pl.cards, ins: i, score: s, why }, why));
      }
      ranked.sort((a, b) => a.score - b.score);
      const top = ranked[0];
      const tn = TYPE_NAME[top.ins.type];
      let reason = top.why || ('先出手里最没用的牌（' + tn + '），把大牌和炸弹留着夺回出牌权');
      if (minFoe <= 3 && !top.why) reason = '对手只剩 ' + minFoe + ' 张，出牌要稳，先出' + tn;
      return { move: { cards: top.cards, ins: top.ins }, reason, ranked };
    }

    // ---- 跟牌 ----
    const t = st.table;
    const tIns = t.ins;
    const owner = t.player;
    const fl = followPlays(plays, tIns);
    const byPartner = owner === partner;
    const fin = fl.find((x) => x.cards.length === hand.length);
    if (fin) return { move: { cards: fin.cards, ins: fin.ins }, reason: '压得住且能出完，直接走', ranked: [{ cards: fin.cards, ins: fin.ins, score: -999, note: '出完' }] };
    if (!fl.length) return { move: null, reason: '要不起', ranked: [] };

    const ownerLeft = st.hands[owner].length;
    const normal = fl.filter((x) => !x.ins.tier);
    const bombs = fl.filter((x) => x.ins.tier).sort((a, b) => strength(a.ins) - strength(b.ins));
    for (const x of normal) {
      const delta = here - evalAfter(base, x.cards, L, opts.scale);
      ranked.push(note({ cards: x.cards, ins: x.ins, score: -delta, delta }, ''));
    }
    ranked.sort((a, b) => a.score - b.score);

    if (byPartner) {
      ranked.unshift({ cards: null, ins: null, pass: true, score: -50, note: '队友在领先' });
      return { move: null, reason: partnerOut ? '队友已走，不出，接风' : '队友在领先，让他走，不拆自己的牌', ranked: ranked.concat(bombs.map((b) => ({ cards: b.cards, ins: b.ins, score: 50, note: '炸（不建议）' }))) };
    }

    // 对手的牌：打完后还剩多少张决定了紧迫度
    const urgent = ownerLeft <= 2;
    const tight = ownerLeft <= 5 || minFoe <= 3;
    const best = ranked[0];
    // 普通牌
    if (best) {
      const ok = urgent || (best.delta !== undefined && best.delta >= (tight ? TAU - opts.tight : TAU)) ||
        (hand.length <= 6 && best.delta > 3);
      if (ok) {
        const why = urgent ? '对手只剩 ' + ownerLeft + ' 张，必须压住' : (best.delta >= TAU ? '用最小的够压牌拿回出牌权' : '局面紧张，压一手');
        return { move: { cards: best.cards, ins: best.ins }, reason: why, ranked: ranked.concat([{ cards: null, ins: null, pass: true, score: 0, note: '不出' }]) };
      }
    }
    // 炸弹：只在关键时刻
    if (bombs.length) {
      const myAfter = Math.round(here / 9);
      const bombOK = urgent || (ownerLeft <= opts.bombLeft && ownerLeft > 0) || hand.length <= 8 || (partnerOut && ownerLeft <= 8) ||
        (t.ins.tier && ownerLeft <= 8) || (minFoe <= 3 && ownerLeft <= minFoe);
      if (bombOK && (!best || urgent || best.delta === undefined || best.delta < opts.bombDelta || ownerLeft <= opts.bombGate)) {
        const b = bombs[0];
        ranked.push({ cards: b.cards, ins: b.ins, score: 20, note: '炸' });
        return { move: { cards: b.cards, ins: b.ins }, reason: urgent ? '对手快出完了，用炸弹截住' : '关键时刻用炸弹夺回出牌权', ranked };
      }
    }
    ranked.unshift({ cards: null, ins: null, pass: true, score: -50, note: '不出' });
    return { move: null, reason: best ? '这手牌不值得花：留着大牌和炸弹' : '没有合适的牌', ranked: ranked.concat(bombs.map((b) => ({ cards: b.cards, ins: b.ins, score: 60, note: '炸（不建议）' }))) };
  }


  /** 「专家」= 困难 + 自对战调出的参数（5000 局对困难 53.4% ±1.4）。
   *  试过「随机确定化 + 模拟到终局」的蒙特卡洛，对困难只有 46%~50%，且慢 100 倍，所以没采用。 */
  const EXPERT = { sizeBonus: -1, scale: 1.3, tau: 3 };

  /** 电脑出牌：level 0/1 用引擎自带；2 困难；3 专家 */
  function aiMove(st, p, level) {
    if (level <= 1) return G.aiChoose(st, p, level);
    return decide(st, p, level >= 3 ? EXPERT : {}).move;
  }

  const api = { PARAMS, EXPERT, evalHand, evalAfter, decide, aiMove, countsOf, unseenCards, beatableByUnseen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GuandanAI = api;
})(typeof self !== 'undefined' ? self : this);
