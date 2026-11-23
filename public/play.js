/* Экран участника */
(function () {
  const { LETTERS, esc, $, toast, emit, watchConnection, countdown, fmt, confetti, BRAND_SVG } = window.QP;
  $('#brandMark').innerHTML = BRAND_SVG;

  const app = $('#app');
  const footer = $('#footer');
  const pinPill = $('#pinPill');
  const STORE = 'qp-player';

  const socket = io({ transports: ['websocket', 'polling'] });
  watchConnection(socket);

  let avatars = ['🦊', '🐼', '🐸', '🐙', '🦄', '🐯', '🐧', '🐨', '🦁', '🐵'];
  let screen = 'pin';
  let pin = '';
  let roomTitle = '';
  let chosenAvatar = null;
  let state = null;
  let renderedKey = '';
  let stopTimer = null;
  let sending = false;
  let booting = false;

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

  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      if (Array.isArray(info.avatars) && info.avatars.length) avatars = info.avatars;
      if (screen === 'name') renderName();
    })
    .catch(() => {});

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
    if (!chosenAvatar) chosenAvatar = avatars[Math.floor(Math.random() * avatars.length)];
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
            <div>
              <span class="label">Аватар</span>
              <div class="avatars" id="avatars">
                ${avatars.map((a) => `<button type="button" data-a="${esc(a)}" class="${a === chosenAvatar ? 'on' : ''}" aria-label="Аватар ${esc(a)}">${esc(a)}</button>`).join('')}
              </div>
            </div>
            ${error ? `<div style="color:#ffb3b5;font-weight:700">${esc(error)}</div>` : ''}
            <button class="btn btn-primary btn-lg" type="submit">Поехали!</button>
          </form>
        </div>
        <button class="btn btn-ghost btn-sm" id="backBtn">← Другой PIN</button>
      </div>`;
    $('#avatars').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      chosenAvatar = b.dataset.a;
      app.querySelectorAll('#avatars button').forEach((x) => x.classList.toggle('on', x === b));
    });
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
      const res = await emit(socket, 'player:join', { pin, name, avatar: chosenAvatar });
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
    footer.innerHTML = `<span style="font-size:26px">${esc(state.me.avatar)}</span><span class="name">${esc(state.me.name)}</span><span class="score">${fmt(state.me.score)}</span>`;
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

    const q = s.question;
    const qNum = `Вопрос ${s.qIndex + 1} из ${s.qTotal}`;

    switch (s.phase) {
      case 'lobby':
        app.innerHTML = `
          <div class="center fade-in">
            <div class="big-avatar bounce-in">${esc(s.me.avatar)}</div>
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
            ${q && q.text ? `<div class="qtext" style="font-size:24px">${esc(q.text)}</div>` : '<h1 class="title-xl">Приготовьтесь!</h1>'}
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
        stopTimer = countdown(s.remainingMs, total, (left, frac) => {
          const bar = $('#tbar');
          const sec = $('#tsec');
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
        const icon = { ok: '✓', bad: '✕', none: '⏱' }[kind];
        app.innerHTML = `
          <div class="center">
            <div class="result ${kind} bounce-in">
              <div class="icon">${icon}</div>
              <h1 class="title-xl" style="margin-top:8px">${head}</h1>
              ${kind === 'ok' ? `<div class="pts">+${fmt(r.points)}</div>` : ''}
              ${kind === 'ok' && r.streak >= 2 ? `<div style="margin-top:12px;font-weight:800">🔥 Серия: ${r.streak} подряд</div>` : ''}
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
            <div class="big-avatar">${esc(s.me.avatar)}</div>
            <h1 class="title-xl">${s.me.rank} место</h1>
            <p class="muted" style="margin:0">из ${s.me.total} участников · ${fmt(s.me.score)} очков</p>
            ${s.result && s.result.aheadName ? `<p>До «${esc(s.result.aheadName)}» — ${fmt(s.result.gap)} очк.</p>` : s.me.rank === 1 ? '<p>Вы лидер! 🏆</p>' : ''}
            <div class="dots"><span></span><span></span><span></span></div>
          </div>`;
        break;

      case 'final': {
        const medal = ['🥇', '🥈', '🥉'][s.me.rank - 1] || '🎉';
        app.innerHTML = `
          <div class="center fade-in">
            <div class="medal bounce-in">${medal}</div>
            <h1 class="title-xl">${s.me.rank} место из ${s.me.total}</h1>
            <p style="margin:0;font-size:18px"><b>${fmt(s.me.score)}</b> очков</p>
            <p class="muted" style="margin:0">Правильных ответов: ${s.result ? s.result.correctCount : 0} из ${s.qTotal}</p>
            <button class="btn btn-primary" id="againBtn" style="margin-top:18px">Войти в другую игру</button>
          </div>`;
        if (s.me.rank <= 3) confetti();
        $('#againBtn').addEventListener('click', () => {
          saveSession({ lastName: s.me.name });
          state = null;
          history.replaceState(null, '', '/');
          renderPin();
        });
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
