/* 音效与背景音乐：全部用 Web Audio 现场合成，无需音频文件，可离线使用 */
(function (root) {
  'use strict';
  let ctx = null, master = null, musicGain = null, noiseBuf = null;
  const S = { sfx: true, music: false };

  function getCtx() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; return null; }
    master = ctx.createGain();
    master.gain.value = 0.75;
    if (ctx.createDynamicsCompressor) {
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    } else master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /** 必须在用户手势（点击/触摸）里调用一次，浏览器才允许出声 */
  function unlock() {
    if (!S.sfx && !S.music) return;
    const c = getCtx();
    if (c && c.state === 'suspended' && c.resume) { try { c.resume(); } catch (e) { /* ignore */ } }
  }

  // ---------- 基本发声单元 ----------
  function tone(freq, dur, o) {
    o = o || {};
    const c = ctx;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const atk = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(o.dest || master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function noise(dur, o) {
    o = o || {};
    const c = ctx;
    const t = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    f.Q.value = o.q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  const rnd = Math.random;
  function chips(n, vol, at0) {
    for (let i = 0; i < n; i++) {
      const at = (at0 || 0) + i * 0.05 + rnd() * 0.015;
      const f = 2100 + rnd() * 900;
      tone(f, 0.07, { type: 'triangle', vol: (vol || 0.13) * (0.8 + rnd() * 0.4), at });
      tone(f * 1.5, 0.035, { type: 'sine', vol: (vol || 0.13) * 0.5, at });
      noise(0.03, { filter: 'highpass', f0: 5200, vol: (vol || 0.13) * 0.7, at });
    }
  }

  // ---------- 音效库 ----------
  const SOUNDS = {
    click() { tone(1000, 0.035, { type: 'triangle', vol: 0.07 }); },
    deal(n) {
      const k = n || 1;
      for (let i = 0; i < k; i++) {
        noise(0.06, { filter: 'bandpass', f0: 3200, f1: 1600, q: 0.9, vol: 0.3, at: i * 0.075 });
        tone(260, 0.04, { type: 'sine', vol: 0.05, at: i * 0.075 });
      }
    },
    flip(n) {
      const k = n || 1;
      for (let i = 0; i < k; i++) {
        noise(0.09, { filter: 'bandpass', f0: 1900, f1: 900, q: 0.8, vol: 0.28, at: i * 0.11 });
        tone(240, 0.05, { type: 'sine', vol: 0.07, at: i * 0.11 });
      }
    },
    check() {
      tone(170, 0.12, { vol: 0.34, slide: 85 });
      noise(0.04, { filter: 'lowpass', f0: 500, vol: 0.2 });
      tone(170, 0.12, { vol: 0.28, slide: 85, at: 0.1 });
      noise(0.04, { filter: 'lowpass', f0: 500, vol: 0.16, at: 0.1 });
    },
    fold() { noise(0.2, { filter: 'bandpass', f0: 2600, f1: 600, q: 0.7, vol: 0.2 }); },
    call() { chips(2, 0.13); },
    raise() { chips(5, 0.14); tone(520, 0.12, { type: 'triangle', vol: 0.05, at: 0.02, slide: 700 }); },
    allin() {
      tone(95, 0.3, { vol: 0.4, slide: 48 });
      chips(10, 0.15, 0.03);
    },
    turn() {
      tone(880, 0.18, { vol: 0.13 });
      tone(1320, 0.24, { vol: 0.09, at: 0.07 });
    },
    award() { chips(6, 0.12); },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.38, { type: 'triangle', vol: 0.18, at: i * 0.095 }));
      tone(1046.5 * 2, 0.5, { vol: 0.05, at: 0.3 });
      chips(5, 0.1, 0.35);
    },
    lose() {
      tone(330, 0.28, { vol: 0.16, type: 'triangle' });
      tone(262, 0.4, { vol: 0.15, type: 'triangle', at: 0.2 });
    },
  };

  function play(name, arg) {
    if (!S.sfx) return;
    const c = getCtx();
    if (!c || c.state === 'closed') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    try { fn(arg); } catch (e) { /* 音频失败不影响游戏 */ }
  }

  // ---------- 背景音乐：缓慢的和弦垫底 + 稀疏的钟声，循环生成 ----------
  const CHORDS = [
    [261.63, 329.63, 392.0, 493.88], // Cmaj7
    [220.0, 261.63, 329.63, 392.0],  // Am7
    [293.66, 349.23, 440.0, 523.25], // Dm7
    [196.0, 246.94, 293.66, 349.23], // G7
  ];
  const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  const CHORD_LEN = 4.2;
  let musicTimer = null, nextAt = 0, chordIdx = 0;

  function scheduleChord(t0) {
    const ch = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    ch.forEach((f, i) => {
      const t = t0 + i * 0.05;
      tone(f, CHORD_LEN + 1.2, { type: 'sine', vol: 0.045, attack: 1.2, at: t - ctx.currentTime, dest: musicGain });
    });
    tone(ch[0] / 2, CHORD_LEN + 0.6, { type: 'sine', vol: 0.07, attack: 0.6, at: t0 - ctx.currentTime, dest: musicGain });
    const nb = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < nb; i++) {
      const f = BELLS[Math.floor(rnd() * BELLS.length)];
      tone(f, 1.6, { type: 'triangle', vol: 0.035, attack: 0.01, at: t0 - ctx.currentTime + 0.6 + rnd() * (CHORD_LEN - 1), dest: musicGain });
    }
  }

  function musicTick() {
    if (!ctx || !S.music) return;
    if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.1;
    while (nextAt < ctx.currentTime + 6) {
      scheduleChord(nextAt);
      nextAt += CHORD_LEN;
    }
  }

  function startMusic() {
    const c = getCtx();
    if (!c || musicTimer) return;
    musicGain.gain.cancelScheduledValues(c.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, c.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.9, c.currentTime + 1.5);
    nextAt = 0;
    musicTick();
    musicTimer = setInterval(musicTick, 1000);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (ctx && musicGain) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    }
  }

  function setSfx(on) { S.sfx = !!on; if (on) unlock(); }
  function setMusic(on) {
    S.music = !!on;
    if (on) { unlock(); startMusic(); } else stopMusic();
  }

  // 页面切到后台时静音，回来再恢复
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      try {
        if (root.document.hidden) ctx.suspend && ctx.suspend();
        else if (S.sfx || S.music) ctx.resume && ctx.resume();
      } catch (e) { /* ignore */ }
    });
  }

  root.SFX = { play, unlock, setSfx, setMusic, state: S, _sounds: SOUNDS };
})(typeof self !== 'undefined' ? self : this);
