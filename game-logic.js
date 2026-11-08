'use strict';
// Reglas puras del juego. Sin sockets ni IO: el servidor las usa y los tests las ejercitan.
const crypto = require('crypto');

const ANSWERS = ['Sí', 'No', 'No sé'];
const MAX_QUESTION = 200;
const MAX_NAME = 20;
const LIVES = 2;

function fail(code) { throw new Error(code); }

function createRoom(code) {
  return {
    code,
    players: [],
    phase: 'lobby', // lobby | choosing | playing | roundOver | ended
    mode: null, // 'bc' | 'dnd' | 'mix'
    picks: [null, null],
    turn: 0,
    awaiting: 'ask', // ask | answer
    winner: null,
    wins: [0, 0],
    chat: [],
    pool: [],
    rematch: [null, null],
    nextStarter: null,
  };
}

function indexOf(room, id) {
  const i = room.players.findIndex(p => p.id === id);
  if (i === -1) fail('JUGADOR_DESCONOCIDO');
  return i;
}

function addPlayer(room, id, name) {
  if (room.players.length >= 2) fail('SALA_LLENA');
  if (room.phase !== 'lobby') fail('PARTIDA_EN_CURSO');
  const clean = String(name || '').trim().slice(0, MAX_NAME) || 'Jugador ' + (room.players.length + 1);
  const token = crypto.randomBytes(12).toString('hex');
  room.players.push({ id, token, name: clean, ready: false, lives: LIVES, character: null, connected: true });
  return { index: room.players.length - 1, token };
}

function reconnect(room, token, newId) {
  const i = room.players.findIndex(p => p.token === token);
  if (i === -1) return null;
  room.players[i].id = newId;
  room.players[i].connected = true;
  return { index: i };
}

function setReady(room, id) {
  if (room.phase !== 'lobby') fail('RONDA_NO_ACTIVA');
  room.players[indexOf(room, id)].ready = true;
}

const MODES = ['bc', 'dnd', 'mix'];

// Ambos están listos: ahora eligen el modo (pool de personajes).
function beginChoosing(room) {
  room.phase = 'choosing';
  room.picks = [null, null];
}

// Cada jugador vota un modo; la partida arranca cuando los dos eligen el mismo.
function choosePool(room, id, mode, poolsMap, rng = Math.random) {
  if (room.phase !== 'choosing') fail('RONDA_NO_ACTIVA');
  if (!MODES.includes(mode)) fail('MODO_INVALIDO');
  const i = indexOf(room, id);
  room.picks[i] = mode;
  if (room.picks[0] && room.picks[0] === room.picks[1]) {
    room.mode = mode;
    startRound(room, poolsMap[mode], rng);
    return { started: true };
  }
  return { started: false };
}

function allReady(room) {
  return room.players.length === 2 && room.players.every(p => p.ready);
}

// Cada jugador sortea por separado: puede tocar el mismo personaje (es parte de la gracia).
function pickTwo(pool, rng) {
  if (pool.length < 1) fail('POCOS_PERSONAJES');
  const a = Math.floor(rng() * pool.length);
  const b = Math.floor(rng() * pool.length);
  return [pool[a], pool[b]];
}

function startRound(room, characterIds, rng = Math.random) {
  if (room.players.length !== 2) fail('FALTAN_JUGADORES');
  room.pool = characterIds.slice();
  const [c0, c1] = pickTwo(room.pool, rng);
  room.players[0].character = c0;
  room.players[1].character = c1;
  room.players.forEach(p => { p.lives = LIVES; });
  room.phase = 'playing';
  room.awaiting = 'ask';
  room.winner = null;
  room.rematch = [null, null];
  room.chat = [];
  room.turn = room.nextStarter != null ? room.nextStarter : (rng() < 0.5 ? 0 : 1);
  room.nextStarter = null;
}

function requirePlaying(room) {
  if (room.phase !== 'playing') fail('RONDA_NO_ACTIVA');
}

