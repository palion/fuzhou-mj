// Lobby UI — create/join online rooms via shareable URL, or solo vs AI.
function Lobby({ tweaks, onStart }) {
  const urlRoom = getRoomFromHash();
  const [mode, setMode] = React.useState(urlRoom ? 'join' : 'menu');
  const [playerName, setPlayerName] = React.useState(() => localStorage.getItem('mj_name') || 'Player');
  const [seats, setSeats] = React.useState([
    { name: playerName, kind: 'human', self: true },
    { name: 'AI · 南', kind: 'ai', personality: 'balanced' },
    { name: 'AI · 西', kind: 'ai', personality: 'defensive' },
    { name: 'AI · 北', kind: 'ai', personality: 'aggressive' },
  ]);

  React.useEffect(() => { localStorage.setItem('mj_name', playerName); }, [playerName]);
  React.useEffect(() => {
    setSeats((s) => s.map((x, i) => i === 0 && x.self ? { ...x, name: playerName || 'Player' } : x));
  }, [playerName]);

  const updateSeat = (idx, patch) => setSeats((s) => s.map((x, i) => i === idx ? { ...x, ...patch } : x));

  const startSolo = () => onStart({ seats, networking: null });

  return (
    <div style={lobbyStyles.wrap}>
      <div style={lobbyStyles.card}>
        <div style={lobbyStyles.brandRow}>
          <div style={lobbyStyles.logoTile}>
            <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 30, color: '#1a5b2e', fontWeight: 700 }}>發</span>
          </div>
          <div>
            <div style={lobbyStyles.brand}>福州麻將</div>
            <div style={lobbyStyles.sub}>Fuzhou Mahjong · 十六番</div>
          </div>
        </div>

        {mode === 'menu' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <label style={lobbyStyles.label}>
              <span style={lobbyStyles.labelTxt}>Your name</span>
              <input style={lobbyStyles.input} value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
            </label>
            <div style={lobbyStyles.sectionTitle}>Play</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button style={lobbyStyles.bigBtn} onClick={() => setMode('solo')}>
                <div style={lobbyStyles.btnTitle}>Solo</div>
                <div style={lobbyStyles.btnSub}>vs 3 AI</div>
              </button>
              <button style={lobbyStyles.bigBtn} onClick={() => setMode('host')}>
                <div style={lobbyStyles.btnTitle}>Host online</div>
                <div style={lobbyStyles.btnSub}>Share a URL</div>
              </button>
              <button style={lobbyStyles.bigBtn} onClick={() => setMode('join')}>
                <div style={lobbyStyles.btnTitle}>Join online</div>
                <div style={lobbyStyles.btnSub}>Open an invite URL</div>
              </button>
              <button style={lobbyStyles.bigBtnAlt} onClick={startSolo}>
                <div style={lobbyStyles.btnTitle}>Quick play</div>
                <div style={lobbyStyles.btnSub}>Deal now, 3 AI</div>
              </button>
            </div>
            <div style={lobbyStyles.hint}>
              Online play is peer-to-peer via WebRTC. Share the invite URL with friends — empty seats stay as AI.
            </div>
          </div>
        )}

        {mode === 'solo' && (
          <SoloSetup
            seats={seats} updateSeat={updateSeat}
            onBack={() => setMode('menu')} onStart={startSolo}
          />
        )}

        {mode === 'host' && (
          <HostFlow
            playerName={playerName} setPlayerName={setPlayerName}
            seats={seats} setSeats={setSeats} updateSeat={updateSeat}
            onBack={() => setMode('menu')}
            onStart={onStart}
          />
        )}

        {mode === 'join' && (
          <JoinFlow
            initialRoom={urlRoom}
            playerName={playerName} setPlayerName={setPlayerName}
            onBack={() => { setRoomInHash(null); setMode('menu'); }}
            onStart={onStart}
          />
        )}
      </div>
    </div>
  );
}

function SoloSetup({ seats, updateSeat, onBack, onStart }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={lobbyStyles.sectionTitle}>Seats</div>
      <SeatsEditor seats={seats} updateSeat={updateSeat} canEdit={(s) => s.kind === 'ai'} />
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button style={lobbyStyles.ghostBtn} onClick={onBack}>Back</button>
        <button style={lobbyStyles.primaryBtn} onClick={onStart}>Start match</button>
      </div>
    </div>
  );
}

function SeatsEditor({ seats, updateSeat, canEdit }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {seats.map((seat, i) => (
        <div key={i} style={lobbyStyles.seatRow}>
          <div style={lobbyStyles.seatWind}>{['東','南','西','北'][i]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 14, color: '#e8ebe7' }}>{seat.name}</div>
            {seat.kind === 'ai' && canEdit(seat) && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(AI_PERSONALITIES).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => updateSeat(i, { personality: k, name: `AI · ${v.name}` })}
                    style={{ ...lobbyStyles.chip, ...(seat.personality === k ? lobbyStyles.chipActive : {}) }}
                  >{v.name}</button>
                ))}
              </div>
            )}
          </div>
          <div style={lobbyStyles.seatKind}>
            {seat.self ? 'You' : seat.kind === 'human' ? 'Friend' : 'AI'}
          </div>
        </div>
      ))}
    </div>
  );
}

