'use strict';
// Reglas puras del juego. Sin sockets ni IO: el servidor las usa y los tests las ejercitan.
const crypto = require('crypto');

const ANSWERS = ['Sí', 'No', 'No sé'];
const MAX_QUESTION = 200;
const MAX_NAME = 20;
const MAX_PHRASE = 80;
const GAME_MODES = ['guess', 'group']; // guess: adivinar personaje · group: grupo social

function fail(code) { throw new Error(code); }

function createRoom(code) {
  return {
    code,
    players: [],
    phase: 'lobby', // lobby | choosing | setup | playing | roundOver | ended
    pools: [], // pools activos, ej: ['bc', 'jjk']
    gameMode: null, // 'guess' | 'group'
    draft: null, // configuración que se está armando en 'choosing': { pools, gameMode }
    accept: [false, false],
    change: null, // propuesta de cambio en plena partida: { by, pools, gameMode }
    turn: 0,
    awaiting: 'ask', // ask | answer | verdict | phraseVerdict
    pending: null, // grupo social: { kind: 'propose', from, characterId } | { kind: 'phrase', from, text }
    winner: null,
    wins: [0, 0],
    chat: [],
    pool: [],
    rematch: [null, null],
    nextStarter: null,
    round: 0,
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
  room.players.push({
    id, token, name: clean, ready: false, character: null, connected: true,
    phrase: null, confirmed: [], rejected: [], discarded: [],
  });
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

function allReady(room) {
  return room.players.length === 2 && room.players.every(p => p.ready);
}

// Valida y normaliza una configuración { pools, gameMode } contra los pools existentes.
function cleanConfig(cfg, poolsMap) {
  const c = cfg || {};
  if (!GAME_MODES.includes(c.gameMode)) fail('MODO_INVALIDO');
  const list = Array.isArray(c.pools) ? c.pools : [];
  const pools = Object.keys(poolsMap).filter(k => list.includes(k) && poolsMap[k].length > 0);
  if (pools.length === 0 || pools.length !== new Set(list).size) fail('POOLS_INVALIDOS');
  return { pools, gameMode: c.gameMode };
}

const poolUnion = (pools, poolsMap) => [...new Set(pools.flatMap(k => poolsMap[k]))];

// Ambos están listos: ahora arman juntos la configuración (pools tildados + modo).
function beginChoosing(room, poolsMap) {
  room.phase = 'choosing';
  room.draft = { pools: Object.keys(poolsMap).filter(k => poolsMap[k].length > 0), gameMode: 'guess' };
  room.accept = [false, false];
}

// Cualquiera de los dos modifica la configuración compartida; eso anula las aceptaciones.
function setDraft(room, id, cfg, poolsMap) {
  if (room.phase !== 'choosing') fail('RONDA_NO_ACTIVA');
  indexOf(room, id);
  room.draft = cleanConfig(cfg, poolsMap);
  room.accept = [false, false];
}

// La partida arranca cuando los dos aceptan la misma configuración.
function acceptDraft(room, id, poolsMap, rng = Math.random) {
  if (room.phase !== 'choosing') fail('RONDA_NO_ACTIVA');
  const i = indexOf(room, id);
  room.accept[i] = true;
  if (room.accept[0] && room.accept[1]) {
    applyConfig(room, room.draft, poolsMap, rng);
    return { started: true };
  }
  return { started: false };
}

function applyConfig(room, cfg, poolsMap, rng) {
  const c = cleanConfig(cfg, poolsMap);
  room.pools = c.pools;
  room.gameMode = c.gameMode;
  room.draft = null;
  room.accept = [false, false];
  startRound(room, poolUnion(c.pools, poolsMap), rng);
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
  if (!room.gameMode) room.gameMode = 'guess';
  room.pool = characterIds.slice();
  if (room.pool.length < 1) fail('POCOS_PERSONAJES');
  room.players.forEach(p => {
    p.character = null;
    p.phrase = null;
    p.confirmed = [];
    p.rejected = [];
    p.discarded = [];
  });
  if (room.gameMode === 'guess') {
    const [c0, c1] = pickTwo(room.pool, rng);
    room.players[0].character = c0;
    room.players[1].character = c1;
    room.phase = 'playing';
  } else {
    room.phase = 'setup'; // cada uno escribe la frase secreta de su grupo
  }
  room.awaiting = 'ask';
  room.pending = null;
  room.change = null;
  room.winner = null;
  room.rematch = [null, null];
  room.chat = [];
  room.round += 1;
  room.turn = room.nextStarter != null ? room.nextStarter : (rng() < 0.5 ? 0 : 1);
  room.nextStarter = null;
}

// Grupo social: frase secreta. Se puede corregir hasta que los dos la tengan.
function setPhrase(room, id, text) {
  if (room.phase !== 'setup') fail('RONDA_NO_ACTIVA');
  const i = indexOf(room, id);
  const t = String(text || '').trim();
  if (!t || t.length > MAX_PHRASE) fail('FRASE_INVALIDA');
  room.players[i].phrase = t;
  if (room.players.every(p => p.phrase)) {
    room.phase = 'playing';
    room.awaiting = 'ask';
    return { started: true };
  }
  return { started: false };
}

function requirePlaying(room) {
  if (room.phase !== 'playing') fail('RONDA_NO_ACTIVA');
}
function requireMode(room, mode) {
  if (room.gameMode !== mode) fail('MODO_INCORRECTO');
}
function requireMyAsk(room, i) {
  if (i !== room.turn) fail('NO_ES_TU_TURNO');
  if (room.awaiting !== 'ask') fail('ESPERANDO_RESPUESTA');
}
function passTurn(room) {
  room.turn = 1 - room.turn;
  room.awaiting = 'ask';
  room.pending = null;
}

function ask(room, id, text) {
  requirePlaying(room);
  const i = indexOf(room, id);
  requireMyAsk(room, i);
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
  passTurn(room);
  return msg;
}

function guess(room, id, characterId) {
  requirePlaying(room);
  requireMode(room, 'guess');
  const i = indexOf(room, id);
  requireMyAsk(room, i);
  if (!room.pool.includes(characterId)) fail('PERSONAJE_INVALIDO');
  const target = room.players[1 - i].character;
  if (characterId === target) {
    room.phase = 'roundOver';
    room.winner = i;
    room.wins[i] += 1;
    room.nextStarter = 1 - i;
    return { correct: true, roundOver: true, winner: i };
  }
  // vidas infinitas: fallar solo pasa el turno
  passTurn(room);
  return { correct: false, roundOver: false };
}

// Grupo social: propongo un personaje como parte del grupo del rival; el rival decide.
function propose(room, id, characterId) {
  requirePlaying(room);
  requireMode(room, 'group');
  const i = indexOf(room, id);
  requireMyAsk(room, i);
  if (!room.pool.includes(characterId)) fail('PERSONAJE_INVALIDO');
  const owner = room.players[1 - i];
  if (owner.confirmed.includes(characterId) || owner.rejected.includes(characterId)) fail('YA_PROPUESTO');
  room.pending = { kind: 'propose', from: i, characterId };
  room.awaiting = 'verdict';
  const msg = { from: i, kind: 'propose', characterId };
  room.chat.push(msg);
  return msg;
}

function verdict(room, id, valid) {
  requirePlaying(room);
  requireMode(room, 'group');
  const i = indexOf(room, id);
  if (room.awaiting !== 'verdict' || !room.pending || room.pending.from === i) fail('NO_PUEDES_RESPONDER');
  const { from, characterId } = room.pending;
  const ok = !!valid;
  (ok ? room.players[i].confirmed : room.players[i].rejected).push(characterId);
  room.chat.push({ from: i, kind: 'verdict', characterId, text: ok ? 'Válido' : 'No válido' });
  passTurn(room);
  return { by: from, characterId, valid: ok };
}

// Grupo social: arriesgo la frase del rival; el rival decide si es correcta.
function guessPhrase(room, id, text) {
  requirePlaying(room);
  requireMode(room, 'group');
  const i = indexOf(room, id);
  requireMyAsk(room, i);
  const t = String(text || '').trim();
  if (!t || t.length > MAX_PHRASE) fail('FRASE_INVALIDA');
  room.pending = { kind: 'phrase', from: i, text: t };
  room.awaiting = 'phraseVerdict';
  const msg = { from: i, kind: 'phraseGuess', text: t };
  room.chat.push(msg);
  return msg;
}

function judgePhrase(room, id, correct) {
  requirePlaying(room);
  requireMode(room, 'group');
  const i = indexOf(room, id);
  if (room.awaiting !== 'phraseVerdict' || !room.pending || room.pending.from === i) fail('NO_PUEDES_RESPONDER');
  const from = room.pending.from;
  const ok = !!correct;
  room.chat.push({ from: i, kind: 'phraseVerdict', text: ok ? '¡Correcto!' : 'Incorrecto' });
  if (ok) {
    room.phase = 'roundOver';
    room.winner = from;
    room.wins[from] += 1;
    room.nextStarter = 1 - from;
    room.pending = null;
    return { correct: true, roundOver: true, winner: from };
  }
  passTurn(room);
  return { correct: false, roundOver: false };
}

// Regalo: en cualquier momento (sea o no tu turno) arrastrás un personaje a tu propio recuadro.
// Grupo social: lo sumás vos mismo a tu grupo. Adivinar personaje: avisás que NO es tu personaje.
function gift(room, id, characterId) {
  requirePlaying(room);
  const i = indexOf(room, id);
  if (!room.pool.includes(characterId)) fail('PERSONAJE_INVALIDO');
  const p = room.players[i];
  let msg;
  if (room.gameMode === 'group') {
    const pend = room.pending;
    if (p.confirmed.includes(characterId) || p.rejected.includes(characterId) ||
      (pend && pend.kind === 'propose' && pend.characterId === characterId)) fail('YA_PROPUESTO');
    p.confirmed.push(characterId);
    msg = { from: i, kind: 'gift', characterId };
  } else {
    if (characterId === p.character) fail('ES_TU_PERSONAJE');
    if (p.discarded.includes(characterId)) fail('YA_PROPUESTO');
    p.discarded.push(characterId);
    msg = { from: i, kind: 'giftNo', characterId };
  }
  room.chat.push(msg);
  return msg;
}

// Ceder el turno: solo quien tiene el turno y antes de hacer su pregunta.
function skip(room, id) {
  requirePlaying(room);
  const i = indexOf(room, id);
  requireMyAsk(room, i);
  const msg = { from: i, kind: 'skip', text: 'cedió su turno' };
  room.chat.push(msg);
  passTurn(room);
  return msg;
}

// Cambiar modo / pools en plena partida: uno propone, el otro acepta y arranca una ronda nueva.
const CHANGE_PHASES = ['setup', 'playing', 'roundOver'];
function proposeChange(room, id, cfg, poolsMap) {
  if (!CHANGE_PHASES.includes(room.phase)) fail('RONDA_NO_ACTIVA');
  const i = indexOf(room, id);
  room.change = { by: i, ...cleanConfig(cfg, poolsMap) };
  return room.change;
}

function answerChange(room, id, yes, poolsMap, rng = Math.random) {
  if (!CHANGE_PHASES.includes(room.phase)) fail('RONDA_NO_ACTIVA');
  const i = indexOf(room, id);
  if (!room.change) fail('SIN_PROPUESTA');
  if (!yes) { room.change = null; return { applied: false }; } // rechazo, o el que propuso la cancela
  if (room.change.by === i) fail('NO_PUEDES_RESPONDER');
  const cfg = room.change;
  room.nextStarter = null;
  applyConfig(room, cfg, poolsMap, rng);
  return { applied: true };
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

// Vista privada: nunca incluye el personaje ni la frase del rival mientras la ronda está activa.
function viewFor(room, id) {
  const me = indexOf(room, id);
  const opp = 1 - me;
  const over = room.phase === 'roundOver' || room.phase === 'ended';
  const hidden = room.phase === 'lobby' || room.phase === 'choosing';
  const view = {
    code: room.code,
    phase: room.phase,
    me,
    turn: room.turn,
    awaiting: room.awaiting,
    pending: room.pending ? { ...room.pending } : null,
    winner: room.winner,
    wins: room.wins.slice(),
    pools: room.pools.slice(),
    gameMode: room.gameMode,
    draft: room.draft ? { pools: room.draft.pools.slice(), gameMode: room.draft.gameMode } : null,
    accept: room.accept.slice(),
    change: room.change ? { ...room.change, pools: room.change.pools.slice() } : null,
    round: room.round,
    chat: room.chat.slice(),
    rematch: room.rematch.slice(),
    players: room.players.map(p => ({
      name: p.name, ready: p.ready, connected: p.connected,
      hasPhrase: !!p.phrase, confirmed: p.confirmed.slice(), rejected: p.rejected.slice(), discarded: p.discarded.slice(),
    })),
    myCharacter: hidden ? null : room.players[me].character,
    myPhrase: hidden ? null : room.players[me].phrase,
  };
  if (over && room.players[opp]) {
    view.opponentCharacter = room.players[opp].character;
    view.opponentPhrase = room.players[opp].phrase;
  }
  return view;
}

module.exports = {
  ANSWERS, GAME_MODES, MAX_PHRASE,
  createRoom, addPlayer, reconnect, setReady, allReady,
  beginChoosing, setDraft, acceptDraft, startRound, setPhrase,
  ask, answer, guess, propose, verdict, guessPhrase, judgePhrase, skip, gift,
  proposeChange, answerChange, rematchVote, viewFor,
};
