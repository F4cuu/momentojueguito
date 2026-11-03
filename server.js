'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game-logic');

const PUBLIC_DIR = path.join(__dirname, 'public');
const characters = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'characters.json'), 'utf8'));
const CHARACTER_IDS = characters.map(c => c.id);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O
const ROOM_TTL_MS = 10 * 60 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function serveStatic(req, res) {
  if (req.url.split('?')[0] === '/health') { res.end('ok'); return; }
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); } catch { rel = '/'; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.statusCode = 403; res.end('Prohibido'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end('No encontrado'); return; }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    if (/\.(webp|png|jpg|mp3|wav)$/i.test(file)) res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(data);
  });
}

function createServer() {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, maxPayload: 1e5 });
  const rooms = new Map();
  const conns = new Map(); // id de conexión -> ws

  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const send = (id, ev, data) => {
    const ws = conns.get(id);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ ev, data }));
  };
  const pushState = room => room.players.forEach(p => send(p.id, 'state', G.viewFor(room, p.id)));
  const opponentId = (room, id) => {
    const i = room.players.findIndex(p => p.id === id);
    const o = room.players[1 - i];
    return o && o.connected ? o.id : null;
  };

  wss.on('connection', ws => {
    const id = crypto.randomBytes(8).toString('hex');
    conns.set(id, ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    let room = null;

    // Ejecuta una acción de reglas; si lanza, responde el código de error y no cambia nada.
    const act = (fn, reply) => {
      if (!room) return reply({ error: 'SIN_SALA' });
      try { const result = fn(); reply({ ok: true, result }); pushState(room); }
      catch (e) { reply({ error: e.message }); }
    };

    const handlers = {
      createRoom({ name } = {}, reply) {
        const code = newCode();
        room = G.createRoom(code);
        room.createdAt = Date.now();
        rooms.set(code, room);
        const { token } = G.addPlayer(room, id, name);
        reply({ ok: true, code, token });
        pushState(room);
      },
      joinRoom({ code, name, token } = {}, reply) {
        const target = rooms.get(String(code || '').toUpperCase());
        if (!target) return reply({ error: 'SALA_NO_EXISTE' });
        try {
          if (token) {
            const r = G.reconnect(target, token, id);
            if (r) {
              room = target;
              reply({ ok: true, code: target.code, token, reconnected: true });
              return pushState(room);
            }
          }
          const { token: newToken } = G.addPlayer(target, id, name);
          room = target;
          reply({ ok: true, code: target.code, token: newToken });
          pushState(room);
        } catch (e) { reply({ error: e.message }); }
      },
      ready: (_, reply) => act(() => {
        G.setReady(room, id);
        if (G.allReady(room)) G.startRound(room, CHARACTER_IDS);
      }, reply),
      ask: ({ text } = {}, reply) => act(() => G.ask(room, id, text), reply),
      answer: ({ answer } = {}, reply) => act(() => G.answer(room, id, answer), reply),
      notes: ({ owner, text } = {}, reply) => act(() => G.setNotes(room, id, owner, text), reply),
      guess: ({ characterId } = {}, reply) => act(() => {
        const r = G.guess(room, id, characterId);
        const by = room.players.findIndex(p => p.id === id);
        room.players.forEach(p => send(p.id, 'guessResult', { by, characterId, correct: r.correct }));
        return r;
      }, reply),
      rematch: ({ yes } = {}, reply) => act(() => G.rematchVote(room, id, yes, CHARACTER_IDS), reply),
    };
    // Eventos efímeros del ragdoll: se reenvían al rival sin tocar el estado del juego.
    const RELAY = new Set(['dragMove', 'dragEnd', 'zoneDrop', 'zoneCancel']);

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.ev !== 'string') return;
      const reply = payload => { if (msg.ack != null && ws.readyState === 1) ws.send(JSON.stringify({ ack: msg.ack, data: payload })); };
      if (RELAY.has(msg.ev)) {
        if (!room) return;
        const o = opponentId(room, id);
        if (o) send(o, msg.ev, msg.data);
        return;
      }
      const h = Object.prototype.hasOwnProperty.call(handlers, msg.ev) ? handlers[msg.ev] : null;
      if (!h) return reply({ error: 'EVENTO_DESCONOCIDO' });
      h(msg.data, reply);
    });

    ws.on('close', () => {
      conns.delete(id);
      if (!room) return;
      const p = room.players.find(x => x.id === id);
      if (p) p.connected = false;
      room.lastActivity = Date.now();
      pushState(room);
    });
  });

  // Mantiene viva la conexión (útil detrás de proxys) y descarta las muertas.
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
    const now = Date.now();
    for (const [code, r] of rooms) {
      const empty = r.players.every(p => !p.connected);
      if (empty && now - (r.lastActivity || r.createdAt || now) > ROOM_TTL_MS) rooms.delete(code);
    }
  }, 30 * 1000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));

  return { server, wss, rooms };
}

if (require.main === module) {
  const { server } = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log('Juego en http://localhost:' + port));
}

module.exports = { createServer };
