// URL-invite P2P networking via PeerJS.
// Uses the free public PeerJS broker for signalling; the data channel is pure WebRTC P2P.
// No backend to run — share the URL, friends click, they're in.

function makeRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `fzmj-${s}`;
}

// Persistent per-browser ID so a disconnect can be rebound to the same seat.
function getClientId() {
  try {
    let id = localStorage.getItem('mj_client_id');
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('mj_client_id', id);
    }
    return id;
  } catch {
    return 'c_' + Math.random().toString(36).slice(2, 10);
  }
}

function getRoomFromHash() {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/room=([a-zA-Z0-9-]+)/);
  return m ? m[1] : null;
}

function setRoomInHash(roomId) {
  if (roomId) history.replaceState(null, '', `${window.location.pathname}#room=${roomId}`);
  else history.replaceState(null, '', window.location.pathname);
}

function inviteUrl(roomId) {
  const base = window.location.origin + window.location.pathname;
  return `${base}#room=${roomId}`;
}

function peerOpts() {
  return { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } };
}

// Host: accepts multiple connections on the room ID. Returns an object with broadcast/sendTo/close.
// handlers object is mutable — the game layer swaps handlers.onMessage when moving from lobby to play.
async function hostRoom({ roomId, onConnect, onMessage, onDisconnect, onError }) {
  if (!window.Peer) throw new Error('PeerJS failed to load (CDN blocked?)');
  const peer = new window.Peer(roomId, peerOpts());
  const connections = new Map();
  const handlers = { onConnect, onMessage, onDisconnect, onError };
  await new Promise((resolve, reject) => {
    const errHandler = (e) => {
      if (e && (e.type === 'unavailable-id' || String(e).includes('unavailable'))) {
        reject(new Error('Room ID is already taken. Try again.'));
      } else reject(e);
    };
    peer.once('open', () => { peer.off('error', errHandler); resolve(); });
    peer.once('error', errHandler);
    setTimeout(() => reject(new Error('Peer open timeout — signalling broker unreachable.')), 10000);
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      connections.set(conn.peer, conn);
      handlers.onConnect && handlers.onConnect(conn.peer, conn);
    });
    conn.on('data', (data) => handlers.onMessage && handlers.onMessage(conn.peer, data));
    conn.on('close', () => {
      connections.delete(conn.peer);
      handlers.onDisconnect && handlers.onDisconnect(conn.peer);
    });
    conn.on('error', (e) => handlers.onError && handlers.onError(e));
  });
  peer.on('error', (e) => handlers.onError && handlers.onError(e));

  return {
    role: 'host',
    peer,
    peerId: peer.id,
    roomId,
    connections,
    handlers,
    broadcast(msg) {
      for (const c of connections.values()) { try { c.send(msg); } catch {} }
    },
    sendTo(peerId, msg) {
      const c = connections.get(peerId);
      if (c) { try { c.send(msg); } catch {} }
    },
    close() { try { peer.destroy(); } catch {} },
  };
}

// Joiner: connects to a host by room ID.
// Supports silent reconnect: if the data channel drops, we try to reopen it on the same peer and
// fire `onReconnect` so the app can re-send its hello and pick up where it left off.
async function joinRoom({ roomId, onMessage, onClose, onError, onReconnect }) {
  if (!window.Peer) throw new Error('PeerJS failed to load (CDN blocked?)');
  const peer = new window.Peer(peerOpts());
  const handlers = { onMessage, onClose, onError, onReconnect };
  const state = { conn: null, closed: false, reconnecting: false };

  await new Promise((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', (e) => reject(e));
    setTimeout(() => reject(new Error('Peer open timeout — signalling broker unreachable.')), 10000);
  });

  const wireConn = (conn) => {
    state.conn = conn;
    conn.on('data', (data) => handlers.onMessage && handlers.onMessage(data));
    conn.on('close', () => {
      if (state.closed) return;
      handlers.onClose && handlers.onClose();
      tryReconnect();
    });
    conn.on('error', (e) => handlers.onError && handlers.onError(e));
  };

  const openConn = () => new Promise((resolve, reject) => {
    let settled = false;
    const c = peer.connect(roomId, { reliable: true });
    c.once('open', () => { if (!settled) { settled = true; resolve(c); } });
    c.once('error', (e) => { if (!settled) { settled = true; reject(e); } });
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('Could not reach host — check the room code.')); } }, 15000);
  });

  const tryReconnect = async () => {
    if (state.closed || state.reconnecting) return;
    state.reconnecting = true;
    for (let attempt = 0; attempt < 10 && !state.closed; attempt++) {
      const wait = Math.min(800 * (attempt + 1), 5000);
      await new Promise((r) => setTimeout(r, wait));
      try {
        const c = await openConn();
        wireConn(c);
        state.reconnecting = false;
        handlers.onReconnect && handlers.onReconnect();
        return;
      } catch {}
    }
    state.reconnecting = false;
  };

  const initial = await openConn();
  wireConn(initial);
  peer.on('error', (e) => handlers.onError && handlers.onError(e));

  return {
    role: 'client',
    peer,
    get conn() { return state.conn; },
    peerId: peer.id,
    roomId,
    handlers,
    send(msg) { try { if (state.conn) state.conn.send(msg); } catch {} },
    close() { state.closed = true; try { peer.destroy(); } catch {} },
  };
}

Object.assign(window, {
  makeRoomId, getRoomFromHash, setRoomInHash, inviteUrl,
  hostRoom, joinRoom, getClientId,
});
