'use strict';
// Cliente WebSocket con reconexión automática y confirmaciones (ack).
const Net = (() => {
  let ws, open = false, everOpened = false, retry = 0, seq = 0, slowTimer;
  const pending = new Map();
  const handlers = {};
  const queue = [];

  const fire = (ev, data) => (handlers[ev] || []).forEach(h => h(data));

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host);
    slowTimer = setTimeout(() => fire('slow'), 2500);
    ws.onopen = () => {
      clearTimeout(slowTimer);
      open = true;
      retry = 0;
      const first = !everOpened;
      everOpened = true;
      fire('open', { first });
      queue.splice(0).forEach(m => ws.send(m));
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.ack != null) {
        const cb = pending.get(m.ack);
        pending.delete(m.ack);
        if (cb) cb(m.data);
      } else {
        fire(m.ev, m.data);
      }
    };
    ws.onclose = () => {
      clearTimeout(slowTimer);
      open = false;
      pending.forEach(cb => cb({ error: 'DESCONECTADO' }));
      pending.clear();
      fire('close');
      setTimeout(connect, Math.min(5000, 500 * Math.pow(2, retry++)));
    };
    ws.onerror = () => {};
  }

  return {
    connect,
    on(ev, h) { (handlers[ev] = handlers[ev] || []).push(h); },
    // Con callback: se confirma (y se encola si no hay conexión). Sin callback: efímero, se descarta si no hay conexión.
    send(ev, data, cb) {
      const m = { ev, data };
      if (cb) { m.ack = ++seq; pending.set(m.ack, cb); }
      const s = JSON.stringify(m);
      if (open) ws.send(s);
      else if (cb) queue.push(s);
    },
  };
})();
