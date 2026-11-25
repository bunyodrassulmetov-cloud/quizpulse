/* Общие утилиты для экранов ведущего и участника */
(function () {
  const LETTERS = ['A', 'B', 'C', 'D'];

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function toast(msg, isErr) {
    let wrap = $('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function emit(socket, event, payload) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, error: window.QPI18N.t('conn.noAnswer') });
        else resolve(res || { ok: false, error: window.QPI18N.t('conn.noAnswer') });
      });
    });
  }

  /** Баннер о потере соединения */
  function watchConnection(socket) {
    let banner = null;
    const show = () => {
      if (banner) return;
      banner = document.createElement('div');
      banner.className = 'conn-banner';
      banner.textContent = window.QPI18N.t('conn.lost');
      document.body.appendChild(banner);
    };
    const hide = () => {
      if (banner) banner.remove();
      banner = null;
    };
    socket.on('disconnect', show);
    socket.on('connect', hide);
  }

  /**
   * Обратный отсчёт: вызывает onTick(оставшиеся_мс, доля) на каждом кадре.
   * Возвращает функцию остановки.
   */
  function countdown(remainingMs, totalMs, onTick) {
    const end = performance.now() + remainingMs;
    let raf = 0;
    const loop = () => {
      const left = Math.max(0, end - performance.now());
      onTick(left, totalMs ? left / totalMs : 0);
      if (left > 0) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }

  function ringSVG() {
    const r = 52;
    const c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="${r}"/><circle class="fg" cx="60" cy="60" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="0"/></svg><div class="num">0</div>`;
  }
  function updateRing(el, leftMs, frac) {
    if (!el) return;
    const r = 52;
    const c = 2 * Math.PI * r;
    const fg = el.querySelector('.fg');
    if (fg) fg.style.strokeDashoffset = String(c * (1 - frac));
    const num = el.querySelector('.num');
    if (num) num.textContent = String(Math.ceil(leftMs / 1000));
    el.classList.toggle('warn', leftMs <= 5000);
  }

  /** Небольшое конфетти без библиотек */
  function confetti(durationMs = 4500) {
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
    };
    resize();
    addEventListener('resize', resize);
    const colors = ['#c8ff3e', '#7c5cff', '#ff4f81', '#13b3d4', '#ff9a1f', '#ffffff'];
    const parts = Array.from({ length: 180 }, () => ({
      x: Math.random() * cv.width,
      y: -Math.random() * cv.height * 0.6,
      w: (6 + Math.random() * 8) * dpr,
      h: (8 + Math.random() * 10) * dpr,
      vy: (2 + Math.random() * 4) * dpr,
      vx: (Math.random() - 0.5) * 2 * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
    }));
    const start = performance.now();
    const tick = (t) => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      const fade = Math.max(0, 1 - (t - start - durationMs + 1200) / 1200);
      ctx.globalAlpha = Math.min(1, fade);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > cv.height) {
          p.y = -20;
          p.x = Math.random() * cv.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t - start < durationMs) requestAnimationFrame(tick);
      else {
        removeEventListener('resize', resize);
        cv.remove();
      }
    };
    requestAnimationFrame(tick);
  }

  /** Плавный счётчик чисел */
  function animateNumber(el, from, to, ms = 900) {
    if (!el) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString('ru-RU');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  const BRAND_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22"/></svg>';

  const svg = (body) =>
    `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    soundOn: svg('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
    soundOff: svg('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
    fullscreen: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    cross: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    phone: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
    play: svg('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
    next: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
    flame: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-4 3 0-2-1-4-3-6 0 4-3 6-3 11 0 5 3 8 7 8z"/>'),
  };

  /** Инициалы для аватара: первые буквы двух первых слов */
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const first = (w) => (Array.from(w)[0] || '').toUpperCase();
    if (!parts.length) return '?';
    return parts.length > 1 ? first(parts[0]) + first(parts[1]) : first(parts[0]);
  }
  /** Аватар участника — цветной кружок с инициалами */
  const avatar = (name, color, extraClass = '') =>
    `<span class="avatar c${Number(color) % 10 || 0} ${extraClass}" aria-hidden="true">${esc(initials(name))}</span>`;

  /**
   * Сценарий пьедестала (мс от начала экрана итогов): барабанная дробь и объявление
   * 3-го, затем 2-го и в конце 1-го места. Общий для ведущего и телефонов.
   */
  function podiumTimeline(count) {
    const places = [3, 2, 1].filter((p) => p <= count);
    let t = 1200;
    const steps = places.map((place) => {
      const roll = place === 1 ? 3200 : 2200;
      const step = { place, rollAt: t, roll, hitAt: t + roll };
      t += roll + (place === 1 ? 0 : 900);
      return step;
    });
    return { steps, endAt: t + 1800 };
  }

  /** Текст ошибки сервера на языке интерфейса (по коду ошибки) */
  function errText(res) {
    const I = window.QPI18N;
    if (res && res.code && I.has('err.' + res.code)) return I.t('err.' + res.code);
    return (res && res.error) || I.t('conn.noAnswer');
  }
  /** Текст варианта ответа: «Верно/Неверно» — на языке интерфейса */
  function answerText(q, i) {
    if (q && q.type === 'truefalse') return window.QPI18N.t(i === 0 ? 'true' : 'false');
    return q && q.answers ? q.answers[i] : '';
  }

  window.QP = { errText, answerText, podiumTimeline, LETTERS, esc, $, $$, toast, emit, watchConnection, countdown, ringSVG, updateRing, confetti, animateNumber, fmt, BRAND_SVG, ICONS, avatar, initials };
})();
