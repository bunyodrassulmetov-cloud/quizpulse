'use strict';

const crypto = require('crypto');

// Фазы игры
const PHASE = {
  LOBBY: 'lobby',
  PREVIEW: 'preview', // вопрос показан, ответы ещё закрыты
  QUESTION: 'question', // идёт приём ответов
  REVEAL: 'reveal', // показан правильный ответ и распределение
  LEADERBOARD: 'leaderboard',
  FINAL: 'final',
};

const PREVIEW_MS = 4000;
const ANSWER_GRACE_MS = 400; // запас на сетевую задержку
const MAX_PLAYERS = 300;
const RECONNECT_GRACE_MS = 8000; // столько ждём игрока после обрыва связи, прежде чем закрыть вопрос досрочно
const BASE_POINTS = 1000;
const ALLOWED_TIMES = [5, 10, 20, 30, 45, 60, 90, 120];
const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦄', '🐯', '🐧', '🐨', '🦁', '🐵', '🐳', '🦉', '🐝', '🦖', '🐲', '🐰', '🐶', '🐱', '🦝', '🐞'];

const token = () => crypto.randomBytes(16).toString('hex');
const id = () => crypto.randomBytes(6).toString('hex');

function clampStr(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Проверяет и нормализует викторину, присланную ведущим. Бросает Error с понятным текстом. */
function sanitizeQuiz(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Викторина не передана');
  const title = clampStr(raw.title, 120) || 'Без названия';
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) throw new Error('В викторине нет вопросов');
  if (raw.questions.length > 100) throw new Error('Слишком много вопросов (максимум 100)');

  const questions = raw.questions.map((q, i) => {
    const n = i + 1;
    const text = clampStr(q && q.text, 300);
    if (!text) throw new Error(`Вопрос ${n}: нет текста`);
    const type = q.type === 'truefalse' ? 'truefalse' : 'quiz';
    let answers = Array.isArray(q.answers) ? q.answers.map((a) => clampStr(a, 120)) : [];
    if (type === 'truefalse') answers = ['Верно', 'Неверно'];
    answers = answers.slice(0, 4);
    const correctRaw = Array.isArray(q.correct) ? q.correct : [q.correct];
    // Убираем пустые варианты, пересчитывая индексы правильных
    const kept = [];
    const correct = [];
    answers.forEach((a, idx) => {
      if (!a) return;
      if (correctRaw.includes(idx)) correct.push(kept.length);
      kept.push(a);
    });
    if (kept.length < 2) throw new Error(`Вопрос ${n}: нужно минимум 2 варианта ответа`);
    if (correct.length === 0) throw new Error(`Вопрос ${n}: отметьте правильный ответ`);
    const timeLimit = ALLOWED_TIMES.includes(Number(q.timeLimit)) ? Number(q.timeLimit) : 20;
    const points = [0, 1, 2].includes(Number(q.points)) ? Number(q.points) : 1;
    let image = clampStr(q.image, 500);
    if (image && !/^https?:\/\//i.test(image)) image = '';
    return { text, type, answers: kept, correct, timeLimit, points, image };
  });

  return { title, questions };
}

class Game {
  constructor({ io, pin, quiz, settings }) {
    this.io = io;
    this.pin = pin;
    const clean = sanitizeQuiz(quiz);
    this.settings = {
      showOnDevices: settings ? settings.showOnDevices !== false : true,
      shuffleQuestions: !!(settings && settings.shuffleQuestions),
    };
    this.title = clean.title;
    this.questions = this.settings.shuffleQuestions ? shuffle(clean.questions) : clean.questions;
    this.hostToken = token();
    this.hostSocketId = null;
    this.players = new Map(); // playerId -> player
    this.phase = PHASE.LOBBY;
    this.qIndex = -1;
    this.locked = false;
    this.timer = null;
    this.phaseEndsAt = 0;
    this.questionStartedAt = 0;
    this.answers = new Map(); // playerId -> { index, elapsedMs }
    this.lastReveal = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  get question() {
    return this.questions[this.qIndex] || null;
  }

  // ---------- Игроки ----------

  addPlayer({ name, avatar, socketId }) {
    if (this.locked) throw new Error('Ведущий закрыл вход в игру');
    if (this.phase === PHASE.FINAL) throw new Error('Игра уже закончилась');
    if (this.players.size >= MAX_PLAYERS) throw new Error('Комната заполнена');
    const clean = clampStr(name, 20);
    if (clean.length < 1) throw new Error('Введите имя');
    const lower = clean.toLowerCase();
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === lower) throw new Error('Такое имя уже занято — выберите другое');
    }
    const player = {
      id: id(),
      token: token(),
      name: clean,
      avatar: AVATARS.includes(avatar) ? avatar : AVATARS[crypto.randomInt(AVATARS.length)],
      score: 0,
      streak: 0,
      correctCount: 0,
      lastPoints: 0,
      lastCorrect: null,
      prevRank: null,
      socketId,
      connected: true,
      joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    this.touch();
    this.broadcast();
    return player;
  }

  reconnectPlayer(tok, socketId) {
    for (const p of this.players.values()) {
      if (p.token === tok) {
        p.socketId = socketId;
        p.connected = true;
        this.touch();
        this.broadcast();
        return p;
      }
    }
    return null;
  }

  playerDisconnected(socketId) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.connected = false;
        p.disconnectedAt = Date.now();
        this.broadcastHost();
        // Если он так и не вернётся, а остальные уже ответили, — закрываем вопрос
        setTimeout(() => this.maybeFinishEarly(), RECONNECT_GRACE_MS + 100).unref();
        return p;
      }
    }
    return null;
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    this.answers.delete(playerId);
    if (p.socketId) this.io.to(p.socketId).emit('kicked');
    this.broadcast();
    this.maybeFinishEarly();
  }

  // ---------- Ход игры ----------

  start() {
    if (this.phase !== PHASE.LOBBY) return;
    if (this.players.size === 0) throw new Error('Дождитесь хотя бы одного участника');
    this.nextQuestion();
  }

  next() {
    this.touch();
    switch (this.phase) {
      case PHASE.LOBBY:
        return this.start();
      case PHASE.PREVIEW:
        return this.openQuestion();
      case PHASE.QUESTION:
        return this.reveal();
      case PHASE.REVEAL:
        return this.qIndex >= this.questions.length - 1 ? this.finish() : this.showLeaderboard();
      case PHASE.LEADERBOARD:
        return this.nextQuestion();
      default:
        return undefined;
    }
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  nextQuestion() {
    this.clearTimer();
    this.qIndex += 1;
    if (this.qIndex >= this.questions.length) return this.finish();
    this.answers.clear();
    this.lastReveal = null;
    this.phase = PHASE.PREVIEW;
    this.phaseEndsAt = Date.now() + PREVIEW_MS;
    this.timer = setTimeout(() => this.openQuestion(), PREVIEW_MS);
    this.broadcast();
    return undefined;
  }

  openQuestion() {
    if (this.phase !== PHASE.PREVIEW) return;
    this.clearTimer();
    const q = this.question;
    this.phase = PHASE.QUESTION;
    this.questionStartedAt = Date.now();
    this.phaseEndsAt = this.questionStartedAt + q.timeLimit * 1000;
    this.timer = setTimeout(() => this.reveal(), q.timeLimit * 1000 + ANSWER_GRACE_MS);
    this.broadcast();
  }

  submitAnswer(playerId, index) {
    if (this.phase !== PHASE.QUESTION) throw new Error('Сейчас нельзя отвечать');
    const p = this.players.get(playerId);
    if (!p) throw new Error('Игрок не найден');
    if (this.answers.has(playerId)) throw new Error('Ответ уже принят');
    const q = this.question;
    if (!Number.isInteger(index) || index < 0 || index >= q.answers.length) throw new Error('Неверный вариант');
    const now = Date.now();
    if (now > this.phaseEndsAt + ANSWER_GRACE_MS) throw new Error('Время вышло');
    const elapsedMs = Math.max(0, Math.min(now - this.questionStartedAt, q.timeLimit * 1000));
    this.answers.set(playerId, { index, elapsedMs });
    this.touch();
    this.emitToPlayer(p);
    this.broadcastHost();
    this.maybeFinishEarly();
  }

  maybeFinishEarly() {
    if (this.phase !== PHASE.QUESTION) return;
    const now = Date.now();
    const active = [...this.players.values()].filter((p) => p.connected || now - (p.disconnectedAt || 0) < RECONNECT_GRACE_MS);
    if (active.length > 0 && active.every((p) => this.answers.has(p.id))) {
      // Небольшая пауза, чтобы последний ответивший увидел «ответ принят»
      this.clearTimer();
      this.timer = setTimeout(() => this.reveal(), 700);
    }
  }

  reveal() {
    if (this.phase !== PHASE.QUESTION) return;
    this.clearTimer();
    const q = this.question;
    const ranksBefore = this.rankMap();
    const counts = q.answers.map(() => 0);
    for (const p of this.players.values()) {
      p.prevRank = ranksBefore.get(p.id) || null;
      const a = this.answers.get(p.id);
      if (a) counts[a.index] += 1;
      const correct = !!a && q.correct.includes(a.index);
      let points = 0;
      if (correct) {
        p.streak += 1;
        p.correctCount += 1;
        if (q.points > 0) {
          const speed = 1 - a.elapsedMs / (q.timeLimit * 1000) / 2; // от 1.0 до 0.5
          const streakBonus = Math.min(p.streak - 1, 5) * 100;
          points = Math.round(BASE_POINTS * speed) * q.points + streakBonus;
        }
      } else {
        p.streak = 0;
      }
      p.lastCorrect = a ? correct : null; // null — не ответил
      p.lastPoints = points;
      p.score += points;
    }
    this.lastReveal = { counts, correct: q.correct.slice(), answered: this.answers.size };
    this.phase = PHASE.REVEAL;
    this.phaseEndsAt = 0;
    this.broadcast();
  }

  showLeaderboard() {
    this.clearTimer();
    this.phase = PHASE.LEADERBOARD;
    this.broadcast();
  }

  finish() {
    this.clearTimer();
    if (this.phase === PHASE.QUESTION) this.reveal();
    this.phase = PHASE.FINAL;
    this.phaseEndsAt = 0;
    this.broadcast();
  }

  setLocked(v) {
    this.locked = !!v;
    this.broadcastHost();
  }

  destroy() {
    this.clearTimer();
    for (const p of this.players.values()) {
      if (p.socketId) this.io.to(p.socketId).emit('room-closed');
    }
  }

  // ---------- Рейтинг ----------

  ranking() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  }

  rankMap() {
    const m = new Map();
    this.ranking().forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }

  // ---------- Представления для клиентов ----------

  baseView() {
    return {
      phase: this.phase,
      pin: this.pin,
      title: this.title,
      qIndex: this.qIndex,
      qTotal: this.questions.length,
      remainingMs: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - Date.now()) : 0,
    };
  }

  hostView() {
    const q = this.question;
    const ranking = this.ranking();
    const view = {
      ...this.baseView(),
      role: 'host',
      locked: this.locked,
      settings: this.settings,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, score: p.score })),
      question: q
        ? { text: q.text, type: q.type, answers: q.answers, timeLimit: q.timeLimit, points: q.points, image: q.image }
        : null,
      answeredCount: this.answers.size,
      activeCount: [...this.players.values()].filter((p) => p.connected).length,
      reveal: this.phase === PHASE.REVEAL ? this.lastReveal : null,
    };
    if (this.phase === PHASE.LEADERBOARD || this.phase === PHASE.FINAL || this.phase === PHASE.REVEAL) {
      view.leaderboard = ranking.map((p, i) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        lastPoints: p.lastPoints,
        rank: i + 1,
        prevRank: p.prevRank,
        correctCount: p.correctCount,
        streak: p.streak,
      }));
      if (this.phase !== PHASE.FINAL) view.leaderboard = view.leaderboard.slice(0, 5);
    }
    return view;
  }

  playerView(p) {
    const q = this.question;
    const view = { ...this.baseView(), role: 'player', showOnDevices: this.settings.showOnDevices };
    const ranking = this.ranking();
    const rank = ranking.findIndex((x) => x.id === p.id) + 1;
    view.me = { id: p.id, name: p.name, avatar: p.avatar, score: p.score, streak: p.streak, rank, total: ranking.length };
    if (q && this.phase !== PHASE.LOBBY) {
      view.question = { type: q.type, answersCount: q.answers.length, timeLimit: q.timeLimit, points: q.points };
      if (this.settings.showOnDevices) {
        view.question.text = q.text;
        view.question.answers = q.answers;
        view.question.image = q.image;
      }
    }
    const mine = this.answers.get(p.id);
    view.myAnswer = mine ? mine.index : null;
    if (this.phase === PHASE.REVEAL || this.phase === PHASE.LEADERBOARD || this.phase === PHASE.FINAL) {
      const ahead = rank > 1 ? ranking[rank - 2] : null;
      view.result = {
        correct: p.lastCorrect,
        points: p.lastPoints,
        streak: p.streak,
        aheadName: ahead ? ahead.name : null,
        gap: ahead ? ahead.score - p.score : 0,
        correctIndices: q ? q.correct : [],
        correctTexts: q ? q.correct.map((i) => q.answers[i]) : [],
        correctCount: p.correctCount,
      };
    }
    return view;
  }

  emitToPlayer(p) {
    if (p.socketId && p.connected) this.io.to(p.socketId).emit('state', this.playerView(p));
  }

  broadcastHost() {
    if (this.hostSocketId) this.io.to(this.hostSocketId).emit('state', this.hostView());
  }

  broadcast() {
    this.broadcastHost();
    for (const p of this.players.values()) this.emitToPlayer(p);
  }
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map();
    // Удаляем заброшенные комнаты
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  newPin() {
    for (let i = 0; i < 1000; i++) {
      const pin = String(crypto.randomInt(100000, 1000000));
      if (!this.games.has(pin)) return pin;
    }
    throw new Error('Не удалось создать комнату');
  }

  create(quiz, settings) {
    const pin = this.newPin();
    const game = new Game({ io: this.io, pin, quiz, settings });
    this.games.set(pin, game);
    return game;
  }

  get(pin) {
    return this.games.get(String(pin || '').replace(/\D/g, '')) || null;
  }

  remove(pin) {
    const g = this.games.get(pin);
    if (g) {
      g.destroy();
      this.games.delete(pin);
    }
  }

  sweep() {
    const now = Date.now();
    for (const [pin, g] of this.games) {
      const idle = now - g.lastActivity;
      if (idle > 3 * 60 * 60 * 1000 || (g.phase === PHASE.FINAL && idle > 30 * 60 * 1000)) this.remove(pin);
    }
  }
}

module.exports = { Game, GameManager, PHASE, AVATARS, sanitizeQuiz };
