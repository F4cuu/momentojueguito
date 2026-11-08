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

test('los personajes se sortean por separado: pueden coincidir y siempre salen del pool', () => {
  let same = 0;
  for (let i = 0; i < 2000; i++) {
    const { room } = started();
    assert.ok(CHARS.includes(room.players[0].character));
    assert.ok(CHARS.includes(room.players[1].character));
    if (room.players[0].character === room.players[1].character) same++;
  }
  assert.ok(same > 0, 'con pool chico tiene que haber coincidencias');
});

const POOLS = { bc: ['x', 'y'], dnd: ['p', 'q'], jjk: ['j1', 'j2'] };
function choosing() {
  const room = G.createRoom('ABCD');
  G.addPlayer(room, 'a', 'Ana');
  G.addPlayer(room, 'b', 'Beto');
  G.setReady(room, 'a');
  G.setReady(room, 'b');
  G.beginChoosing(room, POOLS);
  return room;
}

test('configuración: arranca con todos los pools tildados y modo adivinar personaje', () => {
  const room = choosing();
  assert.equal(room.phase, 'choosing');
  assert.deepEqual(room.draft, { pools: ['bc', 'dnd', 'jjk'], gameMode: 'guess' });
});

test('configuración: pools múltiples, validación y aceptación de los dos', () => {
  const room = choosing();
  assert.throws(() => G.setDraft(room, 'a', { pools: [], gameMode: 'guess' }, POOLS), /POOLS_INVALIDOS/);
  assert.throws(() => G.setDraft(room, 'a', { pools: ['bc', 'otro'], gameMode: 'guess' }, POOLS), /POOLS_INVALIDOS/);
  assert.throws(() => G.setDraft(room, 'a', { pools: ['bc'], gameMode: 'raro' }, POOLS), /MODO_INVALIDO/);
  G.setDraft(room, 'a', { pools: ['jjk', 'bc'], gameMode: 'guess' }, POOLS);
  assert.equal(G.acceptDraft(room, 'a', POOLS).started, false);
  // si el otro cambia algo, se anulan las aceptaciones
  G.setDraft(room, 'b', { pools: ['bc', 'jjk'], gameMode: 'guess' }, POOLS);
  assert.deepEqual(room.accept, [false, false]);
  G.acceptDraft(room, 'a', POOLS);
  assert.equal(G.acceptDraft(room, 'b', POOLS).started, true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.pools, ['bc', 'jjk']);
  assert.deepEqual(room.pool.sort(), ['j1', 'j2', 'x', 'y']);
  assert.ok(room.pool.includes(room.players[0].character));
  assert.deepEqual(G.viewFor(room, 'a').pools, ['bc', 'jjk']);
});

function groupPlaying() {
  const room = choosing();
  G.setDraft(room, 'a', { pools: ['bc', 'dnd'], gameMode: 'group' }, POOLS);
  G.acceptDraft(room, 'a', POOLS);
  G.acceptDraft(room, 'b', POOLS);
  return room;
}

test('grupo social: cada uno escribe su frase secreta y recién ahí se juega', () => {
  const room = groupPlaying();
  assert.equal(room.phase, 'setup');
  assert.equal(room.players[0].character, null);
  assert.throws(() => G.setPhrase(room, 'a', '  '), /FRASE_INVALIDA/);
  assert.equal(G.setPhrase(room, 'a', 'pelo negro').started, false);
  assert.throws(() => G.ask(room, 'a', 'hola'), /RONDA_NO_ACTIVA/);
  assert.equal(G.setPhrase(room, 'b', 'murieron').started, true);
  assert.equal(room.phase, 'playing');
  const va = G.viewFor(room, 'a');
  assert.equal(va.myPhrase, 'pelo negro');
  assert.equal(va.opponentPhrase, undefined);
  assert.equal(JSON.stringify(va).includes('murieron'), false);
  assert.equal(va.players[1].hasPhrase, true);
});

test('grupo social: proponer personaje, el rival lo valida o lo rechaza y pasa el turno', () => {
  const room = groupPlaying();
  G.setPhrase(room, 'a', 'pelo negro');
  G.setPhrase(room, 'b', 'murieron');
  const t = room.turn, me = idAt(room, t), rival = idAt(room, 1 - t);
  assert.throws(() => G.guess(room, me, 'x'), /MODO_INCORRECTO/);
  assert.throws(() => G.propose(room, rival, 'x'), /NO_ES_TU_TURNO/);
  assert.throws(() => G.propose(room, me, 'zzz'), /PERSONAJE_INVALIDO/);
  G.propose(room, me, 'x');
  assert.equal(room.awaiting, 'verdict');
  assert.throws(() => G.ask(room, me, 'hola'), /ESPERANDO_RESPUESTA/);
  assert.throws(() => G.verdict(room, me, true), /NO_PUEDES_RESPONDER/);
  const r = G.verdict(room, rival, true);
  assert.deepEqual(r, { by: t, characterId: 'x', valid: true });
  assert.deepEqual(room.players[1 - t].confirmed, ['x']);
  assert.equal(room.turn, 1 - t);
  assert.equal(room.awaiting, 'ask');
  // ahora propone el otro y se rechaza: sin vidas, solo pasa el turno
  G.propose(room, rival, 'p');
  G.verdict(room, me, false);
  assert.deepEqual(room.players[t].rejected, ['p']);
  assert.deepEqual(room.players.map(p => p.lives), [2, 2]);
  assert.equal(room.turn, t);
  assert.throws(() => G.propose(room, me, 'x'), /YA_PROPUESTO/);
});

