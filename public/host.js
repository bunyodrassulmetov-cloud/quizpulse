/* Экран ведущего: библиотека викторин, редактор и проведение игры */
(function () {
  const { LETTERS, esc, $, $$, toast, emit, watchConnection, countdown, ringSVG, updateRing, confetti, animateNumber, fmt, BRAND_SVG } = window.QP;
  $('#brandMark').innerHTML = BRAND_SVG;

  const view = $('#view');
  const topTitle = $('#topTitle');
  const topActions = $('#topActions');
  const importFile = $('#importFile');

  const STORE_Q = 'qp-quizzes';
  const STORE_HOST = 'qp-host';
  const STORE_BASE = 'qp-join-base';
  const TIMES = [5, 10, 20, 30, 45, 60, 90, 120];

  const store = {
    get(k, d, s = localStorage) {
      try {
        const v = s.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v, s = localStorage) {
      try {
        if (v == null) s.removeItem(k);
        else s.setItem(k, JSON.stringify(v));
      } catch (e) { /* хранилище недоступно */ }
    },
  };

  let info = { publicUrl: '', lanUrls: [] };
  const infoReady = fetch('/api/info')
    .then((r) => r.json())
    .then((j) => (info = j))
    .catch(() => info);

  const socket = io({ transports: ['websocket', 'polling'] });
  watchConnection(socket);

  let mode = 'boot'; // boot | library | editor | game
  let game = null;
  let renderedKey = '';
  let stopTimer = null;

  // ---------------- Данные викторин ----------------

  const uid = () => Math.random().toString(36).slice(2, 10);

  function blankQuestion(type = 'quiz') {
    return type === 'truefalse'
      ? { id: uid(), type, text: '', image: '', answers: ['Верно', 'Неверно'], correct: [0], timeLimit: 10, points: 1 }
      : { id: uid(), type: 'quiz', text: '', image: '', answers: ['', '', '', ''], correct: [0], timeLimit: 20, points: 1 };
  }

  function normalizeQuiz(raw) {
    const q = raw && typeof raw === 'object' ? raw : {};
    const questions = (Array.isArray(q.questions) ? q.questions : []).slice(0, 100).map((x) => {
      const type = x && x.type === 'truefalse' ? 'truefalse' : 'quiz';
      const base = blankQuestion(type);
      const answers = type === 'truefalse' ? base.answers : [0, 1, 2, 3].map((i) => String((x.answers && x.answers[i]) || '').slice(0, 120));
      let correct = Array.isArray(x.correct) ? x.correct : [x.correct];
      correct = correct.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < answers.length);
      return {
        id: uid(),
        type,
        text: String(x.text || '').slice(0, 300),
        image: String(x.image || '').slice(0, 500),
        answers,
        correct: correct.length ? [...new Set(correct)] : [0],
        timeLimit: TIMES.includes(Number(x.timeLimit)) ? Number(x.timeLimit) : base.timeLimit,
        points: [0, 1, 2].includes(Number(x.points)) ? Number(x.points) : 1,
      };
    });
    return { id: q.id || uid(), title: String(q.title || 'Без названия').slice(0, 120), questions, updatedAt: q.updatedAt || Date.now() };
  }

  function demoQuiz() {
    return normalizeQuiz({
      id: 'demo',
      title: 'Разминка: общая эрудиция',
      questions: [
        { text: 'Какая планета Солнечной системы самая большая?', answers: ['Марс', 'Юпитер', 'Сатурн', 'Нептун'], correct: [1], timeLimit: 20 },
        { text: 'Сколько континентов на Земле?', answers: ['5', '6', '7', '8'], correct: [2], timeLimit: 20 },
        { type: 'truefalse', text: 'На уровне моря вода кипит при 100 °C.', correct: [0], timeLimit: 10 },
        { text: 'Кто написал роман «Война и мир»?', answers: ['Ф. Достоевский', 'Л. Толстой', 'А. Чехов', 'А. Пушкин'], correct: [1], timeLimit: 20 },
        { text: 'Какой океан самый большой по площади?', answers: ['Атлантический', 'Индийский', 'Тихий', 'Северный Ледовитый'], correct: [2], timeLimit: 20 },
        { text: 'Самое быстрое наземное животное — это…', answers: ['Гепард', 'Лев', 'Антилопа гну', 'Лошадь'], correct: [0], timeLimit: 20, points: 2 },
        { type: 'truefalse', text: 'Столица Австралии — Сидней.', correct: [1], timeLimit: 10 },
        { text: 'Сколько байт в одном кибибайте (КиБ)?', answers: ['100', '512', '1000', '1024'], correct: [3], timeLimit: 20 },
      ],
    });
  }

  function loadQuizzes() {
    let list = store.get(STORE_Q, null);
    if (!Array.isArray(list)) {
      list = [demoQuiz()];
      store.set(STORE_Q, list);
    }
    return list.map(normalizeQuizKeepIds);
  }
  function normalizeQuizKeepIds(q) {
    const n = normalizeQuiz(q);
    n.id = q.id || n.id;
    n.updatedAt = q.updatedAt || n.updatedAt;
    (q.questions || []).forEach((src, i) => {
      if (n.questions[i] && src.id) n.questions[i].id = src.id;
    });
    return n;
  }
  function saveQuizzes(list) {
    store.set(STORE_Q, list);
  }
  function upsertQuiz(quiz) {
    const list = loadQuizzes();
    const i = list.findIndex((q) => q.id === quiz.id);
    const copy = JSON.parse(JSON.stringify({ ...quiz, updatedAt: Date.now() }));
    if (i >= 0) list[i] = copy;
    else list.unshift(copy);
    saveQuizzes(list);
  }

  function validate(quiz) {
    const errors = [];
    if (!quiz.title.trim()) errors.push({ q: -1, msg: 'Укажите название викторины' });
    if (!quiz.questions.length) errors.push({ q: -1, msg: 'Добавьте хотя бы один вопрос' });
    quiz.questions.forEach((q, i) => {
      const n = i + 1;
      if (!q.text.trim()) errors.push({ q: i, msg: `Вопрос ${n}: введите текст` });
      const filled = q.answers.map((a, idx) => (a.trim() ? idx : -1)).filter((x) => x >= 0);
      if (filled.length < 2) errors.push({ q: i, msg: `Вопрос ${n}: нужно минимум 2 варианта` });
      if (!q.correct.some((c) => filled.includes(c))) errors.push({ q: i, msg: `Вопрос ${n}: отметьте правильный ответ среди заполненных` });
    });
    return errors;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'quiz';

  function exportQuiz(quiz) {
    const data = {
      title: quiz.title,
      questions: quiz.questions.map(({ id, ...rest }) => rest),
    };
    download(`${fileSafe(quiz.title)}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  importFile.addEventListener('change', async () => {
    const f = importFile.files && importFile.files[0];
    importFile.value = '';
    if (!f) return;
    try {
      const quiz = normalizeQuiz(JSON.parse(await f.text()));
      quiz.id = uid();
      if (!quiz.questions.length) throw new Error('В файле нет вопросов');
      upsertQuiz(quiz);
      toast(`Импортировано: «${quiz.title}»`);
      renderLibrary();
    } catch (e) {
      toast('Не удалось импортировать: ' + e.message, true);
    }
  });

  // ---------------- Верхняя панель ----------------

  function setTop(title, actions) {
    topTitle.textContent = title || '';
    topActions.innerHTML = '';
    actions.forEach((a) => {
      if (a.html) {
        const span = document.createElement('span');
        span.innerHTML = a.html;
        topActions.appendChild(span.firstElementChild);
        return;
      }
      const b = document.createElement('button');
      b.className = `btn btn-sm ${a.cls || ''}`;
      b.textContent = a.label;
      if (a.id) b.id = a.id;
      if (a.title) b.title = a.title;
      b.addEventListener('click', a.onClick);
      topActions.appendChild(b);
    });
  }

  // ---------------- Библиотека ----------------

  function renderLibrary() {
    mode = 'library';
    renderedKey = '';
    if (stopTimer) stopTimer();
    $('#topbar').hidden = false;
    setTop('', [
      { label: 'Импорт JSON', onClick: () => importFile.click() },
      { label: '＋ Создать викторину', cls: 'btn-primary', onClick: () => openEditor(normalizeQuiz({ title: '', questions: [blankQuestion()] }), true) },
    ]);
    const list = loadQuizzes();
    const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'вопрос' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'вопроса' : 'вопросов');
    view.innerHTML = `
      <div class="page fade-in">
        <div class="lib-head">
          <div>
            <h1 class="h">Мои викторины</h1>
            <p class="muted" style="margin:8px 0 0">Создайте вопросы и запустите игру — участники подключатся по QR-коду со своих телефонов.</p>
          </div>
        </div>
        ${list.length ? `<div class="quiz-grid">
          ${list.map((q) => `
            <article class="card quiz-card" data-id="${esc(q.id)}">
              <div class="meta">${q.questions.length} ${plural(q.questions.length)} · ${new Date(q.updatedAt).toLocaleDateString('ru-RU')}</div>
              <h3>${esc(q.title || 'Без названия')}</h3>
              <div class="actions">
                <button class="btn btn-primary btn-sm" data-act="play">▶ Запустить</button>
                <button class="btn btn-sm" data-act="edit">Изменить</button>
                <button class="btn btn-sm btn-ghost" data-act="copy" title="Сделать копию">Копия</button>
                <button class="btn btn-sm btn-ghost" data-act="export" title="Скачать JSON">JSON</button>
                <button class="btn btn-sm btn-ghost btn-danger" data-act="del" title="Удалить">Удалить</button>
              </div>
            </article>`).join('')}
        </div>` : `<div class="card empty"><h3 style="margin-top:0">Пока нет викторин</h3><p class="muted">Создайте первую или импортируйте JSON.</p></div>`}
        <section class="card how">
          <div class="step"><b>1</b><div style="font-weight:800">Подготовьте вопросы</div><p>До 4 вариантов ответа, верно/неверно, таймер, двойные очки, картинки.</p></div>
          <div class="step"><b>2</b><div style="font-weight:800">Откройте комнату</div><p>На экране появится PIN и QR-код. Выведите его на проектор или в демонстрацию экрана.</p></div>
          <div class="step"><b>3</b><div style="font-weight:800">Играйте вживую</div><p>Участники отвечают с телефонов, очки за скорость, таблица лидеров и пьедестал.</p></div>
        </section>
      </div>`;

    view.querySelectorAll('.quiz-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const quizzes = loadQuizzes();
        const quiz = quizzes.find((q) => q.id === card.dataset.id);
        if (!quiz) return;
        switch (b.dataset.act) {
          case 'play': {
            const errs = validate(quiz);
            if (errs.length) {
              toast(errs[0].msg, true);
              openEditor(quiz, false, errs[0].q);
            } else openLaunch(quiz);
            break;
          }
          case 'edit':
            openEditor(quiz);
            break;
          case 'copy': {
            const c = JSON.parse(JSON.stringify(quiz));
            c.id = uid();
            c.title = `${quiz.title} (копия)`;
            upsertQuiz(c);
            renderLibrary();
            break;
          }
          case 'export':
            exportQuiz(quiz);
            break;
          case 'del':
            if (confirm(`Удалить викторину «${quiz.title}»?`)) {
              saveQuizzes(quizzes.filter((q) => q.id !== quiz.id));
              renderLibrary();
            }
            break;
          default:
        }
      });
    });
  }

  // ---------------- Редактор ----------------

  let draft = null;
  let sel = 0;
  let dirty = false;
  let errorSet = new Set();

  function openEditor(quiz, isNew = false, focusQ = 0) {
    draft = JSON.parse(JSON.stringify(quiz));
    if (!draft.questions.length) draft.questions.push(blankQuestion());
    sel = Math.max(0, Math.min(focusQ, draft.questions.length - 1));
    dirty = isNew;
    errorSet = new Set();
    renderEditor();
  }

  function leaveEditor() {
    if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
    renderLibrary();
  }

  function saveDraft(silent) {
    draft.title = draft.title.trim() || 'Без названия';
    upsertQuiz(draft);
    dirty = false;
    const errs = validate(draft);
    errorSet = new Set(errs.map((e) => e.q).filter((q) => q >= 0));
    renderQList();
    if (!silent) toast(errs.length ? `Сохранено. Не готово к запуску: ${errs[0].msg}` : 'Сохранено', !!errs.length);
    return errs;
  }

  function renderEditor() {
    mode = 'editor';
    setTop('', [
      { label: '← К списку', cls: 'btn-ghost', onClick: leaveEditor },
      { label: 'JSON', cls: 'btn-ghost', title: 'Скачать JSON', onClick: () => exportQuiz(draft) },
      { label: 'Сохранить', onClick: () => saveDraft(false) },
      {
        label: '▶ Запустить',
        cls: 'btn-primary',
        onClick: () => {
          const errs = saveDraft(true);
          if (errs.length) {
            toast(errs[0].msg, true);
            if (errs[0].q >= 0) {
              sel = errs[0].q;
              renderQList();
              renderQPanel();
            }
            return;
          }
          openLaunch(draft);
        },
      },
    ]);
    view.innerHTML = `
      <div class="page fade-in">
        <div style="margin-bottom:18px">
          <label class="label" for="quizTitle">Название викторины</label>
          <input class="input" id="quizTitle" maxlength="120" placeholder="Например: Итоги квартала" value="${esc(draft.title)}" style="font-size:22px;font-weight:800" />
        </div>
        <div class="ed">
          <aside class="card qlist" id="qlist"></aside>
          <section class="card qpanel" id="qpanel"></section>
        </div>
      </div>`;
    const t = $('#quizTitle');
    t.addEventListener('input', () => {
      draft.title = t.value;
      dirty = true;
    });
    if (!draft.title) t.focus();
    renderQList();
    renderQPanel();
  }

  function renderQList() {
    const el = $('#qlist');
    if (!el) return;
    el.innerHTML = `
      ${draft.questions.map((q, i) => `
        <button class="qitem ${i === sel ? 'on' : ''} ${errorSet.has(i) ? 'err' : ''}" data-i="${i}">
          <span class="n">${i + 1}</span>
          <span class="t ${q.text ? '' : 'ph'}">${esc(q.text || 'Новый вопрос')}</span>
          <span class="muted" style="font-size:12px">${q.type === 'truefalse' ? 'В/Н' : q.timeLimit + 'с'}</span>
        </button>`).join('')}
      <div style="display:grid;gap:8px;margin-top:6px">
        <button class="btn btn-sm" id="addQ">＋ Вопрос с вариантами</button>
        <button class="btn btn-sm btn-ghost" id="addTF">＋ Верно / Неверно</button>
      </div>`;
    el.querySelectorAll('.qitem').forEach((b) =>
      b.addEventListener('click', () => {
        sel = Number(b.dataset.i);
        renderQList();
        renderQPanel();
      })
    );
    const add = (type) => {
      draft.questions.splice(sel + 1, 0, blankQuestion(type));
      sel += 1;
      dirty = true;
      renderQList();
      renderQPanel();
      const ta = $('#qText');
      if (ta) ta.focus();
    };
    $('#addQ').addEventListener('click', () => add('quiz'));
    $('#addTF').addEventListener('click', () => add('truefalse'));
  }

  function updateListItem() {
    const item = $(`#qlist .qitem[data-i="${sel}"] .t`);
    const q = draft.questions[sel];
    if (item) {
      item.textContent = q.text || 'Новый вопрос';
      item.classList.toggle('ph', !q.text);
    }
  }

  function renderQPanel() {
    const el = $('#qpanel');
    const q = draft.questions[sel];
    if (!el || !q) return;
    const tf = q.type === 'truefalse';
    el.innerHTML = `
      <div class="row" style="flex-wrap:wrap">
        <div class="pill">Вопрос ${sel + 1} из ${draft.questions.length}</div>
        <span class="spacer"></span>
        <div class="qtools">
          <button class="btn btn-sm btn-ghost" data-tool="up" ${sel === 0 ? 'disabled' : ''} title="Выше">↑</button>
          <button class="btn btn-sm btn-ghost" data-tool="down" ${sel === draft.questions.length - 1 ? 'disabled' : ''} title="Ниже">↓</button>
          <button class="btn btn-sm btn-ghost" data-tool="dup">Дублировать</button>
          <button class="btn btn-sm btn-ghost btn-danger" data-tool="del" ${draft.questions.length === 1 ? 'disabled' : ''}>Удалить</button>
        </div>
      </div>
      <div>
        <label class="label" for="qText">Текст вопроса</label>
        <textarea class="textarea" id="qText" maxlength="300" placeholder="Введите вопрос…" style="font-size:20px;font-weight:700">${esc(q.text)}</textarea>
      </div>
      <div class="opts">
        <div>
          <label class="label" for="qType">Тип</label>
          <select class="select" id="qType">
            <option value="quiz" ${!tf ? 'selected' : ''}>Варианты ответа</option>
            <option value="truefalse" ${tf ? 'selected' : ''}>Верно / Неверно</option>
          </select>
        </div>
        <div>
          <label class="label" for="qTime">Время на ответ</label>
          <select class="select" id="qTime">${TIMES.map((t) => `<option value="${t}" ${t === q.timeLimit ? 'selected' : ''}>${t} сек</option>`).join('')}</select>
        </div>
        <div>
          <label class="label" for="qPoints">Очки</label>
          <select class="select" id="qPoints">
            <option value="1" ${q.points === 1 ? 'selected' : ''}>Стандартные</option>
            <option value="2" ${q.points === 2 ? 'selected' : ''}>Двойные ×2</option>
            <option value="0" ${q.points === 0 ? 'selected' : ''}>Без очков</option>
          </select>
        </div>
      </div>
      <div>
        <label class="label">Варианты ответа ${tf ? '' : '<span style="font-weight:500">— нажмите на кружок, чтобы отметить правильный (можно несколько)</span>'}</label>
        <div class="ans-edit" id="ansEdit">
          ${q.answers.map((a, i) => `
            <div class="ans a${i}">
              <span class="letter">${LETTERS[i]}</span>
              <input data-ai="${i}" maxlength="120" value="${esc(a)}" placeholder="${i < 2 ? 'Вариант ответа' : 'Необязательно'}" ${tf ? 'readonly' : ''} />
              <button class="ok-toggle ${q.correct.includes(i) ? 'on' : ''}" data-ci="${i}" title="Правильный ответ" aria-pressed="${q.correct.includes(i)}">✓</button>
            </div>`).join('')}
        </div>
      </div>
      <div>
        <label class="label" for="qImg">Картинка (необязательно) — ссылка https://…</label>
        <input class="input" id="qImg" maxlength="500" placeholder="https://example.com/picture.jpg" value="${esc(q.image)}" />
        <div id="imgPrev" style="margin-top:10px"></div>
      </div>`;

    const touch = () => (dirty = true);
    const ta = $('#qText');
    ta.addEventListener('input', () => {
      q.text = ta.value;
      touch();
      updateListItem();
    });
    $('#qType').addEventListener('change', (e) => {
      const nq = blankQuestion(e.target.value);
      nq.id = q.id;
      nq.text = q.text;
      nq.image = q.image;
      nq.points = q.points;
      draft.questions[sel] = nq;
      touch();
      renderQList();
      renderQPanel();
    });
    $('#qTime').addEventListener('change', (e) => {
      q.timeLimit = Number(e.target.value);
      touch();
      renderQList();
    });
    $('#qPoints').addEventListener('change', (e) => {
      q.points = Number(e.target.value);
      touch();
    });
    $('#ansEdit').addEventListener('input', (e) => {
      const i = e.target.dataset.ai;
      if (i == null) return;
      q.answers[Number(i)] = e.target.value;
      touch();
    });
    $('#ansEdit').addEventListener('click', (e) => {
      const b = e.target.closest('.ok-toggle');
      if (!b) return;
      const i = Number(b.dataset.ci);
      if (tf) q.correct = [i];
      else if (q.correct.includes(i)) {
        if (q.correct.length > 1) q.correct = q.correct.filter((x) => x !== i);
      } else q.correct = [...q.correct, i].sort();
      touch();
      $$('#ansEdit .ok-toggle').forEach((x) => {
        const on = q.correct.includes(Number(x.dataset.ci));
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on);
      });
    });
    const img = $('#qImg');
    const showPrev = () => {
      const v = img.value.trim();
      $('#imgPrev').innerHTML = /^https?:\/\//i.test(v) ? `<img class="img-prev" src="${esc(v)}" alt="Предпросмотр" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'muted',textContent:'Не удалось загрузить картинку'}))" />` : '';
    };
    img.addEventListener('change', () => {
      q.image = img.value.trim();
      touch();
      showPrev();
    });
    img.addEventListener('input', () => {
      q.image = img.value.trim();
      touch();
    });
    showPrev();

    el.querySelector('.qtools').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tool]');
      if (!b) return;
      const qs = draft.questions;
      switch (b.dataset.tool) {
        case 'up':
          [qs[sel - 1], qs[sel]] = [qs[sel], qs[sel - 1]];
          sel -= 1;
          break;
        case 'down':
          [qs[sel + 1], qs[sel]] = [qs[sel], qs[sel + 1]];
          sel += 1;
          break;
        case 'dup': {
          const c = JSON.parse(JSON.stringify(qs[sel]));
          c.id = uid();
          qs.splice(sel + 1, 0, c);
          sel += 1;
          break;
        }
        case 'del':
          if (!confirm('Удалить этот вопрос?')) return;
          qs.splice(sel, 1);
          sel = Math.min(sel, qs.length - 1);
          break;
        default:
      }
      errorSet = new Set();
      touch();
      renderQList();
      renderQPanel();
    });
  }

  // ---------------- Запуск игры ----------------

  function openLaunch(quiz) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="card modal bounce-in" role="dialog" aria-modal="true" aria-labelledby="lt">
        <h2 id="lt">Запуск игры</h2>
        <p class="muted" style="margin:0 0 20px">«${esc(quiz.title)}» · ${quiz.questions.length} вопр.</p>
        <div style="display:grid;gap:16px">
          <label class="switch"><input type="checkbox" id="optShow" checked /><span class="track"></span>
            <span><b>Показывать вопрос на телефонах</b><br /><span class="muted" style="font-size:14px">Удобно для онлайн-формата, когда участники не видят общий экран</span></span></label>
          <label class="switch"><input type="checkbox" id="optShuffle" /><span class="track"></span>
            <span><b>Перемешать вопросы</b><br /><span class="muted" style="font-size:14px">Порядок вопросов будет случайным</span></span></label>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:26px">
          <button class="btn btn-ghost" id="lCancel">Отмена</button>
          <button class="btn btn-primary" id="lGo">Открыть комнату</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', (e) => e.target === back && close());
    $('#lCancel', back).addEventListener('click', close);
    $('#lGo', back).addEventListener('click', async (e) => {
      e.target.disabled = true;
      const payload = {
        quiz: { title: quiz.title, questions: quiz.questions.map(({ id, ...q }) => q) },
        settings: { showOnDevices: $('#optShow', back).checked, shuffleQuestions: $('#optShuffle', back).checked },
      };
      const res = await emit(socket, 'host:create', payload);
      if (!res.ok) {
        e.target.disabled = false;
        return toast(res.error, true);
      }
      store.set(STORE_HOST, { pin: res.pin, hostToken: res.hostToken }, sessionStorage);
      close();
      mode = 'game';
      renderedKey = '';
      if (game && game.pin === res.pin) renderGame(game);
    });
  }

  async function hostAction(action, extra) {
    const res = await emit(socket, 'host:action', { action, ...extra });
    if (!res.ok) toast(res.error, true);
    return res;
  }

  // ---------------- Игра ----------------

  function joinBase() {
    const override = store.get(STORE_BASE, '');
    if (override) return override;
    if (info.publicUrl) return info.publicUrl;
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
    if (local && info.lanUrls && info.lanUrls.length) return info.lanUrls[0];
    return location.origin;
  }
  const joinUrl = (pin) => `${joinBase()}/join?pin=${pin}`;
  const prettyPin = (pin) => `${pin.slice(0, 3)} ${pin.slice(3)}`;

  function gameTop(s) {
    const actions = [
      { html: `<span class="pill" id="topPlayers">👥 ${s.players.length}</span>` },
      { html: `<span class="pill">PIN <b style="font-family:var(--font-display);letter-spacing:.05em">${esc(s.pin)}</b></span>` },
      { label: '⛶', cls: 'btn-ghost btn-icon', title: 'Во весь экран', onClick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})) },
    ];
    if (s.phase !== 'final') {
      actions.push({
        label: 'Завершить',
        cls: 'btn-ghost btn-danger',
        onClick: () => confirm('Завершить игру и показать итоги?') && hostAction('end'),
      });
    }
    setTop(s.title, actions);
  }

  function answerTiles(q, reveal) {
    return `<div class="answers">${q.answers
      .map((a, i) => {
        const ok = reveal && reveal.correct.includes(i);
        return `<div class="ans a${i} ${reveal && !ok ? 'dim' : ''}"><span class="letter">${LETTERS[i]}</span><span>${esc(a)}</span>${ok ? '<span class="mark">✓</span>' : ''}</div>`;
      })
      .join('')}</div>`;
  }

  function pointsBadge(q) {
    if (q.points === 2) return '<span class="pill" style="background:var(--accent);color:var(--accent-ink)">Двойные очки ×2</span>';
    if (q.points === 0) return '<span class="pill">Без очков</span>';
    return '';
  }

  function renderGame(s) {
    game = s;
    if (mode !== 'game') return;
    const key = `${s.phase}|${s.qIndex}`;
    const tp = $('#topPlayers');
    if (tp) tp.textContent = `👥 ${s.players.length}`;
    if (key === renderedKey) return partialUpdate(s);
    renderedKey = key;
    if (stopTimer) stopTimer();
    stopTimer = null;
    gameTop(s);
    const q = s.question;

    switch (s.phase) {
      case 'lobby': {
        view.innerHTML = `
          <div class="stage fade-in">
            <div class="card lobby-top">
              <div>
                <div class="join-steps">
                  <div>📱 Наведите камеру телефона на QR-код</div>
                  <div>или откройте <span class="join-url" id="joinHost"></span> и введите PIN:</div>
                </div>
                <div class="pin-label">PIN игры</div>
                <div class="pin-big">${esc(prettyPin(s.pin))}</div>
                <div class="row" style="margin-top:14px;flex-wrap:wrap;gap:8px">
                  <button class="btn btn-sm" id="copyLink">Скопировать ссылку</button>
                  <button class="btn btn-sm btn-ghost" id="editBase">Изменить адрес</button>
                </div>
                <div id="baseWarn" class="muted" style="margin-top:10px;font-size:14px;max-width:560px"></div>
              </div>
              <div class="qr-box"><img id="qrImg" alt="QR-код для входа в игру" /></div>
            </div>
            <div class="lobby-bar">
              <div class="count">👥 <span id="pCount">${s.players.length}</span></div>
              <span class="muted" style="font-weight:700">участников</span>
              <span class="spacer"></span>
              <label class="switch"><input type="checkbox" id="lockT" ${s.locked ? 'checked' : ''} /><span class="track"></span><span style="font-weight:700">Закрыть вход</span></label>
              <button class="btn btn-primary btn-lg" id="startBtn" ${s.players.length ? '' : 'disabled'}>Начать игру ▶</button>
            </div>
            <div class="players" id="players"></div>
          </div>`;
        const fillJoin = () => {
          const url = joinUrl(s.pin);
          const base = joinBase();
          $('#joinHost').textContent = base.replace(/^https?:\/\//, '');
          $('#qrImg').src = `/api/qr?data=${encodeURIComponent(url)}`;
          const h = new URL(base).hostname;
          $('#baseWarn').textContent = ['localhost', '127.0.0.1', '[::1]'].includes(h)
            ? '⚠️ Адрес localhost недоступен с телефонов. Нажмите «Изменить адрес» и укажите IP компьютера в сети или публичный адрес.'
            : '';
        };
        infoReady.then(fillJoin);
        fillJoin();
        $('#copyLink').addEventListener('click', () => {
          const url = joinUrl(s.pin);
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
            .then(() => toast('Ссылка скопирована'))
            .catch(() => prompt('Ссылка для участников:', url));
        });
        $('#editBase').addEventListener('click', () => {
          const v = prompt('Адрес, по которому участники откроют сайт.\nНапример: https://my-quiz.onrender.com или http://192.168.1.10:3000\nОставьте пустым, чтобы вернуть адрес по умолчанию.', joinBase());
          if (v == null) return;
          const clean = v.trim().replace(/\/+$/, '');
          if (clean && !/^https?:\/\/[^\s/]+/i.test(clean)) return toast('Адрес должен начинаться с http:// или https://', true);
          store.set(STORE_BASE, clean || null);
          fillJoin();
        });
        $('#lockT').addEventListener('change', (e) => hostAction('lock', { value: e.target.checked }));
        $('#startBtn').addEventListener('click', () => hostAction('start'));
        lobbyPlayers(s);
        break;
      }

      case 'preview':
        view.innerHTML = `
          <div class="stage">
            <div class="preview fade-in"><div style="width:100%">
              <div class="row" style="justify-content:center;gap:10px"><span class="pill">Вопрос ${s.qIndex + 1} из ${s.qTotal}</span>${pointsBadge(q)}</div>
              <div class="qtext">${esc(q.text)}</div>
              <div class="bar" style="max-width:640px;margin:0 auto"><i id="pbar"></i></div>
            </div></div>
            <div class="controls"><button class="btn btn-ghost" id="skipBtn">Сразу к ответам ⏭</button></div>
          </div>`;
        stopTimer = countdown(s.remainingMs, 4000, (left, frac) => {
          const el = $('#pbar');
          if (el) el.style.transform = `scaleX(${1 - frac})`;
        });
        $('#skipBtn').addEventListener('click', () => hostAction('next'));
        break;

      case 'question':
        view.innerHTML = `
          <div class="stage fade-in">
            <div class="qcard">${esc(q.text)}</div>
            <div class="qmid">
              <div class="side"><div class="ring" id="ring">${ringSVG()}</div></div>
              <div class="img">${q.image ? `<img src="${esc(q.image)}" alt="" />` : `<div style="display:grid;justify-items:center;gap:12px;text-align:center"><span class="pill">Вопрос ${s.qIndex + 1} из ${s.qTotal}</span>${pointsBadge(q)}<span class="muted" style="font-size:20px;font-weight:700">📱 Отвечайте на телефонах</span></div>`}</div>
              <div class="side">
                <div class="answered" id="answered">${s.answeredCount}</div>
                <div class="muted" style="font-weight:700">ответов из <span id="activeCnt">${s.activeCount}</span></div>
                <button class="btn btn-sm btn-ghost" id="skipBtn" style="margin-top:8px">Завершить приём ⏭</button>
              </div>
            </div>
            ${answerTiles(q, null)}
          </div>`;
        stopTimer = countdown(s.remainingMs, q.timeLimit * 1000, (left, frac) => updateRing($('#ring'), left, frac));
        $('#skipBtn').addEventListener('click', () => hostAction('next'));
        break;

      case 'reveal': {
        const r = s.reveal;
        const max = Math.max(1, ...r.counts);
        const last = s.qIndex >= s.qTotal - 1;
        view.innerHTML = `
          <div class="stage fade-in">
            <div class="qcard">${esc(q.text)}</div>
            <div class="chart">
              ${q.answers.map((a, i) => {
                const ok = r.correct.includes(i);
                return `<div class="col">
                  <div class="cnt">${ok ? '<span style="color:var(--ok)">✓</span>' : ''}${r.counts[i]}</div>
                  <div class="well" style="height:100%"><div class="fill" style="height:${(r.counts[i] / max) * 100}%;background:var(--a${i});opacity:${ok ? 1 : 0.4};animation-delay:${i * 0.08}s"></div></div>
                  <div class="lt" style="background:var(--a${i});opacity:${ok ? 1 : 0.5}">${LETTERS[i]}</div>
                </div>`;
              }).join('')}
            </div>
            ${answerTiles(q, r)}
            <div class="controls" style="align-items:center">
              <span class="muted" style="font-weight:700;margin-right:auto">Ответили ${r.answered} из ${s.players.length} · правильно ${r.correct.reduce((n, i) => n + r.counts[i], 0)}</span>
              <button class="btn btn-primary btn-lg" id="nextBtn">${last ? 'Итоги игры 🏆' : 'Таблица лидеров →'}</button>
            </div>
          </div>`;
        $('#nextBtn').addEventListener('click', () => hostAction('next'));
        break;
      }

      case 'leaderboard': {
        const lb = s.leaderboard || [];
        view.innerHTML = `
          <div class="stage fade-in">
            <h1 class="h" style="text-align:center">Таблица лидеров</h1>
            <div class="lb">
              ${lb.length ? lb.map((p, i) => {
                const mv = p.prevRank && p.prevRank !== p.rank ? (p.prevRank > p.rank ? `<span class="move up">▲${p.prevRank - p.rank}</span>` : `<span class="move down">▼${p.rank - p.prevRank}</span>`) : '';
                return `<div class="lb-row" style="animation-delay:${i * 0.08}s">
                  <span class="rk">${p.rank}</span><span class="av">${esc(p.avatar)}</span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}${mv}</span>
                  <span class="plus">${p.lastPoints ? '+' + fmt(p.lastPoints) : ''}</span>
                  <span class="sc" data-from="${p.score - p.lastPoints}" data-to="${p.score}">${fmt(p.score - p.lastPoints)}</span>
                </div>`;
              }).join('') : '<div class="waiting">Нет участников</div>'}
            </div>
            <div class="controls"><button class="btn btn-primary btn-lg" id="nextBtn">Следующий вопрос →</button></div>
          </div>`;
        setTimeout(() => $$('.lb-row .sc').forEach((el) => animateNumber(el, Number(el.dataset.from), Number(el.dataset.to))), 400);
        $('#nextBtn').addEventListener('click', () => hostAction('next'));
        break;
      }

      case 'final': {
        const lb = s.leaderboard || [];
        const pod = (p, n) =>
          p
            ? `<div class="pod p${n}"><div class="who"><div class="av">${esc(p.avatar)}</div><div class="nm">${esc(p.name)}</div></div><div class="block"><div class="place">${n}</div><div class="pts">${fmt(p.score)}</div></div></div>`
            : `<div class="pod p${n}" style="visibility:hidden"><div class="block"></div></div>`;
        view.innerHTML = `
          <div class="stage fade-in">
            <div style="text-align:center"><h1 class="h">${esc(s.title)}</h1><p class="muted" style="margin:6px 0 0;font-weight:700">Итоги игры · ${lb.length} участн.</p></div>
            <div class="podium">${pod(lb[1], 2)}${pod(lb[0], 1)}${pod(lb[2], 3)}</div>
            <div class="controls" style="justify-content:center">
              <button class="btn" id="allBtn">Все результаты</button>
              <button class="btn" id="csvBtn">Скачать CSV</button>
              <button class="btn btn-primary" id="newBtn">Новая игра</button>
            </div>
            <div class="card" id="allRes" hidden style="padding:8px 16px;overflow:auto">
              <table class="res"><thead><tr><th>Место</th><th>Участник</th><th>Очки</th><th>Верных ответов</th></tr></thead>
              <tbody>${lb.map((p) => `<tr><td>${p.rank}</td><td>${esc(p.avatar)} ${esc(p.name)}</td><td>${fmt(p.score)}</td><td>${p.correctCount} / ${s.qTotal}</td></tr>`).join('')}</tbody></table>
            </div>
          </div>`;
        if (lb.length) setTimeout(() => mode === 'game' && confetti(5000), 2300);
        $('#allBtn').addEventListener('click', () => {
          const t = $('#allRes');
          t.hidden = !t.hidden;
          if (!t.hidden) t.scrollIntoView({ behavior: 'smooth' });
        });
        $('#csvBtn').addEventListener('click', () => {
          const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
          const rows = [['Место', 'Имя', 'Очки', 'Верных ответов', 'Всего вопросов'], ...lb.map((p) => [p.rank, p.name, p.score, p.correctCount, s.qTotal])];
          download(`${fileSafe(s.title)} — результаты.csv`, '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
        });
        $('#newBtn').addEventListener('click', async () => {
          await hostAction('close');
          store.set(STORE_HOST, null, sessionStorage);
          game = null;
          renderLibrary();
        });
        break;
      }
      default:
    }
  }

  function lobbyPlayers(s) {
    const wrap = $('#players');
    if (!wrap) return;
    const ids = new Set(s.players.map((p) => p.id));
    $$('.chip', wrap).forEach((c) => !ids.has(c.dataset.id) && c.remove());
    const waiting = $('.waiting', wrap);
    if (waiting) waiting.remove();
    s.players.forEach((p) => {
      let chip = wrap.querySelector(`.chip[data-id="${p.id}"]`);
      if (!chip) {
        chip = document.createElement('button');
        chip.className = 'chip';
        chip.dataset.id = p.id;
        chip.title = 'Нажмите, чтобы удалить участника';
        chip.innerHTML = `<span class="av">${esc(p.avatar)}</span><span>${esc(p.name)}</span>`;
        chip.addEventListener('click', () => confirm(`Удалить «${p.name}» из игры?`) && hostAction('kick', { playerId: p.id }));
        wrap.appendChild(chip);
      }
      chip.classList.toggle('off', !p.connected);
    });
    if (!s.players.length) wrap.insertAdjacentHTML('beforeend', '<div class="waiting">Ждём участников…</div>');
  }

  function partialUpdate(s) {
    if (s.phase === 'lobby') {
      const c = $('#pCount');
      if (c) c.textContent = s.players.length;
      const b = $('#startBtn');
      if (b) b.disabled = !s.players.length;
      const l = $('#lockT');
      if (l) l.checked = s.locked;
      lobbyPlayers(s);
    } else if (s.phase === 'question') {
      const a = $('#answered');
      if (a && a.textContent !== String(s.answeredCount)) {
        a.textContent = s.answeredCount;
        a.classList.remove('bounce-in');
        void a.offsetWidth;
        a.classList.add('bounce-in');
      }
      const ac = $('#activeCnt');
      if (ac) ac.textContent = s.activeCount;
    }
  }

  // Горячие клавиши: пробел / → — дальше (на экранах результатов)
  document.addEventListener('keydown', (e) => {
    if (mode !== 'game' || !game) return;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement && document.activeElement.tagName)) return;
    if ((e.key === ' ' || e.key === 'ArrowRight') && ['reveal', 'leaderboard', 'preview'].includes(game.phase)) {
      e.preventDefault();
      hostAction('next');
    }
  });

  socket.on('state', (s) => {
    if (s.role === 'host') renderGame(s);
  });

  socket.on('host-replaced', () => {
    mode = 'library';
    view.innerHTML = `<div class="page"><div class="card empty"><h2>Игра открыта в другой вкладке</h2><p class="muted">Управление перешло в другое окно.</p><button class="btn btn-primary" onclick="location.reload()">Вернуть управление сюда</button></div></div>`;
  });

  socket.on('connect', async () => {
    const sess = store.get(STORE_HOST, null, sessionStorage);
    if (!sess) {
      if (mode === 'boot') renderLibrary();
      return;
    }
    const res = await emit(socket, 'host:rejoin', sess);
    if (res.ok) {
      if (mode === 'boot' || mode === 'game') {
        mode = 'game';
        renderedKey = '';
        if (game) renderGame(game);
      }
    } else {
      store.set(STORE_HOST, null, sessionStorage);
      if (mode === 'boot' || mode === 'game') {
        if (mode === 'game') toast('Игра больше не доступна', true);
        renderLibrary();
      }
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (mode === 'editor' && dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  view.innerHTML = '<div class="page"><div class="dots" style="text-align:center;padding:60px"><span></span><span></span><span></span></div></div>';
})();
