/* 斗地主规则与 AI 引擎（纯函数，浏览器与 Node 通用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDZ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 点数：3..10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17
  const LABEL = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
  const SUITS = ['♠', '♥', '♣', '♦'];

  function newDeck() {
    const d = [];
    let id = 0;
    for (let r = 3; r <= 15; r++) for (let s = 0; s < 4; s++) d.push({ id: id++, rank: r, suit: s });
    d.push({ id: id++, rank: 16, suit: -1 });
    d.push({ id: id++, rank: 17, suit: -1 });
    return d;
  }

  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 手牌排序：大牌在左
  function sortHand(cards) {
    return cards.slice().sort((a, b) => b.rank - a.rank || a.suit - b.suit);
  }

  function groupByRank(cards) {
    const g = {};
    for (const c of cards) (g[c.rank] = g[c.rank] || []).push(c);
    return g;
  }

  function isConsecutive(sortedRanks) {
    for (let i = 1; i < sortedRanks.length; i++) if (sortedRanks[i] - sortedRanks[i - 1] !== 1) return false;
    return true;
  }

  /**
   * 识别牌型。返回 {type, main, n}，不合法返回 null。
   * type: single pair triple triple1 triple2 straight pairs plane plane1 plane2 four2 four22 bomb rocket
   * main: 用于比较大小的点数（顺子/连对/飞机取最小点）
   */
  function classify(cards) {
    const n = cards.length;
    if (n === 0) return null;
    const cnt = {};
    for (const c of cards) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
    const ranks = Object.keys(cnt).map(Number).sort((a, b) => a - b);
    const counts = ranks.map((r) => cnt[r]);
    const rankWith = (k) => ranks.find((r) => cnt[r] === k);

    if (n === 1) return { type: 'single', main: ranks[0], n };
    if (n === 2) {
      if (ranks.length === 1) return { type: 'pair', main: ranks[0], n };
      if (cnt[16] && cnt[17]) return { type: 'rocket', main: 17, n };
      return null;
    }
    if (n === 3) return ranks.length === 1 ? { type: 'triple', main: ranks[0], n } : null;
    if (n === 4) {
      if (ranks.length === 1) return { type: 'bomb', main: ranks[0], n };
      if (ranks.length === 2 && counts.includes(3)) return { type: 'triple1', main: rankWith(3), n };
      return null;
    }

    const top = ranks[ranks.length - 1];
    if (ranks.length === n && n >= 5 && isConsecutive(ranks) && top <= 14) {
      return { type: 'straight', main: ranks[0], n };
    }
    if (n >= 6 && n % 2 === 0 && ranks.length === n / 2 && counts.every((c) => c === 2) && isConsecutive(ranks) && top <= 14) {
      return { type: 'pairs', main: ranks[0], n };
    }
    if (n === 5 && ranks.length === 2 && counts.includes(3) && counts.includes(2)) {
      return { type: 'triple2', main: rankWith(3), n };
    }
    if (n === 6 && rankWith(4) !== undefined && !(cnt[16] && cnt[17])) {
      return { type: 'four2', main: rankWith(4), n };
    }
    if (n === 8 && ranks.length === 3 && rankWith(4) !== undefined && counts.filter((c) => c === 2).length === 2) {
      return { type: 'four22', main: rankWith(4), n };
    }

    // 飞机：连续的三张（不含 2 和王），带同数量的单牌或对子
    const triples = ranks.filter((r) => cnt[r] >= 3 && r <= 14);
    for (let k = Math.floor(n / 3); k >= 2; k--) {
      for (const s of triples) {
        if (s + k - 1 > 14) continue; // 飞机不能含 2
        let ok = true;
        for (let x = s; x < s + k; x++) if (!(cnt[x] >= 3)) { ok = false; break; }
        if (!ok) continue;
        const rest = n - 3 * k;
        if (rest === 0) return { type: 'plane', main: s, n };
        if (rest === k) return { type: 'plane1', main: s, n };
        if (rest === 2 * k) {
          let pairsOnly = true;
          for (const r of ranks) {
            const rem = cnt[r] - (r >= s && r < s + k ? 3 : 0);
            if (rem !== 0 && rem !== 2) { pairsOnly = false; break; }
          }
          if (pairsOnly) return { type: 'plane2', main: s, n };
        }
      }
    }
    return null;
  }

  // cur 能否压过 prev（prev 为 null 表示自由出牌）
  function canBeat(cur, prev) {
    if (!cur) return false;
    if (!prev) return true;
    if (cur.type === 'rocket') return true;
    if (prev.type === 'rocket') return false;
    if (cur.type === 'bomb') return prev.type !== 'bomb' || cur.main > prev.main;
    if (prev.type === 'bomb') return false;
    return cur.type === prev.type && cur.n === prev.n && cur.main > prev.main;
  }

  /** 枚举手牌里所有“合理”的出法（带牌时只取最小的搭配），每项 {cards, type, main, n} */
  function genMoves(hand) {
    const g = groupByRank(hand);
    const ranks = Object.keys(g).map(Number).sort((a, b) => a - b);
    const moves = [];
    const push = (cards) => {
      const info = classify(cards);
      if (info) moves.push({ cards, type: info.type, main: info.main, n: info.n });
    };

    for (const r of ranks) {
      const L = g[r].length;
      push([g[r][0]]);
      if (L >= 2) push(g[r].slice(0, 2));
      if (L >= 3) push(g[r].slice(0, 3));
      if (L === 4) push(g[r].slice(0, 4));
    }
    if (g[16] && g[17]) push([g[16][0], g[17][0]]);

    // 选带牌：优先拆最“散”的牌（所在点数张数少、点数小）
    const kickerOrder = (exclude) =>
      hand
        .filter((c) => !exclude.has(c.id))
        .sort((a, b) => g[a.rank].length - g[b.rank].length || a.rank - b.rank);
    const pairKickers = (excludeRanks, k) => {
      const rs = ranks
        .filter((r) => !excludeRanks.has(r) && g[r].length >= 2 && r < 16)
        .sort((a, b) => g[a].length - g[b].length || a - b)
        .slice(0, k);
      if (rs.length < k) return null;
      return rs.flatMap((r) => g[r].slice(0, 2));
    };

    for (const r of ranks) {
      if (g[r].length < 3 || r > 15) continue;
      const trio = g[r].slice(0, 3);
      const ex = new Set(trio.map((c) => c.id));
      const single = kickerOrder(ex).filter((c) => c.rank !== r)[0];
      if (single) push(trio.concat(single));
      const pk = pairKickers(new Set([r]), 1);
      if (pk) push(trio.concat(pk));
    }

    // 顺子
    for (let s = 3; s <= 14; s++) {
      if (!g[s]) continue;
      const seq = [];
      for (let e = s; e <= 14 && g[e]; e++) {
        seq.push(g[e][0]);
        if (seq.length >= 5) push(seq.slice());
      }
    }
    // 连对
    for (let s = 3; s <= 14; s++) {
      if (!g[s] || g[s].length < 2) continue;
      const seq = [];
      for (let e = s; e <= 14 && g[e] && g[e].length >= 2; e++) {
        seq.push(...g[e].slice(0, 2));
        if (seq.length >= 6) push(seq.slice());
      }
    }
    // 飞机
    for (let s = 3; s <= 14; s++) {
      if (!g[s] || g[s].length < 3) continue;
      const trios = [];
      const used = new Set();
      for (let e = s; e <= 14 && g[e] && g[e].length >= 3; e++) {
        trios.push(...g[e].slice(0, 3));
        for (const c of g[e].slice(0, 3)) used.add(c.id);
        const k = e - s + 1;
        if (k < 2) continue;
        push(trios.slice());
        const singles = kickerOrder(used).slice(0, k);
        if (singles.length === k) push(trios.concat(singles));
        const planeRanks = new Set();
        for (let x = s; x <= e; x++) planeRanks.add(x);
        const pk = pairKickers(planeRanks, k);
        if (pk) push(trios.concat(pk));
      }
    }
    // 四带二
    for (const r of ranks) {
      if (g[r].length !== 4) continue;
      const four = g[r].slice();
      const ex = new Set(four.map((c) => c.id));
      const two = kickerOrder(ex).slice(0, 2);
      if (two.length === 2) push(four.concat(two));
      const pk = pairKickers(new Set([r]), 2);
      if (pk) push(four.concat(pk));
    }
    return moves;
  }

  // ---------- AI ----------

  // 评估手牌强度，决定叫几分
  function handStrength(hand) {
    const g = groupByRank(hand);
    let s = 0;
    if (g[17]) s += 3;
    if (g[16]) s += 2;
    if (g[16] && g[17]) s += 2;
    if (g[15]) s += 2 * g[15].length;
    if (g[14]) s += g[14].length;
    for (const r in g) if (g[r].length === 4 && +r < 16) s += 3;
    return s;
  }

  function aiBid(hand, bidMax, rnd) {
    rnd = rnd || Math.random;
    const s = handStrength(hand) + (rnd() - 0.5) * 1.4;
    const level = s >= 9.5 ? 3 : s >= 7.5 ? 2 : s >= 5.5 ? 1 : 0;
    return level > bidMax ? level : 0;
  }

  // 估计一手牌最少还要几手才能出完（贪心拆分：火箭/炸弹/顺子/连对/三带/对子/单张）
  function turnsEstimate(hand) {
    const g = groupByRank(hand);
    let t = 0;
    if (g[16] && g[17]) t += 1; else t += (g[16] ? 1 : 0) + (g[17] ? 1 : 0);
    let singles = [], pairs = [], trip = 0;
    for (let r = 3; r <= 15; r++) {
      const L = g[r] ? g[r].length : 0;
      if (L === 4) t += 1;
      else if (L === 3) trip++;
      else if (L === 2) pairs.push(r);
      else if (L === 1) singles.push(r);
    }
    // 取走连续段（顺子 >=5 张，连对 >=3 对），每段只算一手
    const strip = (arr, minLen) => {
      const keep = [];
      let i = 0;
      while (i < arr.length) {
        let j = i;
        while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1 && arr[j + 1] <= 14) j++;
        if (arr[i] <= 14 && j - i + 1 >= minLen) t += 1;
        else for (let x = i; x <= j; x++) keep.push(arr[x]);
        i = j + 1;
      }
      return keep;
    };
    singles = strip(singles, 5);
    pairs = strip(pairs, 3);
    let tr = trip;
    const k1 = Math.min(tr, singles.length); tr -= k1;
    const k2 = Math.min(tr, pairs.length);
    t += trip + (singles.length - k1) + (pairs.length - k2);
    return t;
  }

  function without(hand, cards) {
    const ids = new Set(cards.map((c) => c.id));
    return hand.filter((c) => !ids.has(c.id));
  }

  // 主动出牌时的评分：越高越优先（出完后剩余手数越少越好，其次出小牌）
  function leadScore(m, hand, ctx) {
    const rest = without(hand, m.cards);
    if (rest.length === 0) return 1000;
    const rt = turnsEstimate(rest);
    let sc = -4 * rt - 0.5 * m.main + 0.2 * m.n;
    if (ctx && ctx.minOpp !== undefined) {
      if (ctx.minOpp <= 1 && m.type === 'single' && m.main < 14) sc -= 8;
      if (ctx.minOpp <= 2 && m.type === 'pair' && m.main < 14) sc -= 4;
      if (ctx.lvl >= 1) {
        // 给队友送牌：队友只剩 1~2 张且地主还多时，出小单张/小对子让队友接走
        if (ctx.partner >= 0 && ctx.minOpp > ctx.pCount) {
          if (ctx.pCount === 1 && m.type === 'single') sc += 7 - 0.6 * (m.main - 3);
          else if (ctx.pCount === 2 && m.type === 'pair') sc += 6 - 0.6 * (m.main - 3);
        }
        // 记牌：这手牌没人压得过，且打完只剩一手，稳赢
        if (ctx.un && rt <= 1 && !couldBeat(m, ctx.un)) sc += 12;
      }
    }
    return sc;
  }

  function contextOf(c) {
    const isLandlord = c.me === c.landlord;
    const opps = [0, 1, 2].filter((p) => p !== c.me && (isLandlord || p === c.landlord));
    const partner = isLandlord ? -1 : 3 - c.me - c.landlord;
    return {
      isLandlord, opps, minOpp: Math.min.apply(null, opps.map((p) => c.counts[p])),
      partner, pCount: partner >= 0 ? c.counts[partner] : 99, lCount: c.counts[c.landlord],
      lvl: c.level === undefined ? 1 : c.level, un: null,
    };
  }

  // ---------- 记牌 ----------
  const FULL = (() => { const a = new Array(18).fill(0); for (let r = 3; r <= 15; r++) a[r] = 4; a[16] = 1; a[17] = 1; return a; })();

  function rankCounts(cards) {
    const a = new Array(18).fill(0);
    for (const c of cards) a[c.rank]++;
    return a;
  }

  /** 未见过的牌（按点数计数）：54 张 − 自己手牌 − 已打出的牌。ctx.played 为 18 长度的点数计数数组 */
  function unseenOf(ctx) {
    const u = FULL.slice();
    for (const c of ctx.hand) u[c.rank]--;
    if (ctx.played) for (let r = 3; r <= 17; r++) u[r] -= ctx.played[r];
    return u;
  }

  function runExists(u, from, len, need) {
    for (let s = from; s + len - 1 <= 14; s++) {
      let ok = true;
      for (let r = s; r < s + len; r++) if (u[r] < need) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  /** 对手手里（未见牌中）是否可能有同型更大的牌（不考虑炸弹） */
  function couldBeat(m, u) {
    const main = m.main;
    switch (m.type) {
      case 'rocket': return false;
      case 'bomb': return false;
      case 'single': for (let r = main + 1; r <= 17; r++) if (u[r] >= 1) return true; return false;
      case 'pair': for (let r = main + 1; r <= 15; r++) if (u[r] >= 2) return true; return false;
      case 'triple': case 'triple1': case 'triple2':
        for (let r = main + 1; r <= 15; r++) if (u[r] >= 3) return true; return false;
      case 'straight': return runExists(u, main + 1, m.n, 1);
      case 'pairs': return runExists(u, main + 1, m.n / 2, 2);
      case 'plane': return runExists(u, main + 1, m.n / 3, 3);
      case 'plane1': return runExists(u, main + 1, m.n / 4, 3);
      case 'plane2': return runExists(u, main + 1, m.n / 5, 3);
      default: for (let r = main + 1; r <= 15; r++) if (u[r] >= 4) return true; return false;
    }
  }

  /** 给人类玩家的提示序列（按推荐度排序） */
  function hints(hand, last, ctx) {
    const all = genMoves(hand);
    if (!last) {
      const cx = ctx ? contextOf(ctx) : null;
      const normal = all.filter((m) => m.type !== 'bomb' && m.type !== 'rocket');
      const bombs = all.filter((m) => m.type === 'bomb' || m.type === 'rocket');
      normal.sort((a, b) => leadScore(b, hand, cx) - leadScore(a, hand, cx));
      return normal.concat(bombs);
    }
    const beats = all.filter((m) => canBeat(m, last));
    const normal = beats.filter((m) => m.type !== 'bomb' && m.type !== 'rocket').sort((a, b) => a.main - b.main);
    const bombs = beats.filter((m) => m.type === 'bomb').sort((a, b) => a.main - b.main);
    const rocket = beats.filter((m) => m.type === 'rocket');
    return normal.concat(bombs, rocket);
  }

  /**
   * AI 出牌决策。ctx: {hand, last(info|null), lastBy, me, landlord, counts:[n0,n1,n2]}
   * 返回要出的 move，或 null（不要）
   */
  function aiPlay(ctx, rnd) {
    rnd = rnd || Math.random;
    const { hand, last, lastBy, me, landlord, counts } = ctx;
    const all = genMoves(hand);
    const cx = contextOf(ctx);
    if (cx.lvl >= 1 && ctx.played) cx.un = unseenOf(ctx);
    const myCount = hand.length;
    const finish = all.find((m) => m.n === myCount);
    if (finish && (!last || canBeat(finish, last))) return finish;

    const isBomb = (m) => m.type === 'bomb' || m.type === 'rocket';

    if (!last) {
      const normal = all.filter((m) => !isBomb(m));
      const pool = normal.length ? normal : all;
      let best = null;
      let bestSc = -Infinity;
      for (const m of pool) {
        const sc = leadScore(m, hand, cx) + rnd() * 0.3;
        if (sc > bestSc) { bestSc = sc; best = m; }
      }
      return best;
    }

    const beats = all.filter((m) => canBeat(m, last));
    if (!beats.length) return null;
    const teammate = !cx.isLandlord && lastBy !== landlord;
    if (teammate) return null; // 队友出的牌，不压（除非能直接走完，上面已处理）

    const normal = beats.filter((m) => !isBomb(m));
    const bombs = beats.filter((m) => m.type === 'bomb').sort((a, b) => a.main - b.main);
    const rocket = beats.filter((m) => m.type === 'rocket');
    const urgent = cx.minOpp <= 4;

    if (normal.length) {
      const followScore = (m) => -3 * turnsEstimate(without(hand, m.cards)) - 0.4 * m.main;
      normal.sort((a, b) => followScore(b) - followScore(a));
      const pick = normal[0];
      // 手牌还多、对手还远时，不必用王压小牌
      if (pick.main >= 16 && cx.minOpp > 5 && myCount > 4) return null;
      return pick;
    }
    if (urgent || myCount <= 5) return (bombs[0] || rocket[0]) || null;
    return null;
  }


  // ---------- 蒙特卡洛推演（确定化采样 + 启发式快速对局） ----------

  /** 无信息的快速策略：与 aiPlay 相同，但不带记牌信息 */
  function rolloutMove(hand, last, lastBy, me, landlord, counts, rnd) {
    return aiPlay({ hand, last, lastBy, me, landlord, counts, level: 1 }, rnd);
  }

  let synId = 100000;
  function synCards(ranks) {
    return ranks.map((r) => ({ id: synId++, rank: r, suit: 0 }));
  }

  /**
   * 采样一个“可能的世界”：把未见牌随机分给两位对手。
   * 地主的底牌（已公开且尚未打出的部分）一定在地主手里。
   * 返回 hands[3]，不一致时返回 null。
   */
  function sampleWorld(ctx, u, rnd) {
    const { me, landlord, counts } = ctx;
    const pool = [];
    for (let r = 3; r <= 17; r++) for (let k = 0; k < u[r]; k++) pool.push(r);
    const others = [0, 1, 2].filter((p) => p !== me);
    const need = counts[others[0]] + counts[others[1]];
    if (pool.length !== need) return null;
    const hands = [null, null, null];
    hands[me] = ctx.hand;
    let known = [];
    if (me !== landlord && ctx.bottom) {
      const bc = rankCounts(ctx.bottom);
      const pl = ctx.playedBy ? ctx.playedBy[landlord] : null;
      for (let r = 3; r <= 17; r++) {
        const k = Math.max(0, bc[r] - (pl ? pl[r] : 0));
        for (let i = 0; i < k; i++) known.push(r);
      }
      // 已知牌必须确实在未见牌里
      const tmp = u.slice();
      for (const r of known) { if (tmp[r] <= 0) { known = []; break; } tmp[r]--; }
      if (known.length) {
        // 从 pool 中移除
        const left = u.slice();
        for (const r of known) left[r]--;
        pool.length = 0;
        for (let r = 3; r <= 17; r++) for (let k = 0; k < left[r]; k++) pool.push(r);
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const a = others[0], b = others[1];
    if (me !== landlord) {
      // others 中包含地主与搭档
      const L = landlord, P = a === L ? b : a;
      const nL = counts[L] - known.length;
      if (nL < 0) return null;
      hands[L] = synCards(known.concat(pool.slice(0, nL)));
      hands[P] = synCards(pool.slice(nL));
    } else {
      hands[a] = synCards(pool.slice(0, counts[a]));
      hands[b] = synCards(pool.slice(counts[a]));
    }
    return hands;
  }

  /** 从给定局面打到终局，返回赢家座位。first 为我方先出的 move（null=不要） */
  function playout(hands, st, rnd) {
    const hs = [hands[0], hands[1], hands[2]];
    let last = st.last, lastBy = st.lastBy, passes = st.passes, turn = st.turn;
    const landlord = st.landlord;
    let steps = 0;
    let first = st.first;
    let haveFirst = st.hasFirst;
    while (steps++ < 160) {
      const p = turn;
      let mv;
      if (haveFirst) { mv = first; haveFirst = false; }
      else {
        const counts = [hs[0].length, hs[1].length, hs[2].length];
        mv = rolloutMove(hs[p], last, lastBy, p, landlord, counts, rnd);
      }
      if (mv) {
        hs[p] = without(hs[p], mv.cards);
        last = mv; lastBy = p; passes = 0;
        if (hs[p].length === 0) return p;
        turn = (p + 1) % 3;
      } else {
        passes++;
        if (passes === 2) { last = null; passes = 0; turn = lastBy; }
        else turn = (p + 1) % 3;
      }
    }
    return -1;
  }

  /**
   * 蒙特卡洛出牌决策（生成器：每隔一小段计算 yield 一次，便于界面保持流畅）。
   * opt: {ms: 时间预算, worlds: 固定采样数(测试用), maxWorlds, cands: 候选数上限}
   * 返回 move 或 null（不要）。
   */
  function* mcGen(ctx, rnd, opt) {
    rnd = rnd || Math.random;
    opt = opt || {};
    const { hand, last, me, landlord } = ctx;
    const all = genMoves(hand);
    const myCount = hand.length;
    const finish = all.find((m) => m.n === myCount);
    if (finish && (!last || canBeat(finish, last))) return finish;

    const cx = contextOf(ctx);
    const isBomb = (m) => m.type === 'bomb' || m.type === 'rocket';
    const K = opt.cands || 6;
    let cands;
    if (!last) {
      const normal = all.filter((m) => !isBomb(m));
      const pool = normal.length ? normal : all;
      pool.forEach((m) => { m._h = leadScore(m, hand, cx); });
      pool.sort((a, b) => b._h - a._h);
      cands = pool.slice(0, K);
      const bomb = all.filter(isBomb).sort((a, b) => a.main - b.main)[0];
      if (bomb && myCount <= 10) cands.push(bomb);
    } else {
      const beats = all.filter((m) => canBeat(m, last));
      if (!beats.length) return null;
      const normal = beats.filter((m) => !isBomb(m));
      normal.forEach((m) => { m._h = -3 * turnsEstimate(without(hand, m.cards)) - 0.4 * m.main; });
      normal.sort((a, b) => b._h - a._h);
      cands = normal.slice(0, K - 1);
      const bomb = beats.filter(isBomb).sort((a, b) => (a.type === 'rocket') - (b.type === 'rocket') || a.main - b.main)[0];
      if (bomb) cands.push(bomb);
      cands.push(null); // 不要
    }
    // 额外要评估的出法（复盘时把玩家实际出的牌也放进来比较）
    if (opt.extra) {
      for (const x of opt.extra) {
        const dup = cands.some((c) => (c === null && x === null) || (c && x && sameCards(c.cards, x.cards)));
        if (!dup) cands.push(x);
      }
    }
    if (cands.length === 1) return cands[0];

    const u = unseenOf(ctx);
    const prior = aiPlay(ctx, rnd); // 启发式首选：作为先验
    const nC = cands.length;
    const wins = new Array(nC).fill(0);
    let nW = 0;
    const deadline = Date.now() + (opt.ms || 400);
    const maxW = opt.worlds || opt.maxWorlds || 400;
    let sliceStart = Date.now();
    const st0 = { last: last, lastBy: ctx.lastBy, passes: 0, turn: me, landlord, first: null, hasFirst: true };
    // passes：当前这一轮已有的连续“不要”数（由上层告知，缺省 0）
    st0.passes = ctx.passes || 0;
    while (nW < maxW) {
      const hands = sampleWorld(ctx, u, rnd);
      if (!hands) return prior;
      for (let i = 0; i < nC; i++) {
        const st = Object.assign({}, st0, { first: cands[i] });
        const w = playout(hands, st, rnd);
        const mineWin = me === landlord ? w === landlord : (w !== landlord && w >= 0);
        if (mineWin) wins[i]++;
      }
      nW++;
      const now = Date.now();
      if (!opt.worlds && now >= deadline && nW >= (opt.minWorlds || 8)) break;
      if (now - sliceStart > 10) { sliceStart = now; yield; }
    }
    if (opt.out) { opt.out.cands = cands; opt.out.wins = wins.slice(); opt.out.n = nW; }
    // 先验：启发式首选加半场胜利，防止小样本噪声推翻合理的常规出法
    const bonus = opt.prior === undefined ? 0.6 : opt.prior;
    let bi = 0, bs = -Infinity;
    for (let i = 0; i < nC; i++) {
      const isPrior = (cands[i] === null && prior === null) || (cands[i] && prior && cands[i].cards === prior.cards) ||
        (cands[i] && prior && sameCards(cands[i].cards, prior.cards));
      const sc = wins[i] + (isPrior ? bonus : 0);
      if (sc > bs) { bs = sc; bi = i; }
    }
    return cands[bi];
  }

  function sameCards(a, b) {
    if (a.length !== b.length) return false;
    const ids = new Set(a.map((c) => c.id));
    return b.every((c) => ids.has(c.id));
  }

  /** 同步版本（测试、对战脚本用） */
  function aiPlayMC(ctx, rnd, opt) {
    const it = mcGen(ctx, rnd, opt);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }


  // ---------- 叫牌：模拟“我当地主”的胜率 ----------
  /** 随机补全底牌与两家手牌，用快速策略打完，估计这手牌当地主的胜率（生成器） */
  function* bidWinRate(hand, rnd, n) {
    rnd = rnd || Math.random;
    const have = rankCounts(hand);
    const pool = [];
    for (let r = 3; r <= 17; r++) for (let k = 0; k < FULL[r] - have[r]; k++) pool.push(r);
    let win = 0;
    let sliceStart = Date.now();
    for (let i = 0; i < n; i++) {
      for (let j = pool.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        const t = pool[j]; pool[j] = pool[k]; pool[k] = t;
      }
      const hands = [
        hand.concat(synCards(pool.slice(0, 3))),
        synCards(pool.slice(3, 20)),
        synCards(pool.slice(20, 37)),
      ];
      const w = playout(hands, { last: null, lastBy: -1, passes: 0, turn: 0, landlord: 0, first: null, hasFirst: false }, rnd);
      if (w === 0) win++;
      const now = Date.now();
      if (now - sliceStart > 10) { sliceStart = now; yield; }
    }
    return win / n;
  }

  const BID_TH = [0.5, 0.56, 0.62];

  function levelFromRate(p, th) {
    th = th || BID_TH;
    return p >= th[2] ? 3 : p >= th[1] ? 2 : p >= th[0] ? 1 : 0;
  }

  function* bidGen(hand, bidMax, rnd, opt) {
    opt = opt || {};
    const p = yield* bidWinRate(hand, rnd, opt.n || 40);
    const level = levelFromRate(p, opt.th);
    return level > bidMax ? level : 0;
  }

  function aiBidMC(hand, bidMax, rnd, opt) {
    const it = bidGen(hand, bidMax, rnd, opt);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  return {
    LABEL, SUITS, newDeck, shuffle, sortHand, groupByRank,
    classify, canBeat, genMoves, hints, handStrength, aiBid, aiPlay, aiPlayMC, mcGen, bidGen, aiBidMC, bidWinRate, levelFromRate, unseenOf, rankCounts, couldBeat, contextOf, turnsEstimate,
  };
});