function HostFlow({ playerName, setPlayerName, seats, setSeats, updateSeat, onBack, onStart }) {
  const [status, setStatus] = React.useState('idle'); // idle | opening | open | error
  const [errorMsg, setErrorMsg] = React.useState('');
  const [roomId, setRoomId] = React.useState(null);
  const [inviteUrlStr, setInviteUrlStr] = React.useState('');
  const netRef = React.useRef(null);
  const seatsRef = React.useRef(seats);
  const peerToSeat = React.useRef(new Map()); // peerId -> seatIdx
  React.useEffect(() => { seatsRef.current = seats; }, [seats]);

  const assignSeat = (peerId, name) => {
    const idx = seatsRef.current.findIndex((s) => s.kind === 'ai');
    if (idx < 0) return { idx: -1, seats: seatsRef.current };
    peerToSeat.current.set(peerId, idx);
    const next = [...seatsRef.current];
    next[idx] = { name: name || 'Friend', kind: 'human', self: false, peerId };
    seatsRef.current = next;
    setSeats(next);
    return { idx, seats: next };
  };

  const releaseSeat = (peerId) => {
    const idx = peerToSeat.current.get(peerId);
    if (idx == null) return seatsRef.current;
    peerToSeat.current.delete(peerId);
    const next = [...seatsRef.current];
    next[idx] = { name: `AI · ${['東','南','西','北'][idx]}`, kind: 'ai', personality: 'balanced' };
    seatsRef.current = next;
    setSeats(next);
    return next;
  };

  const startHost = async () => {
    setStatus('opening');
    setErrorMsg('');
    let rid;
    for (let attempt = 0; attempt < 5; attempt++) {
      rid = makeRoomId();
      try {
        const net = await hostRoom({
          roomId: rid,
          onConnect: () => { /* wait for hello before assigning seat */ },
          onMessage: (peerId, msg) => {
            if (msg && msg.type === 'hello') {
              const { idx, seats: next } = assignSeat(peerId, msg.name);
              if (idx < 0) return;
              netRef.current && netRef.current.sendTo(peerId, { type: 'welcome', mySeatIdx: idx, seats: next });
              netRef.current && netRef.current.broadcast({ type: 'lobbyState', seats: next });
            }
          },
          onDisconnect: (peerId) => {
            const next = releaseSeat(peerId);
            netRef.current && netRef.current.broadcast({ type: 'lobbyState', seats: next });
          },
          onError: (e) => console.warn('[net]', e),
        });
        netRef.current = net;
        setRoomId(rid);
        setInviteUrlStr(inviteUrl(rid));
        setRoomInHash(rid);
        setStatus('open');
        return;
      } catch (e) {
        if (String(e.message || e).includes('already taken') && attempt < 4) continue;
        setStatus('error');
        setErrorMsg(e.message || String(e));
        return;
      }
    }
  };

  const startMatch = () => {
    const net = netRef.current;
    const s = seatsRef.current;
    const seed = Date.now();
    const initialState = newGame({ seed, dealer: 0 });
    if (net) {
      for (const [peerId, seatIdx] of peerToSeat.current.entries()) {
        net.sendTo(peerId, { type: 'start', mySeatIdx: seatIdx, seats: s, seed, initialState });
      }
    }
    onStart({ seats: s, networking: net ? { ...net, mySeatIdx: 0, seed, initialState } : null });
  };

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(inviteUrlStr); } catch {}
  };

  const friendCount = seats.filter((x) => x.kind === 'human' && !x.self).length;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={lobbyStyles.sectionTitle}>Host online</div>
      <label style={lobbyStyles.label}>
        <span style={lobbyStyles.labelTxt}>Your name</span>
        <input style={lobbyStyles.input} value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
      </label>
      {status === 'idle' && (
        <button style={lobbyStyles.primaryBtn} onClick={startHost}>Open a room</button>
      )}
      {status === 'opening' && <div style={lobbyStyles.netStatus}>Opening room… contacting signalling broker.</div>}
      {status === 'error' && (
        <>
          <div style={{ ...lobbyStyles.netStatus, color: '#e07b6b', borderColor: '#5a2020', background: '#1a0808' }}>
            {errorMsg}
          </div>
          <button style={lobbyStyles.ghostBtn} onClick={startHost}>Retry</button>
        </>
      )}
      {status === 'open' && (
        <>
          <label style={lobbyStyles.label}>
            <span style={lobbyStyles.labelTxt}>Invite URL — send this to friends</span>
            <textarea
              style={{ ...lobbyStyles.input, minHeight: 64, fontFamily: 'monospace', fontSize: 12 }}
              readOnly value={inviteUrlStr} onFocus={(e) => e.target.select()}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={lobbyStyles.ghostBtn} onClick={copyUrl}>Copy URL</button>
            <span style={lobbyStyles.netStatus}>Room <code style={{ color: '#e0c97e' }}>{roomId}</code> · {friendCount} friend(s) joined</span>
          </div>
          <div style={lobbyStyles.sectionTitle}>Seats</div>
          <SeatsEditor seats={seats} updateSeat={updateSeat} canEdit={(s) => s.kind === 'ai'} />
          <div style={lobbyStyles.hint}>
            Empty seats stay as AI. You can start the match at any time — friends who join after start won't see this game.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button style={lobbyStyles.ghostBtn} onClick={onBack}>Cancel</button>
            <button style={lobbyStyles.primaryBtn} onClick={startMatch}>Start match</button>
          </div>
        </>
      )}
    </div>
  );
}

