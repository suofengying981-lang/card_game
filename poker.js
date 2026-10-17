/* 德州扑克：界面与对局流程（引擎见 poker-engine.js） */
(function () {
  'use strict';
  const { SUITS, RANK_CH, PERSONAS, createHand, aiDecide, equity, evaluate, describe, advise } = window.Poker;
  const SFX = window.SFX || { play() {}, unlock() {}, setSfx() {}, setMusic() {} };

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Number(n).toLocaleString('en-US');

  const START_STACK = 2000;
  const STAKES = [{ sb: 10, bb: 20 }, { sb: 25, bb: 50 }, { sb: 50, bb: 100 }];
  const NAME = (i) => (i === 0 ? '你' : PERSONAS[i - 1].name); // 座位 1..4 对应 4 位电脑牌友
  const AVATAR = ['我', '王', '李', '杰', '陈'];

  // ---------- 存档 ----------
  const KEY = 'ddz-poker-v1';
  const save = { stack: START_STACK, buyins: 1, hands: 0, wins: 0, best: 0, stakes: 0, hint: false, sfx: true, music: false, mute: null };
  try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };
  const profit = () => save.stack - START_STACK * save.buyins;

  // ---------- 状态 ----------
  const G = {
    gen: 0, phase: 'menu', paused: false, fast: false,
    stacks: [START_STACK, START_STACK, START_STACK, START_STACK, START_STACK],
    dealer: -1, handNo: 0, H: null, evIdx: 0, D: null,
    humanTurn: false, resolve: null, raiseL: null, awards: [], eqCache: '', adv: null,
  };

  async function tick(ms) {
    await sleep(G.fast ? Math.min(ms, 40) : ms);
    while (G.paused) await sleep(150);
  }

  // ---------- 牌的渲染 ----------
  function cardEl(c, extra) {
    const el = document.createElement('div');
    el.className = 'card ' + (c.s === 1 || c.s === 3 ? 'red' : 'black') + (extra ? ' ' + extra : '');
    el.innerHTML = '<span class="corner"><b>' + RANK_CH[c.r] + '</b><i>' + SUITS[c.s] + '</i></span><span class="pip">' + SUITS[c.s] + '</span>';
    return el;
  }
  function backEl(extra) {
    const el = document.createElement('div');
    el.className = 'card back' + (extra ? ' ' + extra : '');
    return el;
  }

  function buildSeats() {
    for (let i = 0; i < 5; i++) {
      $('pseat' + i).innerHTML =
        (i ? '<div class="holes"></div>' : '') +
        '<div class="avatar"><span>' + AVATAR[i] + '</span><em class="dbtn">D</em><em class="blind"></em></div>' +
        '<div class="pill"><span class="nm">' + NAME(i) + '</span><b class="stk">0</b></div>' +
        '<div class="lab"></div>';
    }
  }

  function newDisplay(stacks) {
    return {
      seats: stacks.map((st) => ({ stack: st, bet: 0, folded: st <= 0, out: st <= 0, reveal: null, label: '', cls: '', winner: false })),
      board: [], pot: 0, dealer: -1, sbSeat: -1, bbSeat: -1, turn: -1, dealt: false,
    };
  }

  function renderSeat(i) {
    const D = G.D, s = D.seats[i], el = $('pseat' + i);
    el.classList.toggle('folded', s.folded && !s.out);
    el.classList.toggle('out', s.out);
    el.classList.toggle('turn', D.turn === i);
    el.classList.toggle('winner', s.winner);
    el.querySelector('.stk').textContent = fmt(s.stack);
    el.querySelector('.dbtn').style.display = D.dealer === i ? 'grid' : 'none';
    const bl = D.sbSeat === i ? 'SB' : D.bbSeat === i ? 'BB' : '';
    const b = el.querySelector('.blind');
    b.textContent = bl;
    b.style.display = bl ? 'block' : 'none';
    const lab = el.querySelector('.lab');
    lab.textContent = s.label;
    lab.className = 'lab' + (s.cls ? ' ' + s.cls : '');
    if (i > 0) {
      const h = el.querySelector('.holes');
      const key = s.reveal ? 'r' + s.reveal.map((c) => c.id).join(',') : D.dealt && !s.folded && !s.out ? 'back' : 'none';
      if (h.dataset.k !== key) {
        h.dataset.k = key;
        h.textContent = '';
        if (s.reveal) s.reveal.forEach((c) => h.appendChild(cardEl(c, 'pop')));
        else if (key === 'back') { h.appendChild(backEl('pop')); h.appendChild(backEl('pop')); }
      }
    }
    const bet = $('bet' + i);
    bet.textContent = s.bet > 0 ? fmt(s.bet) : '';
    bet.style.display = s.bet > 0 ? 'inline-flex' : 'none';
  }

  function renderBoard() {
    const box = $('board');
    const have = box.querySelectorAll('.card').length;
    const n = G.D.board.length;
    if (n < have || !box.children.length) {
      box.textContent = '';
      for (let i = 0; i < 5; i++) { const s = document.createElement('div'); s.className = 'slot'; box.appendChild(s); }
    }
    const cur = box.querySelectorAll('.card').length;
    for (let i = cur; i < n; i++) box.replaceChild(cardEl(G.D.board[i], 'pop'), box.children[i]);
  }

  function myHoleCards() { return G.H ? G.H.p[0].hole : []; }

  function handLabel() {
    const h = myHoleCards();
    if (!G.D || !G.D.dealt || h.length < 2) return '';
    const board = G.D.board;
    if (!board.length) {
      const a = Math.max(h[0].r, h[1].r), b = Math.min(h[0].r, h[1].r);
      if (a === b) return '口袋对 ' + RANK_CH[a];
      return RANK_CH[a] + RANK_CH[b] + (h[0].s === h[1].s ? ' 同花' : ' 非同花');
    }
    return describe(evaluate(h.concat(board)));
  }

  function renderMe() {
    const D = G.D;
    const hole = myHoleCards();
    const box = $('myCards');
    const key = D.dealt ? hole.map((c) => c.id).join(',') : '';
    if (box.dataset.k !== key) {
      box.dataset.k = key;
      box.textContent = '';
      if (D.dealt) hole.forEach((c) => box.appendChild(cardEl(c, 'pop')));
    }
    box.classList.toggle('folded', D.seats[0].folded);
    const showHand = D.dealt && !D.seats[0].folded;
    $('handLabel').textContent = showHand ? handLabel() : '';
    let eq = '';
    if (save.hint && showHand) {
      const nOpp = D.seats.filter((s, i) => i > 0 && !s.folded && !s.out).length;
      const k = key + '|' + D.board.length + '|' + nOpp;
      if (G.eqCache.k !== k) G.eqCache = { k, v: nOpp > 0 ? equity(hole, D.board, nOpp, 1500) : 1 };
      eq = '胜率约 ' + Math.round(G.eqCache.v * 100) + '%';
    }
    $('eqLabel').textContent = eq;
  }

  // ---------- 出牌建议 ----------
  const ACT_NAME = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', bet: '下注' };
  function renderAdvice() {
    const box = $('advice');
    const D = G.D;
    const H = G.H;
    if (!save.hint || G.phase !== 'playing' || !G.humanTurn || !H || H.done || !D || D.seats[0].folded) {
      box.classList.add('hidden');
      return;
    }
    const L = H.legal();
    if (!L) { box.classList.add('hidden'); return; }
    const hole = H.p[0].hole;
    const nOpp = D.seats.filter((x, i) => i > 0 && !x.folded && !x.out).length;
    const k = hole.map((c) => c.id).join(',') + '|' + D.board.length + '|' + L.toCall + '|' + L.pot + '|' + H.raises + '|' + nOpp;
    if (!G.adv || G.adv.k !== k) {
      G.adv = { k, v: advise({ hole, board: D.board, nOpp, pot: L.pot, toCall: L.toCall, raises: H.raises, street: H.street, iters: 1200 }) };
    }
    const a = G.adv.v;
    let act = a.action;
    if (act === 'raise' && !L.canRaise) act = L.canCheck ? 'check' : 'call';
    const name = act === 'raise' ? (L.currentBet === 0 ? '下注' : '加注') : ACT_NAME[act];
    let sub = a.tier ? a.tier : '';
    if (a.outs && a.outs.total) {
      const g = a.outs.groups.slice(0, 3).map((x) => x.name + ' ' + x.n + ' 张').join('、');
      const when = D.board.length === 3 ? '到河牌' : '下一张';
      sub = '补牌：' + g + '（共 ' + a.outs.total + ' 张，' + when + '约 ' + Math.round(a.outs.pct * 100) + '%）';
    }
    box.className = 'a-' + act;
    box.innerHTML = '<div class="ad-main">建议：<b>' + name + '</b>　' + a.reason + '</div>' +
      '<div class="ad-sub">' + (sub ? sub + ' · ' : '') + '仅供参考，电脑可能诈唬</div>';
  }

  function renderTop() {
    const st = STAKES[save.stakes];
    $('blindInfo').textContent = '盲注 ' + st.sb + '/' + st.bb;
    $('handInfo').textContent = '第 ' + G.handNo + ' 手';
    const p = profit();
    const el = $('profit');
    el.textContent = '盈亏 ' + (p > 0 ? '+' : '') + fmt(p);
    el.classList.toggle('neg', p < 0);
  }

  function renderPot() {
    const box = $('potBox');
    const pot = G.D ? G.D.pot : 0;
    box.classList.toggle('hidden', !(pot > 0));
    $('potAmt').textContent = fmt(pot);
  }

  function renderAll() {
    if (!G.D) return;
    for (let i = 0; i < 5; i++) renderSeat(i);
    renderBoard(); renderMe(); renderTop(); renderPot(); renderActions(); renderAdvice();
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), ms || 1300);
  }

  // ---------- 操作按钮 ----------
  function renderActions() {
    const box = $('actions');
    box.textContent = '';
    $('raisePanel').classList.add('hidden');
    const add = (label, cls, act, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.dataset.act = act;
      b.disabled = !!disabled;
      box.appendChild(b);
    };
    if (G.phase === 'playing' && G.humanTurn && G.H && !G.H.done) {
      const L = G.H.legal();
      if (!L) return;
      add('弃牌', 'danger', 'fold', L.canCheck);
      if (L.canCheck) add('过牌', '', 'check');
      else add(L.toCall >= L.stack ? '全下 ' + fmt(L.toCall) : '跟注 ' + fmt(L.toCall), '', 'call');
      if (L.canRaise) add(L.currentBet === 0 ? '下注' : '加注', 'primary', 'raise');
      else add('加注', 'primary', 'raise', true);
    } else if (G.phase === 'between') {
      add(G.stacks[0] <= 0 ? '重新买入' : '下一手', 'primary', 'next');
    } else if (G.phase === 'playing' && !G.humanTurn && G.H && !G.H.done && !G.fast) {
      const me = G.H.p[0];
      if (me.folded || me.allIn) add('快进', 'ghost', 'fast');
    }
  }

  function snapTo(v, L) {
    if (v >= L.maxTo) return L.maxTo;
    const unit = Math.max(1, Math.floor(G.H.bb / 2));
    const x = Math.round(v / unit) * unit;
    return Math.max(L.minTo, Math.min(L.maxTo, x));
  }
  function updateRaise() {
    const L = G.raiseL;
    if (!L) return;
    const r = $('raiseRange');
    const to = snapTo(Number(r.value), L);
    r.value = to;
    const allin = to >= L.maxTo;
    $('raiseAmt').textContent = fmt(to);
    $('raiseOk').textContent = allin ? '全下 ' + fmt(to) : (L.currentBet === 0 ? '下注 ' : '加注到 ') + fmt(to);
  }
  function openRaise() {
    const L = G.H.legal();
    if (!L || !L.canRaise) return;
    if (L.minTo >= L.maxTo) { submit({ type: 'allin' }); return; }
    const panel = $('raisePanel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    SFX.play('click');
    G.raiseL = L;
    const r = $('raiseRange');
    r.min = L.minTo; r.max = L.maxTo; r.step = 1; r.value = L.minTo;
    panel.classList.remove('hidden');
    updateRaise();
  }
  $('raiseRange').addEventListener('input', updateRaise);
  document.querySelector('.rp-presets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    const L = G.raiseL;
    if (!b || !L) return;
    const f = b.dataset.f;
    let to;
    if (f === 'min') to = L.minTo;
    else if (f === 'all') to = L.maxTo;
    else to = L.currentBet + Number(f) * (L.pot + L.fullToCall);
    $('raiseRange').value = Math.max(L.minTo, Math.min(L.maxTo, Math.round(to)));
    SFX.play('click');
    updateRaise();
  });
  $('raiseOk').addEventListener('click', () => {
    const L = G.raiseL;
    if (!L) return;
    const to = snapTo(Number($('raiseRange').value), L);
    submit(to >= L.maxTo ? { type: 'allin' } : { type: 'raise', amount: to });
  });

  function humanAct() {
    return new Promise((resolve) => {
      G.resolve = resolve;
      G.humanTurn = true;
      renderActions();
      renderAdvice();
    });
  }
  function submit(action) {
    if (!G.resolve) return;
    const r = G.resolve;
    G.resolve = null;
    G.humanTurn = false;
    $('raisePanel').classList.add('hidden');
    renderActions();
    renderAdvice();
    r(action);
  }

  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'fold') submit({ type: 'fold' });
    else if (act === 'check') submit({ type: 'check' });
    else if (act === 'call') submit({ type: 'call' });
    else if (act === 'raise') openRaise();
    else if (act === 'fast') { G.fast = true; renderActions(); }
    else if (act === 'next') startHand();
  });

  // ---------- 弹层 ----------
  function showPanel(html) {
    const o = $('overlay');
    o.innerHTML = '<div class="panel">' + html + '</div>';
    o.classList.remove('hidden');
  }
  function hideOverlay() {
    $('overlay').classList.add('hidden');
    G.paused = false;
  }

  const RULES = '<details><summary>玩法与牌型</summary><ol>' +
    '<li>每人 2 张底牌，桌面最多 5 张公共牌，用其中任意 5 张组成最大牌型。</li>' +
    '<li>牌型从大到小：同花顺（A 高为皇家同花顺）、四条、葫芦、同花、顺子、三条、两对、一对、高牌。</li>' +
    '<li>无限注：加注至少要等于上一次加注的幅度，最多可以全下；不同筹码量产生的边池会自动结算。</li>' +
    '<li>D 为庄家位，其左手边依次是小盲 SB、大盲 BB；翻牌前从大盲下家开始行动，翻牌后从庄家下家开始。</li>' +
    '<li>电脑输光会自动重新买入；你输光后可以点「重新买入」，盈亏会计入买入次数。</li></ol></details>';

  function statsLine() {
    const rate = save.hands ? Math.round((100 * save.wins) / save.hands) : 0;
    const p = profit();
    return '筹码 ' + fmt(save.stack) + ' · 盈亏 ' + (p > 0 ? '+' : '') + fmt(p) + '<br>' +
      save.hands + ' 手 · 胜率 ' + rate + '% · 最大底池 ' + fmt(save.best);
  }
  function stakesHtml() {
    return '<div class="stakes">盲注' + STAKES.map((s, i) =>
      '<button type="button" data-act="stake' + i + '" class="' + (i === save.stakes ? 'on' : '') + '">' + s.sb + '/' + s.bb + '</button>').join('') + '</div>';
  }
  function togglesHtml() {
    const t = (act, label, on) => '<button class="btn ghost tg' + (on ? ' on' : '') + '" type="button" data-act="' + act + '">' + label + '<br><small>' + (on ? '开' : '关') + '</small></button>';
    return '<div class="togglerow">' + t('hint', '提示', save.hint) + t('sfx', '音效', save.sfx) + t('music', '音乐', save.music) + '</div>';
  }
  function refreshMenu() { if (G.phase === 'menu') showStartMenu(); else showGameMenu(); }
  function updateSoundBtn() { $('soundBtn').textContent = save.sfx || save.music ? '🔊' : '🔇'; }
  function applySound() { SFX.setSfx(save.sfx); SFX.setMusic(save.music); updateSoundBtn(); }

  function showStartMenu() {
    showPanel('<h1>德州扑克</h1><p>无限注 · 你和 4 位电脑牌友</p><div class="stats">' + statsLine() + '</div>' +
      stakesHtml() + '<div class="btns" style="margin-top:0">' + togglesHtml() + '</div>' +
      '<div class="btns"><button class="btn primary" type="button" data-act="start">开始游戏</button>' +
      '<a class="btn ghost" href="index.html">去玩斗地主</a></div>' + RULES);
  }
  function showGameMenu() {
    G.paused = true;
    showPanel('<h2>菜单</h2><div class="stats">' + statsLine() + '</div><div class="btns">' +
      '<button class="btn primary" type="button" data-act="resume">继续游戏</button>' +
      togglesHtml() +
      '<button class="btn ghost" type="button" data-act="reset">清空记录并重置筹码</button>' +
      '<a class="btn ghost" href="index.html">去玩斗地主</a></div>' + RULES);
  }

  $('overlay').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'start') { hideOverlay(); startSession(); }
    else if (act === 'resume') { hideOverlay(); }
    else if (act === 'hint') { save.hint = !save.hint; persist(); G.eqCache = ''; refreshMenu(); renderMe(); renderAdvice(); }
    else if (act === 'sfx') { save.sfx = !save.sfx; persist(); applySound(); SFX.play('click'); refreshMenu(); }
    else if (act === 'music') { save.music = !save.music; persist(); applySound(); refreshMenu(); }
    else if (act === 'reset') {
      Object.assign(save, { stack: START_STACK, buyins: 1, hands: 0, wins: 0, best: 0 });
      persist();
      hideOverlay();
      startSession();
    } else if (act.startsWith('stake')) {
      save.stakes = Number(act.slice(5));
      persist();
      showStartMenu();
    }
  });
  $('soundBtn').addEventListener('click', () => {
    if (save.sfx || save.music) {
      save.mute = { music: save.music };
      save.sfx = false; save.music = false;
    } else {
      save.sfx = true; save.music = !!(save.mute && save.mute.music);
    }
    persist(); applySound();
    SFX.play('click');
    toast(save.sfx || save.music ? '声音已开' : '声音已关');
  });
  // 浏览器要求用户操作后才能出声
  document.addEventListener('pointerdown', () => SFX.unlock(), { passive: true });
  $('menuBtn').addEventListener('click', () => {
    if (G.phase === 'menu') return;
    showGameMenu();
  });

  // ---------- 对局流程 ----------
  function startSession() {
    ++G.gen;
    if (save.stack <= 0) { save.stack = START_STACK; save.buyins++; persist(); }
    G.stacks = [save.stack, START_STACK, START_STACK, START_STACK, START_STACK];
    G.dealer = -1;
    G.handNo = 0;
    startHand();
  }

  function nextDealer() {
    const n = 5;
    if (G.dealer < 0) return Math.floor(Math.random() * n);
    for (let k = 1; k <= n; k++) {
      const i = (G.dealer + k) % n;
      if (G.stacks[i] > 0) return i;
    }
    return 0;
  }

  async function startHand() {
    const gen = ++G.gen;
    const st = STAKES[save.stakes];
    G.phase = 'playing';
    G.fast = false;
    G.humanTurn = false;
    G.awards = [];
    G.eqCache = '';
    for (let i = 1; i < 5; i++) {
      if (G.stacks[i] < st.bb * 2) { G.stacks[i] = START_STACK; toast(NAME(i) + ' 重新买入 ' + fmt(START_STACK)); }
    }
    if (G.stacks[0] <= 0) { G.stacks[0] = START_STACK; save.buyins++; save.stack = START_STACK; persist(); }
    G.dealer = nextDealer();
    G.handNo++;
    const H = createHand({ stacks: G.stacks.slice(), dealer: G.dealer, sb: st.sb, bb: st.bb });
    G.H = H;
    G.evIdx = 0;
    G.D = newDisplay(G.stacks);
    G.D.dealer = G.dealer;
    $('banner').textContent = '';
    $('board').textContent = '';
    $('myCards').dataset.k = '#';
    for (let i = 1; i < 5; i++) $('pseat' + i).querySelector('.holes').dataset.k = '#';
    renderAll();
    await tick(350);
    if (G.gen !== gen) return;
    if (!(await drain(gen))) return;

    while (!H.done) {
      const seat = H.toAct;
      G.D.turn = seat;
      renderAll();
      if (seat === 0) {
        if (save.hint) renderMe();
        SFX.play('turn');
        const a = await humanAct();
        if (G.gen !== gen) return;
        G.D.turn = -1;
        H.act(a.type, a.amount);
      } else {
        await tick(550 + Math.random() * 600);
        if (G.gen !== gen) return;
        const d = aiDecide(H, seat, PERSONAS[seat - 1]);
        G.D.turn = -1;
        H.act(d.type, d.amount);
      }
      if (!(await drain(gen))) return;
    }
  }

  const ACT = {
    fold: ['弃牌', 'fold'], check: ['过牌', ''], call: ['跟注', ''], bet: ['下注', 'raise'], raise: ['加注', 'raise'],
  };

  function soundFor(e) {
    if (G.fast) return;
    switch (e.t) {
      case 'deal': SFX.play('deal', 6); break;
      case 'action':
        if (e.a === 'fold') SFX.play('fold');
        else if (e.allin) SFX.play('allin');
        else if (e.a === 'check') SFX.play('check');
        else if (e.a === 'call') SFX.play('call');
        else SFX.play('raise');
        break;
      case 'street': SFX.play('flip', e.cards.length); break;
      case 'showdown': SFX.play('flip', 1); break;
      case 'award': if (e.kind !== 'refund') SFX.play('award'); break;
      default: break;
    }
  }

  function applyEvent(e) {
    const D = G.D;
    soundFor(e);
    switch (e.t) {
      case 'blind': {
        const s = D.seats[e.seat];
        s.stack = e.stack; s.bet = e.bet; D.pot = e.pot;
        if (e.kind === 'sb') D.sbSeat = e.seat; else D.bbSeat = e.seat;
        break;
      }
      case 'deal':
        D.dealt = true; D.dealer = e.dealer; D.sbSeat = e.sb; D.bbSeat = e.bb;
        break;
      case 'action': {
        const s = D.seats[e.seat];
        s.stack = e.stack; s.bet = e.bet; D.pot = e.pot;
        const [text, cls] = ACT[e.a];
        s.label = e.allin && e.a !== 'fold' ? '全下' : text;
        s.cls = e.allin && e.a !== 'fold' ? 'allin' : cls;
        if (e.a === 'fold') s.folded = true;
        break;
      }
      case 'street':
        for (const s of D.seats) { s.bet = 0; if (!s.folded) { s.label = ''; s.cls = ''; } }
        for (const c of e.cards) D.board.push(c);
        D.pot = e.pot;
        break;
      case 'showdown':
        for (const s of D.seats) s.bet = 0;
        for (const h of e.hands) {
          const s = D.seats[h.seat];
          s.reveal = h.hole; s.label = h.name; s.cls = 'hand';
        }
        break;
      case 'award': {
        for (const s of D.seats) s.bet = 0;
        const s = D.seats[e.seat];
        s.stack = e.stack;
        D.pot = Math.max(0, D.pot - e.amount);
        if (e.kind !== 'refund') s.winner = true;
        G.awards.push(e);
        break;
      }
      case 'end':
        finishHand(e);
        break;
      default: break;
    }
  }

  function delayFor(e) {
    const folded = G.H && G.H.p[0].folded;
    const k = folded ? 0.5 : 1;
    switch (e.t) {
      case 'blind': return 180 * k;
      case 'deal': return 600;
      case 'action': return e.seat === 0 ? 150 : 600 * k;
      case 'street': return 900 * k;
      case 'showdown': return 1500;
      case 'award': return 800;
      default: return 0;
    }
  }

  async function drain(gen) {
    while (G.evIdx < G.H.events.length) {
      const e = G.H.events[G.evIdx++];
      applyEvent(e);
      renderAll();
      await tick(delayFor(e));
      if (G.gen !== gen) return false;
    }
    return true;
  }

  function finishHand(e) {
    const H = G.H;
    G.stacks = H.p.map((x) => x.stack);
    const net = e.net[0];
    save.stack = G.stacks[0];
    SFX.play(net > 0 ? 'win' : net < 0 ? 'lose' : '');
    save.hands++;
    if (net > 0) { save.wins++; save.best = Math.max(save.best, H.result.pot); }
    persist();

    // 结算文字
    const lines = [];
    const wins = G.awards.filter((a) => a.kind !== 'refund');
    const byseat = new Map();
    for (const a of wins) {
      const cur = byseat.get(a.seat) || { amount: 0, name: a.name || '', split: a.kind === 'split' };
      cur.amount += a.amount;
      if (a.name) cur.name = a.name;
      byseat.set(a.seat, cur);
    }
    byseat.forEach((v, seat) => {
      const who = seat === 0 ? '你' : NAME(seat);
      const verb = v.split ? '平分赢得 ' : '赢得 ';
      const gain = e.net[seat] > 0 ? e.net[seat] : v.amount; // 显示净赢额，别把自己下的筹码也算进去
      lines.push('<span class="ln' + (seat === 0 ? ' me' : '') + '">' + who + verb + fmt(gain) + (v.name ? ' · ' + v.name : '') + '</span>');
    });
    if (!H.result.showdown) lines.push('<span class="ln">其他人都弃牌了</span>');
    $('banner').innerHTML = lines.join('');

    G.phase = 'between';
    G.D.turn = -1;
    renderAll();
  }

  // ---------- 初始化 ----------
  buildSeats();
  applySound();
  G.D = newDisplay(G.stacks);
  renderAll();
  showStartMenu();

  // 供自动化测试使用
  window.__poker = { G, save, submit };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
