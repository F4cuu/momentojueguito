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
  };
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
  let galleryMode = null;
  let connBanner = '';
  let toastTimer = null;

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
  function buildGallery(mode) {
    const g = $('gallery');
    g.innerHTML = '';
    galleryMode = mode || null;
    chars.filter(c => !mode || mode === 'mix' || c.pool === mode).forEach(c => {
      const d = document.createElement('div');
      d.className = 'gcard';
      d.dataset.id = c.id;
      d.innerHTML = '<img loading="lazy" src="' + esc(c.file) + '" alt=""><span>' + esc(c.name) + '</span>';
      g.appendChild(d);
    });
  }
  function updateAway() {
    const away = new Set(Ragdoll.ids());
    document.querySelectorAll('.gcard').forEach(el => {
      el.classList.toggle('away', away.has(el.dataset.id));
      el.classList.toggle('struck', struck.has(el.dataset.id));
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
  function renderStrikes() {
    if (!state) return;
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
    if (!zoneLocal && Ragdoll.hasZoneCard() && opp) $('cap' + state.me).textContent = opp.name + ' va a intentar adivinar…';
    $('box' + tgt).classList.toggle('disabled', !canGuess());
    $('box' + state.me).classList.remove('disabled');
  }

  $('btnYes').onclick = () => {
    const id = zoneLocal;
    if (!id || guessPending) return;
    guessPending = true;
    updateZoneUI();
    Net.send('guess', { characterId: id }, r => {
      guessPending = false;
      if (r.error) {
        toast(errText(r.error));
        Ragdoll.sendHome(id);
        zoneLocal = null;
      }
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
  $('btnSkip').onclick = () => Net.send('skip', {}, r => r.error && toast(errText(r.error)));
  $('answerBtns').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (b) Net.send('answer', { answer: b.dataset.a }, r => r.error && toast(errText(r.error)));
  });

  // ---------- Render ----------
  const hearts = n => '<span>' + '♥'.repeat(Math.max(0, n)) + '</span><span class="lost">' + '♥'.repeat(Math.max(0, 2 - n)) + '</span>';

  const MODE_NAMES = { bc: 'Black Clover', dnd: 'Torre (D&D)', mix: 'Ambas mezcladas' };
  document.querySelectorAll('.btn.mode').forEach(b => {
    b.onclick = () => Net.send('choosePool', { mode: b.dataset.mode }, r => r.error && toast(errText(r.error)));
  });

  function renderLobby() {
    showScreen('Lobby');
    const s = state;
    const choosing = s.phase === 'choosing';
    $('modeBox').classList.toggle('hidden', !choosing);
    if (choosing) {
      const mine = s.picks[s.me], theirs = s.picks[1 - s.me];
      document.querySelectorAll('.btn.mode').forEach(b => {
        b.classList.toggle('picked', b.dataset.mode === mine);
        b.classList.toggle('rival', b.dataset.mode === theirs && theirs !== mine);
      });
      const opp = s.players[1 - s.me].name;
      $('modeMsg').textContent = !mine ? (theirs ? opp + ' ya eligió. ¡Elegí vos!' : 'Elegí un modo.')
        : (!theirs ? 'Esperando que ' + opp + ' elija…' : opp + ' eligió ' + MODE_NAMES[theirs] + '. Tienen que coincidir: cambiá tu voto o esperá que cambie.');
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
    if (s.turn === s.me) return s.awaiting === 'ask' ? 'Tu turno: preguntá, cedé el turno o arrastrá un personaje al “?”' : 'Esperando la respuesta de ' + opp + '…';
    return s.awaiting === 'ask' ? 'Turno de ' + opp + '…' : opp + ' preguntó. ¡Respondé!';
  }

  // Cada lado muestra a su jugador: el propio recuadro con mi personaje y el del rival en negro con "?".
  function renderSide(i) {
    const s = state;
    const p = s.players[i];
    const mine = i === s.me;
    $('pname' + i).textContent = p.name + (mine ? ' (vos)' : '');
    $('hearts' + i).innerHTML = hearts(p.lives);
    const box = $('box' + i);
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
    $('turnInfo').classList.toggle('mine', myTurn);
    $('askForm').classList.toggle('hidden', !(myTurn && s.awaiting === 'ask'));
    $('answerBtns').classList.toggle('hidden', !(playing && !myTurn && s.awaiting === 'answer'));

    const log = $('chatLog');
    log.innerHTML = s.chat.map(m => {
      const who = esc(s.players[m.from].name);
      if (m.kind === 'question') return '<div class="msg' + (m.from === s.me ? ' mine' : '') + '"><small>' + who + '</small>' + esc(m.text) + '</div>';
      if (m.kind === 'skip') return '<div class="msg ans ns">' + who + ' ' + esc(m.text) + '</div>';
      const cls = m.text === 'Sí' ? 'si' : m.text === 'No' ? 'no' : 'ns';
      return '<div class="msg ans ' + cls + '">' + who + ': ' + esc(m.text) + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;

    Board.setVisible(true);

    if (s.mode && s.mode !== galleryMode) buildGallery(s.mode);
    updateAway();
    renderStrikes();
    updateZoneUI();
    renderOverlay();
  }

  function renderOverlay() {
    const s = state;
    const over = s.phase === 'roundOver' || s.phase === 'ended';
    if (!over || Date.now() < celebrationUntil) {
      $('overlay').classList.add('hidden');
      return;
    }
    const opp = s.players[1 - s.me];
    const won = s.winner === s.me;
    $('overTitle').textContent = s.phase === 'ended' ? 'Partida terminada' : (won ? '¡Ganaste la ronda!' : 'Perdiste la ronda');
    $('overSub').textContent = won
      ? (opp.lives === 0 ? opp.name + ' se quedó sin vidas.' : '¡Adivinaste el personaje de ' + opp.name + '!')
      : (s.players[s.me].lives === 0 ? 'Te quedaste sin vidas.' : opp.name + ' adivinó tu personaje.');
    const mine = charMap[s.myCharacter] || { name: '?', file: '' };
    const theirs = charMap[s.opponentCharacter] || { name: '?', file: '' };
    $('revMine').src = mine.file;
    $('revMineName').textContent = 'Tu personaje: ' + mine.name;
    $('revOpp').src = theirs.file;
    $('revOppName').textContent = 'De ' + opp.name + ': ' + theirs.name;
    $('overScore').innerHTML = esc(s.players[0].name) + ' <b>' + s.wins[0] + '</b> – <b>' + s.wins[1] + '</b> ' + esc(s.players[1].name);

    const ended = s.phase === 'ended';
    const voted = s.rematch[s.me] === true;
    $('overBtns').classList.toggle('hidden', ended || voted);
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
    if (state.phase === 'lobby' || state.phase === 'choosing') renderLobby(); else renderGame();
    updateBanner();
  }

  // ---------- Red ----------
  Net.on('state', s => {
    const prev = state;
    state = s;
    if (s.phase === 'playing' && (!prev || prev.phase !== 'playing')) {
      Ragdoll.clearAll();
      Board.clear();
      struck.clear();
      rivalStruck = [];
      zoneLocal = null;
      guessPending = false;
      celebrationUntil = 0;
      Sfx.turn();
    } else if (prev && s.phase === 'playing') {
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
