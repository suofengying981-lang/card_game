/* 蒸馏用的教师数据：让「困难」档（蒙特卡洛推演）三家对打，记录每一步的 状态特征、各候选出法特征、推演胜率。
 * 用法：node gen_teacher.js <输出文件> <分钟> <每步推演毫秒> [候选数]
 * 记录格式（小端，连续写入）：
 *   u8 相对座位(0 地主/1 地主下家/2 地主上家)  u8 候选数 n  u8[611] 状态特征
 *   重复 n 次：u8[60] 动作特征  f32 目标值(2*胜率-1，从该方视角)
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const DDZ = require(path.join(root, 'engine.js'));
const NN = require(path.join(root, 'nn.js'));

const OUT = process.argv[2];
const MINUTES = +process.argv[3] || 10;
const MS = +process.argv[4] || 250;
const K = +process.argv[5] || 8;
const SDIM = 611, ADIM = 60, NR = 15;

function actFeat(m) {
  const a = Buffer.alloc(ADIM);
  if (m) {
    const c = NN.cardsTo15(m.cards);
    for (let i = 0; i < NR; i++) for (let j = 0; j < c[i]; j++) a[i * 4 + j] = 1;
  }
  return a;
}

function recordDecision(fd, ctx, out) {
  const L = ctx.landlord, p = ctx.me;
  const rel = (x) => (x - L + 3) % 3;
  const me = rel(p);
  const played = [null, null, null], counts = [0, 0, 0];
  for (let x = 0; x < 3; x++) { played[rel(x)] = NN.to15(ctx.playedBy[x]); counts[rel(x)] = ctx.counts[x]; }
  const acts = ctx.history.map((h) => (h.cards ? NN.cardsTo15(h.cards) : null));
  const s = NN.stateFeatures(NN.cardsTo15(ctx.hand), played, acts, counts, ctx.bombs || 0, NN.cardsTo15(ctx.bottom || []), me);
  const n = out.cands.length;
  const parts = [Buffer.from([me, n]), Buffer.from(s)];
  for (let i = 0; i < n; i++) {
    const q = Buffer.alloc(4);
    q.writeFloatLE(2 * (out.wins[i] / out.n) - 1, 0);
    parts.push(actFeat(out.cands[i]), q);
  }
  fs.writeSync(fd, Buffer.concat(parts));
}

function playGame(fd, landlord) {
  const deck = DDZ.shuffle(DDZ.newDeck());
  const hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)].map(DDZ.sortHand);
  const bottom = deck.slice(51);
  hands[landlord] = DDZ.sortHand(hands[landlord].concat(bottom));
  const played = new Array(18).fill(0), playedBy = [0, 1, 2].map(() => new Array(18).fill(0));
  let last = null, lastBy = -1, passes = 0, turn = landlord, bombs = 0, steps = 0, nrec = 0;
  const history = [];
  while (steps++ < 400) {
    const p = turn;
    const ctx = { hand: hands[p], last: last && last.info, lastBy, me: p, landlord, counts: hands.map((h) => h.length), played, playedBy, bottom, passes, level: 2, history, bombs };
    const out = {};
    const mv = DDZ.aiPlayMC(ctx, Math.random, { ms: MS, cands: K, out });
    if (out.cands && out.n >= 30) { recordDecision(fd, ctx, out); nrec++; }
    if (mv) {
      const info = DDZ.classify(mv.cards);
      const ids = new Set(mv.cards.map((c) => c.id));
      hands[p] = hands[p].filter((c) => !ids.has(c.id));
      last = { info, cards: mv.cards }; lastBy = p; passes = 0;
      for (const c of mv.cards) { played[c.rank]++; playedBy[p][c.rank]++; }
      if (info.type === 'bomb' || info.type === 'rocket') bombs++;
      history.push({ cards: mv.cards });
      if (!hands[p].length) return nrec;
    } else { history.push({ cards: null }); passes++; }
    if (passes === 2) { last = null; passes = 0; turn = lastBy; } else turn = (p + 1) % 3;
  }
  return nrec;
}

const fd = fs.openSync(OUT, 'w');
const end = Date.now() + MINUTES * 60000;
let games = 0, recs = 0;
while (Date.now() < end) {
  recs += playGame(fd, games % 3);
  games++;
}
fs.closeSync(fd);
console.log(JSON.stringify({ out: OUT, games, recs }));
