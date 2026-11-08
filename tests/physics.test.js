const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/physics');

const W = 1200, H = 800, CW = 104, CH = 136;
const run = (b, secs, opts, dt = 1 / 60) => { for (let i = 0; i < secs / dt; i++) P.step(b, dt, opts); };
const lowest = b => Math.max(...P.corners(b).map(c => b.y + c.ry));

test('una carta soltada cae al borde inferior y queda quieta apoyada', () => {
  const b = P.makeBody(600, 100, CW, CH);
  run(b, 4, { W, H });
  assert.ok(Math.abs(lowest(b) - H) < 1.5, 'toca el piso: ' + lowest(b));
  assert.ok(Math.hypot(b.vx, b.vy) < 15, 'sin velocidad');
  assert.ok(Math.abs(b.w) < 0.3, 'sin giro');
  assert.ok(P.isAtRest(b, H), 'reposo detectado');
});

test('una carta que cae inclinada termina apoyada de plano (ángulo múltiplo de 90°)', () => {
  const b = P.makeBody(600, 300, CW, CH);
  b.ang = 0.7; b.w = 2;
  run(b, 6, { W, H });
  const q = Math.PI / 2;
  const off = Math.abs(b.ang - Math.round(b.ang / q) * q);
  assert.ok(off < 0.12, 'ángulo final ' + b.ang + ' (desvío ' + off + ')');
  assert.ok(Math.abs(lowest(b) - H) < 1.5);
});

test('agarrada del centro cuelga derecha; agarrada de una esquina se inclina', () => {
  const center = P.makeBody(600, 400, CW, CH);
  run(center, 2.5, { W, H, grab: { lx: 0, ly: 0, tx: 600, ty: 400 } });
  assert.ok(Math.abs(center.ang) < 0.05, 'del centro casi sin giro: ' + center.ang);

  const corner = P.makeBody(600, 400, CW, CH);
  // esquina superior derecha de la carta
  run(corner, 2.5, { W, H, grab: { lx: CW / 2, ly: -CH / 2, tx: 600 + CW / 2, ty: 400 - CH / 2 } });
  assert.ok(Math.abs(corner.ang) > 0.35, 'de la esquina se inclina: ' + corner.ang);
  // el centro queda por debajo del punto de agarre (cuelga)
  assert.ok(corner.y > 400 - CH / 2 + 30, 'cuelga debajo del punto de agarre');
});

test('la física depende de dónde se agarra: dos agarres distintos terminan con ángulos distintos', () => {
  const grabAt = (lx, ly) => {
    const b = P.makeBody(600, 400, CW, CH);
    run(b, 2.5, { W, H, grab: { lx, ly, tx: 600 + lx, ty: 400 + ly } });
    return b.ang;
  };
  const aTop = grabAt(0, -CH / 2);        // del borde superior, al medio
  const aCorner = grabAt(CW / 2, -CH / 2); // de la esquina
  const aLeft = grabAt(-CW / 2, -CH / 2);  // de la esquina opuesta
  assert.ok(Math.abs(aTop) < 0.1, 'del borde superior al medio cuelga derecha');
  assert.ok(Math.abs(aCorner) > 0.35 && Math.abs(aLeft) > 0.35);
  assert.ok(Math.sign(aCorner) !== Math.sign(aLeft), 'esquinas opuestas se inclinan para lados opuestos');
});

test('al soltar con velocidad la carta sale despedida y rebota sin salirse de la pantalla', () => {
  const b = P.makeBody(100, 600, CW, CH);
  b.vx = 2500; b.vy = -900; b.w = 8;
  for (let i = 0; i < 60 * 6; i++) {
    P.step(b, 1 / 60, { W, H });
    for (const c of P.corners(b)) {
      assert.ok(b.x + c.rx > -2 && b.x + c.rx < W + 2, 'dentro por los costados');
      assert.ok(b.y + c.ry < H + 2, 'no atraviesa el piso');
    }
  }
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.ang));
});

test('nunca produce NaN con pasos de tiempo grandes', () => {
  const b = P.makeBody(600, 100, CW, CH);
  for (let i = 0; i < 200; i++) P.step(b, 0.05, { W, H, grab: i < 100 ? { lx: 40, ly: 50, tx: 300, ty: 300 } : null });
  assert.ok([b.x, b.y, b.ang, b.vx, b.vy, b.w].every(Number.isFinite));
});

test('settle() deja la carta apoyada de plano exactamente sobre el piso', () => {
  const b = P.makeBody(600, 300, CW, CH);
  b.ang = 0.7; b.w = 2;
  run(b, 6, { W, H });
  P.settle(b, H);
  assert.ok(Math.abs(lowest(b) - H) < 0.01);
  assert.equal(b.vx, 0);
  assert.equal(b.w, 0);
});
