/* 神经网络出牌（斗地主）：读取 ddz_nn.bin（float16 权重），用与训练一致的特征给每个候选出法打分。
   纯函数 + 一个异步加载器，浏览器与 Node 通用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDZNN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NR = 15, SDIM = 611, ADIM = 60;
  const FULL = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1];

  function f16(h) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) return s * m * 5.960464477539063e-8;
    if (e === 31) return m ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + m / 1024);
  }

  /** 解析 ddz_nn.bin（ArrayBuffer） */
  function parse(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'DDZN') throw new Error('bad model file');
    const jl = dv.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl)));
    let off = 8 + jl;
    const rd = (n) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = f16(dv.getUint16(off + i * 2, true));
      off += n * 2;
      return out;
    };
    const nets = meta.nets.map((layers) => {
      const L = layers.map((ly) => ({ in: ly.in, out: ly.out, W: rd(ly.in * ly.out), b: rd(ly.out) }));
      // 第一层拆成状态部分 [out][SDIM] 与动作部分（转置成 [ADIM][out]）
      const l0 = L[0], H = l0.out, X = l0.in;
      const Ws = new Float32Array(H * SDIM), Wa = new Float32Array(ADIM * H);
      for (let o = 0; o < H; o++) {
        for (let i = 0; i < SDIM; i++) Ws[o * SDIM + i] = l0.W[o * X + i];
        for (let a = 0; a < ADIM; a++) Wa[a * H + o] = l0.W[o * X + SDIM + a];
      }
      return { Ws, Wa, b0: l0.b, H, rest: L.slice(1, -1), out: L[L.length - 1] };
    });
    return { nets, step: meta.step || 0 };
  }

  async function load(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('model fetch failed ' + r.status);
    return parse(await r.arrayBuffer());
  }

  // ---------- 特征（必须与 rl/env.py 完全一致） ----------
  function onehot(cnt15, out, off) { // cnt15: 长度 15 的牌数；写入 out[off..off+60)
    for (let i = 0; i < NR; i++) for (let j = 0; j < cnt15[i]; j++) out[off + i * 4 + j] = 1;
  }
  const to15 = (c18) => { const a = new Array(NR); for (let i = 0; i < NR; i++) a[i] = c18[i + 3] || 0; return a; };
  const cardsTo15 = (cards) => { const a = new Array(NR).fill(0); for (const c of cards) a[c.rank - 3]++; return a; };

  /**
   * 状态特征。参数：
   *  hand15 自己手牌；played[3]（相对座位：0 地主 1 地主下家 2 地主上家）每人已打出的牌（长度 15）；
   *  acts 最近动作（时间顺序，元素为 长度15 的牌数 或 null=不出）；counts[3] 各座位剩余张数（相对座位）；
   *  bombs；bottom15 底牌；me 相对座位。
   */
  function stateFeatures(hand15, played, acts, counts, bombs, bottom15, me) {
    const nxt = (me + 1) % 3, prv = (me + 2) % 3;
    const f = new Uint8Array(SDIM);
    let o = 0;
    onehot(hand15, f, o); o += 60;
    const unseen = new Array(NR);
    for (let i = 0; i < NR; i++) unseen[i] = FULL[i] - hand15[i] - played[0][i] - played[1][i] - played[2][i];
    onehot(unseen, f, o); o += 60;
    onehot(played[me], f, o); o += 60;
    onehot(played[nxt], f, o); o += 60;
    onehot(played[prv], f, o); o += 60;
    for (let k = 0; k < 3; k++) {
      const a = acts.length > k ? acts[acts.length - 1 - k] : null;
      if (a) onehot(a, f, o);
      o += 60;
    }
    [me, nxt, prv].forEach((p, k) => { f[o + k * 21 + counts[p]] = 1; });
    o += 63;
    f[o + Math.min(bombs, 7)] = 1; o += 8;
    onehot(bottom15, f, o); o += 60;
    return f;
  }

  /** 给每个候选动作打分。moves15: [长度15的牌数 或 null(不出)] */
  function scoreMoves(net, s, moves15) {
    const H = net.H, n = moves15.length;
    const base = new Float32Array(H);
    for (let o = 0; o < H; o++) {
      let acc = net.b0[o];
      const row = o * SDIM;
      for (let i = 0; i < SDIM; i++) if (s[i]) acc += net.Ws[row + i];
      base[o] = acc;
    }
    const q = new Float32Array(n);
    let h = new Float32Array(H);
    for (let k = 0; k < n; k++) {
      h.set(base);
      const m = moves15[k];
      if (m) {
        for (let i = 0; i < NR; i++) for (let j = 0; j < m[i]; j++) {
          const a = i * 4 + j, row = a * H;
          for (let o = 0; o < H; o++) h[o] += net.Wa[row + o];
        }
      }
      for (let o = 0; o < H; o++) if (h[o] < 0) h[o] = 0;
      let cur = h;
      for (const ly of net.rest) {
        const nx = new Float32Array(ly.out);
        for (let o = 0; o < ly.out; o++) {
          let acc = ly.b[o];
          const row = o * ly.in;
          for (let i = 0; i < ly.in; i++) acc += ly.W[row + i] * cur[i];
          nx[o] = acc > 0 ? acc : 0;
        }
        cur = nx;
      }
      const ol = net.out;
      let acc = ol.b[0];
      for (let i = 0; i < ol.in; i++) acc += ol.W[i] * cur[i];
      q[k] = acc;
    }
    return q;
  }

  /**
   * 用网络为 ctx 里的玩家选牌（与 engine.js 的 ctx 约定一致，另需 ctx.history / ctx.bombs）。
   * 返回候选出法对象（含 .cards）或 null（不出）。
   */
  function pick(model, ctx, DDZ, opts) {
    const L = ctx.landlord, p = ctx.me;
    const rel = (x) => (x - L + 3) % 3;
    const me = rel(p);
    const played = [null, null, null], counts = [0, 0, 0];
    for (let x = 0; x < 3; x++) { played[rel(x)] = to15(ctx.playedBy[x]); counts[rel(x)] = ctx.counts[x]; }
    const acts = (ctx.history || []).map((h) => (h.cards ? cardsTo15(h.cards) : null));
    const hand15 = cardsTo15(ctx.hand);
    const s = stateFeatures(hand15, played, acts, counts, ctx.bombs || 0, cardsTo15(ctx.bottom || []), me);
    let cand = DDZ.genMoves(ctx.hand);
    if (ctx.last) cand = cand.filter((m) => DDZ.canBeat(m, ctx.last));
    const moves15 = cand.map((m) => cardsTo15(m.cards));
    const list = cand.slice();
    if (ctx.last) { list.push(null); moves15.push(null); }
    if (!list.length) return null;
    const finish = cand.find((m) => m.n === ctx.hand.length);
    if (finish) return finish;
    if (list.length === 1) return list[0];
    const q = scoreMoves(model.nets[me], s, moves15);
    let bi = 0;
    for (let i = 1; i < q.length; i++) if (q[i] > q[bi]) bi = i;
    if (opts) {
      opts.n = q.length;
      opts.top = Array.from(q.keys()).sort((a, b) => q[b] - q[a]).slice(0, 3).map((i) => ({ m: list[i], q: q[i] }));
    }
    return list[bi];
  }

  return { parse, load, stateFeatures, scoreMoves, pick, to15, cardsTo15, SDIM, ADIM };
});