test('grupo social: adivinar la frase gana la ronda solo si el rival la da por correcta', () => {
  const room = groupPlaying();
  G.setPhrase(room, 'a', 'pelo negro');
  G.setPhrase(room, 'b', 'murieron');
  const t = room.turn, me = idAt(room, t), rival = idAt(room, 1 - t);
  G.guessPhrase(room, me, 'son pelados');
  assert.equal(room.awaiting, 'phraseVerdict');
  assert.throws(() => G.judgePhrase(room, me, true), /NO_PUEDES_RESPONDER/);
  assert.equal(G.judgePhrase(room, rival, false).correct, false);
  assert.equal(room.turn, 1 - t);
  G.skip(room, rival);
  G.guessPhrase(room, me, 'están muertos');
  const r = G.judgePhrase(room, rival, true);
  assert.equal(r.roundOver, true);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.winner, t);
  assert.equal(room.wins[t], 1);
  assert.ok(G.viewFor(room, me).opponentPhrase);
  // revancha en grupo social vuelve a pedir frases
  G.rematchVote(room, 'a', true);
  G.rematchVote(room, 'b', true);
  assert.equal(room.phase, 'setup');
  assert.equal(room.players[0].phrase, null);
  assert.deepEqual(room.players[0].confirmed, []);
});

test('cambio de modo/pools en plena partida: requiere que el otro acepte', () => {
  const room = choosing();
  G.acceptDraft(room, 'a', POOLS);
  G.acceptDraft(room, 'b', POOLS);
  assert.equal(room.gameMode, 'guess');
  const round = room.round;
  assert.throws(() => G.answerChange(room, 'b', true, POOLS), /SIN_PROPUESTA/);
  G.proposeChange(room, 'a', { pools: ['jjk'], gameMode: 'group' }, POOLS);
  assert.throws(() => G.answerChange(room, 'a', true, POOLS), /NO_PUEDES_RESPONDER/);
  assert.equal(G.answerChange(room, 'b', false, POOLS).applied, false);
  assert.equal(room.change, null);
  assert.equal(room.gameMode, 'guess');
  G.proposeChange(room, 'a', { pools: ['jjk'], gameMode: 'group' }, POOLS);
  room.wins = [3, 1];
  assert.equal(G.answerChange(room, 'b', true, POOLS).applied, true);
  assert.equal(room.gameMode, 'group');
  assert.deepEqual(room.pools, ['jjk']);
  assert.equal(room.phase, 'setup');
  assert.equal(room.round, round + 1);
  assert.deepEqual(room.wins, [3, 1]); // el marcador se conserva
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

test('ceder turno: pasa el turno y deja un aviso en el chat', () => {
  const { room } = started();
  const t = room.turn;
  const msg = G.skip(room, idAt(room, t));
  assert.equal(room.turn, 1 - t);
  assert.equal(room.awaiting, 'ask');
  assert.equal(msg.kind, 'skip');
  assert.equal(room.chat.at(-1).kind, 'skip');
  assert.equal(room.chat.at(-1).from, t);
});

test('ceder turno: solo quien tiene el turno y antes de preguntar', () => {
  const { room } = started();
  const t = room.turn;
  assert.throws(() => G.skip(room, idAt(room, 1 - t)), /NO_ES_TU_TURNO/);
  G.ask(room, idAt(room, t), '¿Es hombre?');
  assert.throws(() => G.skip(room, idAt(room, t)), /ESPERANDO_RESPUESTA/);
});

test('ceder turno: no se puede cuando la ronda no está activa', () => {
  const { room } = started();
  const t = room.turn;
  G.guess(room, idAt(room, t), room.players[1 - t].character);
  assert.throws(() => G.skip(room, idAt(room, t)), /RONDA_NO_ACTIVA/);
});

test('las notas ya no existen en el estado', () => {
  const { room } = started();
  const v = G.viewFor(room, idAt(room, 0));
  assert.equal(v.notes, undefined);
  assert.equal(G.setNotes, undefined);
});

test('regalo en grupo social: en cualquier momento, sin turno, va directo al propio grupo', () => {
  const room = groupPlaying();
  G.setPhrase(room, 'a', 'pelo negro');
  G.setPhrase(room, 'b', 'murieron');
  const t = room.turn, rival = idAt(room, 1 - t);
  const turn = room.turn;
  G.gift(room, rival, 'p');
  assert.deepEqual(room.players[1 - t].confirmed, ['p']);
  assert.equal(room.turn, turn); // no cambia el turno
  assert.equal(room.chat.at(-1).kind, 'gift');
  assert.throws(() => G.gift(room, rival, 'p'), /YA_PROPUESTO/);
  // el rival ya no puede proponer uno que fue regalado
  assert.throws(() => G.propose(room, idAt(room, t), 'p'), /YA_PROPUESTO/);
  // no se puede regalar el que está esperando veredicto
  G.propose(room, idAt(room, t), 'x');
  assert.throws(() => G.gift(room, rival, 'x'), /YA_PROPUESTO/);
});

test('regalo en adivinar personaje: descarta "no es mi personaje", nunca el propio', () => {
  const { room } = started();
  const t = room.turn, other = idAt(room, 1 - t);
  const own = room.players[1 - t].character;
  const notMine = CHARS.find(c => c !== own);
  assert.throws(() => G.gift(room, other, own), /ES_TU_PERSONAJE/);
  G.gift(room, other, notMine);
  assert.deepEqual(room.players[1 - t].discarded, [notMine]);
  assert.equal(room.turn, t);
  assert.throws(() => G.gift(room, other, notMine), /YA_PROPUESTO/);
  assert.deepEqual(G.viewFor(room, idAt(room, t)).players[1 - t].discarded, [notMine]);
  assert.throws(() => G.gift(room, other, 'zzz'), /PERSONAJE_INVALIDO/);
});