function JoinFlow({ initialRoom, playerName, setPlayerName, onBack, onStart }) {
  const [roomInput, setRoomInput] = React.useState(initialRoom || '');
  const [status, setStatus] = React.useState(initialRoom ? 'connecting' : 'idle');
  const [errorMsg, setErrorMsg] = React.useState('');
  const [mySeatIdx, setMySeatIdx] = React.useState(null);
  const [lobbySeats, setLobbySeats] = React.useState(null);
  const netRef = React.useRef(null);
  const startedRef = React.useRef(false);

  const tryConnect = async (rid) => {
    setStatus('connecting');
    setErrorMsg('');
    try {
      const net = await joinRoom({
        roomId: rid,
        onMessage: (msg) => {
          if (!msg || !msg.type) return;
          if (msg.type === 'welcome') {
            setMySeatIdx(msg.mySeatIdx);
            setLobbySeats(msg.seats);
            setStatus('waiting');
          } else if (msg.type === 'lobbyState') {
            setLobbySeats(msg.seats);
          } else if (msg.type === 'start') {
            if (startedRef.current) return;
            startedRef.current = true;
            onStart({
              seats: msg.seats,
              networking: {
                ...netRef.current,
                mySeatIdx: msg.mySeatIdx,
                seed: msg.seed,
                initialState: msg.initialState,
              },
            });
          }
        },
        onClose: () => { if (!startedRef.current) { setStatus('error'); setErrorMsg('Lost connection to host.'); } },
        onError: (e) => console.warn('[net]', e),
      });
      netRef.current = net;
      net.send({ type: 'hello', name: playerName });
    } catch (e) {
      setStatus('error');
      setErrorMsg(e.message || String(e));
    }
  };

  React.useEffect(() => {
    if (initialRoom && status === 'connecting') tryConnect(initialRoom);
    return () => { if (netRef.current && !startedRef.current) { try { netRef.current.close(); } catch {} } };
  }, []);

  const parseRoomFromInput = (v) => {
    const m = v.match(/room=([a-zA-Z0-9-]+)/);
    return (m ? m[1] : v).trim();
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={lobbyStyles.sectionTitle}>Join online</div>
      <label style={lobbyStyles.label}>
        <span style={lobbyStyles.labelTxt}>Your name</span>
        <input style={lobbyStyles.input} value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
      </label>
      {status === 'idle' && (
        <>
          <label style={lobbyStyles.label}>
            <span style={lobbyStyles.labelTxt}>Invite URL or room code</span>
            <input style={lobbyStyles.input} value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="fzmj-xxxxxx" />
          </label>
          <button style={lobbyStyles.primaryBtn} onClick={() => tryConnect(parseRoomFromInput(roomInput))}>Connect</button>
        </>
      )}
      {status === 'connecting' && <div style={lobbyStyles.netStatus}>Connecting to host…</div>}
      {status === 'waiting' && (
        <>
          <div style={lobbyStyles.netStatus}>
            Connected. You're seated at <strong style={{ color: '#e0c97e' }}>{['東','南','西','北'][mySeatIdx]}</strong>. Waiting for the host to start…
          </div>
          {lobbySeats && (
            <div style={{ display: 'grid', gap: 8 }}>
              {lobbySeats.map((s, i) => (
                <div key={i} style={lobbyStyles.seatRow}>
                  <div style={lobbyStyles.seatWind}>{['東','南','西','北'][i]}</div>
                  <div style={{ flex: 1, fontFamily: 'Inter', fontSize: 14, color: '#e8ebe7' }}>
                    {s.name} {i === mySeatIdx && <span style={{ color: '#e0c97e' }}>· you</span>}
                  </div>
                  <div style={lobbyStyles.seatKind}>{s.kind === 'ai' ? 'AI' : s.self ? 'Host' : 'Friend'}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ ...lobbyStyles.netStatus, color: '#e07b6b', borderColor: '#5a2020', background: '#1a0808' }}>
            {errorMsg}
          </div>
          <button style={lobbyStyles.ghostBtn} onClick={() => setStatus('idle')}>Try again</button>
        </>
      )}
      <button style={lobbyStyles.ghostBtn} onClick={onBack}>Back</button>
    </div>
  );
}

const lobbyStyles = {
  wrap: {
    position: 'fixed', inset: 0,
    background: 'radial-gradient(ellipse at 30% 20%, #1a3025 0%, #0a130e 60%, #05080a 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, overflow: 'auto', zIndex: 10,
  },
  card: {
    width: 'min(560px, 100%)',
    background: 'linear-gradient(180deg, #151c18 0%, #0e1512 100%)',
    border: '1px solid #23302a',
    borderRadius: 20,
    padding: 32,
    boxShadow: '0 30px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.04)',
    color: '#e8ebe7',
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 },
  logoTile: {
    width: 56, height: 72, borderRadius: 8,
    background: 'linear-gradient(180deg, #faf5e8 0%, #eadfc7 100%)',
    boxShadow: '0 3px 0 #a89671, 0 6px 14px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontFamily: "'Noto Serif SC', serif", fontSize: 28, fontWeight: 700, lineHeight: 1, color: '#f0ead6' },
  sub: { fontFamily: 'Inter, system-ui', fontSize: 13, color: '#8aa699', marginTop: 4, letterSpacing: 0.6 },
  sectionTitle: { fontFamily: 'Inter', fontSize: 11, fontWeight: 600, letterSpacing: 2, color: '#6a8578', textTransform: 'uppercase' },
  label: { display: 'grid', gap: 6 },
  labelTxt: { fontFamily: 'Inter', fontSize: 12, color: '#9ab5a8' },
  input: {
    background: '#0a110d', color: '#e8ebe7',
    border: '1px solid #23302a', borderRadius: 8,
    padding: '10px 12px', fontFamily: 'Inter', fontSize: 14,
    outline: 'none', resize: 'vertical',
  },
  bigBtn: {
    background: '#141d18', border: '1px solid #23302a', borderRadius: 12,
    padding: '16px 14px', cursor: 'pointer', textAlign: 'left',
    color: '#e8ebe7', transition: 'all .15s',
  },
  bigBtnAlt: {
    background: 'linear-gradient(180deg, #1e5a3d 0%, #0f3e27 100%)',
    border: '1px solid #2a7a50', borderRadius: 12,
    padding: '16px 14px', cursor: 'pointer', textAlign: 'left',
    color: '#f0ead6', transition: 'all .15s',
  },
  btnTitle: { fontFamily: 'Inter', fontSize: 15, fontWeight: 600 },
  btnSub: { fontFamily: 'Inter', fontSize: 12, color: '#8aa699', marginTop: 4 },
  hint: {
    fontFamily: 'Inter', fontSize: 12, color: '#7a9488', lineHeight: 1.6,
    background: '#0a110d', border: '1px solid #1f2b25', borderRadius: 8, padding: 12,
  },
  seatRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#0d1612', border: '1px solid #1f2b25', borderRadius: 10,
    padding: '10px 12px',
  },
  seatWind: {
    fontFamily: "'Noto Serif SC', serif", fontSize: 22, color: '#e0c97e',
    width: 36, textAlign: 'center',
  },
  seatKind: { fontFamily: 'Inter', fontSize: 11, color: '#8aa699', textTransform: 'uppercase', letterSpacing: 1 },
  chip: {
    background: '#0a110d', border: '1px solid #263028', color: '#c3d3ca',
    borderRadius: 20, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
    fontFamily: 'Inter',
  },
  chipActive: {
    background: 'linear-gradient(180deg, #2a7a50 0%, #1e5a3d 100%)',
    border: '1px solid #3aa068', color: '#fff',
  },
  primaryBtn: {
    background: 'linear-gradient(180deg, #2a7a50 0%, #1e5a3d 100%)',
    border: '1px solid #3aa068', color: '#fff',
    borderRadius: 10, padding: '12px 18px', cursor: 'pointer',
    fontFamily: 'Inter', fontSize: 14, fontWeight: 600,
  },
  ghostBtn: {
    background: 'transparent', border: '1px solid #2a3a30', color: '#c3d3ca',
    borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
    fontFamily: 'Inter', fontSize: 13,
  },
  netStatus: {
    fontFamily: 'Inter', fontSize: 12, color: '#e0c97e',
    padding: '8px 12px', background: '#1a1508', border: '1px solid #3a2f15', borderRadius: 6,
  },
};

Object.assign(window, { Lobby });
