'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ERR = {
    SALA_LLENA: 'La sala ya tiene 2 jugadores.',
    SALA_NO_EXISTE: 'Esa sala no existe (o ya expiró).',
    PARTIDA_EN_CURSO: 'La partida ya empezó.',
    NO_ES_TU_TURNO: 'No es tu turno.',
    ESPERANDO_RESPUESTA: 'Esperá la respuesta a tu pregunta.',
    PREGUNTA_INVALIDA: 'Escribí una pregunta (máximo 200 caracteres).',
    RONDA_NO_ACTIVA: 'La ronda no está activa.',
    DESCONECTADO: 'Sin conexión. Reintentá en un momento.',
    POOLS_INVALIDOS: 'Tiene que quedar al menos un grupo de personajes tildado.',
    MODO_INVALIDO: 'Modo de juego inválido.',
    FRASE_INVALIDA: 'Escribí una frase (máximo 80 caracteres).',
    YA_PROPUESTO: 'Ese personaje ya fue propuesto para ese grupo.',
    MODO_INCORRECTO: 'Eso no se puede hacer en este modo de juego.',
    SIN_PROPUESTA: 'Ya no hay ninguna propuesta pendiente.',
    NO_PUEDES_RESPONDER: 'Ahora no podés responder eso.',
  };
  const POOL_NAMES = { bc: 'Black Clover', dnd: 'Torre (D&D)', jjk: 'Jujutsu Kaisen' };
  const GM_NAMES = { guess: 'Adivinar personaje', group: 'Grupo social' };
  const GM_DESC = {
    guess: 'Cada uno tiene un personaje secreto. Gana quien adivine el del otro (2 vidas).',
    group: 'Cada uno inventa una frase secreta (ej: “pelo negro”). Proponé personajes al “?” del rival: él decide si entran en su grupo. Gana quien adivine la frase del otro.',
  };
  const poolName = k => POOL_NAMES[k] || k;
  const cfgText = c => c ? GM_NAMES[c.gameMode] + ' · ' + c.pools.map(poolName).join(' + ') : '';
  const errText = code => ERR[code] || 'Algo salió mal. Probá de nuevo.';

  let chars = [];
  const charMap = {};
  let state = null;
  let session = null;
  let zoneLocal = null; // id de mi carta posada sobre el "?" del rival
  let guessPending = false;
  let celebrationUntil = 0;
  const struck = new Set();
  let rivalStruck = [];
  let galleryKey = null;
  let connBanner = '';
  let toastTimer = null;
  let phraseMode = false;
  let changeOpen = false;

  try { session = JSON.parse(sessionStorage.getItem('session') || 'null'); } catch (e) { session = null; }
  const saveSession = () => { try { sessionStorage.setItem('session', JSON.stringify(session)); } catch (e) { /* sin storage */ } };
  const clearSession = () => { session = null; try { sessionStorage.removeItem('session'); } catch (e) { /* sin storage */ } };
  const savedName = () => { try { return localStorage.getItem('name') || ''; } catch (e) { return ''; } };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  function showScreen(name) {
    ['Home', 'Lobby', 'Game'].forEach(n => $('screen' + n).classList.toggle('hidden', n !== name));
  }

  function updateBanner() {
    let text = connBanner;
    if (!text && state && state.phase === 'playing') {
      const opp = state.players[1 - state.me];
      if (opp && !opp.connected) text = opp.name + ' se desconectó. Esperando que vuelva…';
    }
    $('banner').textContent = text;
    $('banner').classList.toggle('hidden', !text);
  }

  // ---------- Inicio / sala ----------
  function setHomeError(msg) { $('homeError').textContent = msg || ''; }
  const myNameInput = () => {
    const n = $('nameInput').value.trim().slice(0, 20);
    try { localStorage.setItem('name', n); } catch (e) { /* sin storage */ }
    return n;
  };

  $('btnCreate').onclick = () => {
    setHomeError('');
    Net.send('createRoom', { name: myNameInput() }, r => {
      if (r.error) return setHomeError(errText(r.error));
      session = { code: r.code, token: r.token };
      saveSession();
    });
  };
  $('btnJoin').onclick = () => {
    setHomeError('');
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return setHomeError('Escribí el código de 4 letras de la sala.');
    Net.send('joinRoom', { code, name: myNameInput() }, r => {
      if (r.error) return setHomeError(errText(r.error));
      session = { code: r.code, token: r.token };
      saveSession();
    });
  };
  $('btnReady').onclick = () => Net.send('ready', {}, r => r.error && toast(errText(r.error)));

  const roomLink = () => location.origin + '/?sala=' + state.code;
  async function copyLink() {
    const link = roomLink();
    try { await navigator.clipboard.writeText(link); toast('Link copiado'); }
    catch (e) { window.prompt('Copiá este link:', link); }
  }
  $('btnCopy').onclick = copyLink;
  $('btnCopyGame').onclick = copyLink;
  $('btnMute').onclick = () => { $('btnMute').textContent = Sfx.toggle() ? '🔇' : '🔊'; };
  $('btnMute').textContent = Sfx.isMuted() ? '🔇' : '🔊';

  // ---------- Galería ----------
  function buildGallery(pools) {
    const g = $('gallery');
    g.innerHTML = '';
    galleryKey = pools ? pools.join(',') : null;
    chars.filter(c => !pools || pools.includes(c.pool)).forEach(c => {
      const d = document.createElement('div');
      d.className = 'gcard';
      d.dataset.id = c.id;
      d.innerHTML = '<img loading="lazy" src="' + esc(c.file) + '" alt=""><span>' + esc(c.name) + '</span>';
      g.appendChild(d);
    });
  }
  const isGroup = () => !!state && state.gameMode === 'group';
  function updateAway() {
    const away = new Set(Ragdoll.ids());
    // grupo social: marco lo que ya sé del grupo del rival
    const opp = isGroup() && state.players[1 - state.me];
    const yes = new Set(opp ? opp.confirmed : []), no = new Set(opp ? opp.rejected : []);
    document.querySelectorAll('.gcard').forEach(el => {
      el.classList.toggle('away', away.has(el.dataset.id));
      el.classList.toggle('struck', struck.has(el.dataset.id));
      el.classList.toggle('gyes', yes.has(el.dataset.id));
      el.classList.toggle('gno', no.has(el.dataset.id));
    });
  }
  const canGuess = () => !!state && state.phase === 'playing' && state.turn === state.me && state.awaiting === 'ask' && !guessPending;
  const targetSide = () => 1 - state.me; // el recuadro "?" está del lado del rival

  $('gallery').addEventListener('click', e => {
    const card = e.target.closest('.gcard');
    if (!card || e.button !== 0) return;
    const id = card.dataset.id;
    if (struck.has(id)) struck.delete(id); else struck.add(id);
    sendStrikes();
    updateAway();
    renderStrikes();
  });

  const sendStrikes = () => Net.send('strikes', { ids: [...struck] });
  const thumb = (id, cls) => '<div class="sk ' + cls + '" title="' + esc(charMap[id].name) + '"><img src="' + esc(charMap[id].file) + '" alt=""></div>';
  function renderStrikes() {
    if (!state) return;
    if (isGroup()) {
      // tabla del grupo de cada jugador: los validados (y abajo los rechazados)
      [0, 1].forEach(i => {
        const p = state.players[i];
        const yes = p.confirmed.filter(id => charMap[id]), no = p.rejected.filter(id => charMap[id]);
        $('strikes' + i).innerHTML = yes.map(id => thumb(id, 'ok')).join('') +
          (no.length ? '<div class="sk-sep">No pertenecen</div>' + no.map(id => thumb(id, '')).join('') : '');
        $('stt' + i).textContent = yes.length || no.length ? 'En el grupo (' + yes.length + ')' : 'Grupo vacío';
      });
      return;
    }
    const fill = (i, ids) => {
      $('strikes' + i).innerHTML = ids.filter(id => charMap[id]).map(id =>
        '<div class="sk" title="' + esc(charMap[id].name) + '"><img src="' + esc(charMap[id].file) + '" alt=""></div>').join('');
      $('stt' + i).textContent = ids.length ? 'Descartó (' + ids.length + ')' : '';
    };
    fill(state.me, [...struck]);
    fill(1 - state.me, rivalStruck);
  }

  function startGrab(e, id) {
    if (!state || state.phase !== 'playing' || zoneLocal) return;
    if (Ragdoll.has(id) && !Ragdoll.isFree(id)) return;
    e.preventDefault();
    Sfx.grab();
    Ragdoll.grab(id, e.clientX, e.clientY);
  }
  // Clic derecho: primero cartas sueltas en pantalla (por geometría, respetando su inclinación), si no la galería.
  document.addEventListener('mousedown', e => {
    if (e.button !== 2 || Board.contains(e.target)) return;
    if ($('screenGame').classList.contains('hidden')) return;
    const loose = Ragdoll.cardAt(e.clientX, e.clientY);
    if (loose) return startGrab(e, loose);
    const card = e.target.closest && e.target.closest('.gcard');
    if (card) startGrab(e, card.dataset.id);
  });
  document.addEventListener('contextmenu', e => {
    if (!$('screenGame').classList.contains('hidden')) e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!Ragdoll.isDragging()) return;
    Ragdoll.setTarget(e.clientX, e.clientY);
    $('box' + targetSide()).classList.toggle('hot', Ragdoll.overZone() && canGuess());
  });
  window.addEventListener('mouseup', e => {
    if (e.button !== 2 || !Ragdoll.isDragging()) return;
    document.querySelectorAll('.box').forEach(b => b.classList.remove('hot'));
    const res = Ragdoll.release();
    if (!res) return;
    if (res.where === 'zone') zoneLocal = res.id;
    else if (res.wasOverZone) toast('Solo podés adivinar en tu turno, antes de preguntar.');
    updateZoneUI();
  });

  // ---------- Zona de adivinanza ----------
  function updateZoneUI() {
    if (!state) return;
    if (zoneLocal && !Ragdoll.has(zoneLocal)) zoneLocal = null;
    const tgt = targetSide();
    $('slot' + tgt).appendChild($('guessBtns'));
    $('guessBtns').classList.toggle('hidden', !zoneLocal);
    $('btnYes').disabled = guessPending;
    $('btnNo').disabled = guessPending;
    const opp = state.players[1 - state.me];
    $('cap0').textContent = '';
    $('cap1').textContent = '';
    if (!zoneLocal && Ragdoll.hasZoneCard() && opp) {
      $('cap' + state.me).textContent = isGroup()
        ? (state.awaiting === 'verdict' ? '¿Pertenece a tu grupo? Decidí abajo del chat.' : opp.name + ' va a proponer un personaje…')
        : opp.name + ' va a intentar adivinar…';
    }
    if (zoneLocal && guessPending && isGroup()) $('cap' + tgt).textContent = 'Esperando que ' + opp.name + ' decida…';
    $('box' + tgt).classList.toggle('disabled', !canGuess());
    $('box' + state.me).classList.remove('disabled');
  }

  $('btnYes').onclick = () => {
    const id = zoneLocal;
    if (!id || guessPending) return;
    guessPending = true;
    updateZoneUI();
    // grupo social: la carta queda en el "?" hasta que el rival la valide (llega proposalResult)
    Net.send(isGroup() ? 'propose' : 'guess', { characterId: id }, r => {
      if (r.error) {
        guessPending = false;
        toast(errText(r.error));
        Ragdoll.sendHome(id);
        Net.send('dragEnd', { id, mode: 'home' });
        zoneLocal = null;
      } else if (!isGroup()) guessPending = false;
      updateZoneUI();
    });
  };
  $('btnNo').onclick = () => {
    const id = zoneLocal;
    if (!id || guessPending) return;
    zoneLocal = null;
    Net.send('zoneCancel', { id });
    Ragdoll.eject(id, targetSide());
    updateZoneUI();
  };

  // ---------- Chat ----------
  $('askForm').onsubmit = e => {
    e.preventDefault();
    const text = $('askInput').value.trim();
    if (!text) return;
    Net.send('ask', { text }, r => {
      if (r.error) toast(errText(r.error)); else $('askInput').value = '';
    });
  };
  $('btnPhrase').onclick = () => { phraseMode = true; render(); $('phraseGuessInput').focus(); };
  $('btnPhraseBack').onclick = () => { phraseMode = false; render(); };
  $('phraseForm').onsubmit = e => {
    e.preventDefault();
    const text = $('phraseGuessInput').value.trim();
    if (!text) return;
    Net.send('guessPhrase', { text }, r => {
      if (r.error) return toast(errText(r.error));
      $('phraseGuessInput').value = '';
      phraseMode = false;
      render();
    });
  };
  $('verdictBtns').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) Net.send('verdict', { valid: b.dataset.v === '1' }, r => r.error && toast(errText(r.error)));
  });
  $('phraseBtns').addEventListener('click', e => {
    const b = e.target.closest('button[data-c]');
    if (b) Net.send('judgePhrase', { correct: b.dataset.c === '1' }, r => r.error && toast(errText(r.error)));
  });
  $('setupForm').onsubmit = e => {
    e.preventDefault();
    const text = $('setupInput').value.trim();
    if (!text) return;
    Net.send('setPhrase', { text }, r => r.error && toast(errText(r.error)));
  };
  $('btnSkip').onclick = () => Net.send('skip', {}, r => r.error && toast(errText(r.error)));
  $('answerBtns').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (b) Net.send('answer', { answer: b.dataset.a }, r => r.error && toast(errText(r.error)));
  });

  // ---------- Render ----------
  const hearts = n => '<span>' + '♥'.repeat(Math.max(0, n)) + '</span><span class="lost">' + '♥'.repeat(Math.max(0, 2 - n)) + '</span>';

  // ---------- Configuración (pools + modo) ----------
  const poolIds = () => [...new Set(chars.map(c => c.pool))];
  function cfgFormHTML(cfg, name) {
    const count = k => chars.filter(c => c.pool === k).length;
    return '<div class="cfg-group"><h3>Personajes</h3>' + poolIds().map(k =>
      '<label class="chk"><input type="checkbox" data-pool="' + esc(k) + '"' + (cfg.pools.includes(k) ? ' checked' : '') + '>' +
      '<span>' + esc(poolName(k)) + ' <small>(' + count(k) + ')</small></span></label>').join('') + '</div>' +
      '<div class="cfg-group"><h3>Modo de juego</h3>' + Object.keys(GM_NAMES).map(m =>
      '<label class="chk gm"><input type="radio" name="' + name + '" data-gm="' + m + '"' + (cfg.gameMode === m ? ' checked' : '') + '>' +
      '<span><b>' + GM_NAMES[m] + '</b><small>' + GM_DESC[m] + '</small></span></label>').join('') + '</div>';
  }
  function readCfg(box) {
    const pools = [...box.querySelectorAll('input[data-pool]:checked')].map(i => i.dataset.pool);
    const gm = box.querySelector('input[data-gm]:checked');
    return { pools, gameMode: gm ? gm.dataset.gm : 'guess' };
  }
  function fillCfg(box, cfg, name) {
    const key = JSON.stringify(cfg);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = cfgFormHTML(cfg, name);
  }
  $('cfgForm').addEventListener('change', () => {
    const cfg = readCfg($('cfgForm'));
    if (!cfg.pools.length) { toast(ERR.POOLS_INVALIDOS); $('cfgForm').dataset.key = ''; return render(); }
    Net.send('setDraft', cfg, r => { if (r.error) { toast(errText(r.error)); $('cfgForm').dataset.key = ''; render(); } });
  });
  $('btnAccept').onclick = () => Net.send('acceptDraft', {}, r => r.error && toast(errText(r.error)));

  // Cambio en plena partida
  function openChange() {
    if (!state || state.change) return;
    changeOpen = true;
    $('changeForm').dataset.key = '';
    fillCfg($('changeForm'), { pools: state.pools, gameMode: state.gameMode }, 'gmChange');
    render();
  }
  $('btnChange').onclick = openChange;
  $('btnChangeOver').onclick = openChange;
  $('btnChangeClose').onclick = () => { changeOpen = false; render(); };
  $('btnChangeSend').onclick = () => {
    const cfg = readCfg($('changeForm'));
    if (!cfg.pools.length) return toast(ERR.POOLS_INVALIDOS);
    Net.send('proposeChange', cfg, r => {
      if (r.error) return toast(errText(r.error));
      changeOpen = false;
      render();
    });
  };
  $('btnChangeYes').onclick = () => Net.send('answerChange', { yes: true }, r => r.error && toast(errText(r.error)));
  $('btnChangeNo').onclick = () => Net.send('answerChange', { yes: false }, r => r.error && toast(errText(r.error)));
  $('btnChangeCancel').onclick = () => Net.send('answerChange', { yes: false }, r => r.error && toast(errText(r.error)));

  function renderLobby() {
    showScreen('Lobby');
    const s = state;
    const choosing = s.phase === 'choosing';
    $('cfgBox').classList.toggle('hidden', !choosing);
    if (choosing && s.draft) {
      fillCfg($('cfgForm'), s.draft, 'gmDraft');
      const opp = s.players[1 - s.me].name;
      const mine = s.accept[s.me], theirs = s.accept[1 - s.me];
      $('btnAccept').disabled = mine;
      $('btnAccept').textContent = mine ? '✔ Aceptaste' : 'Aceptar configuración';
      $('cfgMsg').textContent = mine ? 'Esperando que ' + opp + ' acepte…' : theirs ? opp + ' ya aceptó. ¡Aceptá vos!' : 'Tildá los grupos de personajes y elegí el modo.';
    }
    $('lobbyCode').textContent = s.code;
    $('lobbyLink').value = roomLink();
    $('lobbyPlayers').innerHTML = s.players.map((p, i) =>
      '<li><span>Jugador ' + (i + 1) + ': ' + esc(p.name) + '</span><span class="' + (p.ready ? 'ok' : 'wait') + '">' + (p.ready ? '✔ Listo' : 'Esperando…') + '</span></li>').join('') +
      (s.players.length < 2 ? '<li><span class="wait">Esperando al otro jugador…</span></li>' : '');
    const me = s.players[s.me];
    $('btnReady').classList.toggle('hidden', choosing);
    $('btnReady').disabled = me.ready || s.players.length < 2;
    $('btnReady').textContent = me.ready ? 'Esperando al rival…' : '¡Listo!';
    $('lobbyMsg').textContent = choosing ? '' : s.players.length < 2 ? 'Cuando entre tu rival, los dos aprietan “Listo” y empieza la partida.' : '';
    Board.setVisible(false);
  }

  function turnText(s) {
    const opp = s.players[1 - s.me].name;
    if (s.gameMode === 'group') {
      const pc = s.pending && s.pending.characterId && charMap[s.pending.characterId];
      if (s.awaiting === 'verdict') return s.turn === s.me ? 'Esperando que ' + opp + ' decida si ' + (pc ? pc.name : 'el personaje') + ' es de su grupo…' : opp + ' propone a ' + (pc ? pc.name : '?') + ': ¿es de tu grupo?';
      if (s.awaiting === 'phraseVerdict') return s.turn === s.me ? 'Esperando que ' + opp + ' diga si acertaste la frase…' : opp + ' arriesga: “' + s.pending.text + '”. ¿Es tu frase?';
      if (s.turn === s.me && s.awaiting === 'ask') return 'Tu turno: preguntá, arrastrá un personaje al “?” para proponerlo o adiviná la frase';
    }
    if (s.turn === s.me) return s.awaiting === 'ask' ? 'Tu turno: preguntá, cedé el turno o arrastrá un personaje al “?”' : 'Esperando la respuesta de ' + opp + '…';
    return s.awaiting === 'ask' ? 'Turno de ' + opp + '…' : opp + ' preguntó. ¡Respondé!';
  }

  // Cada lado muestra a su jugador: el propio recuadro con mi personaje y el del rival en negro con "?".
  function renderSide(i) {
    const s = state;
    const p = s.players[i];
    const mine = i === s.me;
    $('pname' + i).textContent = p.name + (mine ? ' (vos)' : '');
    $('hearts' + i).innerHTML = s.gameMode === 'group' ? '' : hearts(p.lives);
    const box = $('box' + i);
    if (s.gameMode === 'group') {
      const key = mine ? 'p:' + (s.myPhrase || '') : 'tg';
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.className = 'box ' + (mine ? 'mine phrase' : 'target');
        box.innerHTML = mine ? '<span class="ph">' + esc(s.myPhrase || '…') + '</span>' : '<span class="q">?</span>';
      }
      $('boxname' + i).textContent = mine ? 'Tu frase secreta' : (p.hasPhrase ? 'Grupo a adivinar' : 'Escribiendo su frase…');
      return;
    }
    const ch = mine ? (charMap[s.myCharacter] || { name: '?', file: '' }) : null;
    const key = mine ? 'm:' + s.myCharacter : 't';
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.className = 'box ' + (mine ? 'mine' : 'target');
      box.innerHTML = mine ? '<img src="' + esc(ch.file) + '" alt="">' : '<span class="q">?</span>';
    }
    $('boxname' + i).textContent = mine ? ch.name : 'Personaje a adivinar';
  }

  function renderGame() {
    showScreen('Game');
    const s = state;
    $('gameCode').textContent = s.code;
    $('score').innerHTML = esc(s.players[0].name) + ' (J1) <b>' + s.wins[0] + '</b> – <b>' + s.wins[1] + '</b> ' + esc(s.players[1].name) + ' (J2)';
    renderSide(0);
    renderSide(1);

    const playing = s.phase === 'playing';
    const myTurn = playing && s.turn === s.me;
    $('turnInfo').textContent = playing ? turnText(s) : '';
    $('turnInfo').classList.toggle('mine', myTurn || (playing && !myTurn && (s.awaiting === 'verdict' || s.awaiting === 'phraseVerdict')));
    const group = s.gameMode === 'group';
    if (!(myTurn && s.awaiting === 'ask' && group)) phraseMode = false;
    $('askForm').classList.toggle('hidden', !(myTurn && s.awaiting === 'ask') || phraseMode);
    $('btnPhrase').classList.toggle('hidden', !group);
    $('phraseForm').classList.toggle('hidden', !phraseMode);
    $('answerBtns').classList.toggle('hidden', !(playing && !myTurn && s.awaiting === 'answer'));
    $('verdictBtns').classList.toggle('hidden', !(playing && !myTurn && s.awaiting === 'verdict'));
    $('phraseBtns').classList.toggle('hidden', !(playing && !myTurn && s.awaiting === 'phraseVerdict'));
    $('cfgInfo').textContent = cfgText(s);
    $('galhint').textContent = 'Clic izquierdo: tachar · Clic derecho (mantener): agarrar y arrastrar · Soltá en el “?” del rival para ' + (group ? 'proponerlo para su grupo' : 'adivinar');
    $('btnChange').disabled = !!s.change || s.phase === 'ended';

    // grupo social: escribir la frase secreta
    const setup = s.phase === 'setup';
    $('setupBox').classList.toggle('hidden', !setup);
    if (setup) {
      const opp = s.players[1 - s.me];
      $('setupMsg').textContent = s.myPhrase
        ? (opp.hasPhrase ? '' : 'Guardaste “' + s.myPhrase + '”. Esperando la frase de ' + opp.name + '… (la podés corregir)')
        : (opp.hasPhrase ? opp.name + ' ya escribió la suya.' : '');
    }

    // cambio de modo / pools
    $('changeModal').classList.toggle('hidden', !changeOpen || !!s.change);
    $('changeAsk').classList.toggle('hidden', !s.change);
    if (s.change) {
      const mineCh = s.change.by === s.me;
      const by = s.players[s.change.by].name;
      $('changeAskTitle').textContent = mineCh ? 'Propuesta enviada' : by + ' quiere cambiar la partida';
      $('changeAskText').textContent = (mineCh ? 'Esperando que ' + s.players[1 - s.me].name + ' acepte: ' : 'Nueva configuración: ') + cfgText(s.change) + '. Arranca una ronda nueva.';
      $('changeAskBtns').classList.toggle('hidden', mineCh);
      $('changeWaitBtns').classList.toggle('hidden', !mineCh);
    }

    const log = $('chatLog');
    log.innerHTML = s.chat.map(m => {
      const who = esc(s.players[m.from].name);
      if (m.kind === 'question') return '<div class="msg' + (m.from === s.me ? ' mine' : '') + '"><small>' + who + '</small>' + esc(m.text) + '</div>';
      if (m.kind === 'skip') return '<div class="msg ans ns">' + who + ' ' + esc(m.text) + '</div>';
      if (m.kind === 'propose') {
        const c = charMap[m.characterId];
        return '<div class="msg sys' + (m.from === s.me ? ' mine' : '') + '"><small>' + who + ' propone para el grupo</small>' +
          (c ? '<img src="' + esc(c.file) + '" alt=""> ' + esc(c.name) : '?') + '</div>';
      }
      if (m.kind === 'verdict') return '<div class="msg ans ' + (m.text === 'Válido' ? 'si' : 'no') + '">' + who + ': ' + esc(m.text) + '</div>';
      if (m.kind === 'phraseGuess') return '<div class="msg' + (m.from === s.me ? ' mine' : '') + '"><small>' + who + ' arriesga la frase</small>“' + esc(m.text) + '”</div>';
      if (m.kind === 'phraseVerdict') return '<div class="msg ans ' + (m.text === 'Incorrecto' ? 'no' : 'si') + '">' + who + ': ' + esc(m.text) + '</div>';
      const cls = m.text === 'Sí' ? 'si' : m.text === 'No' ? 'no' : 'ns';
      return '<div class="msg ans ' + cls + '">' + who + ': ' + esc(m.text) + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;

    Board.setVisible(true);

    if (s.pools.length && s.pools.join(',') !== galleryKey) buildGallery(s.pools);
    updateAway();
    renderStrikes();
    updateZoneUI();
    renderOverlay();
  }

  function renderOverlay() {
    const s = state;
    const over = s.phase === 'roundOver' || s.phase === 'ended';
    if (!over || Date.now() < celebrationUntil || s.change || changeOpen) {
      $('overlay').classList.add('hidden');
      return;
    }
    const opp = s.players[1 - s.me];
    const won = s.winner === s.me;
    $('overTitle').textContent = s.phase === 'ended' ? 'Partida terminada' : (won ? '¡Ganaste la ronda!' : 'Perdiste la ronda');
    const group = s.gameMode === 'group';
    $('overSub').textContent = group
      ? (won ? '¡Adivinaste la frase del grupo de ' + opp.name + '!' : opp.name + ' adivinó la frase de tu grupo.')
      : won
        ? (opp.lives === 0 ? opp.name + ' se quedó sin vidas.' : '¡Adivinaste el personaje de ' + opp.name + '!')
        : (s.players[s.me].lives === 0 ? 'Te quedaste sin vidas.' : opp.name + ' adivinó tu personaje.');
    $('overlay').querySelector('.reveal').classList.toggle('hidden', group);
    $('revPhrases').classList.toggle('hidden', !group);
    if (group) {
      $('revPhrases').innerHTML = '<div><small>Tu frase</small>“' + esc(s.myPhrase) + '”</div><div><small>Frase de ' + esc(opp.name) + '</small>“' + esc(s.opponentPhrase) + '”</div>';
    }
    const mine = charMap[s.myCharacter] || { name: '?', file: '' };
    const theirs = charMap[s.opponentCharacter] || { name: '?', file: '' };
    $('revMine').src = mine.file;
    $('revMineName').textContent = 'Tu personaje: ' + mine.name;
    $('revOpp').src = theirs.file;
    $('revOppName').textContent = 'De ' + opp.name + ': ' + theirs.name;
    $('overScore').innerHTML = esc(s.players[0].name) + ' <b>' + s.wins[0] + '</b> – <b>' + s.wins[1] + '</b> ' + esc(s.players[1].name);

    const ended = s.phase === 'ended';
    const voted = s.rematch[s.me] === true;
    $('overBtns').classList.toggle('hidden', ended || voted || !!s.change);
    $('btnChangeOver').classList.toggle('hidden', !!s.change);
    $('overWait').classList.toggle('hidden', ended || !voted);
    $('overWait').textContent = 'Esperando que ' + opp.name + ' responda…';
    $('btnHome').classList.toggle('hidden', !ended);
    $('overlay').classList.remove('hidden');
  }

  $('btnRematchYes').onclick = () => Net.send('rematch', { yes: true }, r => r.error && toast(errText(r.error)));
  $('btnRematchNo').onclick = () => Net.send('rematch', { yes: false }, r => r.error && toast(errText(r.error)));
  $('btnHome').onclick = () => { clearSession(); location.href = '/'; };

  function render() {
    if (!state) { showScreen('Home'); Board.setVisible(false); updateBanner(); return; }
    if (state.phase === 'lobby' || state.phase === 'choosing') {
      renderLobby();
      ['setupBox', 'changeModal', 'changeAsk'].forEach(m => $(m).classList.add('hidden'));
    } else renderGame();
    updateBanner();
  }

  // ---------- Red ----------
  Net.on('state', s => {
    const prev = state;
    state = s;
    const newRound = !prev || prev.round !== s.round;
    if (newRound || (s.phase === 'playing' && prev.phase !== 'playing')) {
      // ronda nueva (revancha o cambio de modo/pools) o arranque del juego tras escribir las frases
      if (newRound) { Ragdoll.clearAll(); Board.clear(); struck.clear(); rivalStruck = []; }
      zoneLocal = null;
      guessPending = false;
      celebrationUntil = 0;
      if (newRound) { changeOpen = false; $('setupInput').value = ''; }
      if (s.phase === 'playing') Sfx.turn();
    } else if (prev && s.phase === 'playing' && prev.chat && s.chat) {
      const myMove = (s.turn === s.me && s.awaiting === 'ask') || (s.turn !== s.me && s.awaiting === 'answer');
      const wasMyMove = (prev.turn === prev.me && prev.awaiting === 'ask') || (prev.turn !== prev.me && prev.awaiting === 'answer');
      if (myMove && !wasMyMove) Sfx.turn();
      else if (s.chat.length > prev.chat.length) Sfx.msg();
    }
    if (prev && prev.phase === 'playing' && s.phase === 'playing' && !prev.players[1 - prev.me].connected && s.players[1 - s.me].connected) sendStrikes();
    render();
  });
  Net.on('dragMove', d => Ragdoll.remoteMove(d));
  Net.on('boardStroke', d => Board.remoteStroke(d));
  Net.on('boardClear', () => Board.clear());
  Net.on('boardOpen', d => Board.remoteOpen(d.open));
  Net.on('strikes', d => { rivalStruck = (d && Array.isArray(d.ids) ? d.ids : []).filter(id => charMap[id]); renderStrikes(); });
  Net.on('dragEnd', d => Ragdoll.remoteEnd(d));
  Net.on('zoneDrop', d => { Ragdoll.remoteZone(d); updateZoneUI(); });
  Net.on('zoneCancel', d => { Ragdoll.eject(d.id, state ? state.me : 0); updateZoneUI(); });
  // Grupo social: el rival decidió sobre el personaje propuesto.
  Net.on('proposalResult', ({ by, characterId, valid }) => {
    const mine = state && by === state.me;
    if (valid) { Ragdoll.sendHome(characterId); Sfx.good(); } else { Ragdoll.eject(characterId, 1 - by); Sfx.bad(); }
    if (mine) { zoneLocal = null; guessPending = false; }
    updateZoneUI();
  });
  Net.on('guessResult', ({ by, characterId, correct }) => {
    const mine = state && by === state.me;
    const side = 1 - by; // el recuadro "?" estaba del lado del rival del que adivinó
    celebrationUntil = Date.now() + (correct ? 2300 : 1500);
    setTimeout(render, (correct ? 2300 : 1500) + 50);
    if (correct) { Ragdoll.celebrate(characterId, side); Sfx.good(); } else { Ragdoll.eject(characterId, side); Sfx.bad(); }
    if (mine) zoneLocal = null;
    updateZoneUI();
  });
  Net.on('slow', () => { connBanner = 'Despertando el servidor… puede tardar hasta un minuto.'; updateBanner(); });
  Net.on('close', () => { connBanner = 'Conexión perdida. Reconectando…'; updateBanner(); });
  Net.on('open', () => {
    connBanner = '';
    updateBanner();
    if (session) {
      Net.send('joinRoom', { code: session.code, token: session.token, name: savedName() }, r => {
        if (r.error) {
          clearSession();
          state = null;
          render();
          setHomeError(errText(r.error));
        }
      });
    }
  });

  // ---------- Arranque ----------
  async function boot() {
    $('nameInput').value = savedName();
    const q = new URLSearchParams(location.search).get('sala');
    if (q) $('codeInput').value = q.toUpperCase().slice(0, 4);
    try {
      chars = await (await fetch('characters.json')).json();
    } catch (e) {
      setHomeError('No se pudo cargar la lista de personajes. Recargá la página.');
      chars = [];
    }
    chars.forEach(c => { charMap[c.id] = c; });
    buildGallery(null);
    Board.init({ send: (ev, data) => Net.send(ev, data) });
    Ragdoll.init($('fly'), {
      character: id => charMap[id] || { name: id, file: '' },
      zoneRect: side => $('box' + side).getBoundingClientRect(),
      zoneSide: () => targetSide(),
      mySide: () => state.me,
      slotRect: id => {
        const el = $('gallery').querySelector('[data-id="' + id + '"]');
        return (el || $('gallery')).getBoundingClientRect();
      },
      galleryRect: () => $('gallery').getBoundingClientRect(),
      canGuess,
      send: (ev, data) => Net.send(ev, data),
      onChange: () => { updateAway(); updateZoneUI(); },
    });
    showScreen('Home');
    Net.connect();
  }
  boot();
})();
