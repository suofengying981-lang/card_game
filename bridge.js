/* 桥牌界面：你坐南家，北家是电脑搭档，东西是电脑对手；复式计分，身价与庄家按 16 副一轮轮转。 */
(function () {
  'use strict';
  const E = window.BridgeEngine, BB = window.BridgeBid, BP = window.BridgePlay;
  const SFX = window.SFX || { play() {}, unlock() {}, setSfx() {}, setMusic() {} };
  const ME = 2, KEY = 'bridge-v1';
  const LEVELS = [
    { name: '简单', ms: 0, min: 3, max: 6 },
    { name: '标准', ms: 300, min: 12, max: 160 },
    { name: '强', ms: 900, min: 30, max: 600 },
  ];
  const SEAT_CLS = ['N', 'E', 'S', 'W'];
  const VUL_TXT = ['双方无身价', '南北有身价', '东西有身价', '双方有身价'];
  const $ = (id) => document.getElementById(id);

  const save = { no: 1, ns: 0, ew: 0, boards: 0, made: 0, level: 1, sfx: true, music: false, best: 0 };
  try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };
  const fmt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

  const G = { b: null, phase: 'menu', paused: true, token: 0, shown: null, hintCard: null, hintCall: null, msg: '', timer: null };

  // ---------- 小工具 ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1500);
  }
  const isRed = (su) => su === 1 || su === 2;
  function symHtml(su) { return '<span class="' + (isRed(su) ? 'red' : '') + '">' + E.SUIT_CH[su] + '</span>'; }
  function callHtml(c) {
    if (c >= 5) { const k = E.strainOf(c); return E.lvlOf(c) + '<span class="' + (isRed(k) ? 'red' : '') + '">' + E.SUIT_CH[k] + '</span>'; }
    return c === E.PASS ? '过' : c === E.DBL ? 'X' : 'XX';
  }
  function contractHtml(k) {
    return k.level + (k.strain === 4 ? 'NT' : symHtml(k.strain)) + (k.dbl === 1 ? ' X' : k.dbl === 2 ? ' XX' : '');
  }
  function cardEl(c, o) {
    o = o || {};
    const el = document.createElement('div');
    const su = E.suitOf(c);
    el.className = 'card' + (isRed(su) ? ' red' : '') + (o.cls ? ' ' + o.cls : '');
    el.style.setProperty('--cw', (o.cw || 44) + 'px');
    el.dataset.c = c;
    el.innerHTML = '<span class="r">' + E.RANK_CH[E.rankOf(c)] + '</span><span class="s">' + E.SUIT_CH[su] + '</span><span class="p">' + E.SUIT_CH[su] + '</span>';
    return el;
  }
  function backEl(cw) {
    const el = document.createElement('div'); el.className = 'card back'; el.style.setProperty('--cw', cw + 'px'); return el;
  }
  function availW() { return Math.min(window.innerWidth, 460) - 14; }
  function fanRow(cards, o) {
    o = o || {};
    const row = document.createElement('div'); row.className = 'row';
    const cw = o.cw || 44, n = cards.length;
    const avail = o.avail || availW();
    let gaps = 0;
    for (let i = 1; i < n; i++) if (E.suitOf(cards[i]) !== E.suitOf(cards[i - 1])) gaps++;
    const gapPx = o.gap === undefined ? 5 : o.gap;
    let step = n > 1 ? (avail - cw - gaps * gapPx) / (n - 1) : 0;
    step = Math.min(step, cw + 3);
    if (step < 12) { step = n > 1 ? (avail - cw) / (n - 1) : 0; }
    cards.forEach((c, i) => {
      const el = o.back ? backEl(cw) : cardEl(c, { cw, cls: o.cls ? o.cls(c) : '' });
      if (i > 0) {
        let m = step - cw;
        if (!o.back && E.suitOf(c) !== E.suitOf(cards[i - 1])) m += gapPx;
        el.style.marginLeft = m + 'px';
      }
      row.appendChild(el);
    });
    return row;
  }
  function dummyGrid(cards, clsFn) {
    const wrap = document.createElement('div'); wrap.className = 'dummy';
    const half = Math.max(80, (availW() - 10) / 2 - 20);
    for (const su of [3, 2, 1, 0]) {
      const cs = cards.filter((c) => E.suitOf(c) === su).sort((a, b) => E.rankOf(b) - E.rankOf(a));
      const r = document.createElement('div'); r.className = 'srow';
      r.innerHTML = '<span class="sym ' + (isRed(su) ? 'red' : '') + '">' + E.SUIT_CH[su] + '</span>';
      const box = document.createElement('div'); box.className = 'cards';
      if (cs.length) {
        const cw = 28;
        const step = cs.length > 1 ? Math.min(cw * 0.62, (half - cw) / (cs.length - 1)) : 0;
        cs.forEach((c, i) => {
          const el = cardEl(c, { cw, cls: clsFn ? clsFn(c) : '' });
          if (i > 0) el.style.marginLeft = (step - cw) + 'px';
          box.appendChild(el);
        });
      }
      r.appendChild(box); wrap.appendChild(r);
    }
    return wrap;
  }

  // ---------- 状态查询 ----------
  const B = () => G.b;
  const revealed = () => !!(B().play && B().play.played.length > 0);
  function seatVisible(seat) {
    const b = B();
    if (b.done) return true;
    if (seat === ME) return true;
    return !!(b.contract && seat === b.contract.dummy && revealed());
  }
  function handOf(seat) { const b = B(); return b.play ? b.play.hands[seat] : b.hands[seat]; }
  function humanTurnSeat() { // 轮到人类操作的座位（自己或代打的明手），否则 -1
    const b = B();
    if (!b || b.done || G.phase !== 'play' || !b.play) return -1;
    const s = b.play.turn;
    return E.controller(b, s) === ME ? s : -1;
  }
  function legalSet(seat) {
    const p = B().play;
    const led = p.trick.length ? E.suitOf(p.trick[0].card) : -1;
    return new Set(E.legalPlays(p.hands[seat], led));
  }

  // ---------- 渲染 ----------
  function renderTop() {
    const b = B();
    $('boardInfo').textContent = '第 ' + b.no + ' 副 · 庄家 ' + E.SEAT_NAME[b.dealer];
    $('vulInfo').textContent = VUL_TXT[b.vul];
    const sc = $('scoreInfo');
    sc.textContent = '南北 ' + fmt(save.ns - save.ew);
    sc.className = save.ns - save.ew < 0 ? 'neg' : '';
  }
  function renderInfo() {
    const b = B(), el = $('info');
    if (G.phase === 'bid') {
      const cur = E.curBidder(b);
      el.innerHTML = '叫牌中 · 轮到 <b>' + E.SEAT_NAME[cur] + '</b>' + (cur === ME ? '（你）' : '');
    } else if (b.contract) {
      const k = b.contract, p = b.play;
      const decl = E.side(k.declarer);
      const ns = p.tricks[0], ew = p.tricks[1];
      el.innerHTML = '<span class="link" data-act="auction">定约 <b>' + contractHtml(k) + '</b> · ' + E.SEAT_NAME[k.declarer] + '庄</span>' +
        '<span>南北 <b>' + ns + '</b> · 东西 <b>' + ew + '</b></span>' +
        '<span>' + (decl === 0 ? '南北' : '东西') + '需 ' + (k.level + 6) + ' 墩</span>';
    } else {
      el.textContent = '四家都过牌';
    }
  }
  function zoneForHand(seat, el, o) {
    el.innerHTML = '';
    const b = B();
    const hand = handOf(seat);
    const wrap = document.createElement('div'); wrap.className = 'zone-col';
    const turnSeat = G.phase === 'bid' ? (b.done ? -1 : E.curBidder(b)) : (b.play && !b.done ? b.play.turn : -1);
    const isDummy = !!(b.contract && b.contract.dummy === seat);
    const label = document.createElement('span');
    label.className = 'tag' + (turnSeat === seat ? ' turn' : '');
    label.textContent = E.SEAT_NAME[seat] + (b.contract && b.contract.declarer === seat ? ' 庄家' : '') + (isDummy ? ' 明手' : '') + (seat === ME ? '（你）' : '') + ' · ' + hand.length + ' 张';
    const canSeat = humanTurnSeat();
    const legal = canSeat === seat ? legalSet(seat) : null;
    const clsFn = (c) => {
      let s = '';
      if (legal) s += legal.has(c) ? ' can' : ' dim';
      if (G.hintCard === c) s += ' hint';
      return s.trim();
    };
    if (seatVisible(seat)) {
      const sorted = hand.slice().sort((x, y) => (E.suitOf(y) - E.suitOf(x)) || (E.rankOf(y) - E.rankOf(x)));
      if (o.grid) wrap.appendChild(dummyGrid(sorted, clsFn));
      else wrap.appendChild(fanRow(sorted, { cw: o.cw || 44, cls: clsFn }));
    } else if (o.fanBack) {
      wrap.appendChild(fanRow(hand, { cw: 24, back: true, avail: Math.min(availW(), 13 * 10 + 14) }));
    }
    wrap.insertBefore(label, wrap.firstChild);
    el.appendChild(wrap);
  }
  function renderSide(seat, el) {
    const b = B();
    el.innerHTML = '';
    if (G.phase === 'bid' && false) return;
    const hand = handOf(seat);
    const turnSeat = G.phase === 'bid' ? (b.done ? -1 : E.curBidder(b)) : (b.play && !b.done ? b.play.turn : -1);
    const wrap = document.createElement('div'); wrap.className = 'zone-col';
    const label = document.createElement('span'); label.className = 'tag' + (turnSeat === seat ? ' turn' : '');
    const isDummy = !!(b.contract && b.contract.dummy === seat);
    label.textContent = E.SEAT_NAME[seat] + (b.contract && b.contract.declarer === seat ? '庄' : '') + (isDummy ? '·明手' : '');
    wrap.appendChild(label);
    if (!(isDummy && revealed()) && !b.done) {
      wrap.appendChild(backEl(30));
    }
    const n = document.createElement('span'); n.className = 'tag'; n.textContent = hand.length + ' 张'; wrap.appendChild(n);
    el.appendChild(wrap);
  }
  function renderCenter() {
    const b = B(), c = $('center');
    c.innerHTML = '';
    if (G.phase === 'bid' || !b.contract) {
      c.appendChild(auctionTable(true));
      return;
    }
    const wrap = document.createElement('div'); wrap.className = 'trick';
    const trick = G.shown ? G.shown.cards : b.play.trick;
    const winSeat = G.shown ? G.shown.winner : -1;
    for (const t of trick) {
      const d = document.createElement('div'); d.className = 'tc ' + SEAT_CLS[t.seat];
      d.appendChild(cardEl(t.card, { cw: 40, cls: t.seat === winSeat ? 'win' : '' }));
      wrap.appendChild(d);
    }
    if (!trick.length) {
      const hint = document.createElement('div'); hint.className = 'tricks-count';
      const l = b.play.tricksLog.length;
      hint.innerHTML = l ? '第 <b>' + (l + 1) + '</b> 墩' : '开始出牌';
      wrap.appendChild(hint);
    }
    c.appendChild(wrap);
  }
  function auctionTable(live) {
    const b = B();
    const box = document.createElement('div'); box.id = 'auction';
    const order = [3, 0, 1, 2];
    let html = '<table class="atab"><thead><tr>' + order.map((s) => '<th class="' + (s === ME ? 'me' : '') + '">' + E.SEAT_NAME[s] + (s === ME ? '(你)' : '') + '</th>').join('') + '</tr></thead><tbody><tr>';
    let col = order.indexOf(b.dealer);
    for (let i = 0; i < col; i++) html += '<td></td>';
    b.auction.forEach((c, i) => {
      if (col === 4) { html += '</tr><tr>'; col = 0; }
      html += '<td class="' + (i === 0 ? 'dealer' : '') + '">' + callHtml(c) + '</td>';
      col++;
    });
    if (live && !E.auctionOver(b.auction)) {
      if (col === 4) { html += '</tr><tr>'; col = 0; }
      html += '<td class="q">?</td>';
    }
    html += '</tr></tbody></table>';
    box.innerHTML = html;
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
    return box;
  }
  function renderBand() {
    const b = B(), el = $('band');
    el.innerHTML = '';
    el.style.display = 'none';
    if (b.contract && revealed()) {
      const d = b.contract.dummy;
      if (d === 1 || d === 3) { el.style.display = ''; zoneForHand(d, el, { grid: true }); }
    }
  }
  function renderBottom() {
    const b = B(), el = $('bottom');
    el.innerHTML = '';
    if (G.phase === 'bid' && !b.done) {
      if (E.curBidder(b) === ME) {
        el.appendChild(msgEl(G.msg));
        el.appendChild(bidBox());
      } else {
        el.appendChild(msgEl('等待 ' + E.SEAT_NAME[E.curBidder(b)] + ' 叫牌…'));
      }
      return;
    }
    if (G.phase === 'play' && !b.done) {
      const s = b.play.turn, who = E.controller(b, s);
      const hs = humanTurnSeat();
      if (hs >= 0) {
        const m = document.createElement('div'); m.className = 'msg';
        m.innerHTML = (hs === ME ? '轮到你出牌' : '轮到你代打明手（' + E.SEAT_NAME[hs] + '）') + '　<button class="btn ghost" data-act="hintPlay" type="button" style="min-height:30px;padding:0 12px;font-size:13px">提示</button>';
        el.appendChild(m);
      } else if (b.contract.dummy === ME) {
        el.appendChild(msgEl('你是明手，由' + E.SEAT_NAME[b.contract.declarer] + '家代打 · 现在轮到 ' + E.SEAT_NAME[s]));
      } else {
        el.appendChild(msgEl('轮到 ' + E.SEAT_NAME[s] + (who !== s ? '（庄家代打）' : '')));
      }
      void who;
    }
  }
  function msgEl(t) { const d = document.createElement('div'); d.className = 'msg'; d.innerHTML = t || '&nbsp;'; return d; }
  function bidBox() {
    const b = B();
    const legal = new Set(E.legalCalls(b.auction, b.dealer));
    const box = document.createElement('div'); box.className = 'bbox';
    for (let l = 1; l <= 7; l++) {
      for (let k = 0; k < 5; k++) {
        const c = E.bid(l, k);
        const btn = document.createElement('button');
        btn.type = 'button'; btn.dataset.call = c;
        btn.className = isRed(k) ? 'red' : '';
        btn.innerHTML = l + (k === 4 ? 'NT' : E.SUIT_CH[k]);
        if (!legal.has(c)) btn.disabled = true;
        if (G.hintCall === c) btn.style.outline = '3px solid #ffb531';
        box.appendChild(btn);
      }
    }
    const mkBtn = (cls, label, call, dis) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'act ' + cls; btn.textContent = label;
      if (call !== null) btn.dataset.call = call;
      if (dis) btn.disabled = true;
      return btn;
    };
    box.appendChild(mkBtn('pass', '过牌 Pass', E.PASS, false));
    box.appendChild(mkBtn('dbl', 'X', E.DBL, !legal.has(E.DBL)));
    box.appendChild(mkBtn('rdbl', 'XX', E.RDBL, !legal.has(E.RDBL)));
    const h = mkBtn('hintb', '提示', null, false); h.dataset.act = 'hintBid'; box.appendChild(h);
    return box;
  }
  function renderAll() {
    renderTop(); renderInfo();
    zoneForHand(0, $('north'), { grid: !!(B().contract && B().contract.dummy === 0 && revealed()), fanBack: true, cw: 30 });
    renderSide(3, $('west')); renderSide(1, $('east'));
    renderCenter(); renderBand();
    zoneForHand(2, $('south'), { cw: 44 });
    renderBottom();
  }

  // ---------- 流程 ----------
  function levelCfg() { return LEVELS[save.level] || LEVELS[1]; }
  function later(fn, ms) {
    const tok = G.token;
    clearTimeout(G.timer);
    G.timer = setTimeout(() => { if (tok === G.token && !G.paused) fn(); }, ms);
  }
  function startBoard() {
    G.token++;
    clearTimeout(G.timer);
    G.b = E.newBoard(save.no, Math.random);
    G.phase = 'bid'; G.shown = null; G.hintCard = null; G.hintCall = null; G.msg = '';
    G.paused = false;
    hideOverlay();
    SFX.play('deal', 6);
    renderAll();
    step();
  }
  function step() {
    const b = B();
    if (G.paused || !b) return;
    if (b.done) { later(finishBoard, 700); return; }
    if (G.phase === 'bid') {
      const cur = E.curBidder(b);
      if (cur === ME) {
        G.msg = b.auction.length ? '轮到你叫牌' : '你是庄家，请开叫或过牌';
        renderAll();
        SFX.play('turn');
        return;
      }
      later(() => {
        const call = BB.chooseCall(b.hands[cur], cur, b.dealer, b.vul, b.auction);
        applyCall(call);
      }, 700);
      return;
    }
    // 打牌
    const s = b.play.turn;
    if (E.controller(b, s) === ME) { renderAll(); SFX.play('turn'); return; }
    later(() => {
      const L = levelCfg();
      const card = BP.choosePlay(b, s, Math.random, { ms: L.ms, minWorlds: L.min, maxWorlds: L.max });
      applyPlay(card);
    }, 450);
  }
  function applyCall(call) {
    const b = B();
    G.hintCall = null;
    E.makeCall(b, call);
    SFX.play(call >= 5 ? 'click' : 'check');
    if (b.contract) { G.phase = 'play'; G.msg = ''; renderAll(); toast('定约 ' + E.callName(E.bid(b.contract.level, b.contract.strain)).replace(/^/, '') + ' · ' + E.SEAT_NAME[b.contract.declarer] + '庄'); step(); return; }
    renderAll();
    step();
  }
  function applyPlay(card) {
    const b = B();
    G.hintCard = null;
    const done = E.playCard(b, card);
    SFX.play('flip', 1);
    if (done) {
      G.shown = done;
      renderAll();
      const tok = G.token;
      clearTimeout(G.timer);
      G.timer = setTimeout(() => {
        if (tok !== G.token) return;
        G.shown = null; renderAll(); step();
      }, 1050);
      return;
    }
    renderAll();
    step();
  }
  function humanPlay(card) {
    if (G.shown) { // 点击跳过展示
      G.shown = null; clearTimeout(G.timer); renderAll();
    }
    const seat = humanTurnSeat();
    if (seat < 0) return;
    if (!legalSet(seat).has(card)) { toast('必须跟出同花色'); return; }
    applyPlay(card);
  }
  function hintBid() {
    const b = B();
    const c = BB.chooseCall(b.hands[ME], ME, b.dealer, b.vul, b.auction);
    const h = b.hands[ME], l = BB.lensOf(h);
    G.hintCall = c;
    G.msg = '建议：<b>' + esc(E.callShort(c) === 'Pass' ? '过牌' : E.callName(c)) + '</b>　（你有 ' + BB.hcpOf(h) + ' 点，牌型 ' + [3, 2, 1, 0].map((s) => l[s]).join('-') + '）';
    renderAll();
  }
  function hintPlay() {
    const seat = humanTurnSeat();
    if (seat < 0) return;
    const L = levelCfg();
    G.hintCard = BP.choosePlay(B(), seat, Math.random, { ms: Math.max(250, L.ms), minWorlds: Math.max(20, L.min), maxWorlds: Math.max(100, L.max) });
    renderAll();
  }

  // ---------- 结束与面板 ----------
  function handLine(seat) {
    const h = B().hands[seat];
    return [3, 2, 1, 0].map((su) => {
      const cs = h.filter((c) => E.suitOf(c) === su).sort((a, b) => E.rankOf(b) - E.rankOf(a)).map((c) => E.RANK_CH[E.rankOf(c)]).join('') || '-';
      return '<span class="' + (isRed(su) ? 'red' : '') + '">' + E.SUIT_CH[su] + '</span>' + cs;
    }).join(' ');
  }
  function handsHtml() {
    return '<div class="hands">' + [0, 1, 2, 3].map((s) => '<div class="hh"><b>' + E.SEAT_NAME[s] + '</b> ' + handLine(s) + '</div>').join('') + '</div>';
  }
  function finishBoard() {
    const b = B();
    if (G.phase === 'done') return;
    G.phase = 'done';
    renderAll();
    const r = b.result, k = b.contract;
    let top, res;
    if (r.passedOut) { top = '四家都过牌'; res = '本副不得分'; }
    else {
      const declName = E.SEAT_NAME[k.declarer];
      const tag = r.diff >= 0 ? '完成' + (r.diff ? ' +' + r.diff : '') : '宕 ' + (-r.diff);
      top = '定约 ' + contractHtml(k) + ' · ' + declName + '庄 · ' + tag + '（' + r.made + '/' + r.need + ' 墩）';
      res = '';
    }
    const ns = r.passedOut ? 0 : r.nsScore;
    save.boards++; save.ns += Math.max(0, ns); save.ew += Math.max(0, -ns);
    if (!r.passedOut && ns > 0) save.made++;
    if (ns > save.best) save.best = ns;
    save.no++;
    persist();
    SFX.play(ns > 0 ? 'win' : ns < 0 ? 'lose' : 'click');
    const cls = ns > 0 ? 'pos' : ns < 0 ? 'neg' : '';
    showPanel('<h2>本副结束</h2><div class="res"><div>' + top + '</div>' +
      '<div class="big ' + cls + '">南北 ' + (r.passedOut ? '0' : fmt(ns)) + '</div><div>' + res + '</div>' +
      '<div style="font-size:13px;color:#bfe0d0">累计 南北 ' + fmt(save.ns - save.ew) + '（共 ' + save.boards + ' 副）</div></div>' + handsHtml() +
      '<div class="btns"><button class="btn primary" type="button" data-act="next">下一副</button>' +
      '<button class="btn ghost" type="button" data-act="viewTable">查看牌桌</button>' +
      '<a class="btn ghost" href="index.html">返回游戏大厅</a></div>');
  }

  const RULES = '<div class="rules"><b>玩法</b>：你坐南家，北家电脑是搭档，东西是对手。先叫牌定约，再打牌；庄家方要赢够「阶数+6」墩。' +
    '得分按复式桥牌计算（局况/身价每 16 副一轮）。<br>' +
    '<b>电脑叫牌体系（自然叫牌）</b>：12+ 点开叫，5 张高花；1NT=15–17 平均牌型；2NT=20–21；2♣=强牌 22+（逼叫到局）；' +
    '2♦/♥/♠ 弱二；3 阶及以上为阻击叫；争叫 1 阶 8+ 点、2 阶 11+ 点；技术性加倍；4NT 黑木问 A（5♣=0/4、5♦=1、5♥=2、5♠=3）。无斯台曼、转移等约定叫。<br>' +
    '点力：A=4 K=3 Q=2 J=1。双方合计约 25 点打成局，33 点以上考虑满贯。</div>';
  function statsLine() {
    return '累计 南北 ' + fmt(save.ns - save.ew) + ' · ' + save.boards + ' 副 · 最佳 ' + fmt(save.best);
  }
  function showPanel(html) { const o = $('overlay'); o.innerHTML = '<div class="panel">' + html + '</div>'; o.classList.remove('hidden'); }
  function hideOverlay() { $('overlay').classList.add('hidden'); }
  function levelSeg() {
    return '<div class="seg">' + LEVELS.map((l, i) => '<button type="button" data-act="lv' + i + '" class="' + (i === save.level ? 'on' : '') + '">' + l.name + '</button>').join('') + '</div>';
  }
  function togglesHtml() {
    const t = (act, label, on) => '<button class="btn ghost tg' + (on ? ' on' : '') + '" type="button" data-act="' + act + '">' + label + '<small>' + (on ? '开' : '关') + '</small></button>';
    return '<div class="togglerow">' + t('sfx', '音效', save.sfx) + t('music', '音乐', save.music) + '</div>';
  }
  function showStartMenu() {
    G.paused = true;
    showPanel('<h1>桥牌</h1><p>合约桥牌 · 你与电脑搭档对抗两位电脑</p><div class="stats">' + statsLine() + '</div>' +
      '<p>电脑水平（影响打牌推演强度）</p>' + levelSeg() + togglesHtml() +
      '<div class="btns"><button class="btn primary" type="button" data-act="start">开始游戏</button>' +
      '<a class="btn ghost" href="index.html">返回游戏大厅</a></div>' + RULES);
  }
  function showGameMenu() {
    G.paused = true;
    showPanel('<h2>菜单</h2><div class="stats">' + statsLine() + '</div>' + levelSeg() + togglesHtml() +
      '<div class="btns"><button class="btn primary" type="button" data-act="resume">继续游戏</button>' +
      '<button class="btn ghost" type="button" data-act="auction">查看叫牌记录</button>' +
      '<button class="btn ghost" type="button" data-act="reset">清空累计得分</button>' +
      '<a class="btn ghost" href="index.html">返回游戏大厅</a></div>' + RULES);
  }
  function showAuction() {
    const wasPaused = G.paused;
    G.paused = true;
    const tmp = auctionTable(false);
    tmp.style.maxHeight = '55vh';
    const b = B();
    showPanel('<h2>叫牌记录</h2><p>第 ' + b.no + ' 副 · 庄家 ' + E.SEAT_NAME[b.dealer] + ' · ' + VUL_TXT[b.vul] + '</p><div id="aucHost"></div>' +
      '<div class="btns"><button class="btn primary" type="button" data-act="resume">关闭</button></div>');
    $('aucHost').appendChild(tmp);
    G.pausedBefore = wasPaused;
  }
  function resume() {
    hideOverlay();
    if (G.phase === 'done') return;
    G.paused = false;
    renderAll();
    step();
  }
  function updateSoundBtn() { $('soundBtn').textContent = save.sfx || save.music ? '🔊' : '🔇'; }
  function applySound() { SFX.setSfx(save.sfx); SFX.setMusic(save.music); updateSoundBtn(); }
  function refreshMenu() { if (G.phase === 'menu') showStartMenu(); else showGameMenu(); }

  // ---------- 事件 ----------
  $('overlay').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'start') { G.phase = 'idle'; startBoard(); }
    else if (act === 'next') startBoard();
    else if (act === 'resume') resume();
    else if (act === 'viewTable') { hideOverlay(); }
    else if (act === 'auction') showAuction();
    else if (act === 'sfx') { save.sfx = !save.sfx; persist(); applySound(); SFX.play('click'); refreshMenu(); }
    else if (act === 'music') { save.music = !save.music; persist(); applySound(); refreshMenu(); }
    else if (act === 'reset') {
      Object.assign(save, { no: 1, ns: 0, ew: 0, boards: 0, made: 0, best: 0 });
      persist();
      G.phase = 'idle'; startBoard();
    } else if (act.startsWith('lv')) { save.level = Number(act.slice(2)); persist(); refreshMenu(); }
  });
  $('menuBtn').addEventListener('click', () => { if (G.phase === 'menu') return; SFX.play('click'); if (G.phase === 'done') showGameMenu(); else showGameMenu(); });
  $('soundBtn').addEventListener('click', () => {
    if (save.sfx || save.music) { save.mute = { music: save.music }; save.sfx = false; save.music = false; }
    else { save.sfx = true; save.music = !!(save.mute && save.mute.music); }
    persist(); applySound(); SFX.play('click');
    toast(save.sfx || save.music ? '声音已开' : '声音已关');
  });
  $('app').addEventListener('click', (e) => {
    if (!$('overlay').classList.contains('hidden')) return;
    const btn = e.target.closest('button[data-call]');
    if (btn && G.phase === 'bid' && E.curBidder(B()) === ME && !btn.disabled) {
      G.msg = ''; G.hintCall = null;
      applyCall(Number(btn.dataset.call));
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'hintBid') return hintBid();
      if (act.dataset.act === 'hintPlay') return hintPlay();
      if (act.dataset.act === 'auction') return showAuction();
    }
    const card = e.target.closest('.card.can');
    if (card) return humanPlay(Number(card.dataset.c));
    if (G.shown) { // 点击牌桌跳过一墩的展示
      G.shown = null; clearTimeout(G.timer); renderAll(); step();
    }
  });
  document.addEventListener('pointerdown', () => SFX.unlock(), { passive: true });
  window.addEventListener('resize', () => { if (G.b) renderAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.phase !== 'menu' && G.phase !== 'done') { /* 后台时继续由定时器暂停 */ } });

  // ---------- 启动 ----------
  G.b = E.newBoard(save.no, Math.random);
  G.phase = 'menu';
  applySound();
  renderAll();
  showStartMenu();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // 供自动化测试使用
  window.__bridge = { G, save, startBoard, applyCall, applyPlay, step };
})();
