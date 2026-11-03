'use strict';
// Efectos de sonido sintetizados (sin archivos). Silenciables.
const Sfx = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('muted') === '1'; } catch (e) { /* sin storage */ }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, start, dur, type = 'sine', vol = 0.12) {
    if (muted) return;
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  return {
    turn() { tone(660, 0, 0.12); tone(880, 0.1, 0.16); },
    grab() { tone(300, 0, 0.06, 'triangle', 0.08); },
    good() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, 'triangle', 0.14)); },
    bad() { tone(220, 0, 0.25, 'sawtooth', 0.1); tone(160, 0.18, 0.35, 'sawtooth', 0.1); },
    msg() { tone(520, 0, 0.07, 'sine', 0.07); },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('muted', muted ? '1' : '0'); } catch (e) { /* sin storage */ }
      return muted;
    },
    isMuted: () => muted,
  };
})();
