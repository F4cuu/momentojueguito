'use strict';
// Cartas "ragdoll": físicas de resorte con inercia e inclinación. Una carta por personaje.
// Modos: drag (la sostengo yo), remote (la sostiene el rival), free (suelta en el centro),
//        zone (fija en el cuadrado "?"), home (vuelve a su lugar en la galería).
const Ragdoll = (() => {
  const cards = new Map();
  let layer, cfg, dragging = null, lastSend = 0, lastT = performance.now();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function init(layerEl, config) {
    layer = layerEl;
    cfg = config; // { character(id), zoneRect(), slotRect(id), canGuess(), send(ev,data), onChange() }
    requestAnimationFrame(loop);
  }

  function make(id, x, y) {
    const ch = cfg.character(id);
    const el = document.createElement('div');
    el.className = 'fcard';
    el.dataset.id = id;
    el.innerHTML = '<img src="' + esc(ch.file) + '" alt=""><span>' + esc(ch.name) + '</span>';
    layer.appendChild(el);
    const c = { id, el, x, y, vx: 0, vy: 0, rot: 0, vr: 0, tx: x, ty: y, trot: 0, mode: 'free', rest: 0 };
    cards.set(id, c);
    draw(c);
    cfg.onChange();
    return c;
  }

  function setMode(c, mode) {
    c.mode = mode;
    c.el.classList.toggle('grabbable', mode === 'free');
  }

  function draw(c) {
    c.el.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px) translate(-50%,-50%) rotate(' + c.rot + 'deg)';
  }

  function remove(c) {
    c.el.remove();
    cards.delete(c.id);
    if (dragging === c) dragging = null;
    cfg.onChange();
  }

  function step(c, dt) {
    const W = innerWidth, H = innerHeight;
    if (c.mode === 'drag') {
      c.vx += ((c.tx - c.x) * 140 - c.vx * 16) * dt;
      c.vy += ((c.ty - c.y) * 140 - c.vy * 16) * dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      const tilt = clamp(c.vx * 0.035, -40, 40);
      c.vr += ((tilt - c.rot) * 90 - c.vr * 9) * dt;
      c.rot += c.vr * dt;
    } else if (c.mode === 'free') {
      c.vx += ((c.tx - c.x) * 40 - c.vx * 3.2) * dt;
      c.vy += ((c.ty - c.y) * 40 - c.vy * 3.2) * dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.vr += ((c.rest - c.rot) * 25 - c.vr * 2.5) * dt;
      c.rot += c.vr * dt;
      // rebote contra los bordes de la pantalla
      if (c.x < 40) { c.x = 40; c.vx = Math.abs(c.vx) * 0.6; }
      if (c.x > W - 40) { c.x = W - 40; c.vx = -Math.abs(c.vx) * 0.6; }
      if (c.y < 60) { c.y = 60; c.vy = Math.abs(c.vy) * 0.6; }
      if (c.y > H - 60) { c.y = H - 60; c.vy = -Math.abs(c.vy) * 0.6; }
    } else if (c.mode === 'remote') {
      const a = Math.min(1, dt * 20);
      c.x += (c.tx - c.x) * a; c.y += (c.ty - c.y) * a; c.rot += (c.trot - c.rot) * a;
    } else if (c.mode === 'zone') {
      const z = center(cfg.zoneRect());
      c.vx += ((z.x - c.x) * 120 - c.vx * 22) * dt;
      c.vy += ((z.y - c.y) * 120 - c.vy * 22) * dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.vr += ((0 - c.rot) * 80 - c.vr * 14) * dt;
      c.rot += c.vr * dt;
    } else if (c.mode === 'home') {
      const s = cfg.slotRect(c.id);
      const h = center(s);
      c.vx += ((h.x - c.x) * 120 - c.vx * 20) * dt;
      c.vy += ((h.y - c.y) * 120 - c.vy * 20) * dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.vr += ((0 - c.rot) * 80 - c.vr * 14) * dt;
      c.rot += c.vr * dt;
      if (Math.hypot(h.x - c.x, h.y - c.y) < 8 && Math.hypot(c.vx, c.vy) < 60) { remove(c); return; }
    }
    draw(c);
  }

  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000 || 0.016);
    lastT = t;
    for (const c of Array.from(cards.values())) step(c, dt);
    if (dragging && t - lastSend > 33) {
      lastSend = t;
      cfg.send('dragMove', { id: dragging.id, x: dragging.x / innerWidth, y: dragging.y / innerHeight, rot: dragging.rot });
    }
    requestAnimationFrame(loop);
  }

  return {
    init,
    ids: () => Array.from(cards.keys()),
    has: id => cards.has(id),
    isFree: id => { const c = cards.get(id); return !!c && c.mode === 'free'; },
    hasZoneCard: () => Array.from(cards.values()).some(c => c.mode === 'zone' && c.remoteZone),
    isDragging: () => !!dragging,

    // Empieza a arrastrar (clic derecho). Si la carta ya está suelta en pantalla, la reutiliza.
    grab(id, mx, my) {
      let c = cards.get(id);
      if (!c) {
        const s = center(cfg.slotRect(id));
        c = make(id, s.x, s.y);
      }
      c.tx = mx; c.ty = my;
      setMode(c, 'drag');
      dragging = c;
      return c;
    },
    setTarget(mx, my) {
      if (!dragging) return;
      dragging.tx = mx; dragging.ty = my;
    },
    // Suelta la carta: si está sobre el "?" y es mi turno queda en la zona; si no, vuelve a la galería.
    release() {
      const c = dragging;
      if (!c) return null;
      dragging = null;
      const z = cfg.zoneRect();
      const inside = c.x > z.left - 20 && c.x < z.right + 20 && c.y > z.top - 20 && c.y < z.bottom + 20;
      if (inside && cfg.canGuess()) {
        setMode(c, 'zone');
        cfg.send('zoneDrop', { id: c.id });
        return { id: c.id, where: 'zone' };
      }
      setMode(c, 'home');
      cfg.send('dragEnd', { id: c.id, mode: 'home' });
      return { id: c.id, where: 'home', wasOverZone: inside };
    },
    overZone() {
      if (!dragging) return false;
      const z = cfg.zoneRect();
      return dragging.x > z.left - 20 && dragging.x < z.right + 20 && dragging.y > z.top - 20 && dragging.y < z.bottom + 20;
    },

    // Eventos del rival
    remoteMove({ id, x, y, rot }) {
      let c = cards.get(id);
      if (!c) c = make(id, x * innerWidth, y * innerHeight);
      if (c.mode === 'drag') return;
      setMode(c, 'remote');
      c.tx = x * innerWidth; c.ty = y * innerHeight; c.trot = rot || 0;
    },
    remoteEnd({ id }) {
      const c = cards.get(id);
      if (c && c.mode !== 'drag') setMode(c, 'home');
    },
    remoteZone({ id }) {
      const c = cards.get(id);
      if (c && c.mode !== 'drag') { setMode(c, 'zone'); c.remoteZone = true; }
    },

    // La carta sale despedida y cae al medio de la pantalla (adivinanza fallida o "Permitime dudar...").
    eject(id) {
      let c = cards.get(id);
      if (!c) { const z = center(cfg.zoneRect()); c = make(id, z.x, z.y); }
      if (dragging === c) dragging = null;
      const h = hash(id);
      const ox = ((h % 160) - 80), oy = (((h >> 8) % 120) - 60);
      c.tx = innerWidth / 2 + ox; c.ty = innerHeight / 2 + oy;
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy) || 1;
      c.vx = (dx / d) * 1100; c.vy = (dy / d) * 1100 - 250;
      c.vr = (h % 2 ? 1 : -1) * (500 + (h % 400));
      c.rest = (h % 2 ? 1 : -1) * (6 + (h % 14));
      setMode(c, 'free');
    },
    // Movimiento de acierto: pulso dorado y chispas.
    celebrate(id) {
      let c = cards.get(id);
      if (!c) { const z = center(cfg.zoneRect()); c = make(id, z.x, z.y); }
      setMode(c, 'zone');
      c.remoteZone = false;
      c.el.classList.add('win');
      const z = center(cfg.zoneRect());
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
      if (c) setMode(c, 'home');
    },
    clearAll() {
      dragging = null;
      cards.forEach(c => c.el.remove());
      cards.clear();
      cfg.onChange();
    },
  };
})();
