/* 斗地主：界面与对局流程 */
(function () {
  'use strict';
  const { classify, canBeat, hints, aiPlay, aiBid, newDeck, shuffle, sortHand, LABEL, SUITS } = window.DDZ;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NAMES = ['我', '电脑·右', '电脑·左']; // 出牌顺序 0 → 1 → 2 → 0

  // ---------- 存档 ----------
  const STORE_KEY = 'ddz-stats-v1';
  let stats = { score: 0, games: 0, wins: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved && typeof saved === 'object') stats = Object.assign(stats, saved);
  } catch (e) { /* 隐私模式等情况下忽略 */ }
  function saveStats() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
  }

  // ---------- 状态 ----------
  const S = {
    gen: 0, phase: 'menu', paused: false,
    hands: [[], [], []], bottom: [], landlord: -1, turn: 0,
    bidMax: 0, bidder: -1, bids: [null, null, null],
    last: null, lastBy: -1, passes: 0, plays: [0, 0, 0], bombs: 0, base: 1,
    selected: new Set(), hintList: null, hintIdx: 0, humanTurn: false, resolve: null,
  };
  let layout = { left0: 0, step: 0, cw: 56, n: 0 };

  async function tick(ms) {
    await sleep(ms);
    while (S.paused) await sleep(150);
  }

  // ---------- 渲染：牌 ----------
  function cardEl(c) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = c.id;
    if (c.rank >= 16) {
      el.classList.add('joker', c.rank === 17 ? 'red' : 'black');
      el.innerHTML = '<span class="corner"><b>' + (c.rank === 17 ? '大' : '小') + '</b><i>王</i></span><span class="jk">JOKER</span>';
    } else {
      el.classList.add(c.suit === 1 || c.suit === 3 ? 'red' : 'black');
      el.innerHTML = '<span class="corner"><b>' + LABEL[c.rank] + '</b><i>' + SUITS[c.suit] + '</i></span><span class="pip">' + SUITS[c.suit] + '</span>';
    }
    return el;
  }
  function backEl() {
    const el = document.createElement('div');
    el.className = 'card back';
    return el;
  }

  function renderHand(animate) {
    const box = $('hand');
    box.textContent = '';
    const hand = S.hands[0];
    const n = hand.length;
    layout.n = n;
    if (!n) return;
    const W = box.clientWidth || 360;
    const cw = n > 17 ? 50 : n > 13 ? 54 : 58;
    box.style.setProperty('--cw', cw + 'px');
    const step = n > 1 ? Math.min(cw * 0.72, (W - cw) / (n - 1)) : 0;
    const left0 = (W - (step * (n - 1) + cw)) / 2;
    layout = { left0, step, cw, n };
    hand.forEach((c, i) => {
      const el = cardEl(c);
      el.style.left = left0 + i * step + 'px';
      el.style.zIndex = String(i);
      if (S.selected.has(c.id)) el.classList.add('sel');
      if (animate) {
        el.style.animation = 'deal .28s ease-out backwards';
        el.style.animationDelay = i * 22 + 'ms';
      }
      box.appendChild(el);
    });
  }

  function clearPlayed(p) { $('played' + p).textContent = ''; $('played' + p).classList.remove('reveal'); }
  function clearAllPlayed() { for (let p = 0; p < 3; p++) clearPlayed(p); }

  function showTag(p, text, cls) {
    const box = $('played' + p);
    box.textContent = '';
    const t = document.createElement('span');
    t.className = 'tag' + (cls ? ' ' + cls : '');
    t.textContent = text;
    box.appendChild(t);
  }

  function showCards(p, cards, reveal) {
    const box = $('played' + p);
    box.textContent = '';
    box.classList.toggle('reveal', !!reveal);
    for (const c of cards) {
      const el = cardEl(c);
      el.style.animation = 'drop .18s ease-out';
      box.appendChild(el);
    }
  }

  function renderBottom() {
    const box = $('bottomCards');
    box.textContent = '';
    if (S.phase === 'menu') return;
    if (S.landlord >= 0) for (const c of sortHand(S.bottom)) box.appendChild(cardEl(c));
    else for (let i = 0; i < 3; i++) box.appendChild(backEl());
  }

  function renderSeats() {
    for (let p = 0; p < 3; p++) {
      const el = $('seat' + p);
      const active = (S.phase === 'playing' || S.phase === 'bidding') && S.turn === p;
      el.classList.toggle('turn', active);
      const badge = el.querySelector('.badge');
      if (S.landlord < 0) { badge.className = 'badge'; badge.textContent = ''; }
      else if (p === S.landlord) { badge.className = 'badge landlord'; badge.textContent = '地主'; }
      else { badge.className = 'badge farmer'; badge.textContent = '农民'; }
      const n = S.hands[p].length;
      el.querySelector('.cnt b').textContent = String(n);
      el.querySelector('.cnt').classList.toggle('warn', S.phase === 'playing' && n > 0 && n <= 2);
    }
  }

  function renderTop() {
    const playing = S.phase === 'playing' || S.phase === 'over';
    $('baseInfo').textContent = playing ? '底分 ' + S.base : S.bidMax ? '当前叫分 ' + S.bidMax : '底分 —';
    $('multInfo').textContent = '倍数 ×' + Math.pow(2, S.bombs);
    $('totalScore').textContent = '积分 ' + stats.score;
  }

  function renderAll(animateHand) {
    renderTop(); renderBottom(); renderSeats(); renderHand(animateHand); renderActions();
  }

  // ---------- 操作按钮 ----------
  function renderActions() {
    const box = $('actions');
    box.textContent = '';
    const add = (label, cls, act, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.dataset.act = act;
      b.disabled = !!disabled;
      box.appendChild(b);
    };
    if (S.phase === 'bidding' && S.humanTurn) {
      add('不叫', 'ghost small', 'bid0');
      for (const v of [1, 2, 3]) add(v + '分', v === 3 ? 'primary small' : 'small', 'bid' + v, v <= S.bidMax);
    } else if (S.phase === 'playing' && S.humanTurn) {
      add('不要', 'ghost', 'pass', !S.last);
      add('提示', '', 'hint');
      add('出牌', 'primary', 'play', true);
      updatePlayBtn();
    } else if (S.phase === 'over' && $('overlay').classList.contains('hidden')) {
      add('再来一局', 'primary', 'again');
    }
  }

  function selectedCards() {
    return S.hands[0].filter((c) => S.selected.has(c.id));
  }
  function updatePlayBtn() {
    const btn = $('actions').querySelector('[data-act="play"]');
    if (!btn) return;
    const info = classify(selectedCards());
    btn.disabled = !(info && canBeat(info, S.last && S.last.info));
  }

  function setSel(i, on) {
    const c = S.hands[0][i];
    if (!c) return;
    if (on) S.selected.add(c.id); else S.selected.delete(c.id);
    const el = $('hand').children[i];
    if (el) el.classList.toggle('sel', on);
  }

  // 点选 + 滑动选牌
  function bindHand() {
    const box = $('hand');
    let dragging = false, target = true, lastIdx = -1;
    const idxAt = (x) => {
      if (!layout.n) return null;
      const r = box.getBoundingClientRect();
      const px = x - r.left - layout.left0;
      const total = layout.step * (layout.n - 1) + layout.cw;
      if (px < -6 || px > total + 6) return null;
      if (layout.n === 1) return 0;
      return Math.max(0, Math.min(layout.n - 1, Math.floor(px / layout.step)));
    };
    box.addEventListener('pointerdown', (e) => {
      if (S.phase !== 'playing') return;
      e.preventDefault();
      const i = idxAt(e.clientX);
      if (i === null) return;
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      dragging = true;
      target = !S.selected.has(S.hands[0][i].id);
      setSel(i, target);
      lastIdx = i;
      updatePlayBtn();
    });
    box.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const i = idxAt(e.clientX);
      if (i === null || i === lastIdx) return;
      const a = Math.min(lastIdx, i), b = Math.max(lastIdx, i);
      for (let k = a; k <= b; k++) setSel(k, target);
      lastIdx = i;
      updatePlayBtn();
    });
    const end = () => { dragging = false; lastIdx = -1; updatePlayBtn(); };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function humanAct() {
    return new Promise((resolve) => {
      S.resolve = resolve;
      S.humanTurn = true;
      renderActions();
    });
  }
  function submit(action) {
    if (!S.resolve) return;
    const r = S.resolve;
    S.resolve = null;
    S.humanTurn = false;
    renderActions();
    r(action);
  }

  function doHint() {
    if (!S.hintList) {
      S.hintList = hints(S.hands[0], S.last && S.last.info, { me: 0, landlord: S.landlord, counts: S.hands.map((h) => h.length) });
      S.hintIdx = 0;
    }
    if (!S.hintList.length) { toast('没有能大过的牌'); return; }
    const m = S.hintList[S.hintIdx % S.hintList.length];
    S.hintIdx++;
    S.selected = new Set(m.cards.map((c) => c.id));
    renderHand();
    updatePlayBtn();
  }

  function doPlay() {
    const cards = selectedCards();
    const info = classify(cards);
    if (!info) { toast('这不是有效的牌型'); return; }
    if (!canBeat(info, S.last && S.last.info)) { toast('压不过上家的牌'); return; }
    submit({ play: cards });
  }

  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act.startsWith('bid')) submit({ bid: Number(act.slice(3)) });
    else if (act === 'pass') submit({ pass: true });
    else if (act === 'hint') doHint();
    else if (act === 'play') doPlay();
    else if (act === 'again') newRound();
  });

  // ---------- 提示 ----------
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1300);
  }

  // ---------- 弹层 ----------
  function showPanel(html) {
    const o = $('overlay');
    o.innerHTML = '<div class="panel">' + html + '</div>';
    o.classList.remove('hidden');
  }
  function hideOverlay() {
    $('overlay').classList.add('hidden');
    S.paused = false;
    renderActions();
  }

  const RULES = '<details><summary>玩法说明</summary><ul>' +
    '<li>三人对战：一个地主对两个农民。地主多拿 3 张底牌并先出。</li>' +
    '<li>叫分：叫分最高者当地主，叫 3 分直接成为地主；无人叫分则重新发牌。</li>' +
    '<li>牌型：单张、对子、三张、三带一/二、顺子(5张起)、连对(3对起)、飞机、四带二、炸弹、火箭(双王)。</li>' +
    '<li>炸弹可压任何非炸弹牌，火箭最大。每出一个炸弹倍数翻倍，春天再翻倍。</li>' +
    '<li>操作：点牌，或在手牌上滑动来选牌，再点「出牌」。「提示」可连续点击切换方案。</li>' +
    '<li>结算：地主赢得 2×(底分×倍数)，农民赢各得 1×；输则相反。</li></ul></details>';

  function statsLine() {
    const rate = stats.games ? Math.round((100 * stats.wins) / stats.games) : 0;
    return '累计积分 ' + stats.score + ' · ' + stats.games + ' 局 · 胜率 ' + rate + '%';
  }

  function showStartMenu() {
    showPanel('<h1>斗地主</h1><p>人机对战 · 叫分抢地主</p><div class="stats">' + statsLine() + '</div>' +
      '<div class="btns"><button class="btn primary" type="button" data-act="start">开始游戏</button>' +
      '<a class="btn ghost" href="poker.html">玩德州扑克</a></div>' + RULES);
  }
  function showGameMenu() {
    S.paused = true;
    showPanel('<h2>菜单</h2><div class="stats">' + statsLine() + '</div><div class="btns">' +
      '<button class="btn primary" type="button" data-act="resume">继续游戏</button>' +
      '<button class="btn" type="button" data-act="restart">放弃本局，重新发牌</button>' +
      '<button class="btn ghost" type="button" data-act="resetScore">清空积分</button>' +
      '<a class="btn ghost" href="poker.html">玩德州扑克</a></div>' + RULES);
  }

  $('overlay').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'start' || act === 'restart' || act === 'again') { hideOverlay(); newRound(); }
    else if (act === 'resume' || act === 'review') hideOverlay();
    else if (act === 'resetScore') {
      stats = { score: 0, games: 0, wins: 0 };
      saveStats(); renderTop(); toast('积分已清空');
      hideOverlay();
    }
  });
  $('menuBtn').addEventListener('click', () => {
    if (S.phase === 'menu') return;
    showGameMenu();
  });

  // ---------- 对局流程 ----------
  async function newRound() {
    const gen = ++S.gen;
    const deck = shuffle(newDeck());
    Object.assign(S, {
      phase: 'bidding', paused: false, landlord: -1, bidMax: 0, bidder: -1, bids: [null, null, null],
      last: null, lastBy: -1, passes: 0, plays: [0, 0, 0], bombs: 0, base: 1,
      selected: new Set(), hintList: null, hintIdx: 0, humanTurn: false, resolve: null,
    });
    S.hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)].map(sortHand);
    S.bottom = deck.slice(51);
    S.turn = Math.floor(Math.random() * 3);
    clearAllPlayed();
    renderAll(true);
    await tick(650);
    if (S.gen !== gen) return;

    const start = S.turn;
    for (let i = 0; i < 3; i++) {
      const p = (start + i) % 3;
      S.turn = p;
      renderSeats();
      let v;
      if (p === 0) {
        const a = await humanAct();
        if (S.gen !== gen) return;
        v = a.bid;
      } else {
        await tick(700);
        if (S.gen !== gen) return;
        v = aiBid(S.hands[p], S.bidMax);
      }
      S.bids[p] = v;
      if (v > S.bidMax) { S.bidMax = v; S.bidder = p; }
      showTag(p, v ? '叫' + v + '分' : '不叫', v ? 'bid' : '');
      renderTop();
      if (v === 3) break;
      await tick(350);
      if (S.gen !== gen) return;
    }

    if (S.bidMax === 0) {
      toast('无人叫分，重新发牌', 1500);
      await tick(1600);
      if (S.gen === gen) newRound();
      return;
    }

    S.landlord = S.bidder;
    S.base = S.bidMax;
    S.hands[S.landlord] = sortHand(S.hands[S.landlord].concat(S.bottom));
    S.phase = 'playing';
    S.turn = S.landlord;
    clearAllPlayed();
    renderAll(S.landlord === 0);
    toast(NAMES[S.landlord] + '是地主', 1400);
    await tick(1200);
    if (S.gen === gen) playLoop(gen);
  }

  function applyPlay(p, cards) {
    const info = classify(cards);
    const ids = new Set(cards.map((c) => c.id));
    S.hands[p] = S.hands[p].filter((c) => !ids.has(c.id));
    S.last = { info, cards: sortHand(cards) };
    S.lastBy = p;
    S.passes = 0;
    S.plays[p]++;
    if (info.type === 'bomb' || info.type === 'rocket') {
      S.bombs++;
      toast(info.type === 'rocket' ? '火箭！倍数翻倍' : '炸弹！倍数翻倍', 1200);
    }
    showCards(p, S.last.cards);
    if (p === 0) { S.selected.clear(); renderHand(); }
    renderTop(); renderSeats();
  }

  async function playLoop(gen) {
    while (S.gen === gen && S.phase === 'playing') {
      const p = S.turn;
      clearPlayed(p);
      renderSeats();
      let act;
      if (p === 0) {
        S.hintList = null; S.hintIdx = 0;
        if (S.last && !hints(S.hands[0], S.last.info).length) {
          toast('没有能大过的牌', 1000);
          await tick(1100);
          act = { pass: true };
        } else {
          act = await humanAct();
        }
      } else {
        await tick(700 + Math.random() * 500);
        if (S.gen !== gen) return;
        const mv = aiPlay({
          hand: S.hands[p], last: S.last && S.last.info, lastBy: S.lastBy,
          me: p, landlord: S.landlord, counts: S.hands.map((h) => h.length),
        });
        act = mv ? { play: mv.cards } : { pass: true };
      }
      if (S.gen !== gen) return;

      if (act.play) {
        applyPlay(p, act.play);
        if (S.hands[p].length === 0) {
          await tick(700);
          if (S.gen === gen) endGame(p);
          return;
        }
      } else {
        showTag(p, '不要');
        S.passes++;
      }

      if (S.passes === 2) {
        await tick(700);
        if (S.gen !== gen) return;
        clearAllPlayed();
        S.last = null;
        S.passes = 0;
        S.turn = S.lastBy;
      } else {
        S.turn = (p + 1) % 3;
      }
    }
  }

  function endGame(winner) {
    S.phase = 'over';
    S.humanTurn = false;
    const L = S.landlord;
    const landlordWon = winner === L;
    const farmerPlays = S.plays[(L + 1) % 3] + S.plays[(L + 2) % 3];
    const spring = landlordWon && farmerPlays === 0;
    const antiSpring = !landlordWon && S.plays[L] === 1;
    const bombMult = Math.pow(2, S.bombs);
    const unit = S.base * bombMult * (spring || antiSpring ? 2 : 1);
    const iAmLandlord = L === 0;
    const iWon = iAmLandlord ? landlordWon : !landlordWon;
    const delta = (iAmLandlord ? 2 : 1) * unit * (iWon ? 1 : -1);

    stats.score += delta;
    stats.games += 1;
    if (iWon) stats.wins += 1;
    saveStats();

    // 亮出对手剩余的牌
    for (let p = 1; p < 3; p++) if (S.hands[p].length) showCards(p, S.hands[p], true);
    renderTop(); renderSeats();

    const parts = ['底分 ' + S.base];
    if (S.bombs) parts.push('炸弹 ×' + bombMult);
    if (spring) parts.push('春天 ×2');
    if (antiSpring) parts.push('反春天 ×2');
    const role = iAmLandlord ? '地主' : '农民';
    showPanel(
      '<h2 class="' + (iWon ? 'win' : 'lose') + '">' + (iWon ? '你赢了！' : '你输了') + '</h2>' +
      '<p>你是' + role + '，' + (landlordWon ? '地主' : '农民') + '获胜</p>' +
      '<p>' + parts.join(' · ') + '</p>' +
      '<div class="delta ' + (delta >= 0 ? 'pos' : 'neg') + '">' + (delta >= 0 ? '+' : '') + delta + '</div>' +
      '<div class="stats">' + statsLine() + '</div>' +
      '<div class="btns"><button class="btn primary" type="button" data-act="again">再来一局</button>' +
      '<button class="btn ghost" type="button" data-act="review">查看牌桌</button></div>'
    );
  }

  // ---------- 初始化 ----------
  function buildSeats() {
    const chars = ['我', '右', '左'];
    for (let p = 0; p < 3; p++) {
      $('seat' + p).innerHTML =
        '<div class="avatar"><span>' + chars[p] + '</span><em class="badge"></em></div>' +
        '<div class="meta"><span class="nm">' + NAMES[p] + '</span><span class="cnt"><i class="mb"></i><b>0</b></span></div>';
    }
  }

  buildSeats();
  bindHand();
  renderTop();
  renderSeats();
  showStartMenu();
  window.addEventListener('resize', () => renderHand());

  // 供自动化测试使用
  window.__ddz = { S, toggleCard: (i) => { setSel(i, !S.selected.has(S.hands[0][i].id)); updatePlayBtn(); } };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