function ask(room, id, text) {
  requirePlaying(room);
  const i = indexOf(room, id);
  if (i !== room.turn) fail('NO_ES_TU_TURNO');
  if (room.awaiting !== 'ask') fail('ESPERANDO_RESPUESTA');
  const t = String(text || '').trim();
  if (!t || t.length > MAX_QUESTION) fail('PREGUNTA_INVALIDA');
  const msg = { from: i, kind: 'question', text: t };
  room.chat.push(msg);
  room.awaiting = 'answer';
  return msg;
}

function answer(room, id, ans) {
  requirePlaying(room);
  const i = indexOf(room, id);
  if (room.awaiting !== 'answer' || i === room.turn) fail('NO_PUEDES_RESPONDER');
  if (!ANSWERS.includes(ans)) fail('RESPUESTA_INVALIDA');
  const msg = { from: i, kind: 'answer', text: ans };
  room.chat.push(msg);
  room.turn = 1 - room.turn;
  room.awaiting = 'ask';
  return msg;
}

function guess(room, id, characterId) {
  requirePlaying(room);
  const i = indexOf(room, id);
  if (i !== room.turn) fail('NO_ES_TU_TURNO');
  if (room.awaiting !== 'ask') fail('ESPERANDO_RESPUESTA');
  if (!room.pool.includes(characterId)) fail('PERSONAJE_INVALIDO');
  const target = room.players[1 - i].character;
  if (characterId === target) {
    room.phase = 'roundOver';
    room.winner = i;
    room.wins[i] += 1;
    room.nextStarter = 1 - i;
    return { correct: true, roundOver: true, winner: i };
  }
  room.players[i].lives -= 1;
  if (room.players[i].lives <= 0) {
    room.phase = 'roundOver';
    room.winner = 1 - i;
    room.wins[1 - i] += 1;
    room.nextStarter = i; // empieza el que perdió
    return { correct: false, roundOver: true, winner: 1 - i };
  }
  room.turn = 1 - i;
  room.awaiting = 'ask';
  return { correct: false, roundOver: false, livesLeft: room.players[i].lives };
}

// Ceder el turno: solo quien tiene el turno y antes de hacer su pregunta.
function skip(room, id) {
  requirePlaying(room);
  const i = indexOf(room, id);
  if (i !== room.turn) fail('NO_ES_TU_TURNO');
  if (room.awaiting !== 'ask') fail('ESPERANDO_RESPUESTA');
  const msg = { from: i, kind: 'skip', text: 'cedió su turno' };
  room.chat.push(msg);
  room.turn = 1 - room.turn;
  room.awaiting = 'ask';
  return msg;
}

function rematchVote(room, id, yes, characterIds, rng = Math.random) {
  if (room.phase !== 'roundOver') fail('RONDA_NO_ACTIVA');
  const i = indexOf(room, id);
  room.rematch[i] = !!yes;
  if (!yes) {
    room.phase = 'ended';
    return { started: false, ended: true };
  }
  if (room.rematch[0] && room.rematch[1]) {
    // el perdedor empieza: nextStarter ya se fijó al terminar la ronda
    startRound(room, characterIds || room.pool, rng);
    return { started: true };
  }
  return { started: false, ended: false };
}

// Vista privada: nunca incluye el personaje del rival mientras la ronda está activa.
function viewFor(room, id) {
  const me = indexOf(room, id);
  const opp = 1 - me;
  const over = room.phase === 'roundOver' || room.phase === 'ended';
  const view = {
    code: room.code,
    phase: room.phase,
    me,
    turn: room.turn,
    awaiting: room.awaiting,
    winner: room.winner,
    wins: room.wins.slice(),
    mode: room.mode,
    picks: room.picks.slice(),
    chat: room.chat.slice(),
    rematch: room.rematch.slice(),
    players: room.players.map(p => ({ name: p.name, ready: p.ready, lives: p.lives, connected: p.connected })),
    myCharacter: room.phase === 'lobby' || room.phase === 'choosing' ? null : room.players[me].character,
  };
  if (over && room.players[opp]) view.opponentCharacter = room.players[opp].character;
  return view;
}

module.exports = {
  ANSWERS, LIVES, MODES, beginChoosing, choosePool, createRoom, addPlayer, reconnect, setReady, allReady,
  startRound, ask, answer, guess, rematchVote, skip, viewFor,
};
