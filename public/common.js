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
        if (err) resolve({ ok: false, error: 'Нет ответа от сервера' });
        else resolve(res || { ok: false, error: 'Пустой ответ' });
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
      banner.textContent = 'Нет соединения с сервером — переподключаемся…';
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

  window.QP = { LETTERS, esc, $, $$, toast, emit, watchConnection, countdown, ringSVG, updateRing, confetti, animateNumber, fmt, BRAND_SVG };
})();
