'use strict';
// Cartas con física. Una carta por personaje, con un cuerpo rígido (ver physics.js).
// Modos:
//   drag   la sostengo yo, agarrada de un punto (cuelga e inclina según de dónde la agarre)
//   fall   la solté fuera de su lugar: cae al borde inferior con gravedad y rebotes
//   rest   quedó apoyada en el piso (se puede volver a agarrar)
//   remote la sostiene/cae por el rival; yo solo la sigo
//   zone   fija sobre el "?" del rival (intento de adivinar)
//   free   expulsada (adivinanza fallida / "Permitime dudar...") suelta en el medio de la pantalla
//   home   vuelve a su lugar en la galería y desaparece
const Ragdoll = (() => {
  const CW = 104, CH = 136;
  const cards = new Map();
  let layer, cfg, dragging = null, lastT = performance.now();

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const inside = (x, y, r, pad) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function init(layerEl, config) {
    layer = layerEl;
    cfg = config; // { character, zoneRect(side), zoneSide(), mySide(), slotRect(id), galleryRect(), canGuess(), send, onChange }
    window.addEventListener('resize', () => {
      cards.forEach(c => {
        if (c.mode !== 'rest') return;
        c.b.x = Math.max(CW / 2, Math.min(innerWidth - CW / 2, c.b.x));
        Physics.settle(c.b, innerHeight);
        draw(c);
      });
    });
    requestAnimationFrame(loop);
  }

  function make(id, x, y) {
    const ch = cfg.character(id);
    const el = document.createElement('div');
    el.className = 'fcard';
    el.dataset.id = id;
    el.innerHTML = '<img src="' + esc(ch.file) + '" alt=""><span>' + esc(ch.name) + '</span>';
    layer.appendChild(el);
    const c = {
      id, el, b: Physics.makeBody(x, y, CW, CH), mode: 'free',
      tx: x, ty: y, tang: 0, lx: 0, ly: 0, local: false, restT: 0, lastSend: 0, lastRemote: 0,
      zoneSide: 0, restAng: 0, remoteZone: false,
    };
    cards.set(id, c);
    draw(c);
    cfg.onChange();
    return c;
  }

  function setMode(c, mode) {
    c.mode = mode;
    c.el.classList.toggle('held', mode === 'drag');
  }

  function draw(c) {
    c.el.style.transform = 'translate(' + c.b.x + 'px,' + c.b.y + 'px) translate(-50%,-50%) rotate(' + c.b.ang + 'rad)';
  }

  function remove(c) {
    c.el.remove();
    cards.delete(c.id);
    if (dragging === c) dragging = null;
    cfg.onChange();
  }

  function spring(b, tx, ty, k, d, dt) {
    b.vx += ((tx - b.x) * k - b.vx * d) * dt;
    b.vy += ((ty - b.y) * k - b.vy * d) * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  function springAng(b, target, k, d, dt) {
    const t = b.ang + wrap(target - b.ang);
    b.w += ((t - b.ang) * k - b.w * d) * dt;
    b.ang += b.w * dt;
  }
  const zoneCenter = c => center(cfg.zoneRect(c.zoneSide));

  // El cuerpo ya está apoyado: se congela y, si era mía, se avisa al rival la posición final.
  function toRest(c) {
    setMode(c, 'rest');
    if (c.local) {
      c.local = false;
      cfg.send('dragEnd', { id: c.id, mode: 'rest', x: c.b.x / innerWidth, y: c.b.y / innerHeight, rot: c.b.ang });
    }
    c.b.vx = c.b.vy = c.b.w = 0;
  }

  function stepCard(c, dt, now) {
    const b = c.b;
    switch (c.mode) {
      case 'drag':
        Physics.step(b, dt, { W: innerWidth, H: innerHeight, grab: { lx: c.lx, ly: c.ly, tx: c.tx, ty: c.ty } });
        break;
      case 'fall':
        Physics.step(b, dt, { W: innerWidth, H: innerHeight });
        if (Physics.isAtRest(b, innerHeight)) {
          c.restT += dt;
          if (c.restT > 0.45) { Physics.settle(b, innerHeight); toRest(c); }
        } else c.restT = 0;
        break;
      case 'rest':
        return;
      case 'remote': {
        const a = Math.min(1, dt * 20);
        b.x += (c.tx - b.x) * a; b.y += (c.ty - b.y) * a; b.ang += (c.tang - b.ang) * a;
        if (now - c.lastRemote > 1500) { b.x = c.tx; b.y = c.ty; b.ang = c.tang; setMode(c, 'rest'); }
        break;
      }
      case 'zone': {
        const z = zoneCenter(c);
        spring(b, z.x, z.y, 120, 22, dt);
        springAng(b, 0, 80, 14, dt);
        break;
      }
      case 'free':
        spring(b, c.tx, c.ty, 40, 3.2, dt);
        springAng(b, c.restAng, 25, 2.5, dt);
        b.x = Math.max(40, Math.min(innerWidth - 40, b.x));
        b.y = Math.max(60, Math.min(innerHeight - 60, b.y));
        break;
      case 'home': {
        const h = center(cfg.slotRect(c.id));
        spring(b, h.x, h.y, 120, 20, dt);
        springAng(b, 0, 80, 14, dt);
        if (Math.hypot(h.x - b.x, h.y - b.y) < 8 && Math.hypot(b.vx, b.vy) < 60) { remove(c); return; }
        break;
      }
    }
    draw(c);
    // mientras la sostengo o cae por mi culpa, el rival recibe la posición
    if (c.local && (c.mode === 'drag' || c.mode === 'fall') && now - c.lastSend > 33) {
      c.lastSend = now;
      cfg.send('dragMove', { id: c.id, x: b.x / innerWidth, y: b.y / innerHeight, rot: b.ang });
    }
  }

  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000 || 0.016);
    lastT = t;
    const now = performance.now();
    for (const c of Array.from(cards.values())) stepCard(c, dt, now);
    requestAnimationFrame(loop);
  }

  const grabbable = c => c.mode === 'free' || c.mode === 'rest' || (c.mode === 'fall' && c.local);

  return {
    init,
    ids: () => Array.from(cards.keys()),
    has: id => cards.has(id),
    isFree: id => { const c = cards.get(id); return !!c && grabbable(c); },
    hasZoneCard: () => Array.from(cards.values()).some(c => c.mode === 'zone' && c.remoteZone),
    isDragging: () => !!dragging,

    // Carta suelta (o cayendo) bajo el cursor, para volver a agarrarla. Respeta la rotación.
    cardAt(x, y) {
      const list = Array.from(cards.values()).reverse();
      for (const c of list) {
        if (!grabbable(c)) continue;
        const dx = x - c.b.x, dy = y - c.b.y;
        const cs = Math.cos(c.b.ang), sn = Math.sin(c.b.ang);
        const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
        if (Math.abs(lx) <= CW / 2 && Math.abs(ly) <= CH / 2) return c.id;
      }
      return null;
    },

    // Empieza a arrastrar (clic derecho). El punto de agarre decide cómo se mueve y se inclina.
    grab(id, mx, my) {
      let c = cards.get(id);
      if (!c) {
        const s = center(cfg.slotRect(id));
        c = make(id, s.x, s.y);
        c.b.ang = 0;
      }
      const b = c.b;
      const dx = mx - b.x, dy = my - b.y;
      const cs = Math.cos(b.ang), sn = Math.sin(b.ang);
      c.lx = Math.max(-CW / 2, Math.min(CW / 2, dx * cs + dy * sn));
      c.ly = Math.max(-CH / 2, Math.min(CH / 2, -dx * sn + dy * cs));
      c.tx = mx; c.ty = my;
      if (c.mode !== 'fall') { b.vx = b.vy = b.w = 0; }
      c.local = true;
      setMode(c, 'drag');
      dragging = c;
      return c;
    },
    setTarget(mx, my) {
      if (!dragging) return;
      dragging.tx = mx; dragging.ty = my;
    },
    overZone() {
      if (!dragging) return false;
      return inside(dragging.b.x, dragging.b.y, cfg.zoneRect(cfg.zoneSide()), 20);
    },
    overOwn() {
      if (!dragging || !cfg.canGift || !cfg.canGift()) return false;
      return inside(dragging.b.x, dragging.b.y, cfg.zoneRect(cfg.mySide()), 20);
    },
    // Suelta la carta: sobre mi propio recuadro es un regalo (vuelve a la galería); sobre el "?" del rival (y es mi turno) queda fija; exactamente sobre su lugar
    // en la galería vuelve a él; en cualquier otro sitio cae al borde inferior de la página.
    release() {
      const c = dragging;
      if (!c) return null;
      dragging = null;
      if (cfg.canGift && cfg.canGift() && inside(c.b.x, c.b.y, cfg.zoneRect(cfg.mySide()), 20)) {
        c.local = false;
        setMode(c, 'home');
        cfg.send('dragEnd', { id: c.id, mode: 'home' });
        return { id: c.id, where: 'own' };
      }
      const side = cfg.zoneSide();
      const over = inside(c.b.x, c.b.y, cfg.zoneRect(side), 20);
      if (over && cfg.canGuess()) {
        c.zoneSide = side;
        c.local = false;
        setMode(c, 'zone');
        cfg.send('zoneDrop', { id: c.id });
        return { id: c.id, where: 'zone' };
      }
      const slot = cfg.slotRect(c.id);
      const gal = cfg.galleryRect();
      if (inside(c.b.x, c.b.y, slot, 14) && inside(c.b.x, c.b.y, gal, 0)) {
        c.local = false;
        setMode(c, 'home');
        cfg.send('dragEnd', { id: c.id, mode: 'home' });
        return { id: c.id, where: 'home' };
      }
      c.restT = 0;
      setMode(c, 'fall'); // sigue siendo mía: transmite su caída
      return { id: c.id, where: 'fall', wasOverZone: over };
    },

    // ---- eventos del rival ----
    remoteMove({ id, x, y, rot }) {
      let c = cards.get(id);
      if (!c) { c = make(id, x * innerWidth, y * innerHeight); c.b.ang = rot || 0; }
      if (c.mode === 'drag' || (c.mode === 'fall' && c.local)) return;
      setMode(c, 'remote');
      c.local = false;
      c.tx = x * innerWidth; c.ty = y * innerHeight; c.tang = rot || 0;
      c.lastRemote = performance.now();
    },
    remoteEnd({ id, mode, x, y, rot }) {
      const c = cards.get(id);
      if (!c || c.mode === 'drag' || (c.mode === 'fall' && c.local)) return;
      if (mode === 'rest') {
        if (x != null) { c.b.x = x * innerWidth; c.b.y = y * innerHeight; c.b.ang = rot || 0; }
        c.b.vx = c.b.vy = c.b.w = 0;
        setMode(c, 'rest');
        draw(c);
      } else {
        setMode(c, 'home');
      }
    },
    // El rival soltó una carta sobre su objetivo, que es mi propio recuadro.
    remoteZone({ id }) {
      const c = cards.get(id);
      if (!c || c.mode === 'drag') return;
      c.zoneSide = cfg.mySide();
      c.remoteZone = true;
      c.local = false;
      setMode(c, 'zone');
    },

    // La carta sale despedida y cae al medio de la pantalla (adivinanza fallida o "Permitime dudar...").
    eject(id, fromSide) {
      let c = cards.get(id);
      if (!c) {
        const z = center(cfg.zoneRect(fromSide));
        c = make(id, z.x, z.y);
        c.zoneSide = fromSide;
      }
      if (dragging === c) dragging = null;
      const h = hash(id);
      const ox = (h % 160) - 80, oy = ((h >> 8) % 120) - 60;
      c.tx = innerWidth / 2 + ox; c.ty = innerHeight / 2 + oy;
      const dx = c.tx - c.b.x, dy = c.ty - c.b.y, d = Math.hypot(dx, dy) || 1;
      c.b.vx = (dx / d) * 1100; c.b.vy = (dy / d) * 1100 - 250;
      c.b.w = (h % 2 ? 1 : -1) * (8 + (h % 7));
      c.restAng = (h % 2 ? 1 : -1) * (6 + (h % 14)) * Math.PI / 180;
      c.local = false; c.remoteZone = false;
      setMode(c, 'free');
    },
    // Movimiento de acierto: pulso dorado y chispas.
    celebrate(id, side) {
      let c = cards.get(id);
      if (!c) {
        const z0 = center(cfg.zoneRect(side));
        c = make(id, z0.x, z0.y);
      }
      c.zoneSide = side;
      c.remoteZone = false;
      c.local = false;
      setMode(c, 'zone');
      c.el.classList.add('win');
      const z = center(cfg.zoneRect(side));
      for (let i = 0; i < 26; i++) {
        const s = document.createElement('i');
        s.className = 'spark';
        const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 170;
        s.style.left = z.x + 'px'; s.style.top = z.y + 'px';
        s.style.setProperty('--dx', Math.cos(a) * r + 'px');
        s.style.setProperty('--dy', Math.sin(a) * r + 'px');
        layer.appendChild(s);
        setTimeout(() => s.remove(), 1100);
      }
    },
    sendHome(id) {
      const c = cards.get(id);
      if (c) { c.local = false; setMode(c, 'home'); }
    },
    clearAll() {
      dragging = null;
      cards.forEach(c => c.el.remove());
      cards.clear();
      cfg.onChange();
    },
  };
})();
