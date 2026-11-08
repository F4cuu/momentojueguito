'use strict';
// Pizarrón compartido y movible. Se asoma apenas por el borde superior de la pantalla; con clic se lo
// agarra y se lo arrastra; adentro dibujan los dos jugadores a la vez (los trazos se retransmiten).
const Board = (() => {
  const COLORS = ['#ffffff', '#ffd84d', '#ff6b6b', '#5ec8ff', '#6be38d', '#ff9f43', '#ff7ad9', '#b388ff'];
  const DOCK_VISIBLE = 14;  // px que asoma en reposo
  const PEEK_VISIBLE = 40;  // px que asoma al acercar el cursor
  const CANVAS_W = 520, CANVAS_H = 300;

  let el, canvas, ctx, send = () => {}, mode = 'docked', peek = false, visible = false;
  let drag = null, drawing = false, last = null;
  let color = COLORS[0], size = 4, erasing = false;

  const $ = id => document.getElementById(id);

  const totalW = () => el.offsetWidth;
  const totalH = () => el.offsetHeight;
  function applyDock() {
    const show = peek ? PEEK_VISIBLE : DOCK_VISIBLE;
    el.style.left = Math.round((innerWidth - totalW()) / 2) + 'px';
    el.style.top = -(totalH() - show) + 'px';
  }

  function clampOpen() {
    const w = totalW();
    const left = Math.max(-w + 90, Math.min(innerWidth - 90, parseFloat(el.style.left) || 0));
    const top = Math.max(0, Math.min(innerHeight - 50, parseFloat(el.style.top) || 0));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function dock(fromRemote) {
    if (!fromRemote && mode === 'open') send('boardOpen', { open: false });
    mode = 'docked';
    peek = false;
    el.classList.remove('open', 'peek');
    applyDock();
  }

  function startDrag(e) {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    if (mode === 'docked') {
      // se abre siguiendo al cursor
      mode = 'open';
      send('boardOpen', { open: true });
      el.classList.add('open');
      el.classList.remove('peek');
      drag = { dx: totalW() / 2, dy: 22 };
      el.style.left = e.clientX - drag.dx + 'px';
      el.style.top = e.clientY - drag.dy + 'px';
    } else {
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    }
    el.classList.add('dragging');
  }

  function endDrag() {
    drag = null;
    el.classList.remove('dragging');
    const r = el.getBoundingClientRect();
    const nearHome = r.bottom < 90;
    if (nearHome) dock(); else clampOpen();
  }

  // ---------- dibujo ----------
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const k = CANVAS_W / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }
  function stroke(a, b, st) {
    st = st || { c: color, s: size, e: erasing };
    ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = st.c;
    ctx.lineWidth = st.e ? st.s * 2.5 : st.s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  function emit(a, p) {
    send('boardStroke', { a, b: p, c: color, s: size, e: erasing });
  }
  function updateDot() {
    const d = $('bdot');
    const px = Math.max(2, size);
    d.style.width = d.style.height = px + 'px';
    d.style.background = erasing ? '#1d2f26' : color;
    d.style.outline = erasing ? '1px dashed #fff' : 'none';
  }
  function setTool(isEraser) {
    erasing = isEraser;
    $('beraser').classList.toggle('active', erasing);
    el.classList.toggle('erasing', erasing);
    updateDot();
  }

  function init(opts) {
    if (opts && opts.send) send = opts.send;
    el = $('board');
    canvas = $('bcanvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // colores
    const box = $('bcolors');
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' active' : '');
      b.style.background = c;
      b.title = 'Color';
      b.onclick = () => {
        color = c;
        box.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        b.classList.add('active');
        setTool(false);
      };
      box.appendChild(b);
    });
    $('bsize').oninput = e => { size = +e.target.value; updateDot(); };
    $('beraser').onclick = () => setTool(!erasing);
    $('bclear').onclick = () => { clear(); send('boardClear', {}); };
    $('bclose').onclick = () => dock(false);
    $('bexpand').onclick = () => {
      el.classList.toggle('big');
      const w = totalW(), h = totalH();
      el.style.left = Math.max(8, Math.min(parseFloat(el.style.left) || 0, innerWidth - w - 8)) + 'px';
      el.style.top = Math.max(8, Math.min(parseFloat(el.style.top) || 0, innerHeight - h - 8)) + 'px';
    };
    updateDot();

    // arrastrar el pizarrón: desde la solapa o desde el título
    $('bhandle').addEventListener('mousedown', e => { if (e.button === 0) startDrag(e); });
    $('bhead').addEventListener('mousedown', e => {
      if (e.button === 0 && mode === 'open' && !e.target.closest('button')) startDrag(e);
    });
    window.addEventListener('mousemove', e => {
      if (drag) {
        el.style.left = e.clientX - drag.dx + 'px';
        el.style.top = e.clientY - drag.dy + 'px';
        return;
      }
      if (!visible || mode !== 'docked') return;
      const near = e.clientY < 40 && Math.abs(e.clientX - innerWidth / 2) < 330;
      const want = near || el.contains(e.target);
      if (want !== peek) {
        peek = want;
        el.classList.toggle('peek', peek);
        applyDock();
      }
    });
    window.addEventListener('mouseup', e => { if (drag && e.button === 0) endDrag(); });
    window.addEventListener('resize', () => { if (mode === 'docked') applyDock(); else clampOpen(); });

    // dibujar con el mouse
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      last = pos(e);
      stroke(last, last);
      emit(last, last);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = pos(e);
      stroke(last, p);
      emit(last, p);
      last = p;
    });
    const stop = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  function clear() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  return {
    init,
    clear,
    isOpen: () => mode === 'open',
    // eventos que llegan del otro jugador
    remoteStroke(d) {
      if (!d || !d.a || !d.b) return;
      stroke(d.a, d.b, { c: d.c, s: d.s, e: d.e });
    },
    remoteOpen(open) {
      if (open && mode === 'docked') {
        mode = 'open';
        peek = false;
        el.classList.remove('peek');
        el.classList.add('open');
        el.style.left = Math.round((innerWidth - totalW()) / 2) + 'px';
        el.style.top = '70px';
      } else if (!open && mode === 'open') dock(true);
    },
    setVisible(v) {
      visible = v;
      el.classList.toggle('hidden', !v);
      if (v && mode === 'docked') applyDock();
    },
    contains: target => !!target && el.contains(target),
  };
})();
