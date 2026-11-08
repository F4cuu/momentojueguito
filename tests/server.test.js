const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');

function connect(port) {
  return new Promise(res => {
    const ws = new WebSocket('ws://localhost:' + port);
    ws.latest = null;
    ws.pending = new Map();
    ws.seq = 0;
    ws.events = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.ack != null) { ws.pending.get(m.ack)(m.data); ws.pending.delete(m.ack); }
      else if (m.ev === 'state') ws.latest = m.data;
      else ws.events.push(m);
    });
    ws.on('open', () => res(ws));
  });
}
const emit = (ws, ev, data) => new Promise(res => {
  const n = ++ws.seq;
  ws.pending.set(n, res);
  ws.send(JSON.stringify({ ev, data, ack: n }));
});
const wait = ms => new Promise(r => setTimeout(r, ms));

test('flujo completo cliente-servidor: sorteo privado, turnos, ragdoll y revancha', async () => {
  const { server } = createServer();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const [a, b, c] = [await connect(port), await connect(port), await connect(port)];
  try {
    const created = await emit(a, 'createRoom', { name: 'Ana' });
    assert.match(created.code, /^[A-Z]{4}$/);
    assert.equal((await emit(b, 'joinRoom', { code: created.code, name: 'Beto' })).ok, true);
    assert.equal((await emit(c, 'joinRoom', { code: created.code, name: 'Carla' })).error, 'SALA_LLENA');
    assert.equal((await emit(c, 'joinRoom', { code: 'ZZZZ' })).error, 'SALA_NO_EXISTE');
    assert.equal((await emit(a, 'hackear', {})).error, 'EVENTO_DESCONOCIDO');

    await emit(a, 'ready');
    await emit(b, 'ready');
    await wait(100);
    assert.equal(a.latest.phase, 'playing');
    assert.notEqual(a.latest.myCharacter, b.latest.myCharacter);
    assert.equal(a.latest.opponentCharacter, undefined);
    assert.equal(JSON.stringify(a.latest).includes(b.latest.myCharacter), false);

    // el arrastre se reenvía al rival
    a.send(JSON.stringify({ ev: 'dragMove', data: { id: 'x', x: 10, y: 20 } }));
    await wait(100);
    assert.equal(b.events.some(e => e.ev === 'dragMove' && e.data.x === 10), true);

    const turnPlayer = a.latest.turn === 0 ? a : b;
    const other = turnPlayer === a ? b : a;
    assert.equal((await emit(other, 'ask', { text: 'hola' })).error, 'NO_ES_TU_TURNO');
    assert.equal((await emit(other, 'skip')).error, 'NO_ES_TU_TURNO');
    assert.equal((await emit(turnPlayer, 'ask', { text: '¿Es chica?' })).ok, true);
    assert.equal((await emit(other, 'answer', { answer: 'No' })).ok, true);

    // ceder turno desde el que tiene el turno ahora (other) y volver a ceder
    const skipper = other;
    assert.equal((await emit(skipper, 'skip')).ok, true);
    await wait(50);
    assert.equal((await emit(turnPlayer, 'skip')).ok, true);
    await wait(50);
    assert.ok(a.latest.chat.some(m => m.kind === 'skip'));

    const res = await emit(other, 'guess', { characterId: turnPlayer.latest.myCharacter });
    assert.equal(res.result.correct, true);
    await wait(100);
    assert.equal(a.latest.phase, 'roundOver');
    assert.ok(a.latest.opponentCharacter);

    await emit(a, 'rematch', { yes: true });
    await emit(b, 'rematch', { yes: true });
    await wait(100);
    assert.equal(a.latest.phase, 'playing');
    assert.deepEqual(a.latest.players.map(p => p.lives), [2, 2]);
  } finally {
    [a, b, c].forEach(s => s.close());
    server.close();
  }
});

test('reconexión con token recupera al jugador en la misma sala', async () => {
  const { server } = createServer();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const a = await connect(port);
  const b = await connect(port);
  try {
    const { code, token } = await emit(a, 'createRoom', { name: 'Ana' });
    await emit(b, 'joinRoom', { code, name: 'Beto' });
    a.close();
    await wait(100);
    assert.equal(b.latest.players[0].connected, false);
    const a2 = await connect(port);
    const r = await emit(a2, 'joinRoom', { code, token });
    assert.equal(r.reconnected, true);
    await wait(100);
    assert.equal(b.latest.players[0].connected, true);
    a2.close();
  } finally {
    b.close();
    server.close();
  }
});

test('no se puede salir de la carpeta public (path traversal)', async () => {
  const { server } = createServer();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/..%2Fserver.js`);
    assert.notEqual(res.status, 200);
  } finally { server.close(); }
});
