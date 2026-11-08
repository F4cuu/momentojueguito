'use strict';
// Cuerpo rígido 2D para las cartas: gravedad, agarre por un punto (resorte), rebotes y fricción
// contra los bordes de la pantalla. Sin DOM: se usa en el navegador y en los tests de Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GRAVITY = 2200;      // px/s²
  const KS = 450;            // rigidez del resorte de agarre
  const KD = 30;             // amortiguación del resorte de agarre
  const ANG_DAMP = 1.5;      // roce angular
  const LIN_DAMP = 0.05;     // roce del aire
  const RESTITUTION = 0.3;
  const FRICTION = 0.6;
  const SUBSTEPS = 4;

  // masa = 1; inercia de un rectángulo w×h
  function makeBody(x, y, w, h) {
    return { x, y, ang: 0, vx: 0, vy: 0, w: 0, hw: w / 2, hh: h / 2, I: (w * w + h * h) / 12 };
  }

  // Esquinas como desplazamientos (rx, ry) respecto del centro, ya rotadas.
  function corners(b) {
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    return [[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]]
      .map(([lx, ly]) => ({ rx: lx * c - ly * s, ry: lx * s + ly * c }));
  }

  // Resuelve el contacto de una esquina con un plano de normal (nx, ny); pen = penetración.
  function resolveContact(b, rx, ry, nx, ny) {
    const vcx = b.vx - b.w * ry, vcy = b.vy + b.w * rx;
    const vn = vcx * nx + vcy * ny;
    if (vn >= 0) return;
    const e = -vn < 80 ? 0 : RESTITUTION;
    const rn = rx * ny - ry * nx;
    const j = -(1 + e) * vn / (1 + rn * rn / b.I);
    b.vx += j * nx; b.vy += j * ny;
    b.w += (rx * (j * ny) - ry * (j * nx)) / b.I;
    // fricción tangencial
    const tx = -ny, ty = nx;
    const wx = b.vx - b.w * ry, wy = b.vy + b.w * rx;
    const vt = wx * tx + wy * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 + rt * rt / b.I);
    const max = FRICTION * j;
    jt = Math.max(-max, Math.min(max, jt));
    b.vx += jt * tx; b.vy += jt * ty;
    b.w += (rx * (jt * ty) - ry * (jt * tx)) / b.I;
  }

  function collide(b, W, H) {
    const planes = [
      { nx: 0, ny: -1, pen: (cx, cy) => cy - H },   // piso
      { nx: 1, ny: 0, pen: cx => -cx },             // pared izquierda
      { nx: -1, ny: 0, pen: cx => cx - W },         // pared derecha
      { nx: 0, ny: 1, pen: (cx, cy) => -cy },       // techo
    ];
    for (let iter = 0; iter < 3; iter++) {
      for (const pl of planes) {
        for (const c of corners(b)) {
          if (pl.pen(b.x + c.rx, b.y + c.ry) > 0) resolveContact(b, c.rx, c.ry, pl.nx, pl.ny);
        }
      }
    }
    // corrección de posición
    for (const pl of planes) {
      let max = 0;
      for (const c of corners(b)) max = Math.max(max, pl.pen(b.x + c.rx, b.y + c.ry));
      if (max > 0) { b.x += pl.nx * max; b.y += pl.ny * max; }
    }
  }

  // opts: { W, H, grab: { lx, ly, tx, ty } | null }
  // grab: punto de agarre en coordenadas locales de la carta (lx, ly) y destino (tx, ty) = mouse.
  function step(b, dt, opts) {
    const { W, H, grab } = opts;
    dt = Math.min(dt, 1 / 20);
    const h = dt / SUBSTEPS;
    for (let n = 0; n < SUBSTEPS; n++) {
      let ax = 0, ay = GRAVITY, torque = 0;
      if (grab) {
        const c = Math.cos(b.ang), s = Math.sin(b.ang);
        const rx = grab.lx * c - grab.ly * s, ry = grab.lx * s + grab.ly * c;
        const px = b.x + rx, py = b.y + ry;
        const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx;
        const fx = KS * (grab.tx - px) - KD * vpx;
        const fy = KS * (grab.ty - py) - KD * vpy;
        ax += fx; ay += fy;
        torque += rx * fy - ry * fx;
      }
      b.vx += ax * h; b.vy += ay * h; b.w += (torque / b.I) * h;
      b.w *= 1 - ANG_DAMP * h;
      b.vx *= 1 - LIN_DAMP * h; b.vy *= 1 - LIN_DAMP * h;
      b.x += b.vx * h; b.y += b.vy * h; b.ang += b.w * h;
      collide(b, W, H);
    }
  }

  function lowestPoint(b) {
    let m = -Infinity;
    for (const c of corners(b)) m = Math.max(m, b.y + c.ry);
    return m;
  }

  // ¿Está quieta y apoyada en el piso?
  function isAtRest(b, H) {
    return Math.hypot(b.vx, b.vy) < 12 && Math.abs(b.w) < 0.25 && lowestPoint(b) > H - 3;
  }

  // Deja la carta exactamente apoyada de plano sobre el piso y sin movimiento.
  function settle(b, H) {
    const q = Math.PI / 2;
    const snapped = Math.round(b.ang / q) * q;
    if (Math.abs(b.ang - snapped) < 0.2) b.ang = snapped;
    b.vx = 0; b.vy = 0; b.w = 0;
    b.y += H - lowestPoint(b);
  }

  return { makeBody, corners, step, isAtRest, settle, lowestPoint };
});
