'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { GameManager, gameError } = require('./src/game');

const PORT = Number(process.env.PORT) || 3000;
// Публичный адрес (например, после деплоя или туннеля): https://my-quiz.onrender.com
// На Render он подставляется автоматически из RENDER_EXTERNAL_URL.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 10000, pingTimeout: 8000 });
const games = new GameManager(io);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const PUBLIC_DIR = path.join(__dirname, 'public');
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get(['/join', '/play'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.get('/api/info', (req, res) => {
  res.json({
    publicUrl: PUBLIC_URL,
    lanUrls: lanAddresses().map((ip) => `http://${ip}:${PORT}`),
  });
});

app.get('/api/qr', async (req, res) => {
  const data = String(req.query.data || '').slice(0, 600);
  if (!data) return res.status(400).send('data required');
  try {
    const svg = await QRCode.toString(data, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0d1321', light: '#ffffff' },
    });
    res.set('Cache-Control', 'public, max-age=3600').type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).send('qr error');
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, rooms: games.games.size }));

// ---------------- Сокеты ----------------

const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {});
const fail = (ack, e) => ack({ ok: false, code: (e && e.code) || undefined, error: e && e.message ? e.message : String(e) });

io.on('connection', (socket) => {
  const hostGame = () => {
    if (socket.data.role !== 'host') return null;
    const g = games.get(socket.data.pin);
    return g && g.hostSocketId === socket.id ? g : null;
  };
  const playerCtx = () => {
    if (socket.data.role !== 'player') return null;
    const g = games.get(socket.data.pin);
    const p = g && g.players.get(socket.data.playerId);
    return g && p ? { g, p } : null;
  };

  // --- Ведущий ---
  socket.on('host:create', (payload, ack) => {
    ack = safeAck(ack);
    try {
      const g = games.create(payload && payload.quiz, payload && payload.settings);
      g.hostSocketId = socket.id;
      socket.data = { role: 'host', pin: g.pin };
      ack({ ok: true, pin: g.pin, hostToken: g.hostToken });
      g.broadcastHost();
    } catch (e) {
      fail(ack, e);
    }
  });

  socket.on('host:rejoin', (payload, ack) => {
    ack = safeAck(ack);
    const g = games.get(payload && payload.pin);
    if (!g || g.hostToken !== (payload && payload.hostToken)) return fail(ack, gameError('game_not_found', 'Игра не найдена'));
    if (g.hostSocketId && g.hostSocketId !== socket.id) io.to(g.hostSocketId).emit('host-replaced');
    g.hostSocketId = socket.id;
    socket.data = { role: 'host', pin: g.pin };
    g.touch();
    ack({ ok: true, pin: g.pin });
    g.broadcastHost();
  });

  socket.on('host:action', (payload, ack) => {
    ack = safeAck(ack);
    const g = hostGame();
    if (!g) return fail(ack, gameError('no_access', 'Нет доступа к игре'));
    const action = payload && payload.action;
    try {
      switch (action) {
        case 'start':
          g.start();
          break;
        case 'next':
          g.next();
          break;
        case 'kick':
          g.kick(String(payload.playerId || ''));
          break;
        case 'lock':
          g.setLocked(!!payload.value);
          break;
        case 'end':
          g.finish();
          break;
        case 'close':
          games.remove(g.pin);
          socket.data = {};
          break;
        default:
          throw new Error('Неизвестное действие');
      }
      ack({ ok: true });
    } catch (e) {
      fail(ack, e);
    }
  });

  // --- Участник ---
  socket.on('room:check', (payload, ack) => {
    ack = safeAck(ack);
    const g = games.get(payload && payload.pin);
    if (!g) return ack({ ok: false, code: 'pin_not_found', error: 'Игра с таким PIN не найдена' });
    if (g.locked) return ack({ ok: false, code: 'locked', error: 'Вход в игру закрыт ведущим' });
    if (g.phase === 'final') return ack({ ok: false, code: 'ended', error: 'Эта игра уже закончилась' });
    ack({ ok: true, title: g.title, started: g.phase !== 'lobby' });
  });

  socket.on('player:join', (payload, ack) => {
    ack = safeAck(ack);
    const g = games.get(payload && payload.pin);
    if (!g) return fail(ack, gameError('pin_not_found', 'Игра с таким PIN не найдена'));
    try {
      const p = g.addPlayer({ name: payload.name, socketId: socket.id });
      socket.data = { role: 'player', pin: g.pin, playerId: p.id };
      ack({ ok: true, token: p.token, playerId: p.id });
      g.emitToPlayer(p);
    } catch (e) {
      fail(ack, e);
    }
  });

  socket.on('player:rejoin', (payload, ack) => {
    ack = safeAck(ack);
    const g = games.get(payload && payload.pin);
    const p = g && g.reconnectPlayer(String((payload && payload.token) || ''), socket.id);
    if (!p) return fail(ack, gameError('session_not_found', 'Сессия не найдена'));
    socket.data = { role: 'player', pin: g.pin, playerId: p.id };
    ack({ ok: true, playerId: p.id });
    g.emitToPlayer(p);
  });

  socket.on('player:answer', (payload, ack) => {
    ack = safeAck(ack);
    const ctx = playerCtx();
    if (!ctx) return fail(ack, gameError('not_in_game', 'Вы не в игре'));
    try {
      ctx.g.submitAnswer(ctx.p.id, Number(payload && payload.index));
      ack({ ok: true });
    } catch (e) {
      fail(ack, e);
    }
  });

  socket.on('player:leave', () => {
    const ctx = playerCtx();
    if (ctx) ctx.g.kick(ctx.p.id);
    socket.data = {};
  });

  socket.on('disconnect', () => {
    const { role, pin } = socket.data || {};
    const g = pin && games.get(pin);
    if (!g) return;
    if (role === 'host' && g.hostSocketId === socket.id) g.hostSocketId = null;
    if (role === 'player') g.playerDisconnected(socket.id);
  });
});

server.listen(PORT, () => {
  const lan = lanAddresses();
  console.log('\n  QuizPulse запущен');
  console.log(`  Ведущий:   http://localhost:${PORT}/host`);
  if (PUBLIC_URL) console.log(`  Публичный адрес: ${PUBLIC_URL}`);
  lan.forEach((ip) => console.log(`  В локальной сети: http://${ip}:${PORT}`));
  console.log('');
});
