import { useEffect, useRef } from 'react';

// ---- Live updates (see server/events.js) ----
// One connection per tab while signed in. The server says what kind of thing changed ({ type, id }); pages that
// show that kind of thing load it again with useLive. After the connection drops and comes back (sleep, offline,
// a server restart), everything is reloaded once ({ type: '*' }), since changes may have been missed meanwhile.

let source = null;
const listeners = new Set();
const emit = (event) => listeners.forEach((fn) => fn(event));

export function startLive() {
  if (source || typeof EventSource === 'undefined') return;
  let opened = false;
  source = new EventSource('/api/events');
  source.addEventListener('open', () => {
    if (opened) emit({ type: '*', id: null });
    opened = true;
  });
  source.addEventListener('change', (e) => {
    try {
      emit(JSON.parse(e.data));
    } catch {}
  });
}

export function stopLive() {
  source?.close();
  source = null;
}

// Calls reload(event) when something of one of `types` changes (e.g. ['letter', 'file']). Changes arriving close
// together, like a letter saved and then sent, cause one reload. `filter(event)` can skip events, e.g. other letters.
export function useLive(types, reload, { filter, delay = 300 } = {}) {
  // The latest reload and filter, so callers can pass inline functions without reconnecting.
  const latest = useRef({ reload, filter });
  latest.current = { reload, filter };
  const key = types.join(',');

  useEffect(() => {
    let timer = null;
    let last = null;
    const onEvent = (event) => {
      if (event.type !== '*' && !types.includes(event.type)) return;
      if (event.type !== '*' && latest.current.filter && !latest.current.filter(event)) return;
      last = event;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current.reload(last), delay);
    };
    listeners.add(onEvent);
    return () => {
      listeners.delete(onEvent);
      clearTimeout(timer);
    };
  }, [key, delay]);
}
