/* Экран участника */
(function () {
  const { LETTERS, esc, $, toast, emit, watchConnection, countdown, fmt, confetti, BRAND_SVG, ICONS, avatar, podiumTimeline } = window.QP;
  const Sound = window.QPSound;
  $('#brandMark').innerHTML = BRAND_SVG;

  const app = $('#app');
  const footer = $('#footer');
  const pinPill = $('#pinPill');
  const STORE = 'qp-player';

  const socket = io({ transports: ['websocket', 'polling'] });
  watchConnection(socket);

  let screen = 'pin';
  let pin = '';
  let roomTitle = '';
  let state = null;
  let renderedKey = '';
  let stopTimer = null;
  let sending = false;
  let booting = false;
  let soundPhase = '';

  const loadSession = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch (e) {
      return null;
    }
  };
  const saveSession = (s) => {
    try {
      if (s) localStorage.setItem(STORE, JSON.stringify(s));
      else localStorage.removeItem(STORE);
    } catch (e) { /* приватный режим */ }
  };

  // ---------- Вход ----------

  function renderPin(prefill = '', error = '') {
    screen = 'pin';
    renderedKey = '';
    footer.hidden = true;
    pinPill.hidden = true;
    app.innerHTML = `
      <div class="center fade-in">
        <div class="card join-card">
          <h1>Войти в игру</h1>
          <p class="muted" style="margin:0">Введите PIN с экрана ведущего или отсканируйте QR-код</p>
          <form id="pinForm" style="display:grid;gap:12px">
            <input class="input pin-input" id="pinInput" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="000000" value="${esc(prefill)}" aria-label="PIN игры" />
            ${error ? `<div style="color:#ffb3b5;font-weight:700">${esc(error)}</div>` : ''}
            <button class="btn btn-primary btn-lg" type="submit">Далее</button>
          </form>
        </div>
        <p class="host-link">Хотите провести свою викторину? <a href="/host">Стать ведущим →</a></p>
      </div>`;
    const input = $('#pinInput');
    input.addEventListener('input', () => (input.value = input.value.replace(/\D/g, '').slice(0, 6)));
    $('#pinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      checkPin(input.value);
    });
    if (!prefill) input.focus();
  }

  async function checkPin(value) {
    const clean = String(value || '').replace(/\D/g, '');
    if (clean.length !== 6) return renderPin(clean, 'PIN состоит из 6 цифр');
    const res = await emit(socket, 'room:check', { pin: clean });
    if (!res.ok) return renderPin(clean, res.error);
    pin = clean;
    roomTitle = res.title;
    renderName();
  }

  function renderName(error = '') {
    screen = 'name';
    footer.hidden = true;
    pinPill.hidden = false;
    pinPill.textContent = `PIN ${pin}`;
    const prevName = (loadSession() || {}).lastName || '';
    app.innerHTML = `
      <div class="center fade-in">
        <div class="card join-card">
          <div class="muted" style="font-weight:700">Игра</div>
          <h1 style="margin-top:-8px">${esc(roomTitle)}</h1>
          <form id="nameForm" style="display:grid;gap:14px">
            <div>
              <label class="label" for="nameInput">Ваше имя</label>
              <input class="input" id="nameInput" maxlength="20" autocomplete="nickname" placeholder="Например, Аня" value="${esc(prevName)}" />
            </div>
            ${error ? `<div style="color:#ffb3b5;font-weight:700">${esc(error)}</div>` : ''}
            <button class="btn btn-primary btn-lg" type="submit">Поехали!</button>
          </form>
        </div>
        <button class="btn btn-ghost btn-sm" id="backBtn">← Другой PIN</button>
      </div>`;
    $('#backBtn').addEventListener('click', () => {
      history.replaceState(null, '', '/');
      renderPin();
    });
    $('#nameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#nameInput').value.trim();
      if (!name) return renderName('Введите имя');
      const btn = e.submitter || app.querySelector('button[type=submit]');
      btn.disabled = true;
      const res = await emit(socket, 'player:join', { pin, name });
      if (!res.ok) return renderName(res.error);
      saveSession({ pin, token: res.token, lastName: name });
      history.replaceState(null, '', `/join?pin=${pin}`);
      screen = 'game';
    });
    const ni = $('#nameInput');
    ni.focus();
    ni.setSelectionRange(ni.value.length, ni.value.length);
  }

  // ---------- Игра ----------

  function renderFooter() {
    if (!state || !state.me) return (footer.hidden = true);
    footer.hidden = false;
    footer.innerHTML = `${avatar(state.me.name, state.me.color)}<span class="name">${esc(state.me.name)}</span>
      <button class="sound-btn" id="soundBtn" aria-label="${Sound.isMuted() ? 'Включить звук' : 'Выключить звук'}">${Sound.isMuted() ? ICONS.soundOff : ICONS.soundOn}</button>
      <span class="score">${fmt(state.me.score)}</span>`;
    $('#soundBtn').addEventListener('click', () => {
      Sound.toggle();
      renderFooter();
    });
  }

  /** Звуки на телефоне — один раз при смене экрана */
  function phaseSound(s) {
    const key = `${s.phase}|${s.qIndex}`;
    if (key === soundPhase) return;
    soundPhase = key;
    switch (s.phase) {
      case 'lobby':
        Sound.join();
        break;
      case 'preview':
        Sound.questionIn();
        break;
      case 'reveal': {
        const c = s.result && s.result.correct;
        if (c === true) Sound.correct();
        else if (c === false) Sound.wrong();
        else Sound.timeout();
        break;
      }
      default:
    }
  }

  function rankLine(s) {
    const r = s.result;
    if (!s.me.rank) return '';
    if (s.me.rank === 1) return 'Вы на <b>1 месте</b> — так держать!';
    return `Вы на <b>${s.me.rank} месте</b>${r && r.aheadName ? ` · до «${esc(r.aheadName)}» ${fmt(r.gap)} очк.` : ''}`;
  }

  function answersMarkup(q, chosen) {
    const n = q.answersCount;
    const showText = !!q.answers;
    const cls = showText ? (q.answers.some((a) => a.length > 22) ? 'list' : '') : 'only-letters';
    return `<div class="p-answers ${cls}" id="answers">
      ${Array.from({ length: n }, (_, i) => `
        <button class="ans a${i} ${chosen != null && chosen !== i ? 'dim' : ''}" data-i="${i}" ${chosen != null ? 'disabled' : ''}>
          <span class="letter">${LETTERS[i]}</span>${showText ? `<span>${esc(q.answers[i])}</span>` : ''}
        </button>`).join('')}
    </div>`;
  }

  function render(s) {
    state = s;
    renderFooter();
    pinPill.hidden = false;
    pinPill.textContent = `PIN ${s.pin}`;
    const key = `${s.phase}|${s.qIndex}|${s.myAnswer}`;
    if (key === renderedKey && s.phase !== 'lobby') return;
    renderedKey = key;
    if (stopTimer) stopTimer();
    stopTimer = null;
    phaseSound(s);

    const q = s.question;
    const qNum = `Вопрос ${s.qIndex + 1} из ${s.qTotal}`;

    switch (s.phase) {
      case 'lobby':
        app.innerHTML = `
          <div class="center fade-in">
            <div class="bounce-in">${avatar(s.me.name, s.me.color, 'xl')}</div>
            <h1 class="title-xl">Вы в игре!</h1>
            <p class="muted" style="margin:0;font-size:17px">Смотрите на экран ведущего — скоро начнём</p>
            <div class="dots" style="margin:10px 0"><span></span><span></span><span></span></div>
            <div class="pill">Участников: ${s.me.total}</div>
            <button class="btn btn-ghost btn-sm" id="leaveBtn" style="margin-top:20px">Выйти из игры</button>
          </div>`;
        $('#leaveBtn').addEventListener('click', () => {
          socket.emit('player:leave');
          saveSession({ lastName: s.me.name });
          state = null;
          renderPin();
        });
        break;

      case 'preview':
        app.innerHTML = `
          <div class="center fade-in">
            <div class="pill">${qNum}</div>
            ${q && q.image ? `<img class="qimg" src="${esc(q.image)}" alt="" />` : ''}
            ${q && q.text ? `<div class="qtext" style="font-size:${q.image ? 20 : 24}px">${esc(q.text)}</div>` : '<h1 class="title-xl">Приготовьтесь!</h1>'}
            <div class="bar" style="width:100%;max-width:320px"><i id="pbar"></i></div>
          </div>`;
        stopTimer = countdown(s.remainingMs, 4000, (left, frac) => {
          const el = $('#pbar');
          if (el) el.style.transform = `scaleX(${1 - frac})`;
        });
        break;

      case 'question': {
        const total = q.timeLimit * 1000;
        if (s.myAnswer != null) {
          app.innerHTML = `
            <div class="center fade-in">
              <div class="chosen">${answersMarkup({ ...q, answersCount: q.answersCount }, s.myAnswer).replace('p-answers', 'p-answers list')}</div>
              <h1 class="title-xl">Ответ принят</h1>
              <p class="muted" style="margin:0">Ждём остальных участников…</p>
              <div class="dots"><span></span><span></span><span></span></div>
            </div>`;
          // оставляем только выбранный вариант
          app.querySelectorAll('.ans').forEach((b) => {
            if (Number(b.dataset.i) !== s.myAnswer) b.remove();
          });
          break;
        }
        app.innerHTML = `
          <div class="fade-in" style="display:flex;flex-direction:column;flex:1">
            <div class="qhead"><span class="pill">${s.qIndex + 1}/${s.qTotal}</span><div class="bar"><i id="tbar"></i></div><span class="sec" id="tsec"></span></div>
            ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="" />` : ''}
            ${q.text ? `<div class="qtext">${esc(q.text)}</div>` : '<div class="qtext muted">Выберите ответ на экране ведущего</div>'}
            ${answersMarkup(q, null)}
          </div>`;
        let lastSec = Math.ceil(s.remainingMs / 1000);
        stopTimer = countdown(s.remainingMs, total, (left, frac) => {
          const bar = $('#tbar');
          const sec = $('#tsec');
          const whole = Math.ceil(left / 1000);
          if (whole !== lastSec) {
            lastSec = whole;
            // в онлайн-формате телефон — единственный экран, поэтому тикаем последние 5 секунд
            if (s.showOnDevices && whole <= 5 && whole > 0 && bar) Sound.second(99);
          }
          if (bar) {
            bar.style.transform = `scaleX(${frac})`;
            bar.style.background = left <= 5000 ? 'var(--bad)' : 'var(--accent)';
          }
          if (sec) sec.textContent = Math.ceil(left / 1000);
        });
        $('#answers').addEventListener('click', async (e) => {
          const b = e.target.closest('.ans');
          if (!b || sending) return;
          sending = true;
          Sound.tap();
          const index = Number(b.dataset.i);
          app.querySelectorAll('.ans').forEach((x) => x.classList.toggle('dim', x !== b));
          if (navigator.vibrate) navigator.vibrate(30);
          const res = await emit(socket, 'player:answer', { index });
          sending = false;
          if (!res.ok) {
            toast(res.error, true);
            app.querySelectorAll('.ans').forEach((x) => x.classList.remove('dim'));
          }
        });
        break;
      }

      case 'reveal': {
        const r = s.result;
        const kind = r.correct === true ? 'ok' : r.correct === false ? 'bad' : 'none';
        const head = { ok: 'Верно!', bad: 'Неверно', none: 'Время вышло' }[kind];
        const icon = { ok: ICONS.check, bad: ICONS.cross, none: ICONS.clock }[kind];
        app.innerHTML = `
          <div class="center">
            <div class="result ${kind} bounce-in">
              <div class="icon">${icon}</div>
              <h1 class="title-xl" style="margin-top:8px">${head}</h1>
              ${kind === 'ok' ? `<div class="pts">+${fmt(r.points)}</div>` : ''}
              ${kind === 'ok' && r.streak >= 2 ? `<div style="margin-top:12px;font-weight:800">${ICONS.flame} Серия: ${r.streak} подряд</div>` : ''}
              ${kind !== 'ok' && r.correctTexts.length && s.showOnDevices ? `<div style="margin-top:14px;font-weight:700">Правильно: ${r.correctTexts.map(esc).join(' / ')}</div>` : ''}
              ${kind !== 'ok' && !s.showOnDevices ? `<div style="margin-top:14px;font-weight:700">Правильно: ${r.correctIndices.map((i) => LETTERS[i]).join(', ')}</div>` : ''}
            </div>
            <p style="font-size:17px">${rankLine(s)}</p>
          </div>`;
        if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? [40, 60, 40] : 120);
        break;
      }

      case 'leaderboard':
        app.innerHTML = `
          <div class="center fade-in">
            ${avatar(s.me.name, s.me.color, 'xl')}
            <h1 class="title-xl">${s.me.rank} место</h1>
            <p class="muted" style="margin:0">из ${s.me.total} участников · ${fmt(s.me.score)} очков</p>
            ${s.result && s.result.aheadName ? `<p>До «${esc(s.result.aheadName)}» — ${fmt(s.result.gap)} очк.</p>` : s.me.rank === 1 ? '<p>Вы лидер!</p>' : ''}
            <div class="dots"><span></span><span></span><span></span></div>
          </div>`;
        break;

      case 'final': {
        // Место участника объявляется синхронно с пьедесталом на экране ведущего
        const tl = podiumTimeline(Math.min(3, s.me.total));
        const step = tl.steps.find((x) => x.place === s.me.rank);
        const revealAt = step ? step.hitAt : tl.endAt - 1400;
        const wait = revealAt - (s.elapsedMs || 0);
        const showResult = (late) => {
          const rc = s.me.rank <= 3 ? `r${s.me.rank}` : 'rn';
          app.innerHTML = `
            <div class="center fade-in">
              <div class="rank-badge ${rc} bounce-in">${s.me.rank}</div>
              <h1 class="title-xl">${s.me.rank === 1 ? 'Вы победили!' : `${s.me.rank} место из ${s.me.total}`}</h1>
              <p style="margin:0;font-size:18px"><b>${fmt(s.me.score)}</b> очков</p>
              <p class="muted" style="margin:0">Правильных ответов: ${s.result ? s.result.correctCount : 0} из ${s.qTotal}</p>
              <button class="btn btn-primary" id="againBtn" style="margin-top:18px">Войти в другую игру</button>
            </div>`;
          if (!late) {
            Sound.placeReveal(s.me.rank);
            if (navigator.vibrate) navigator.vibrate(s.me.rank <= 3 ? [60, 80, 60, 80, 120] : 80);
            if (s.me.rank <= 3) confetti(s.me.rank === 1 ? 6000 : 4000);
          }
          $('#againBtn').addEventListener('click', () => {
            saveSession({ lastName: s.me.name });
            state = null;
            history.replaceState(null, '', '/');
            renderPin();
          });
        };
        if (wait > 0) {
          app.innerHTML = `
            <div class="center fade-in">
              <div class="drum-wait"><span></span><span></span><span></span></div>
              <h1 class="title-xl">Объявляем победителей…</h1>
              <p class="muted" style="margin:0">Смотрите на экран ведущего</p>
            </div>`;
          const tm = setTimeout(() => showResult(false), wait);
          stopTimer = () => clearTimeout(tm);
        } else showResult(true);
        break;
      }
      default:
        break;
    }
  }

  function renderMessage(title, text) {
    screen = 'msg';
    if (stopTimer) stopTimer();
    state = null;
    renderedKey = '';
    footer.hidden = true;
    app.innerHTML = `
      <div class="center fade-in">
        <h1 class="title-xl">${esc(title)}</h1>
        <p class="muted">${esc(text)}</p>
        <button class="btn btn-primary" id="homeBtn">На главную</button>
      </div>`;
    $('#homeBtn').addEventListener('click', () => {
      history.replaceState(null, '', '/');
      renderPin();
    });
  }

  socket.on('state', (s) => {
    if (s.role !== 'player') return;
    screen = 'game';
    booting = false;
    render(s);
  });
  socket.on('kicked', () => {
    const sess = loadSession();
    saveSession(sess ? { lastName: sess.lastName } : null);
    renderMessage('Вас удалили из игры', 'Ведущий удалил вас из комнаты.');
  });
  socket.on('room-closed', () => {
    const sess = loadSession();
    saveSession(sess ? { lastName: sess.lastName } : null);
    renderMessage('Игра завершена', 'Ведущий закрыл комнату.');
  });

  // При (пере)подключении пытаемся вернуться в свою игру
  const urlPin = new URLSearchParams(location.search).get('pin') || '';
  const fallbackToJoin = () => {
    booting = false;
    if (urlPin) checkPin(urlPin);
    else renderPin();
  };

  socket.on('connect', async () => {
    const sess = loadSession();
    if (!(sess && sess.pin && sess.token && (screen === 'game' || booting))) return;
    const res = await emit(socket, 'player:rejoin', { pin: sess.pin, token: sess.token });
    if (res.ok) {
      booting = false;
      pin = sess.pin;
      screen = 'game';
      renderedKey = '';
      return;
    }
    saveSession({ lastName: sess.lastName });
    if (booting) fallbackToJoin();
    else if (screen === 'game') renderMessage('Игра не найдена', 'Возможно, она уже закончилась.');
  });

  // Старт: PIN из QR-ссылки ?pin=123456
  const sess = loadSession();
  if (sess && sess.token && (!urlPin || urlPin === sess.pin)) {
    booting = true;
    app.innerHTML = '<div class="center"><div class="dots"><span></span><span></span><span></span></div></div>';
    setTimeout(() => booting && !state && fallbackToJoin(), 5000);
  } else if (urlPin) {
    checkPin(urlPin);
  } else {
    renderPin();
  }
})();
