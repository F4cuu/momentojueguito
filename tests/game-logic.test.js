const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game-logic');

const CHARS = Array.from({ length: 10 }, (_, i) => 'c' + i);

function ready2() {
  const room = G.createRoom('ABCD');
  const a = G.addPlayer(room, 's1', 'Ana');
  const b = G.addPlayer(room, 's2', 'Beto');
  G.setReady(room, 's1');
  G.setReady(room, 's2');
  return { room, a, b };
}

function started(rng) {
  const ctx = ready2();
  G.startRound(ctx.room, CHARS, rng);
  return ctx;
}
const idAt = (room, i) => room.players[i].id;

test('la sala no admite un tercer jugador', () => {
  const { room } = ready2();
  assert.throws(() => G.addPlayer(room, 's3', 'Carla'), /SALA_LLENA/);
});

test('allReady es true solo con 2 jugadores listos', () => {
  const room = G.createRoom('X');
  G.addPlayer(room, 's1', 'Ana');
  G.setReady(room, 's1');
  assert.equal(G.allReady(room), false);
  G.addPlayer(room, 's2', 'Beto');
  assert.equal(G.allReady(room), false);
  G.setReady(room, 's2');
  assert.equal(G.allReady(room), true);
});

test('los personajes sorteados son siempre distintos (1000 rondas)', () => {
  for (let i = 0; i < 1000; i++) {
    const { room } = started();
    assert.notEqual(room.players[0].character, room.players[1].character);
    assert.ok(CHARS.includes(room.players[0].character));
    assert.ok(CHARS.includes(room.players[1].character));
  }
});

test('el sorteo es realmente aleatorio: aparecen todos los personajes', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const { room } = started();
    seen.add(room.players[0].character);
    seen.add(room.players[1].character);
  }
  assert.equal(seen.size, CHARS.length);
});

test('cada jugador empieza con 2 vidas y el estado es playing', () => {
  const { room } = started();
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.players.map(p => p.lives), [2, 2]);
  assert.equal(room.awaiting, 'ask');
});

test('el jugador sin turno no puede preguntar', () => {
  const { room } = started();
  const other = idAt(room, 1 - room.turn);
  assert.throws(() => G.ask(room, other, 'hola'), /NO_ES_TU_TURNO/);
});

test('flujo pregunta -> respuesta cambia el turno', () => {
  const { room } = started();
  const t = room.turn;
  G.ask(room, idAt(room, t), '¿Es hombre?');
  assert.equal(room.awaiting, 'answer');
  assert.throws(() => G.ask(room, idAt(room, t), 'otra'), /ESPERANDO_RESPUESTA/);
  assert.throws(() => G.answer(room, idAt(room, t), 'Sí'), /NO_PUEDES_RESPONDER/);
  assert.throws(() => G.answer(room, idAt(room, 1 - t), 'Quizás'), /RESPUESTA_INVALIDA/);
  G.answer(room, idAt(room, 1 - t), 'Sí');
  assert.equal(room.turn, 1 - t);
  assert.equal(room.awaiting, 'ask');
  assert.equal(room.chat.length, 2);
});

test('pregunta vacía o enorme es rechazada', () => {
  const { room } = started();
  const id = idAt(room, room.turn);
  assert.throws(() => G.ask(room, id, '   '), /PREGUNTA_INVALIDA/);
  assert.throws(() => G.ask(room, id, 'x'.repeat(500)), /PREGUNTA_INVALIDA/);
});

test('adivinar sin tu turno es rechazado', () => {
  const { room } = started();
  const other = idAt(room, 1 - room.turn);
  assert.throws(() => G.guess(room, other, 'c1'), /NO_ES_TU_TURNO/);
});

test('acierto gana la ronda y suma al marcador', () => {
  const { room } = started();
  const t = room.turn;
  const target = room.players[1 - t].character;
  const r = G.guess(room, idAt(room, t), target);
  assert.equal(r.correct, true);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.winner, t);
  assert.equal(room.wins[t], 1);
});

test('fallo resta una vida y pasa el turno; con 0 vidas pierde', () => {
  const { room } = started();
  const t = room.turn;
  const wrong = CHARS.find(c => c !== room.players[1 - t].character);
  const r1 = G.guess(room, idAt(room, t), wrong);
  assert.equal(r1.correct, false);
  assert.equal(room.players[t].lives, 1);
  assert.equal(room.turn, 1 - t);
  assert.equal(room.phase, 'playing');
  // el rival pasa su turno con un fallo y vuelve a ser el turno de t
  const wrong2 = CHARS.find(c => c !== room.players[t].character);
  G.guess(room, idAt(room, 1 - t), wrong2);
  assert.equal(room.turn, t);
  const r2 = G.guess(room, idAt(room, t), wrong);
  assert.equal(room.players[t].lives, 0);
  assert.equal(r2.roundOver, true);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.winner, 1 - t);
  assert.equal(room.wins[1 - t], 1);
});

test('adivinar con personaje inexistente es rechazado', () => {
  const { room } = started();
  assert.throws(() => G.guess(room, idAt(room, room.turn), 'zzz'), /PERSONAJE_INVALIDO/);
});

test('adivinar después de terminada la ronda es ignorado', () => {
  const { room } = started();
  const t = room.turn;
  G.guess(room, idAt(room, t), room.players[1 - t].character);
  assert.throws(() => G.guess(room, idAt(room, t), 'c1'), /RONDA_NO_ACTIVA/);
  assert.throws(() => G.ask(room, idAt(room, t), 'hola'), /RONDA_NO_ACTIVA/);
});

test('viewFor oculta el personaje del rival hasta el final', () => {
  const { room } = started();
  const v = G.viewFor(room, idAt(room, 0));
  assert.equal(v.myCharacter, room.players[0].character);
  assert.equal(v.opponentCharacter, undefined);
  assert.equal(JSON.stringify(v).includes(room.players[1].character), false);
  const t = room.turn;
  G.guess(room, idAt(room, t), room.players[1 - t].character);
  const v2 = G.viewFor(room, idAt(room, 0));
  assert.equal(v2.opponentCharacter, room.players[1].character);
});

test('revancha: ambos aceptan -> nueva ronda con nuevo sorteo y vidas', () => {
  const { room } = started();
  const t = room.turn;
  G.guess(room, idAt(room, t), room.players[1 - t].character);
  G.rematchVote(room, idAt(room, 0), true);
  assert.equal(room.phase, 'roundOver');
  const res = G.rematchVote(room, idAt(room, 1), true, CHARS);
  assert.equal(res.started, true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.players.map(p => p.lives), [2, 2]);
  assert.notEqual(room.players[0].character, room.players[1].character);
  assert.equal(room.turn, 1 - t); // empieza quien perdió
  assert.equal(room.wins[t], 1); // el marcador se conserva
});

test('revancha: si alguien dice que no, la partida termina', () => {
  const { room } = started();
  const t = room.turn;
  G.guess(room, idAt(room, t), room.players[1 - t].character);
  G.rematchVote(room, idAt(room, 0), false);
  assert.equal(room.phase, 'ended');
});

test('reconexión por token conserva el estado del jugador', () => {
  const { room, a } = started();
  const char = room.players[0].character;
  const r = G.reconnect(room, a.token, 's9');
  assert.equal(r.index, 0);
  assert.equal(room.players[0].id, 's9');
  assert.equal(room.players[0].character, char);
  assert.equal(G.reconnect(room, 'token-falso', 's10'), null);
});
