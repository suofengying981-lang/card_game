/* 跳棋（六角星，121 孔，每人 10 子）规则引擎 + 电脑 AI。UMD，可在 Node 里测试。 */
(function (root) {
  'use strict';

  // 立方坐标 (x,y,z)，x+y+z=0。六个角（星尖）：下标 0..5
  const TIPS = [
    { t: [8, -4, -4], in: (x, y, z) => x >= 5 && y >= -4 && z >= -4 },
    { t: [-8, 4, 4], in: (x, y, z) => x <= -5 && y <= 4 && z <= 4 },
    { t: [-4, 8, -4], in: (x, y, z) => y >= 5 && x >= -4 && z >= -4 },
    { t: [4, -8, 4], in: (x, y, z) => y <= -5 && x <= 4 && z <= 4 },
    { t: [-4, -4, 8], in: (x, y, z) => z >= 5 && x >= -4 && y >= -4 },
    { t: [4, 4, -8], in: (x, y, z) => z <= -5 && x <= 4 && y <= 4 },
  ];
  const OPP = [1, 0, 3, 2, 5, 4];
  const DIRS = [[1, -1, 0], [-1, 1, 0], [1, 0, -1], [-1, 0, 1], [0, 1, -1], [0, -1, 1]];

  const CELLS = [];            // {x,y,z}
  const IDX = new Map();       // "x,y" -> 下标
  for (let x = -8; x <= 8; x++) {
    for (let y = -8; y <= 8; y++) {
      const z = -x - y;
      if (z < -8 || z > 8) continue;
      const hex = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 4;
      if (hex || TIPS.some((t) => t.in(x, y, z))) { IDX.set(x + ',' + y, CELLS.length); CELLS.push({ x, y, z }); }
    }
  }
  const N = CELLS.length;      // 121
  const idxOf = (x, y) => { const v = IDX.get(x + ',' + y); return v === undefined ? -1 : v; };

  // 邻居与"跳过去"的落点
  const NEI = CELLS.map((c) => DIRS.map((d) => idxOf(c.x + d[0], c.y + d[1])));
  const JUMP = CELLS.map((c, i) => DIRS.map((d, k) => {
    const over = NEI[i][k];
    if (over < 0) return null;
    const land = idxOf(c.x + 2 * d[0], c.y + 2 * d[1]);
    return land < 0 ? null : [over, land];
  }));

  const TIP_CELLS = TIPS.map((t) => { const a = []; CELLS.forEach((c, i) => { if (t.in(c.x, c.y, c.z)) a.push(i); }); return a; });
  const TIP_APEX = TIPS.map((t) => idxOf(t.t[0], t.t[1]));
  const dist = (a, b) => (Math.abs(CELLS[a].x - CELLS[b].x) + Math.abs(CELLS[a].y - CELLS[b].y) + Math.abs(CELLS[a].z - CELLS[b].z)) / 2;
  // 到每个角顶点的距离表
  const DIST_TO_APEX = TIP_APEX.map((ap) => CELLS.map((_, i) => dist(i, ap)));

  // 玩家 -> 出发角。2 人：下 / 上；3 人：下 / 左上 / 右上
  const HOMES = { 2: [4, 5], 3: [4, 2, 0] };

  function newGame(np) {
    const homes = HOMES[np] || HOMES[2];
    const board = new Int8Array(N).fill(-1);
    homes.forEach((h, p) => TIP_CELLS[h].forEach((c) => { board[c] = p; }));
    return { np: homes.length, homes, board, turn: 0, winner: -1, moves: 0 };
  }

  const targetOf = (st, p) => OPP[st.homes[p]];

  /** 从 from 能到达的所有格子，返回 Map(格 -> 上一步格)，用于路径还原。 */
  function reach(board, from) {
    const par = new Map();
    for (let k = 0; k < 6; k++) {
      const n = NEI[from][k];
      if (n >= 0 && board[n] < 0) par.set(n, from);
    }
    // 连跳（BFS）
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (let k = 0; k < 6; k++) {
        const j = JUMP[cur][k];
        if (!j) continue;
        const [over, land] = j;
        if (over !== from && board[over] >= 0 && (board[land] < 0 || land === from) && !seen.has(land)) {
          seen.add(land);
          if (land !== from && !par.has(land)) par.set(land, cur);
          q.push(land);
        }
      }
    }
    // 走一步的落点不是通过跳到达的，保持 par 为 from；跳到的落点 par 是上一个落脚点
    return par;
  }

  function pathTo(par, from, to) {
    const path = [to];
    let c = to;
    while (c !== from) { c = par.get(c); path.push(c); }
    return path.reverse();
  }

  function allMoves(st, p) {
    const out = [];
    for (let i = 0; i < N; i++) {
      if (st.board[i] !== p) continue;
      for (const to of reach(st.board, i).keys()) out.push({ from: i, to });
    }
    return out;
  }

  function hasWon(st, p) {
    const tg = TIP_CELLS[targetOf(st, p)];
    return tg.every((c) => st.board[c] === p);
  }

  function apply(st, mv) {
    const p = st.board[mv.from];
    st.board[mv.from] = -1;
    st.board[mv.to] = p;
    st.moves++;
    if (hasWon(st, p)) st.winner = p;
    else st.turn = (st.turn + 1) % st.np;
  }

  function undoMove(st, mv, prevTurn) {
    const p = st.board[mv.to];
    st.board[mv.to] = -1;
    st.board[mv.from] = p;
    st.moves--;
    st.winner = -1;
    st.turn = prevTurn;
  }

  // ---------- AI ----------
  /** 玩家 p 的局面分：越大越接近胜利。 */
  function evalPlayer(st, p) {
    const dt = DIST_TO_APEX[targetOf(st, p)];
    let sum = 0, worst = 0, inGoal = 0;
    const tg = TIP_CELLS[targetOf(st, p)];
    const goalSet = new Set(tg);
    for (let i = 0; i < N; i++) {
      if (st.board[i] !== p) continue;
      const d = dt[i];
      sum += d;
      if (d > worst) worst = d;
      if (goalSet.has(i)) inGoal++;
    }
    // 总距离越小越好；最落后的子权重加大，避免掉队；入栈有奖励
    return -(sum + 0.6 * worst) + inGoal * 1.5;
  }

  /** level: 0 简单（随机性大）、1 普通（贪心）、2 困难（考虑对手最佳回应）。 */
  function aiMove(st, p, level) {
    const mvs = allMoves(st, p);
    if (!mvs.length) return null;
    const base = evalPlayer(st, p);
    const scored = [];
    for (const mv of mvs) {
      const prevTurn = st.turn;
      st.board[mv.from] = -1; st.board[mv.to] = p;
      let s = evalPlayer(st, p) - base;
      if (level >= 2 && st.np === 2) {
        // 对手最佳回应：扣掉对手能得到的最大进步
        const q = 1 - p;
        const bq = evalPlayer(st, q);
        let best = 0;
        for (const r of allMoves(st, q)) {
          st.board[r.from] = -1; st.board[r.to] = q;
          const g = evalPlayer(st, q) - bq;
          st.board[r.to] = -1; st.board[r.from] = q;
          if (g > best) best = g;
        }
        s -= 0.35 * best;
      }
      st.board[mv.to] = -1; st.board[mv.from] = p;
      st.turn = prevTurn;
      scored.push({ mv, s });
    }
    scored.sort((a, b) => b.s - a.s);
    if (level === 0) {
      const k = Math.min(scored.length, 6);
      return scored[Math.floor(Math.random() * k)].mv;
    }
    // 并列最优里随机，避免来回摆动
    const top = scored.filter((x) => x.s >= scored[0].s - 1e-9);
    return top[Math.floor(Math.random() * top.length)].mv;
  }

  const api = { CELLS, N, TIPS, TIP_CELLS, TIP_APEX, NEI, OPP, HOMES, newGame, targetOf, reach, pathTo, allMoves, hasWon, apply, undoMove, aiMove, evalPlayer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TiaoqiEngine = api;
})(typeof self !== 'undefined' ? self : this);
