/* 桥牌叫牌 AI：自然叫牌体系（5 张高花、15-17 无将、弱二、强二梅花、黑木、简单加倍）。
   核心思想：把每个人的叫品解释成 HCP 区间 + 花色长度（analyze），再用"我的点力 + 搭档点力估计"决定目标定约。 */
(function (root) {
  'use strict';
  const E = typeof require !== 'undefined' ? require('./bridge-engine.js') : root.BridgeEngine;
  const { PASS, DBL, RDBL, suitOf, rankOf, partner, side, bid, lvlOf, strainOf, lastBidInfo, legalCalls } = E;

  // ---------- 手牌特征 ----------
  const HCP_OF = { 14: 4, 13: 3, 12: 2, 11: 1 };
  function hcpOf(hand) { let h = 0; for (const c of hand) h += HCP_OF[rankOf(c)] || 0; return h; }
  function lensOf(hand) { const l = [0, 0, 0, 0]; for (const c of hand) l[suitOf(c)]++; return l; }
  function isBal(l) {
    const s = l.slice().sort((a, b) => a - b);
    return s[0] >= 2 && (s[0] === 2 ? s[1] >= 3 && (s[1] === 3 || false) && true : true) && s[3] <= 5 && !(s[0] === 2 && s[1] === 2);
  }
  function suitHcp(hand, s) { let h = 0; for (const c of hand) if (suitOf(c) === s) h += HCP_OF[rankOf(c)] || 0; return h; }
  function suitCards(hand, s) { return hand.filter((c) => suitOf(c) === s).map(rankOf).sort((a, b) => b - a); }
  function aces(hand) { return hand.filter((c) => rankOf(c) === 14).length; }
  function kings(hand) { return hand.filter((c) => rankOf(c) === 13).length; }
  // 该花色上有没有止张（A、Kx、Qxx、Jxxx）
  function stopper(hand, s) {
    const r = suitCards(hand, s), n = r.length;
    if (!n) return false;
    if (r[0] === 14) return true;
    if (r[0] === 13 && n >= 2) return true;
    if (r[0] === 12 && n >= 3) return true;
    if (r[0] === 11 && n >= 4) return true;
    return false;
  }
  function shortPts(l, trump) {
    let p = 0;
    for (let s = 0; s < 4; s++) { if (s === trump) continue; p += l[s] === 0 ? 3 : l[s] === 1 ? 2 : l[s] === 2 ? 1 : 0; }
    return p;
  }
  function longPts(l) { let p = 0; for (let s = 0; s < 4; s++) p += Math.max(0, l[s] - 4); return p; }
  const MAJ = (s) => s === 2 || s === 3;

  // ---------- 叫牌解释 ----------
  function newInfo() { return { lo: 0, hi: 40, len: [0, 0, 0, 0], bal: false, nt: false, forceGame: false, takeout: false, preempt: false, ask: false, bids: 0 }; }
  function setRange(inf, lo, hi) {
    const nlo = Math.max(inf.lo, lo), nhi = Math.min(inf.hi, hi);
    if (nlo <= nhi) { inf.lo = nlo; inf.hi = nhi; } else { inf.lo = lo; inf.hi = hi; }
  }
  function minLevel(strain, lastBid) {
    if (!lastBid) return 1;
    return strain > strainOf(lastBid) ? lvlOf(lastBid) : lvlOf(lastBid) + 1;
  }

  /** 把整个叫牌过程解释成每个座位的信息 */
  function analyze(auction, dealer) {
    const infos = [newInfo(), newInfo(), newInfo(), newInfo()];
    const hist = [];
    let lastBid = 0;
    for (let i = 0; i < auction.length; i++) {
      const s = (dealer + i) & 3, c = auction[i], inf = infos[s];
      const bids = hist.filter((x) => x.call >= 5);
      const ownB = bids.filter((x) => side(x.seat) === side(s));
      const oppB = bids.filter((x) => side(x.seat) !== side(s));
      const myB = ownB.filter((x) => x.seat === s), pB = ownB.filter((x) => x.seat !== s);
      if (c === PASS) {
        if (!bids.length) setRange(inf, 0, 11);
        else if (!myB.length && pB.length && !oppB.length) {
          const pl = pB[pB.length - 1].call;
          if (!infos[partner(s)].forceGame) setRange(inf, 0, lvlOf(pl) >= 2 && strainOf(pl) !== 4 && infos[partner(s)].preempt ? 40 : 5);
        }
      } else if (c === DBL) {
        const ob = bids.length ? bids[bids.length - 1] : null;
        if (ob && side(ob.seat) !== side(s) && !pB.length && lvlOf(ob.call) <= 3) { setRange(inf, 11, 40); inf.takeout = true; }
        else if (ob && side(ob.seat) !== side(s)) { setRange(inf, 8, 40); if (lvlOf(ob.call) <= 3) inf.takeout = true; }
      } else if (c === RDBL) {
        setRange(inf, 10, 40);
      } else {
        const L = lvlOf(c), k = strainOf(c);
        inf.bids++;
        if (!bids.length) {
          // 开叫
          if (L === 1 && k < 4) { setRange(inf, 12, 21); inf.len[k] = Math.max(inf.len[k], k >= 2 ? 5 : k === 1 ? 4 : 3); }
          else if (L === 1) { setRange(inf, 15, 17); inf.bal = true; inf.nt = true; }
          else if (L === 2 && k === 4) { setRange(inf, 20, 21); inf.bal = true; inf.nt = true; }
          else if (L === 2 && k === 0) { setRange(inf, 22, 40); inf.forceGame = true; }
          else if (L === 2) { setRange(inf, 5, 10); inf.len[k] = 6; inf.preempt = true; }
          else if (L === 3 && k < 4) { setRange(inf, 4, 10); inf.len[k] = 7; inf.preempt = true; }
          else if (L >= 4 && k < 4) { setRange(inf, 4, 13); inf.len[k] = 7; inf.preempt = true; }
          else setRange(inf, 15, 40);
        } else if (!ownB.length) {
          // 对手已叫、我方首次叫牌：争叫
          if (k === 4) { if (L === 1) { setRange(inf, 15, 18); inf.bal = true; inf.nt = true; } else setRange(inf, 19, 40); }
          else if (L === 1) { setRange(inf, 8, 17); inf.len[k] = 5; }
          else if (L === 2) { setRange(inf, 11, 17); inf.len[k] = 5; }
          else { setRange(inf, 0, 12); inf.len[k] = L === 3 ? 6 : 7; inf.preempt = true; }
        } else if (!myB.length) {
          // 对搭档的叫品作出回应
          const pb = pB[pB.length - 1];
          const ps = strainOf(pb.call), pl = lvlOf(pb.call);
          const pinf = infos[partner(s)];
          const mn = minLevel(k, lastBid), jump = L - mn;
          if (pinf.forceGame && pb.call === bid(2, 0)) {
            if (c === bid(2, 1)) setRange(inf, 0, 7);
            else if (k < 4) { setRange(inf, 8, 40); inf.len[k] = 5; }
            else { setRange(inf, 8, 40); inf.bal = true; }
          } else if (ps === 4 && pinf.nt) {
            if (k < 4) {
              if (L === 2) { setRange(inf, 0, 8); inf.len[k] = 5; }
              else if (L === 3) { setRange(inf, 10, 40); inf.len[k] = 5; }
              else { setRange(inf, 10, 40); inf.len[k] = 6; }
            } else if (L === 2) setRange(inf, 8, 9);
            else if (L === 3) setRange(inf, 10, 15);
            else if (L === 4) { setRange(inf, 16, 17); inf.ask = true; }
            else setRange(inf, 18, 40);
          } else if (k === ps) {
            inf.len[k] = Math.max(inf.len[k], MAJ(k) ? 3 : 4);
            if (L >= 5) setRange(inf, 12, 40);
            else if (L === 4 && MAJ(k)) { setRange(inf, 10, 15); inf.len[k] = 4; }
            else if (jump <= 0) setRange(inf, 6, 10);
            else if (jump === 1) { setRange(inf, 10, 12); inf.len[k] = 4; }
            else setRange(inf, 5, 40);
          } else if (k === 4) {
            if (L === 4 && agreedSuit(hist, s) >= 0) { inf.ask = true; setRange(inf, 16, 40); }
            else if (L === 1) setRange(inf, 6, 10);
            else if (L === 2) setRange(inf, 11, 12);
            else if (L === 3) setRange(inf, 13, 15);
            else setRange(inf, 16, 40);
            inf.bal = true;
          } else {
            inf.len[k] = Math.max(inf.len[k], 4);
            if (jump >= 1) setRange(inf, 16, 40);
            else if (L === 1) setRange(inf, 6, 40);
            else if (L === 2) setRange(inf, 10, 40);
            else setRange(inf, 12, 40);
          }
        } else {
          // 我已经叫过：再叫
          const mb = myB[myB.length - 1];
          const ms = strainOf(mb.call);
          const pb = pB.length ? pB[pB.length - 1] : null;
          const ps = pb ? strainOf(pb.call) : -1;
          const mn = minLevel(k, lastBid), jump = L - mn;
          const opener = bids.length && bids[0].seat === s;
          if (k === 4) {
            if (L === 4 && agreedSuit(hist, s) >= 0) { inf.ask = true; setRange(inf, 16, 40); }
            else if (L === 1) { setRange(inf, 12, 14); inf.bal = true; }
            else if (L === 2) { if (opener) { setRange(inf, 18, 19); } else setRange(inf, 11, 12); inf.bal = true; }
            else if (L === 3) { setRange(inf, opener ? 19 : 13, 40); inf.bal = true; }
          } else if (k === ms) {
            inf.len[k] = Math.max(inf.len[k], 6);
            if (jump >= 1) setRange(inf, opener ? 16 : 10, opener ? 19 : 40);
            else if (opener) setRange(inf, 12, 15);
          } else if (k === ps) {
            inf.len[k] = Math.max(inf.len[k], MAJ(k) ? 3 : 4);
            if (opener) { if (jump <= 0) setRange(inf, 12, 15); else if (jump === 1) setRange(inf, 16, 18); else setRange(inf, 19, 40); }
            else { if (jump <= 0) setRange(inf, 6, 12); else setRange(inf, 10, 40); }
          } else {
            inf.len[k] = Math.max(inf.len[k], 4);
            if (opener && k < ms && L >= 2) setRange(inf, 17, 40);   // 反转
            else if (jump >= 1) setRange(inf, 16, 40);
          }
        }
        lastBid = c;
      }
      hist.push({ seat: s, call: c, index: i });
    }
    return infos;
  }

  /** 搭档已确认的将牌花色（本方有人叫过、另一人对同一花色表示支持） */
  function agreedSuit(hist, s) {
    const mine = hist.filter((x) => x.call >= 5 && side(x.seat) === side(s) && strainOf(x.call) < 4);
    const seen = {};
    for (const x of mine) {
      const k = strainOf(x.call);
      (seen[k] = seen[k] || new Set()).add(x.seat);
    }
    for (let k = 3; k >= 0; k--) if (seen[k] && seen[k].size >= 2) return k;
    return -1;
  }

  /** 各座位 HCP 期望（总点力 40，已知自己的）*/
  function estimateHcp(infos, me, myHcp) {
    const est = [0, 0, 0, 0];
    const others = [0, 1, 2, 3].filter((x) => x !== me);
    const lo = {}, hi = {};
    others.forEach((o) => { lo[o] = infos[o].lo; hi[o] = Math.min(infos[o].hi, 24); est[o] = (lo[o] + Math.min(hi[o], lo[o] === 0 ? 14 : lo[o] + 6)) / 2; if (lo[o] === 0 && infos[o].hi === 40) est[o] = 7.5; });
    const target = 40 - myHcp;
    for (let it = 0; it < 4; it++) {
      const sum = others.reduce((a, o) => a + est[o], 0) || 1;
      const f = target / sum;
      others.forEach((o) => { est[o] = Math.max(lo[o], Math.min(hi[o], est[o] * f)); });
    }
    est[me] = myHcp;
    return est;
  }

  // ---------- 叫牌决策 ----------
  function bestSuitFor(hand, l, minLen, exclude) {
    let best = -1, bs = -1;
    for (let s = 3; s >= 0; s--) {
      if (exclude && exclude.indexOf(s) >= 0) continue;
      if (l[s] < minLen) continue;
      const score = l[s] * 10 + suitHcp(hand, s) + (s >= 2 ? 1 : 0);
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }
  function openingCall(hand, pos) {
    const l = lensOf(hand), H = hcpOf(hand), bal = isBal(l);
    const sorted = l.slice().sort((a, b) => b - a);
    const rule20 = H + sorted[0] + sorted[1] >= 20;
    const canOpen = pos === 3 ? (H + l[3] >= 15) : (H >= 12 || (H >= 10 && rule20) );
    if (H >= 22 || (H >= 20 && !bal && sorted[0] >= 7)) return bid(2, 0);
    if (canOpen) {
      if (bal && H >= 20) return bid(2, 4);
      if (bal && H >= 15 && H <= 17) return bid(1, 4);
      let s = -1;
      if (l[3] >= 5 && l[3] >= l[2]) s = 3;
      else if (l[2] >= 5) s = 2;
      else if (l[3] >= 5) s = 3;
      else if (l[1] >= 5 && l[1] > l[0]) s = 1;
      else if (l[0] >= 5 && l[0] >= l[1]) s = 0;
      else if (l[1] > l[0] && l[1] >= 3) s = 1;
      else if (l[0] >= l[1] && l[0] >= 3) s = 0;
      else if (l[1] >= 3) s = 1;
      else s = l[3] >= l[2] ? 3 : 2;
      if (s === 1 && l[1] === l[0] && l[1] === 3) s = 0;
      return bid(1, s);
    }
    // 阻击叫
    if (pos <= 2 && H <= 10 && H >= 5) {
      for (const s of [3, 2, 1]) {
        if (l[s] === 6 && suitHcp(hand, s) >= 4 && !(l[3] >= 4 && s !== 3) && !(l[2] >= 4 && s !== 2)) return bid(2, s);
      }
    }
    if (pos <= 2 && H <= 10) {
      for (let s = 3; s >= 0; s--) {
        if (l[s] >= 7 && suitHcp(hand, s) >= 4) return bid(l[s] >= 8 ? 4 : 3, s);
      }
    }
    return PASS;
  }

  function levelFor(T, strain) {
    if (T >= 37) return 7;
    if (T >= 33) return 6;
    if (strain === 4) return T >= 25 ? 3 : T >= 23 ? 2 : 1;
    if (MAJ(strain)) return T >= 26 ? 4 : T >= 23 ? 3 : T >= 19 ? 2 : 1;
    return T >= 29 ? 5 : T >= 24 ? 3 : T >= 19 ? 2 : 1;
  }

  /** 主入口。返回一个合法叫品 */
  function chooseCall(hand, seat, dealer, vul, auction, opts) {
    const legal = legalCalls(auction, dealer);
    const legalSet = new Set(legal);
    let call = PASS;
    try { call = decide(hand, seat, dealer, vul, auction, legalSet); } catch (e) { call = PASS; }
    if (!legalSet.has(call)) call = PASS;
    return call;
  }

  function decide(hand, seat, dealer, vul, auction, legalSet) {
    const L = lensOf(hand), H = hcpOf(hand), bal = isBal(L);
    const lb = lastBidInfo(auction, dealer);
    const infos = analyze(auction, dealer);
    const part = partner(seat), lho = (seat + 1) & 3, rho = (seat + 3) & 3;
    const est = estimateHcp(infos, seat, H);
    const hist = auction.map((c, i) => ({ seat: (dealer + i) & 3, call: c, index: i }));
    const bids = hist.filter((x) => x.call >= 5);
    const myB = bids.filter((x) => x.seat === seat), pB = bids.filter((x) => x.seat === part);
    const oppB = bids.filter((x) => side(x.seat) !== side(seat));
    const can = (lv, st) => lv <= 7 && legalSet.has(bid(lv, st));
    const cheapest = (st) => { const lvl = minLevel(st, lb ? lb.bid : 0); return lvl <= 7 ? lvl : null; };
    const bidCheap = (st) => { const lv = cheapest(st); return lv && can(lv, st) ? bid(lv, st) : null; };

    // ---- 1. 开叫 ----
    if (!bids.length) return openingCall(hand, auction.length);

    const oppLast = oppB.length ? oppB[oppB.length - 1] : null;
    const pInf = infos[part];
    const gameForced = pInf.forceGame || infos[seat].forceGame;
    const ourSideSilent = !myB.length && !pB.length;

    // ---- 搭档刚加倍（技术性/负加倍）：必须叫牌，除非转罚 ----
    const lastNP = hist.slice().reverse().find((x) => x.call !== PASS);
    if (lastNP && lastNP.call === DBL && lastNP.seat === part && pInf.takeout && lb && lb.dbl === 1 && side(lb.seat) !== side(seat) && lvlOf(lb.bid) <= 3) {
      return respondDouble(hand, L, H, bal, lb, oppB, infos, est, seat, part, legalSet, can, cheapest);
    }

    // ---- 2. 对手叫了、我方沉默：争叫 / 加倍 / 过 ----
    if (ourSideSilent) {
      const ob = oppLast;
      const oppLvl = lvlOf(ob.call), oppK = strainOf(ob.call);
      const balancing = lb && auction.length - lb.index >= 3 && auction.slice(lb.index + 1).every((c) => c === PASS);
      const adj = balancing ? 3 : 0;
      const oppSuits = oppB.map((x) => strainOf(x.call)).filter((k) => k < 4);
      if (oppLvl >= 4) return penaltyDouble(hand, L, H, est, ob, infos, seat, legalSet) || PASS;
      // 1NT 争叫
      if (bal && H >= 15 - adj && H <= 18 && oppLvl === 1 && oppK < 4 && stopper(hand, oppK) && can(1, 4)) return bid(1, 4);
      // 技术性加倍
      if (legalSet.has(DBL) && oppLvl <= 3 && oppK < 4 && oppB.length === 1) {
        const shortOpp = L[oppK] <= 2;
        const supp = [0, 1, 2, 3].filter((s) => s !== oppK && L[s] >= 3).length;
        const majOk = [2, 3].every((s) => s === oppK || L[s] >= 3 || L[s] === 0 ? true : L[s] >= 3);
        if (H >= 12 - adj && shortOpp && supp >= 3 && ([2, 3].filter((s) => s !== oppK).every((s) => L[s] >= 3 || L[s] === 0))) return DBL;
        if (H >= 17) return DBL;
        void majOk;
      }
      // 花色争叫
      const cand = [];
      for (let s = 0; s < 4; s++) {
        if (oppSuits.indexOf(s) >= 0 || L[s] < 5) continue;
        const lv = cheapest(s);
        if (!lv || !can(lv, s)) continue;
        const q = suitHcp(hand, s);
        if (lv === 1 && H >= 8 - adj && q >= 2) cand.push([s, L[s] * 10 + q]);
        else if (lv === 2 && H >= 11 - adj && (L[s] >= 6 || q >= 4)) cand.push([s, L[s] * 10 + q]);
        else if (lv === 3 && L[s] >= 7 && H <= 11 && q >= 4 && !balancing) cand.push([s, L[s] * 10 + q - 5]);
      }
      // 阻击争叫（跳叫）
      if (oppLvl === 1 && H <= 10 && !cand.length) {
        for (let s = 3; s >= 0; s--) {
          if (oppSuits.indexOf(s) >= 0) continue;
          if (L[s] >= 7 && suitHcp(hand, s) >= 4) { const lv = Math.max(3, cheapest(s) || 3); if (can(lv, s)) return bid(lv, s); }
        }
      }
      if (cand.length) { cand.sort((a, b) => b[1] - a[1]); return bid(cheapest(cand[0][0]), cand[0][0]); }
      return penaltyDouble(hand, L, H, est, ob, infos, seat, legalSet) || PASS;
    }

    // ---- 3. 我方已有人叫过 ----
    // 先看是否应当惩罚性加倍对手的高阶定约
    if (oppLast && lb && side(lb.seat) !== side(seat) && lb.dbl === 0) {
      const d = penaltyDouble(hand, L, H, est, oppLast, infos, seat, legalSet);
      if (d) return d;
    }
    // 黑木应答
    const ans = blackwoodReply(hand, hist, seat, infos, legalSet, dealer);
    if (ans !== undefined) return ans;

    return constructive(hand, L, H, bal, seat, part, hist, bids, myB, pB, oppB, infos, est, lb, legalSet, can, cheapest, bidCheap, gameForced);
  }

  function respondDouble(hand, L, H, bal, lb, oppB, infos, est, seat, part, legalSet, can, cheapest) {
    const oppK = strainOf(lb.bid), oppLvl = lvlOf(lb.bid);
    const oppSuits = oppB.map((x) => strainOf(x.call)).filter((k) => k < 4);
    if (oppK < 4 && L[oppK] >= 4 && suitHcp(hand, oppK) >= 4 && H >= 7 && (L[oppK] >= 5 || oppLvl === 1 && suitHcp(hand, oppK) >= 5)) return PASS;
    const T = H + est[part];
    const cands = [];
    for (let s = 0; s < 4; s++) {
      if (oppSuits.indexOf(s) >= 0 || L[s] < 4) continue;
      const lv = cheapest(s); if (lv === null) continue;
      cands.push({ s, lv, score: L[s] * 10 + (MAJ(s) ? 3 : 0) + suitHcp(hand, s) * 0.3 });
    }
    cands.sort((a, b) => b.score - a.score);
    if (T >= 25 && bal && stopOk(hand, oppSuits) && can(3, 4)) return bid(3, 4);
    if (cands.length) {
      const c = cands[0];
      let lv = c.lv;
      if (H >= 13 && MAJ(c.s) && T >= 26) lv = Math.max(lv, 4);
      else if (H >= 10) lv = Math.min(lv + 1, 4);
      while (lv <= 7 && !can(lv, c.s)) lv++;
      if (lv <= 7) return bid(lv, c.s);
    }
    if (stopOk(hand, oppSuits)) {
      const lv = H >= 13 ? 3 : H >= 11 ? 2 : 1;
      for (let l2 = lv; l2 <= 3; l2++) if (can(l2, 4)) return bid(l2, 4);
    }
    // 3 张的花色里最便宜的
    for (let s = 3; s >= 0; s--) {
      if (oppSuits.indexOf(s) >= 0 || L[s] < 3) continue;
      const lv = cheapest(s);
      if (lv !== null && lv <= 2 && can(lv, s)) return bid(lv, s);
    }
    return PASS;
  }

  // 估计对手定约宕多少，若足够就加倍
  function penaltyDouble(hand, L, H, est, ob, infos, seat, legalSet) {
    if (!legalSet.has(DBL)) return null;
    const lvl = lvlOf(ob.call), k = strainOf(ob.call);
    if (lvl < 3) return null;
    // 对手一方的总点力估计
    const oppSeats = [0, 1, 2, 3].filter((x) => side(x) !== side(seat));
    const oppHcp = oppSeats.reduce((a, o) => a + est[o], 0);
    const need = lvl >= 6 ? 33 : lvl >= 4 ? (k >= 2 && k < 4 ? 25 : k === 4 ? 25 : 28) : 22;
    const trumpLen = k < 4 ? L[k] : 0;
    const guard = (k < 4 && trumpLen >= 4 && suitHcp(hand, k) >= 4) ? 3 : 0;
    if (need - oppHcp >= 4 - guard * 0.5 && H >= 10) return DBL;
    if (lvl >= 5 && H >= 14 && need - oppHcp >= 2) return DBL;
    return null;
  }

  function blackwoodReply(hand, hist, seat, infos, legalSet, dealer) {
    // 搭档刚叫 4NT 且本方已有确定将牌 → 回答 A 数
    const last = hist[hist.length - 1];
    if (!last || last.call !== bid(4, 4) || last.seat !== partner(seat)) {
      // 自己问了 4NT，搭档回答后决定
      const mineAsk = hist.filter((x) => x.seat === seat && x.call === bid(4, 4));
      if (mineAsk.length) {
        const idx = hist.indexOf(mineAsk[mineAsk.length - 1]);
        const rep = hist.slice(idx + 1).find((x) => x.seat === partner(seat) && x.call >= 5);
        if (rep && hist.slice(idx + 1).filter((x) => x.seat === seat && x.call >= 5).length === 0) {
          const trump = agreedSuit(hist, seat);
          const pAces = rep.call === bid(5, 0) ? 0 : rep.call === bid(5, 1) ? 1 : rep.call === bid(5, 2) ? 2 : 3;
          const tot = aces(hand) + pAces;
          const lvlRep = lvlOf(rep.call);
          const target = trump >= 0 ? trump : 4;
          if (lvlRep !== 5) return PASS;
          const missing = 4 - tot;
          const H = hcpOf(hand);
          const t = (pAces === 0 && tot < 4 ? 0 : 1);
          void t;
          if (missing >= 2) { // 缺两个 A：停在 5 阶
            const b5 = bid(5, target);
            return legalSet.has(b5) ? b5 : PASS;
          }
          const grand = missing === 0 && H >= 16;
          const b = bid(grand ? 7 : 6, target);
          return legalSet.has(b) ? b : PASS;
        }
      }
      return undefined;
    }
    const trump = agreedSuit(hist, seat);
    const infoP = infos[partner(seat)];
    if (!infoP.ask) return undefined;
    // 非黑木情形（无将自然 4NT 邀请）：按点力决定
    if (trump < 0) {
      const H = hcpOf(hand);
      return H >= 7 && legalSet.has(bid(6, 4)) ? bid(6, 4) : PASS;
    }
    const a = aces(hand);
    const r = a === 4 || a === 0 ? 0 : a;
    const b = bid(5, r);
    return legalSet.has(b) ? b : (legalSet.has(PASS) ? PASS : PASS);
  }

  function constructive(hand, L, H, bal, seat, part, hist, bids, myB, pB, oppB, infos, est, lb, legalSet, can, cheapest, bidCheap, gameForced) {
    const P = infos[part], me = infos[seat];
    const pEst = est[part];
    const lastP = pB.length ? pB[pB.length - 1] : null;
    const lastMine = myB.length ? myB[myB.length - 1] : null;
    const opener = bids[0].seat === seat;
    const responder = !opener && !myB.length;
    const oppSuits = oppB.map((x) => strainOf(x.call)).filter((k) => k < 4);
    const competing = oppB.length > 0 && lb && side(lb.seat) !== side(seat);

    // --- 搭档没有再叫（只有我叫过）：除非强迫否则过
    if (!pB.length) {
      if (competing && lastMine) return compete(hand, L, H, seat, part, infos, est, lb, legalSet, can, cheapest, hist) || PASS;
      return PASS;
    }
    // --- 搭档的最近叫品
    const pk = strainOf(lastP.call), pl = lvlOf(lastP.call);
    const lastAction = hist[hist.length - 1];
    const partnerJustBid = lastAction && lastAction.seat === part && lastAction.call >= 5;

    // 已知配合
    let fitSuit = -1, fitN = 0;
    for (let s = 0; s < 4; s++) {
      const n = L[s] + P.len[s];
      const hasInfo = P.len[s] > 0;
      if (hasInfo && n >= 8 && (n > fitN || (n === fitN && s > fitSuit && (MAJ(s) || !MAJ(fitSuit))))) { fitSuit = s; fitN = n; }
    }
    // 搭档开 1M 我有 3 张也算（P.len 已按 5 张记）
    // 将牌确定后的点力
    const ptsFit = fitSuit >= 0 ? H + shortPts(L, fitSuit) + Math.max(0, L[fitSuit] - 5) : -1;
    const ptsNT = H + Math.min(2, longPts(L));
    const myLong = bestSuitFor(hand, L, 6, null);

    // ----- 强二梅花（22+）-----
    if (P.forceGame && lastP.call === bid(2, 0) && pB.length === 1 && !myB.length) {
      return respond2C(hand, L, H, bal, can, bidCheap);
    }
    if (me.forceGame && myB.length === 1 && lastMine.call === bid(2, 0)) {
      return after2C(hand, L, H, bal, lastP, can, bidCheap, cheapest);
    }

    // ----- 搭档开 1NT/2NT -----
    if (pk === 4 && P.nt && pB.length === 1 && !myB.length) {
      return respondNT(hand, L, H, bal, pl, lb, can, cheapest, bidCheap, legalSet);
    }
    if (lastMine && strainOf(lastMine.call) === 4 && me.nt && lastMine === myB[0] && opener) {
      // 我开了无将，搭档回应
      return openerAfterNT(hand, L, H, lastP, lastMine, can, cheapest, bidCheap, legalSet, hist);
    }

    // ----- 有配合：直接去目标定约 -----
    if (fitSuit >= 0) {
      const T = ptsFit + pEst;
      let tgt = levelFor(T, fitSuit);
      // 小满贯以上走黑木
      if (tgt >= 6 && hist.filter((x) => x.call === bid(4, 4)).length === 0 && can(4, 4) && lvlOf(lb ? lb.bid : 0) <= 4 && pl <= 4) return bid(4, 4);
      if (tgt >= 6 && !can(6, fitSuit)) tgt = 5;
      if (!MAJ(fitSuit) && tgt === 3 && T >= 25) {
        // 低花配合、点力足够：优先试 3NT
        if (bal && can(3, 4) && stopOk(hand, oppSuits)) return bid(3, 4);
      }
      if (!MAJ(fitSuit) && tgt >= 5 && can(3, 4) && T < 29 && bal && stopOk(hand, oppSuits)) return bid(3, 4);
      const cur = cheapest(fitSuit);
      // 我这边已叫到的最高水平
      const myTopLevel = Math.max(0, ...hist.filter((x) => side(x.seat) === side(seat) && x.call >= 5).map((x) => lvlOf(x.call)));
      if (cur === null) return PASS;
      // 搭档刚邀请（限制性加叫）而我很弱 → 不继续
      if (tgt <= myTopLevel && !gameForced) {
        // 我方已叫到合适水平
        if (competing && cur <= Math.min(L[fitSuit] + P.len[fitSuit] - 6, 4) && T >= 17) return can(cur, fitSuit) ? bid(cur, fitSuit) : PASS;
        return PASS;
      }
      if (tgt >= cur) {
        // 邀请型：搭档有最小限制叫品且 T 刚好到邀请线，才叫在邀请水平；到了 3 阶以上由搭档决定
        const b = bid(Math.min(tgt, MAJ(fitSuit) ? 4 : (tgt >= 5 ? 5 : tgt)), fitSuit);
        if (can(lvlOf(b), fitSuit)) {
          // 限制水平：叫得比我方此前更高才算继续
          return b;
        }
      }
      if (competing) return compete(hand, L, H, seat, part, infos, est, lb, legalSet, can, cheapest, hist) || PASS;
      return PASS;
    }

    // ----- 尚无配合 -----
    if (responder && partnerJustBid) {
      return respondSuit(hand, L, H, bal, seat, lastP, lb, infos, est, hist, can, cheapest, bidCheap, legalSet, oppSuits);
    }
    if (!responder) {
      return rebidNoFit(hand, L, H, bal, seat, part, hist, myB, pB, lastP, lastMine, infos, est, lb, legalSet, can, cheapest, bidCheap, oppSuits, opener, gameForced);
    }
    return PASS;
  }

  function stopOk(hand, oppSuits) {
    if (!oppSuits.length) return true;
    return oppSuits.every((s) => stopper(hand, s));
  }

  function compete(hand, L, H, seat, part, infos, est, lb, legalSet, can, cheapest, hist) {
    // 总墩数定律：最长配合 n 张 → 竞叫到 n-6 阶（需有一定点力）
    let bestS = -1, bestN = 0;
    for (let s = 0; s < 4; s++) {
      const n = L[s] + infos[part].len[s];
      if (infos[part].len[s] > 0 && n > bestN) { bestN = n; bestS = s; }
    }
    if (bestS < 0 || bestN < 8) return null;
    const lv = cheapest(bestS);
    if (lv === null || !can(lv, bestS)) return null;
    const T = H + est[part];
    if (lv <= bestN - 6 && T >= 16 && lv <= 4) return bid(lv, bestS);
    return null;
  }

  function respond2C(hand, L, H, bal, can, bidCheap) {
    const best = bestSuitFor(hand, L, 5, null);
    if (H < 8) return bid(2, 1);
    if (best >= 0 && best !== 0 && can(2, best)) return bid(2, best);
    if (best === 0 || best === 1) { const lv = best === 0 ? 3 : 3; if (can(lv, best)) return bid(lv, best); }
    if (bal && can(2, 4)) return bid(2, 4);
    return bidCheap(4) || bid(2, 1);
  }

  function after2C(hand, L, H, bal, lastP, can, bidCheap, cheapest) {
    if (!lastP) return PASS;
    const pk = strainOf(lastP.call);
    const best = bestSuitFor(hand, L, 5, null);
    // 搭档 2♦ 等待：展示自己的牌型
    if (lastP.call === bid(2, 1)) {
      if (bal && H >= 22) return H >= 25 ? (can(3, 4) ? bid(3, 4) : PASS) : (can(2, 4) ? bid(2, 4) : bidCheap(4) || PASS);
      if (best >= 0) { const b = bidCheap(best); if (b) return b; }
      return bidCheap(4) || PASS;
    }
    // 搭档有自然花色：配合则加叫到局，否则继续
    if (pk < 4 && L[pk] >= 3) {
      const lvl = pk >= 2 ? 4 : 5;
      const cur = cheapest(pk);
      if (cur && cur <= lvl && can(lvl, pk)) return bid(lvl, pk);
    }
    if (pk === 4) return can(3, 4) ? bid(3, 4) : PASS;
    if (best >= 0) { const b = bidCheap(best); if (b) return b; }
    return can(3, 4) ? bid(3, 4) : (bidCheap(4) || PASS);
  }

  function respondNT(hand, L, H, bal, pl, lb, can, cheapest, bidCheap, legalSet) {
    const base = pl === 1 ? 16 : 20.5;
    const long = bestSuitFor(hand, L, 5, null);
    const T = H + Math.min(2, longPts(L)) + base;
    if (T >= 37) return can(7, 4) ? bid(7, 4) : PASS;
    if (T >= 33) return can(6, 4) ? bid(6, 4) : (can(4, 4) ? bid(4, 4) : PASS);
    if (pl === 1) {
      if (long >= 0 && MAJ(long) && L[long] >= 6 && T >= 25 && can(4, long)) return bid(4, long);
      if (T >= 25) {
        if (long >= 0 && MAJ(long) && L[long] === 5 && can(3, long)) return bid(3, long);
        return can(3, 4) ? bid(3, 4) : PASS;
      }
      if (T >= 23.5) return can(2, 4) ? bid(2, 4) : PASS;
      if (long >= 0 && L[long] >= 5 && long !== 0 && H <= 7 && can(2, long) && !(bal)) return bid(2, long);
      if (long >= 0 && L[long] >= 6 && can(2, long) && H <= 8) return bid(2, long);
      return PASS;
    }
    // 2NT 开叫
    if (T >= 25) {
      if (long >= 0 && MAJ(long) && L[long] >= 5 && can(4, long)) return bid(4, long);
      return can(3, 4) ? bid(3, 4) : PASS;
    }
    if (long >= 0 && L[long] >= 5 && H >= 3 && can(3, long) && MAJ(long)) return bid(3, long);
    return PASS;
  }

  function openerAfterNT(hand, L, H, lastP, lastMine, can, cheapest, bidCheap, legalSet, hist) {
    if (!lastP) return PASS;
    const pk = strainOf(lastP.call), pl = lvlOf(lastP.call);
    const mine = lvlOf(lastMine.call);
    if (pk === 4) {
      // 搭档加叫无将：邀请 → 看点力
      if (pl === 2 && mine === 1) return H >= 16 ? (can(3, 4) ? bid(3, 4) : PASS) : PASS;
      if (pl === 4) return H >= 17 && can(6, 4) ? bid(6, 4) : PASS;
      return PASS;
    }
    // 搭档说了花色
    if (pl === 2) return PASS;                       // 弱的 2 阶，示弱
    if (pl === 3) {                                 // 逼叫花色 3 阶：有 3+ 配合则叫 4M，否则 3NT
      if (pk >= 2 && L[pk] >= 3 && can(4, pk)) return bid(4, pk);
      if (pk >= 2 && L[pk] >= 3 && can(5, pk)) return bid(5, pk);
      if (can(3, 4)) return bid(3, 4);
    }
    if (pl >= 4) return PASS;
    return PASS;
  }

  function respondSuit(hand, L, H, bal, seat, lastP, lb, infos, est, hist, can, cheapest, bidCheap, legalSet, oppSuits) {
    const pk = strainOf(lastP.call), pl = lvlOf(lastP.call);
    const P = infos[(seat + 2) & 3];
    const preempt = P.preempt;
    if (preempt) return PASS;    // 阻击开叫：自然不必回答（有大牌将来不处理）
    const pEst = est[(seat + 2) & 3];
    // 配合（开叫在 M 时 3 张即可，低花 4 张）
    const supp = pk < 4 && L[pk] >= (MAJ(pk) ? 3 : 4);
    if (supp) {
      const pts = H + shortPts(L, pk) + Math.max(0, L[pk] - 5) * 1;
      const T = pts + pEst;
      let tgt = levelFor(T, pk);
      if (!MAJ(pk) && tgt >= 3 && T >= 25 && can(3, 4) && bal && stopOk(hand, oppSuits)) return bid(3, 4);
      if (tgt >= 6) { if (can(4, 4)) return bid(4, 4); tgt = 5; }
      const cur = cheapest(pk);
      if (cur !== null && tgt >= cur && pts >= 6) {
        if (MAJ(pk) && tgt === 3 && pts < 10) tgt = 2;
        return can(tgt, pk) ? bid(tgt, pk) : (can(cur, pk) ? bid(cur, pk) : PASS);
      }
      if (cur !== null && cur <= 3 && L[pk] + P.len[pk] >= 9 && cur <= L[pk] + P.len[pk] - 6 && can(cur, pk) && pts >= 4) return bid(cur, pk);
    }
    if (H < 6) return PASS;
    // 新花色
    const opts = [];
    for (let s = 0; s < 4; s++) {
      if (s === pk || oppSuits.indexOf(s) >= 0 || L[s] < 4) continue;
      const lv = cheapest(s);
      if (lv === null || !can(lv, s)) continue;
      const need = lv === 1 ? 6 : lv === 2 ? 10 : 13;
      if (H < need) continue;
      opts.push({ s, lv, score: L[s] * 10 + (L[s] >= 5 ? 0 : (MAJ(s) ? 6 : 0)) - s * 0.1 + (L[s] === 4 ? -s : 0) });
    }
    if (opts.length) {
      // 5 张以上取最长；都是 4 张则"从下往上"叫（1 阶 4 张高花优先）
      opts.sort((a, b) => b.score - a.score);
      const long5 = opts.filter((o) => L[o.s] >= 5);
      let pick;
      if (long5.length) pick = long5.sort((a, b) => L[b.s] - L[a.s] || b.s - a.s)[0];
      else {
        const majs = opts.filter((o) => MAJ(o.s) && o.lv === 1);
        pick = majs.length ? majs.sort((a, b) => a.s - b.s)[0] : opts.sort((a, b) => a.lv - b.lv || a.s - b.s)[0];
      }
      if (pick) return bid(pick.lv, pick.s);
    }
    // 无将
    if (H >= 6 && H <= 10 && can(1, 4)) return bid(1, 4);
    if (H >= 11 && H <= 12 && can(2, 4) && stopOk(hand, oppSuits)) return bid(2, 4);
    if (H >= 13 && can(3, 4) && stopOk(hand, oppSuits)) return bid(3, 4);
    // 退而求其次：自己的长花色
    const best = bestSuitFor(hand, L, 6, null);
    if (best >= 0 && best !== pk) { const b = bidCheap(best); if (b && lvlOf(b) <= 2 && H >= 6) return b; }
    if (H >= 8 && can(2, 4) && stopOk(hand, oppSuits)) return bid(2, 4);
    return PASS;
  }

  function rebidNoFit(hand, L, H, bal, seat, part, hist, myB, pB, lastP, lastMine, infos, est, lb, legalSet, can, cheapest, bidCheap, oppSuits, opener, gameForced) {
    const P = infos[part];
    const pk = strainOf(lastP.call), pl = lvlOf(lastP.call);
    const mk = strainOf(lastMine.call);
    const pEst = est[part];
    const lastAct = hist[hist.length - 1];
    const myStart = Math.min(...myB.map((x) => x.index));
    const sinceMine = hist.filter((x) => x.index > lastMine.index);
    const partnerActed = sinceMine.some((x) => x.seat === part && x.call >= 5);
    if (!partnerActed) return PASS;
    // 搭档叫了无将
    if (pk === 4) {
      const T = H + (bal ? 0 : Math.min(2, longPts(L))) + pEst;
      if (pl >= 3) return PASS;
      if (T >= 25 && can(3, 4)) return bid(3, 4);
      if (T >= 23 && pl === 2 && can(3, 4) && H >= 14) return bid(3, 4);
      return PASS;
    }
    // 搭档叫了新花色（逼叫）
    const forcing = lastAct.seat === part && !P.preempt && pl <= 2 && pk !== mk;
    const T = H + longPts(L) + pEst;
    if (!forcing && T < 23 && !gameForced) return PASS;
    // 我方足够进局
    if (T >= 26 || gameForced) {
      if (bal && can(3, 4) && stopOk(hand, oppSuits)) return bid(3, 4);
      const own = bestSuitFor(hand, L, 6, null);
      if (own >= 0 && MAJ(own) && can(4, own)) return bid(4, own);
      if (P.len[pk] >= 5 && L[pk] >= 2 && MAJ(pk) && can(4, pk)) return bid(4, pk);
      if (can(3, 4)) return bid(3, 4);
    }
    // 重复自己的好花色（6 张）
    if (L[mk] >= 6) { const b = bidCheap(mk); if (b && lvlOf(b) <= (T >= 23 ? 3 : 2)) return b; }
    // 平均牌型 12-14 → 1NT；18-19 → 2NT
    if (bal && opener) {
      if (H >= 18 && H <= 19 && can(2, 4)) return bid(2, 4);
      if (H <= 14 && can(1, 4)) return bid(1, 4);
      if (H <= 14 && can(2, 4) && stopOk(hand, oppSuits)) return bid(2, 4);
    }
    // 支持搭档的花色（3 张 / 低花 4 张）
    if (pk < 4 && L[pk] >= (MAJ(pk) ? 3 : 4)) {
      const lv = cheapest(pk);
      if (lv && lv <= 3 && can(lv, pk)) return bid(lv, pk);
    }
    // 新花色（4 张以上，便宜）
    const cands = [];
    for (let s = 0; s < 4; s++) {
      if (s === mk || s === pk || oppSuits.indexOf(s) >= 0 || L[s] < 4) continue;
      const lv = cheapest(s); if (!lv || lv > 2 || !can(lv, s)) continue;
      cands.push({ s, lv });
    }
    if (cands.length) { cands.sort((a, b) => a.lv - b.lv || a.s - b.s); const c0 = cands[0]; if (!(c0.lv === 2 && H < 12)) return bid(c0.lv, c0.s); }
    // 重复自己的花色（5 张也行，作为最小叫）
    if (L[mk] >= 5) { const b = bidCheap(mk); if (b && lvlOf(b) <= 2) return b; }
    if (can(1, 4)) return bid(1, 4);
    if (L[mk] >= 5) { const b = bidCheap(mk); if (b && lvlOf(b) <= 3) return b; }
    return PASS;
  }

  const api = { hcpOf, lensOf, isBal, stopper, suitHcp, aces, analyze, estimateHcp, chooseCall, openingCall, agreedSuit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BridgeBid = api;
})(typeof self !== 'undefined' ? self : this);
