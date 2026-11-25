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

    /** Бубен-дафф: «дум» — низкий удар в центр, «тек» — звонкий удар по краю */
    function duff(t, kind = 'dum', vol = 0.6) {
      if (kind === 'dum') {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(98, t);
        o.frequency.exponentialRampToValueAtTime(62, t + 0.2);
        const g = gain(0);
        env(g, t, 0.004, vol, 0.38);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.45);
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(215, t);
        o2.frequency.exponentialRampToValueAtTime(170, t + 0.12);
        const g2 = gain(0);
        env(g2, t, 0.003, vol * 0.35, 0.14);
        o2.connect(g2).connect(out);
        o2.start(t);
        o2.stop(t + 0.2);
        const s = noise();
        const g3 = gain(0);
        env(g3, t, 0.002, vol * 0.9, 0.05);
        s.connect(filter('lowpass', 700, 0.7)).connect(g3).connect(out);
        s.start(t, Math.random());
        s.stop(t + 0.08);
      } else {
        const s = noise();
        const g = gain(0);
        env(g, t, 0.0015, vol * 2.6, 0.065);
        s.connect(filter('bandpass', rnd(1900, 2500), 1.6)).connect(g).connect(out);
        s.start(t, Math.random());
        s.stop(t + 0.09);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(390, t);
        o.frequency.exponentialRampToValueAtTime(320, t + 0.06);
        const g2 = gain(0);
        env(g2, t, 0.002, vol * 0.35, 0.07);
        o.connect(g2).connect(out);
        o.start(t);
        o.stop(t + 0.1);
      }
    }

    /** Барабанная дробь на даффе: удары учащаются и становятся громче */
    function roll(t, dur = 2.2, vol = 0.5) {
      let tt = t;
      let i = 0;
      while (tt < t + dur - 0.02) {
        const k = (tt - t) / dur;
        const accent = i % 6 === 0;
        const v = vol * (0.22 + 0.78 * k * k) * (i % 2 ? 0.82 : 1);
        duff(tt + rnd(-0.004, 0.004), accent ? 'dum' : 'tek', accent ? v * 0.8 : v);
        tt += 1 / (8 + 18 * k);
        i += 1;
      }
    }

    /** Финальный удар после дроби */
    function bigHit(t, vol = 0.9) {
      duff(t, 'dum', vol * 0.55);
      duff(t, 'tek', vol * 0.38);
      thump(t, vol * 0.45, 88);
    }

    /** Рык льва (синтез: «голос» с дрожанием, хрипом и формантами) */
    function roar(t, vol = 0.8, dur = 2.4) {
      const bus = gain(0);
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.exponentialRampToValueAtTime(vol, t + 0.22);
      bus.gain.setValueAtTime(vol, t + 0.85);
      bus.gain.exponentialRampToValueAtTime(vol * 0.55, t + 1.5);
      bus.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      bus.connect(out);

      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(88, t);
      o.frequency.linearRampToValueAtTime(150, t + 0.32);
      o.frequency.linearRampToValueAtTime(132, t + 1.0);
      o.frequency.exponentialRampToValueAtTime(62, t + dur);
      const jit = noise(brown);
      jit.connect(filter('lowpass', 45, 0.7)).connect(gain(30)).connect(o.frequency);

      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(3.2 * x);
      }
      ws.curve = curve;

      // хрип: быстрая амплитудная модуляция
      const growl = gain(0.55);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(24, t);
      lfo.frequency.linearRampToValueAtTime(33, t + dur);
      lfo.connect(gain(0.45)).connect(growl.gain);

      o.connect(ws).connect(growl);
      const breath = noise();
      breath.connect(filter('bandpass', 900, 0.6)).connect(gain(0.9)).connect(growl);

      // форманты «а-о-у»
      const f1 = filter('bandpass', 760, 2.2);
      f1.frequency.setValueAtTime(760, t);
      f1.frequency.linearRampToValueAtTime(480, t + dur);
      const f2 = filter('bandpass', 1250, 2.8);
      f2.frequency.setValueAtTime(1250, t);
      f2.frequency.linearRampToValueAtTime(820, t + dur);
      const f3 = filter('bandpass', 2500, 3.5);
      growl.connect(f1).connect(gain(1.15)).connect(bus);
      growl.connect(f2).connect(gain(0.7)).connect(bus);
      growl.connect(f3).connect(gain(0.3)).connect(bus);
      growl.connect(filter('lowpass', 300, 0.7)).connect(gain(0.27)).connect(bus);

      // грудной низ
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(58, t);
      sub.frequency.exponentialRampToValueAtTime(38, t + dur);
      sub.connect(gain(0.16)).connect(bus);

      [o, jit, lfo, breath, sub].forEach((n) => {
        n.start(t);
        n.stop(t + dur + 0.05);
      });
    }

    /** Яркий «звёздный» дождь из высоких капель */
    function sparkle(t, dur = 1.6, vol = 0.4) {
      for (let i = 0; i < 46; i++) {
        const k = Math.random();
        drop(t + k * dur, rnd(1600, 4200), vol * rnd(0.25, 0.6) * (1 - k * 0.6), rnd(0.03, 0.07), rnd(1.4, 2.2));
      }
    }

    return { drop, tick, knock, thump, heartbeat, whoosh, splash, rain, bird, birds, stream, duff, roll, bigHit, roar, sparkle };
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

  // Отдельная шина для пьедестала: при пропуске анимации её можно мгновенно заглушить
  let podBus = null;
  let podEng = null;
  function podium(fn) {
    if (!ready()) return;
    if (!podBus) {
      podBus = ctx.createGain();
      podBus.connect(master);
      podEng = createEngine(ctx, podBus);
    }
    try {
      fn(podEng, at);
    } catch (e) { /* звук не критичен */ }
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
    /** Пьедестал: барабанная дробь перед объявлением места */
    podiumRoll: (ms, place) => podium((e, t) => e.roll(t(), ms / 1000, place === 1 ? 0.6 : 0.5)),
    /** Объявление места: удар; для 1-го места — рык льва и яркий звёздный дождь */
    podiumHit: (place) => podium((e, t) => {
      e.bigHit(t(), place === 1 ? 1 : 0.85);
      if (place === 1) {
        e.roar(t(0.08), 0.85, 2.4);
        e.sparkle(t(0.15), 1.8, 0.45);
        e.rain(t(1.2), 3.5, 26, 0.4);
        e.birds(t(1.8), 4, 7, 0.14);
      } else {
        e.sparkle(t(0.05), 0.9, 0.3);
      }
    }),
    podiumCancel() {
      if (!podBus || !ctx) return;
      const bus = podBus;
      podBus = null;
      podEng = null;
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + 0.12);
      setTimeout(() => bus.disconnect(), 300);
    },
    /** Телефон участника: его место объявлено */
    placeReveal: (rank) => play((e, t) => {
      if (rank > 3) return e.splash(t(), 0.45);
      e.bigHit(t(), 0.8);
      e.sparkle(t(0.05), 1.2, 0.4);
      if (rank === 1) e.roar(t(0.08), 0.7, 2.2);
    }),
    finish: () => play((e, t) => e.splash(t(), 0.45)),
  };

  window.QPSound = Sound;
})();
