/* 军旗（陆战棋）规则引擎 + 电脑 AI。UMD，可在 Node 里测试。
 * 棋盘 12 行 × 5 列：第 0..5 行是上方（side 1，电脑），第 6..11 行是下方（side 0，玩家）。
 * 棋子类型：1 工兵 2 排长 3 连长 4 营长 5 团长 6 旅长 7 师长 8 军长 9 司令 10 炸弹 11 地雷 12 军旗
 */
(function (root) {
  'use strict';

  const ROWS = 12, COLS = 5;
  const NAMES = ['', '工兵', '排长', '连长', '营长', '团长', '旅长', '师长', '军长', '司令', '炸弹', '地雷', '军旗'];
  const TOTAL = [0, 3, 3, 3, 2, 2, 2, 2, 1, 1, 2, 3, 1];     // 每方 25 子
  const VAL = [0, 14, 6, 10, 18, 25, 35, 50, 70, 90, 30, 12, 0];
  const id = (r, c) => r * COLS + c;
  const rowOf = (n) => (n / COLS) | 0;
  const colOf = (n) => n % COLS;

  const CAMPS = new Set([id(2, 1), id(2, 3), id(3, 2), id(8, 1), id(8, 3), id(9, 2)]);
  const HQ = [[id(11, 1), id(11, 3)], [id(0, 1), id(0, 3)]];   // 按 side 索引
  const isHQ = (n, side) => HQ[side].includes(n);
  const sideOfRow = (r) => (r >= 6 ? 0 : 1);
  const backRow = (side) => (side === 0 ? 11 : 0);
  const frontRow = (side) => (side === 0 ? 6 : 5);
  const inBackTwo = (n, side) => { const r = rowOf(n); return side === 0 ? r >= 10 : r <= 1; };
  const isFront = (n, side) => rowOf(n) === frontRow(side);

  // 铁路：第 1、5、6、10 行整行，第 0、4 列 1..10 行，以及第 2 列在 5-6 行间的桥
  const railEdges = new Set();
  const railNodes = new Set();
  const addRail = (a, b) => { railEdges.add(a + ',' + b); railEdges.add(b + ',' + a); railNodes.add(a); railNodes.add(b); };
  for (const r of [1, 5, 6, 10]) for (let c = 0; c < COLS - 1; c++) addRail(id(r, c), id(r, c + 1));
  for (const c of [0, 4]) for (let r = 1; r < 10; r++) addRail(id(r, c), id(r + 1, c));
  addRail(id(5, 2), id(6, 2));
  const isRailEdge = (a, b) => railEdges.has(a + ',' + b);

  // 公路 / 邻接：上下左右（5-6 行之间只有 0、2、4 列相通），行营另有四个斜向
  const ADJ = Array.from({ length: ROWS * COLS }, () => []);
  const link = (a, b) => { if (!ADJ[a].includes(b)) ADJ[a].push(b); if (!ADJ[b].includes(a)) ADJ[b].push(a); };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS) link(id(r, c), id(r, c + 1));
      if (r + 1 < ROWS) {
        if (r === 5 && c % 2 === 1) continue;
        link(id(r, c), id(r + 1, c));
      }
    }
  }
  for (const n of CAMPS) {
    const r = rowOf(n), c = colOf(n);
    for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) link(n, id(rr, cc));
    }
  }

  // ---------- 开局布阵 ----------
  function canPlace(t, n, side) {
    if (CAMPS.has(n)) return false;
    const r = rowOf(n);
    if (sideOfRow(r) !== side) return false;
    if (t === 12) return isHQ(n, side);
    if (t === 11) return inBackTwo(n, side);
    if (t === 10) return !isFront(n, side);
    return true;
  }

  function ownNodes(side) {
    const out = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const n = id(r, c);
      if (sideOfRow(r) === side && !CAMPS.has(n)) out.push(n);
    }
    return out;
  }

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /** 随机合法布阵，返回 {节点: 类型}。 */
  function randomSetup(side) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const free = new Set(ownNodes(side));
      const lay = {};
      const put = (n, t) => { lay[n] = t; free.delete(n); };
      const flagN = HQ[side][Math.floor(Math.random() * 2)];
      put(flagN, 12);
      // 两颗地雷贴着军旗，第三颗在后两排
      const around = ADJ[flagN].filter((n) => free.has(n) && inBackTwo(n, side));
      shuffle(around);
      for (let i = 0; i < 2 && i < around.length; i++) put(around[i], 11);
      let mines = Object.values(lay).filter((t) => t === 11).length;
      const back = shuffle([...free].filter((n) => inBackTwo(n, side)));
      while (mines < 3 && back.length) { const n = back.pop(); if (free.has(n)) { put(n, 11); mines++; } }
      // 炸弹：不放第一排
      const nonFront = shuffle([...free].filter((n) => !isFront(n, side)));
      for (let i = 0; i < 2; i++) put(nonFront[i], 10);
      const rest = [];
      for (let t = 1; t <= 9; t++) for (let k = 0; k < TOTAL[t]; k++) rest.push(t);
      shuffle(rest);
      const spots = shuffle([...free]);
      for (let i = 0; i < rest.length; i++) put(spots[i], rest[i]);
      if (Object.keys(lay).length === 25) return lay;
    }
    throw new Error('布阵失败');
  }

  function makePiece(side, t, serial) {
    return { side, t, uid: side * 100 + serial, moved: false, lb: 0, fought: false, nomine: false };
  }

  function newGame(humanLayout) {
    const board = new Array(ROWS * COLS).fill(null);
    let serial = 0;
    const place = (side, lay) => { for (const n in lay) board[+n] = makePiece(side, lay[n], serial++); };
    place(0, humanLayout || randomSetup(0));
    place(1, randomSetup(1));
    return { board, turn: 0, winner: -1, moves: 0, dead: [[], []], last: null, noCapture: 0, lastFrom: [-1, -1] };
  }

  // ---------- 走法 ----------
  function combat(a, d) {
    if (d.t === 12) return 'flag';
    if (a.t === 10 || d.t === 10) return 'both';
    if (d.t === 11) return a.t === 1 ? 'win' : 'lose';
    if (a.t > d.t) return 'win';
    if (a.t === d.t) return 'both';
    return 'lose';
  }

  /** 棋子 (在 from) 的全部可达点：Map(to -> 'move'|'attack') */
  function targetsOf(st, from) {
    const p = st.board[from];
    const out = new Map();
    if (!p || p.t >= 11) return out;
    const b = st.board;
    const consider = (n) => {
      const q = b[n];
      if (!q) { out.set(n, 'move'); return true; }
      if (q.side !== p.side && !CAMPS.has(n)) out.set(n, 'attack');
      return false;
    };
    for (const n of ADJ[from]) consider(n);
    if (railNodes.has(from)) {
      if (p.t === 1) {
        const seen = new Set([from]);
        const q = [from];
        while (q.length) {
          const cur = q.shift();
          for (const n of ADJ[cur]) {
            if (!isRailEdge(cur, n) || seen.has(n)) continue;
            seen.add(n);
            if (consider(n)) q.push(n);
          }
        }
      } else {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let cur = from;
          for (;;) {
            const r = rowOf(cur) + dr, c = colOf(cur) + dc;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
            const n = id(r, c);
            if (!isRailEdge(cur, n)) break;
            if (!consider(n)) break;
            cur = n;
          }
        }
      }
    }
    return out;
  }

  function allMoves(st, side) {
    const mv = [];
    for (let i = 0; i < st.board.length; i++) {
      const p = st.board[i];
      if (!p || p.side !== side || p.t >= 11) continue;
      for (const [to, kind] of targetsOf(st, i)) mv.push({ from: i, to, kind });
    }
    return mv;
  }

  /** 执行走法，返回事件 {kind, att, def, text}；att/def 为类型副本（战斗后双方公开）。 */
  function apply(st, mv) {
    const a = st.board[mv.from];
    const d = st.board[mv.to];
    const side = a.side;
    const ev = { side, from: mv.from, to: mv.to, kind: 'move', att: null, def: null };
    st.lastFrom[side] = mv.from;
    a.moved = true;
    if (!d) {
      st.board[mv.to] = a; st.board[mv.from] = null;
      st.noCapture++;
    } else {
      st.noCapture = 0;
      const res = combat(a, d);
      ev.kind = res; ev.att = a.t; ev.def = d.t;
      a.fought = true; d.fought = true;
      if (res === 'flag') {
        st.board[mv.to] = a; st.board[mv.from] = null; st.dead[d.side].push(d.t);
        st.winner = side;
      } else if (res === 'win') {
        st.board[mv.to] = a; st.board[mv.from] = null; st.dead[d.side].push(d.t);
        a.lb = Math.max(a.lb, d.t > 9 ? 0 : d.t);
      } else if (res === 'lose') {
        st.board[mv.from] = null; st.dead[a.side].push(a.t);
        d.lb = Math.max(d.lb, a.t);
        if (a.t === 1) d.nomine = true;
      } else {
        st.board[mv.from] = null; st.board[mv.to] = null;
        st.dead[a.side].push(a.t); st.dead[d.side].push(d.t);
      }
    }
    st.moves++;
    st.last = ev;
    if (st.winner < 0) {
      st.turn = 1 - side;
      if (!allMoves(st, st.turn).length) st.winner = side;
      else if (st.moves >= 800 || st.noCapture >= 120) st.winner = 2;      // 和棋
    }
    return ev;
  }

  // ---------- 电脑 AI（只使用公开信息推断对手） ----------
  function remainingOf(st, enemySide) {
    const rem = TOTAL.slice();
    for (const t of st.dead[enemySide]) rem[t]--;
    return rem;
  }

  /** 对 enemySide 的某个棋子 piece（在 node）可能的类型分布 [[t, w], ...] */
  function belief(st, node, piece, rem, hqUnmoved) {
    const side = piece.side;
    const cand = [];
    let sum = 0;
    for (let t = 1; t <= 11; t++) {
      if (rem[t] <= 0) continue;
      if (t === 11 && (piece.moved || piece.fought || piece.nomine || !inBackTwo(node, side))) continue;
      if (t === 10 && (piece.fought || (!piece.moved && isFront(node, side)))) continue;
      if (t <= 9 && t <= piece.lb) continue;
      if (t === 11 && piece.lb > 0) continue;
      cand.push([t, rem[t]]); sum += rem[t];
    }
    if (rem[12] > 0 && !piece.moved && !piece.fought && isHQ(node, side)) {
      if (hqUnmoved <= 1 || !cand.length) return [[12, 1]];
      cand.push([12, sum / (hqUnmoved - 1)]);
    }
    if (!cand.length) cand.push([5, 1]);
    return cand;
  }

  function expectedAttack(a, cand) {
    let tot = 0, sw = 0;
    for (const [t, w] of cand) {
      const r = combat(a, { t });
      let v;
      if (r === 'flag') v = 6000;
      else if (r === 'win') v = VAL[t];
      else if (r === 'both') v = VAL[t] - VAL[a.t];
      else v = -VAL[a.t];
      tot += v * w; sw += w;
    }
    return tot / sw;
  }

  function exposure(st, node, p, remEnemy, hqCount) {
    if (CAMPS.has(node)) return 0;
    let worst = 0;
    for (const n of ADJ[node]) {
      const e = st.board[n];
      if (!e || e.side === p.side) continue;
      const cand = belief(st, n, e, remEnemy, hqCount);
      let tot = 0, sw = 0;
      for (const [t, w] of cand) {
        sw += w;
        if (t >= 11) continue;                      // 地雷和军旗不会主动攻击
        const r = combat({ t }, p);
        if (r === 'win') tot += VAL[p.t] * w;
        else if (r === 'both') tot += (VAL[p.t] - VAL[t]) * w;
      }
      worst = Math.max(worst, tot / sw);
    }
    return worst * 0.55;
  }

  function aiMove(st, side, level) {
    const mvs = allMoves(st, side);
    if (!mvs.length) return null;
    const enemy = 1 - side;
    const rem = remainingOf(st, enemy);
    let hq = 0;
    for (const n of HQ[enemy]) { const e = st.board[n]; if (e && !e.moved && !e.fought) hq++; }
    const goalRow = backRow(enemy);
    const noise = level === 0 ? 40 : level === 1 ? 6 : 2;
    let best = null, bs = -1e9;
    for (const mv of mvs) {
      const a = st.board[mv.from];
      let s = 0;
      if (mv.kind === 'attack') {
        const e = st.board[mv.to];
        s += expectedAttack(a, belief(st, mv.to, e, rem, hq)) * (level === 0 ? 0.5 : 1);
      }
      // 推进：棋子越弱越敢往前，强子谨慎
      const dRow = Math.abs(rowOf(mv.from) - goalRow) - Math.abs(rowOf(mv.to) - goalRow);
      const eager = a.t === 10 ? 0.2 : a.t <= 3 ? 1.6 : a.t <= 6 ? 1.1 : 0.7;
      s += dRow * eager;
      if (a.t === 1 && mv.kind === 'move') s += dRow * 0.6;
      if (level >= 1) {
        s += exposure(st, mv.from, a, rem, hq) - exposure(st, mv.to, a, rem, hq) * (mv.kind === 'attack' ? 0 : 1);
        if (mv.to === st.lastFrom[side] && mv.kind === 'move') s -= 2.5;           // 少来回摆
        // 守家：旗附近有敌人时，让附近的子回防的收益交给 exposure，不另算
      }
      s += (Math.random() - 0.5) * noise;
      if (s > bs) { bs = s; best = mv; }
    }
    return best;
  }

  const api = {
    ROWS, COLS, NAMES, TOTAL, VAL, CAMPS, HQ, id, rowOf, colOf, railNodes, isRailEdge, ADJ,
    canPlace, ownNodes, randomSetup, newGame, combat, targetsOf, allMoves, apply, aiMove, sideOfRow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JunqiEngine = api;
})(typeof self !== 'undefined' ? self : this);
