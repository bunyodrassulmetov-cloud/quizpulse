/*
 * Звуки игры без музыки и музыкальных инструментов.
 * Только природные и бытовые звуки, синтезированные в браузере (Web Audio API):
 * капли воды, всплеск, дождь, ветер, ручей, птицы, тиканье часов, стук по дереву, сердцебиение.
 * Никаких аудиофайлов — всё генерируется на лету.
 */
(function () {
  const rnd = (a, b) => a + Math.random() * (b - a);

  /** Набор звуков для любого AudioContext (живого или офлайн для проверки) */
  function createEngine(ctx, out) {
    const sr = ctx.sampleRate;
    const white = ctx.createBuffer(1, sr * 2, sr);
    {
      const d = white.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const brown = ctx.createBuffer(1, sr * 4, sr);
    {
      const d = brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const noise = (buf = white) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      return s;
    };
    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type, freq, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    /** Огибающая: быстрая атака и экспоненциальное затухание */
    const env = (g, t, attack, peak, decay) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    };

    /** Капля воды: пузырёк, тон которого быстро растёт */
    function drop(t, f = 800, vol = 0.4, dur = 0.12, rise = 2.2) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * rise, t + dur * 0.7);
      const g = gain(0);
      env(g, t, 0.004, vol, dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    /** Тиканье механических часов */
    function tick(t, tock = false, vol = 0.4) {
      const s = noise();
      const bp = filter('bandpass', tock ? 1700 : 2500, 9);
      const hp = filter('highpass', 900, 0.7);
      const g = gain(0);
      env(g, t, 0.0015, vol * (tock ? 10 : 6), 0.04);
      s.connect(bp).connect(hp).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + 0.07);
    }

    /** Стук по дереву: короткий импульс через резонансы деревянной доски */
    function knock(t, f = 520, vol = 0.5) {
      const s = noise();
      const hit = gain(0);
      env(hit, t, 0.001, 1, 0.01);
      const mix = gain(vol * 22);
      [
        [f, 16, 1],
        [f * 2.3, 12, 0.5],
        [f * 3.9, 9, 0.25],
      ].forEach(([ff, q, lvl]) => {
        hit.connect(filter('bandpass', ff, q)).connect(gain(lvl)).connect(mix);
      });
      s.connect(hit);
      mix.connect(out);
      s.start(t, Math.random());
      s.stop(t + 0.35);
    }

    /** Глухой удар (сердце, падение) */
    function thump(t, vol = 0.7, f = 105) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.42, t + 0.13);
      const g = gain(0);
      env(g, t, 0.006, vol, 0.2);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
      // немного шума, чтобы удар был слышен и на маленьких динамиках
      const s = noise(brown);
      const g2 = gain(0);
      env(g2, t, 0.004, vol * 0.9, 0.09);
      s.connect(filter('lowpass', 420, 0.7)).connect(g2).connect(out);
      s.start(t, Math.random() * 3);
      s.stop(t + 0.2);
    }

    function heartbeat(t, vol = 0.7) {
      thump(t, vol);
      thump(t + 0.19, vol * 0.7, 95);
    }

    /** Порыв ветра */
    function whoosh(t, dur = 0.9, f1 = 300, f2 = 1600, vol = 0.3) {
      const s = noise();
      const bp = filter('bandpass', f1, 1.1);
      bp.frequency.setValueAtTime(f1, t);
      bp.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.65);
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, f1 * 1.1), t + dur);
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * 2.8, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bp).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + dur + 0.05);
    }

    /** Всплеск воды */
    function splash(t, vol = 0.5) {
      const s = noise();
      const lp = filter('lowpass', 4500, 0.6);
      lp.frequency.setValueAtTime(4500, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 0.45);
      const g = gain(0);
      env(g, t, 0.006, vol * 0.55, 0.45);
      s.connect(lp).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + 0.6);
      for (let i = 0; i < 8; i++) drop(t + rnd(0.03, 0.35), rnd(450, 1300), vol * rnd(0.25, 0.55), rnd(0.07, 0.13), rnd(1.8, 2.6));
    }

    /** Дождь из капель */
    function rain(t, dur = 3, rate = 22, vol = 0.35) {
      const n = Math.round(dur * rate);
      for (let i = 0; i < n; i++) {
        const k = Math.random();
        const fade = Math.sin(Math.PI * Math.min(1, k * 1.15)); // нарастает и стихает
        drop(t + k * dur, rnd(900, 2700), vol * rnd(0.2, 0.6) * (0.3 + 0.7 * fade), rnd(0.04, 0.09), rnd(1.6, 2.6));
      }
      const s = noise();
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * 0.12, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(filter('highpass', 1400, 0.5)).connect(filter('lowpass', 7000, 0.5)).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + dur + 0.05);
    }

    /** Птица: несколько коротких щебечущих посвистов, иногда трель */
    function chirp(t, base, vol) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.45, t + 0.035);
      o.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.075);
      const g = gain(0);
      env(g, t, 0.012, vol, 0.075);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.11);
    }
    function trill(t, base, vol, dur = 0.35) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rnd(24, 34);
      const depth = gain(base * 0.12);
      lfo.connect(depth).connect(o.frequency);
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.02);
      lfo.stop(t + dur + 0.02);
    }
    function bird(t, vol = 0.12) {
      const base = rnd(2600, 4300);
      const n = 2 + Math.floor(Math.random() * 4);
      let tt = t;
      for (let i = 0; i < n; i++) {
        chirp(tt, base * rnd(0.92, 1.08), vol * rnd(0.7, 1));
        tt += rnd(0.09, 0.16);
      }
      if (Math.random() < 0.4) trill(tt + 0.05, base * 1.1, vol * 0.7);
    }
    function birds(t, dur = 4, count = 6, vol = 0.12) {
      for (let i = 0; i < count; i++) bird(t + Math.random() * dur, vol * rnd(0.6, 1));
    }

    /** Журчание ручья (фон лобби). Возвращает функцию остановки. */
    function stream(vol = 0.2) {
      const t = ctx.currentTime;
      const bus = gain(0);
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.exponentialRampToValueAtTime(1, t + 1.5);
      bus.connect(out);
      const s1 = noise(brown);
      s1.connect(filter('lowpass', 1000, 0.5)).connect(gain(vol * 0.8)).connect(bus);
      const s2 = noise();
      const g2 = gain(vol * 0.05);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.35;
      lfo.connect(gain(vol * 0.035)).connect(g2.gain);
      s2.connect(filter('bandpass', 1900, 0.8)).connect(g2).connect(bus);
      s1.start(t, Math.random() * 3);
      s2.start(t, Math.random());
      lfo.start(t);
      // мелкие пузырьки
      const bubble = () => {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) drop(ctx.currentTime + rnd(0.01, 0.12), rnd(380, 1100), vol * rnd(0.12, 0.35), rnd(0.035, 0.07), rnd(1.6, 2.2));
      };
      const bubbleTimer = setInterval(bubble, 140);
      let birdTimer = 0;
      const birdLoop = () => {
        birdTimer = setTimeout(() => {
          bird(ctx.currentTime + 0.02, vol * 0.45);
          birdLoop();
        }, rnd(2500, 7000));
      };
      birdLoop();
      return function stop() {
        clearInterval(bubbleTimer);
        clearTimeout(birdTimer);
        const now = ctx.currentTime;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now);
        bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
        [s1, s2, lfo].forEach((n) => n.stop(now + 0.9));
      };
    }

    return { drop, tick, knock, thump, heartbeat, whoosh, splash, rain, bird, birds, stream };
  }

  // ---------------- Живое воспроизведение ----------------

  const KEY = 'qp-muted';
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === '1';
  } catch (e) { /* нет доступа к хранилищу */ }

  let ctx = null;
  let master = null;
  let eng = null;
  let ambienceWanted = false;
  let ambienceStop = null;
  const listeners = new Set();

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      eng = createEngine(ctx, master);
      ctx.addEventListener('statechange', syncAmbience);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Браузеры разрешают звук только после действия пользователя — «размораживаем» при первом касании
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) => addEventListener(ev, ensure, { capture: true, passive: true }));

  const ready = () => !muted && ctx && ctx.state === 'running';
  const at = (d = 0) => ctx.currentTime + 0.01 + d;
  function play(fn) {
    if (!ready()) return;
    try {
      fn(eng, at);
    } catch (e) { /* звук не критичен */ }
  }

  function syncAmbience() {
    const shouldPlay = ambienceWanted && ready();
    if (shouldPlay && !ambienceStop) ambienceStop = eng.stream(0.2);
    if (!shouldPlay && ambienceStop) {
      ambienceStop();
      ambienceStop = null;
    }
  }

  let lastAnswerSound = 0;

  const Sound = {
    createEngine,
    isMuted: () => muted,
    state: () => (ctx ? ctx.state : 'none'),
    setMuted(v) {
      muted = !!v;
      try {
        localStorage.setItem(KEY, muted ? '1' : '0');
      } catch (e) { /* ignore */ }
      if (!muted) ensure();
      syncAmbience();
      listeners.forEach((fn) => fn(muted));
    },
    toggle() {
      Sound.setMuted(!muted);
      return muted;
    },
    onChange(fn) {
      listeners.add(fn);
    },
    /** Фон лобби: журчание ручья и птицы */
    ambience(on) {
      ambienceWanted = !!on;
      syncAmbience();
    },

    // --- игровые события ---
    join: () => play((e, t) => e.drop(t(), rnd(650, 1050), 0.4, 0.11)),
    tap: () => play((e, t) => e.drop(t(), 900, 0.45, 0.1, 2)),
    start: () => play((e, t) => {
      e.knock(t(), 560, 0.5);
      e.knock(t(0.14), 560, 0.45);
      e.whoosh(t(0.1), 1.1, 250, 1400, 0.28);
    }),
    questionIn: () => play((e, t) => e.whoosh(t(), 1.0, 240, 1500, 0.26)),
    go: () => play((e, t) => e.knock(t(), 620, 0.5)),
    /** Тиканье каждую секунду; в последние 5 секунд — громче и с сердцебиением */
    second(left) {
      play((e, t) => {
        if (left <= 5 && left > 0) {
          e.tick(t(), false, 0.55);
          e.heartbeat(t(0.02), 0.55 + (5 - left) * 0.06);
        } else if (left > 0) e.tick(t(), left % 2 === 0, 0.32);
      });
    },
    answerIn() {
      const now = performance.now();
      if (now - lastAnswerSound < 110) return;
      lastAnswerSound = now;
      play((e, t) => e.drop(t(), rnd(1100, 1700), 0.25, 0.08, 1.9));
    },
    timeUp: () => play((e, t) => {
      e.knock(t(), 460, 0.6);
      e.knock(t(0.17), 460, 0.55);
    }),
    reveal: () => play((e, t) => e.splash(t(0.05), 0.5)),
    correct: () => play((e, t) => {
      e.drop(t(), 620, 0.5, 0.1, 2);
      e.drop(t(0.13), 880, 0.55, 0.12, 2.2);
      e.drop(t(0.24), 1150, 0.4, 0.1, 2.2);
    }),
    wrong: () => play((e, t) => {
      e.knock(t(), 210, 0.7);
      e.thump(t(0.01), 0.45, 80);
    }),
    timeout: () => play((e, t) => e.whoosh(t(), 0.8, 1100, 260, 0.5)),
    leaderboard: (rows) => play((e, t) => {
      e.whoosh(t(), 0.7, 300, 1200, 0.2);
      for (let i = 0; i < rows; i++) e.drop(t(0.3 + i * 0.09), rnd(700, 1200), 0.3, 0.09);
    }),
    /** Пьедестал: удары при появлении 3-го, 2-го и 1-го места, затем дождь из капель и птицы */
    podium: () => play((e, t) => {
      e.whoosh(t(0.2), 0.9, 200, 900, 0.18);
      e.thump(t(1.1), 0.7);
      e.whoosh(t(0.8), 0.9, 220, 1100, 0.2);
      e.thump(t(1.7), 0.8);
      e.whoosh(t(1.4), 0.9, 240, 1400, 0.24);
      e.thump(t(2.3), 0.95);
      e.rain(t(2.3), 4, 24, 0.4);
      e.birds(t(2.6), 5, 8, 0.14);
    }),
    celebrate: () => play((e, t) => {
      e.rain(t(), 3, 22, 0.4);
      e.birds(t(0.3), 3.5, 5, 0.13);
    }),
    finish: () => play((e, t) => e.splash(t(), 0.45)),
  };

  window.QPSound = Sound;
})();
