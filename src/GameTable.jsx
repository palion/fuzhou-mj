// Main table UI — dark charcoal + jade, slight 3D tilt on desktop.
// Supports solo (local AI), host (authoritative local engine + broadcast), and client (renders host state + sends actions).
// Responsive: phone (<640) uses a compact vertical layout; tablet (<960) a mid-density layout; desktop the full 3D felt.

function useResponsive() {
  const [size, setSize] = React.useState(() => ({
    w: typeof window === 'undefined' ? 1200 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));
  React.useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const isPhone = size.w < 640;
  const isTablet = size.w >= 640 && size.w < 960;
  const isLandscape = size.w > size.h;
  return { w: size.w, h: size.h, isPhone, isTablet, isDesktop: !isPhone && !isTablet, isLandscape };
}

function parseGoldenKey(key) {
  if (!key) return null;
  const suit = key[0];
  const rest = key.slice(1);
  if (suit === 'm' || suit === 'p' || suit === 's') return { suit, n: parseInt(rest), id: `golden_${key}` };
  if (suit === 'w') return { suit: 'w', n: rest, id: `golden_${key}` };
  if (suit === 'd') return { suit: 'd', n: rest, id: `golden_${key}` };
  return null;
}

function priorityOf(c) { return { hu: 4, kong: 3, pong: 3, chi: 1 }[c.type] || 0; }

function GameTable({ seats: initialSeats, networking, tweaks, onExit, scoringCfg }) {
  const role = networking?.role || 'solo';
  const isClient = role === 'client';
  const myIdx = networking?.mySeatIdx ?? 0;
  const rs = useResponsive();

  // Seats are local state so disconnect/reconnect can update the visible roster without a re-mount.
  const [seats, setSeats] = React.useState(initialSeats);

  const [state, setState] = React.useState(() => {
    if (networking?.initialState) return networking.initialState;
    return newGame({ seed: networking?.seed || Date.now(), dealer: 0 });
  });
  const [round, setRound] = React.useState(1);
  const [hand, setHand] = React.useState(1);
  const [scores, setScores] = React.useState([0, 0, 0, 0]);
  const [showScore, setShowScore] = React.useState(null);
  const [pendingClaims, setPendingClaims] = React.useState(null);
  const [selectedTileId, setSelectedTileId] = React.useState(null);
  const [huBtnReady, setHuBtnReady] = React.useState(false);
  const [log, setLog] = React.useState([]);

  const claimCollectorRef = React.useRef(null);
  const peerToSeatRef = React.useRef(new Map());
  const stateRef = React.useRef(state);
  const seatsRef = React.useRef(seats);
  const respondedForRef = React.useRef(null);

  React.useEffect(() => { stateRef.current = state; }, [state]);
  React.useEffect(() => { seatsRef.current = seats; }, [seats]);
  React.useEffect(() => {
    const m = new Map();
    seats.forEach((s, i) => { if (s.peerId) m.set(s.peerId, i); });
    peerToSeatRef.current = m;
  }, [seats]);

  const pushLog = (msg) => setLog((l) => [...l.slice(-30), msg]);
  const isMyTurn = state.turn === myIdx && state.phase === 'discard';

  // --- Networking handlers ---
  React.useEffect(() => {
    if (!networking) return;
    if (role === 'host') {
      networking.handlers.onMessage = (peerId, msg) => {
        if (!msg) return;
        // Reconnect: if a known clientId comes back, remap the peer to its seat and resync.
        if (msg.type === 'hello' && msg.clientId && networking.clientIdToSeat) {
          const idx = networking.clientIdToSeat.get(msg.clientId);
          if (idx != null) {
            peerToSeatRef.current.set(peerId, idx);
            const nextSeats = seatsRef.current.map((s, i) => i === idx ? { ...s, peerId, disconnected: false } : s);
            setSeats(nextSeats);
            networking.sendTo(peerId, { type: 'welcome', mySeatIdx: idx, seats: nextSeats, resume: true });
            networking.sendTo(peerId, { type: 'state', state: stateRef.current, round, hand, scores });
            pushLog(`${nextSeats[idx].name} 重連`);
          }
          return;
        }
        const seatIdx = peerToSeatRef.current.get(peerId);
        if (seatIdx == null) return;
        const s = stateRef.current;
        if (msg.type === 'discard' && s.turn === seatIdx && s.phase === 'discard') {
          const tile = s.hands[seatIdx].find((t) => t.id === msg.tileId);
          if (!tile) return;
          setState((st) => discardTile(st, seatIdx, msg.tileId));
          pushLog(`${seatsRef.current[seatIdx].name} 打 ${tileDesc(tile)}`);
        } else if (msg.type === 'claim' && s.phase === 'claim') {
          claimCollectorRef.current && claimCollectorRef.current.recordDecision(seatIdx, msg.claim);
        } else if (msg.type === 'pass-claim' && s.phase === 'claim') {
          claimCollectorRef.current && claimCollectorRef.current.recordDecision(seatIdx, null);
        } else if (msg.type === 'self-kong' && s.turn === seatIdx) {
          const opts = selfKongOptions(s, seatIdx);
          const pick = opts.find((o) => o.key === msg.key) || opts[0];
          if (pick) setState((st) => applySelfKong(st, seatIdx, pick));
        } else if (msg.type === 'hu' && canDeclareHu(s, seatIdx)) {
          setState((st) => declareHu(st, seatIdx));
        }
      };
      networking.handlers.onDisconnect = (peerId) => {
        const seatIdx = peerToSeatRef.current.get(peerId);
        if (seatIdx == null) return;
        peerToSeatRef.current.delete(peerId);
        const nextSeats = seatsRef.current.map((s, i) => i === seatIdx ? { ...s, disconnected: true } : s);
        setSeats(nextSeats);
        pushLog(`${nextSeats[seatIdx].name} 離線`);
      };
    } else if (role === 'client') {
      networking.handlers.onMessage = (msg) => {
        if (!msg) return;
        if (msg.type === 'state') {
          setState(msg.state);
          if (msg.round != null) setRound(msg.round);
          if (msg.hand != null) setHand(msg.hand);
          if (msg.scores) setScores(msg.scores);
        } else if (msg.type === 'welcome') {
          // Resume after reconnect — host re-sent seat assignment.
          // Seats may have shifted if others disconnected; nothing else to do here.
        } else if (msg.type === 'score') {
          setShowScore(msg.payload);
        } else if (msg.type === 'next-hand') {
          setShowScore(null);
          respondedForRef.current = null;
        } else if (msg.type === 'exit') {
          onExit();
        }
      };
      networking.handlers.onReconnect = () => {
        // Data channel reopened mid-game — re-send hello so host can rebind us to our seat.
        try { networking.send({ type: 'hello', clientId: networking.clientId, name: seats[myIdx]?.name }); } catch {}
      };
    }
    return () => {
      if (networking?.handlers) {
        networking.handlers.onMessage = null;
        networking.handlers.onDisconnect = null;
        networking.handlers.onReconnect = null;
      }
    };
  }, [networking, role]);

  // Host: broadcast state on every change
  React.useEffect(() => {
    if (role !== 'host') return;
    networking.broadcast({ type: 'state', state, round, hand, scores });
  }, [state, round, hand, scores]);

  // --- Engine driver (host/solo only) ---
  React.useEffect(() => {
    if (isClient) return;
    if (state.phase === 'end') return;

    if (state.phase === 'draw') {
      const t = setTimeout(() => {
        setState((s) => {
          const next = drawTile(s, s.turn);
          if (next.wall.length === 0 && !next.hu) {
            next.phase = 'end';
            pushLog('流局 — 荒牌');
          }
          return next;
        });
      }, tweaks.animIntensity === 'off' ? 50 : tweaks.animIntensity === 'high' ? 600 : 350);
      return () => clearTimeout(t);
    }

    if (state.phase === 'claim') {
      return driveClaim();
    }

    if (state.phase === 'discard') {
      const p = state.turn;
      const seat = seats[p];
      // Disconnected humans fall back to AI autoplay.
      if (seat.kind === 'human' && !seat.disconnected) {
        if (p === myIdx) setHuBtnReady(canDeclareHu(state, myIdx));
        else setHuBtnReady(false);
        return;
      }
      const pers = AI_PERSONALITIES[seat.personality] || AI_PERSONALITIES.balanced;
      if (canDeclareHu(state, p)) {
        const t = setTimeout(() => setState((s) => declareHu(s, p)), 500);
        return () => clearTimeout(t);
      }
      const kOpts = selfKongOptions(state, p);
      const kChoice = decideSelfKong(kOpts, state, p, pers);
      if (kChoice) {
        const t = setTimeout(() => setState((s) => applySelfKong(s, p, kChoice)), 400);
        return () => clearTimeout(t);
      }
      const tile = chooseDiscard(state, p, pers);
      const delay = tweaks.animIntensity === 'off' ? 60 : tweaks.animIntensity === 'high' ? 900 : 500;
      const t = setTimeout(() => {
        setState((s) => discardTile(s, p, tile.id));
        pushLog(`${seat.name} 打 ${tileDesc(tile)}`);
      }, delay);
      return () => clearTimeout(t);
    }
  }, [state, seats, tweaks.animIntensity, role]);

  function applyClaimSequence(claim) {
    setState((s) => {
      const next = applyClaim(s, claim);
      if (claim.type === 'hu') pushLog(`${seats[claim.player].name} 胡！`);
      return next;
    });
  }

  function driveClaim() {
    const lastDiscard = state.lastDiscard;
    if (!lastDiscard) { setState((s) => advanceTurn(s)); return; }

    const allClaims = availableClaims(state, lastDiscard.tile, lastDiscard.from);
    const decisions = new Map();
    const waitingOn = new Set();

    for (let p = 0; p < 4; p++) {
      if (p === lastDiscard.from) continue;
      const opts = allClaims.filter((c) => c.player === p);
      if (opts.length === 0) { decisions.set(p, null); continue; }
      const seat = seats[p];
      // Disconnected humans: AI decides for them.
      if (seat.kind === 'ai' || seat.disconnected) {
        const pers = AI_PERSONALITIES[seat.personality] || AI_PERSONALITIES.balanced;
        const choice = decideClaim(opts, state, pers);
        decisions.set(p, choice || null);
      } else {
        waitingOn.add(p);
      }
    }

    const mySeatClaims = allClaims.filter((c) => c.player === myIdx);
    if (mySeatClaims.length > 0) {
      setPendingClaims({ options: mySeatClaims, tile: lastDiscard.tile });
    }

    let resolved = false;
    let timer = null;
    const resolve = () => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      setPendingClaims(null);
      claimCollectorRef.current = null;
      const pending = [...decisions.values()].filter(Boolean);
      if (pending.length === 0) {
        setState((s) => advanceTurn(s));
        return;
      }
      pending.sort((a, b) => (priorityOf(b) - priorityOf(a)) ||
        ((a.player - lastDiscard.from + 4) % 4) - ((b.player - lastDiscard.from + 4) % 4));
      applyClaimSequence(pending[0]);
    };

    claimCollectorRef.current = {
      recordDecision(seatIdx, claim) {
        if (resolved) return;
        decisions.set(seatIdx, claim);
        waitingOn.delete(seatIdx);
        if (waitingOn.size === 0) resolve();
      },
    };

    if (waitingOn.size === 0) {
      const delay = tweaks.animIntensity === 'off' ? 50 : tweaks.animIntensity === 'high' ? 900 : 500;
      timer = setTimeout(resolve, delay);
    } else {
      timer = setTimeout(resolve, 8000);
    }
    return () => {
      if (!resolved) { resolved = true; if (timer) clearTimeout(timer); }
      claimCollectorRef.current = null;
    };
  }

  // Client: derive claim prompt + Hu availability from received state
  React.useEffect(() => {
    if (!isClient) return;
    if (state.phase !== 'claim' || !state.lastDiscard) { setPendingClaims(null); return; }
    if (respondedForRef.current === state.lastDiscard.tile.id) { setPendingClaims(null); return; }
    const allClaims = availableClaims(state, state.lastDiscard.tile, state.lastDiscard.from);
    const my = allClaims.filter((c) => c.player === myIdx);
    if (my.length > 0) setPendingClaims({ options: my, tile: state.lastDiscard.tile });
    else setPendingClaims(null);
  }, [state.phase, state.lastDiscard, isClient]);

  React.useEffect(() => {
    if (!isClient) return;
    setHuBtnReady(state.phase === 'discard' && state.turn === myIdx && canDeclareHu(state, myIdx));
  }, [state, isClient]);

  // End-of-hand scoring. Host/solo drives score deltas; clients only render locally computed modal.
  React.useEffect(() => {
    if (state.phase !== 'end' || showScore) return;
    const result = state.hu ? scoreHand(state, scoringCfg) : null;
    setShowScore({ state, result });
    if (!isClient && result) {
      const pay = paymentDeltas(result, state);
      setScores((sc) => sc.map((v, i) => v + pay.deltas[i]));
    }
  }, [state.phase, isClient]);

  // Host: broadcast score modal
  React.useEffect(() => {
    if (role !== 'host' || !showScore) return;
    networking.broadcast({ type: 'score', payload: showScore });
  }, [showScore, role]);

  // --- Player actions ---
  const doDiscard = (tileId) => {
    if (state.turn !== myIdx || state.phase !== 'discard') return;
    if (isClient) {
      networking.send({ type: 'discard', tileId });
      setSelectedTileId(null);
      return;
    }
    const tile = state.hands[myIdx].find((t) => t.id === tileId);
    setState((s) => discardTile(s, myIdx, tileId));
    if (tile) pushLog(`${seats[myIdx].name} 打 ${tileDesc(tile)}`);
    setSelectedTileId(null);
  };

  const doSelfKong = () => {
    const opts = selfKongOptions(state, myIdx);
    if (!opts[0]) return;
    if (isClient) { networking.send({ type: 'self-kong', key: opts[0].key }); return; }
    setState((s) => applySelfKong(s, myIdx, opts[0]));
  };

  const doHu = () => {
    if (!canDeclareHu(state, myIdx)) return;
    if (isClient) { networking.send({ type: 'hu' }); return; }
    setState((s) => declareHu(s, myIdx));
  };

  const takeMyClaim = (c) => {
    setPendingClaims(null);
    if (isClient) {
      respondedForRef.current = state.lastDiscard ? state.lastDiscard.tile.id : null;
      networking.send({ type: 'claim', claim: c });
      return;
    }
    claimCollectorRef.current && claimCollectorRef.current.recordDecision(myIdx, c);
  };

  const passClaim = () => {
    setPendingClaims(null);
    if (isClient) {
      respondedForRef.current = state.lastDiscard ? state.lastDiscard.tile.id : null;
      networking.send({ type: 'pass-claim' });
      return;
    }
    claimCollectorRef.current && claimCollectorRef.current.recordDecision(myIdx, null);
  };

  const startNextHand = () => {
    if (isClient) return;
    setShowScore(null);
    respondedForRef.current = null;
    let newDealer = state.dealer;
    let newRound = round, newHand = hand;
    const dealerWon = state.hu && state.hu.winner === state.dealer;
    const newStreak = dealerWon ? (state.dealerStreak || 0) + 1 : 0;
    if (!dealerWon) {
      newDealer = (state.dealer + 1) % 4;
      newHand++;
      if (newHand > 4) { newHand = 1; newRound++; }
    }
    if (newRound > 4) { setShowScore({ matchOver: true, scores }); return; }
    setRound(newRound);
    setHand(newHand);
    const roundWinds = ['E', 'S', 'W', 'N'];
    const seatWinds = [];
    for (let i = 0; i < 4; i++) seatWinds[(newDealer + i) % 4] = roundWinds[i];
    const fresh = newGame({ seed: Date.now(), dealer: newDealer, roundWind: roundWinds[newRound - 1], seatWinds, dealerStreak: newStreak });
    setState(fresh);
    if (role === 'host') networking.broadcast({ type: 'next-hand' });
  };

  const positionOfSeat = (seatIdx) => {
    const rel = (seatIdx - myIdx + 4) % 4;
    return ['bot', 'right', 'top', 'left'][rel];
  };

  return (
    <div style={tableStyles.root(tweaks, rs)}>
      <TableChrome
        round={round} hand={hand} roundWind={state.roundWind}
        goldenKey={state.goldenKey}
        scores={scores} seats={seats} turn={state.turn}
        onExit={onExit}
        networking={networking}
        rs={rs}
      />
      <div style={tableStyles.tableWrap(rs)}>
        <div style={tableStyles.felt(tweaks, rs)}>
          <WallDisplay remaining={state.wall.length} rs={rs} />
          {[0, 1, 2, 3].filter((i) => i !== myIdx).map((i) => (
            <OpponentSeat key={i} seat={seats[i]} idx={i}
              position={positionOfSeat(i)} state={state} tweaks={tweaks} rs={rs} />
          ))}
          <CenterPond state={state} tweaks={tweaks} myIdx={myIdx} rs={rs} />
          <MySeat
            seat={seats[myIdx]} state={state} tweaks={tweaks} myIdx={myIdx}
            isMyTurn={isMyTurn}
            canHu={huBtnReady}
            canSelfKong={selfKongOptions(state, myIdx).length > 0 && state.turn === myIdx}
            selectedTileId={selectedTileId}
            setSelectedTileId={setSelectedTileId}
            onDiscard={doDiscard}
            onSelfKong={doSelfKong}
            onHu={doHu}
            rs={rs}
          />
        </div>
      </div>

      {pendingClaims && (
        <ClaimPrompt options={pendingClaims.options} tile={pendingClaims.tile}
          onChoose={takeMyClaim} onPass={passClaim} rs={rs} />
      )}

      {!rs.isPhone && <EventLog log={log} rs={rs} />}

      {showScore && (
        showScore.matchOver
          ? <MatchOver scores={showScore.scores} seats={seats} onExit={onExit} rs={rs} />
          : <ScoreModal payload={showScore} seats={seats} onNext={startNextHand} hideNext={isClient} rs={rs} />
      )}
    </div>
  );
}

function TableChrome({ round, hand, roundWind, goldenKey, scores, seats, turn, onExit, networking, rs }) {
  const windCh = { E: '東', S: '南', W: '西', N: '北' }[roundWind];
  const goldenTile = goldenKey ? parseGoldenKey(goldenKey) : null;
  const friends = networking?.role === 'host' ? (networking.connections ? networking.connections.size : 0) : null;
  const scoreGap = rs.isPhone ? 4 : 10;
  const badgeMinW = rs.isPhone ? 52 : 90;
  return (
    <div style={tableStyles.chrome(rs)}>
      <div style={tableStyles.chromeLeft(rs)}>
        <button style={tableStyles.exitBtn(rs)} onClick={onExit}>{rs.isPhone ? '←' : '← Exit'}</button>
        <div style={tableStyles.matchBadge(rs)}>
          <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 15 : 20, color: '#e0c97e' }}>{windCh}場</div>
          <div style={{ fontFamily: 'Inter', fontSize: rs.isPhone ? 9 : 10, color: '#8aa699', letterSpacing: 2 }}>R{round}·{hand}</div>
        </div>
        {goldenTile && (
          <div style={tableStyles.goldenBadge(rs)} title={`Golden (wild): ${tileDesc(goldenTile)}`}>
            {!rs.isPhone && (
              <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#c9a14a', letterSpacing: 2 }}>金 GOLDEN</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: rs.isPhone ? 0 : 4 }}>
              <div style={{ position: 'relative' }}>
                <Tile tile={goldenTile} size="xs" />
                <GoldenBadge size={14} />
              </div>
              {!rs.isPhone && (
                <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 13, color: '#e0c97e' }}>{tileDesc(goldenTile)}</span>
              )}
            </div>
          </div>
        )}
        {networking && !rs.isPhone && (
          <div style={tableStyles.netPill}>
            <span style={{ color: '#8aa699' }}>{networking.role === 'host' ? 'HOST' : 'CLIENT'}</span>
            {friends != null && <span> · {friends} linked</span>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: scoreGap, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {scores.map((v, i) => (
          <div key={i} style={{ ...tableStyles.scoreBadge(rs), minWidth: badgeMinW, ...(turn === i ? tableStyles.scoreActive : {}) }}>
            <div style={{ fontFamily: 'Inter', fontSize: rs.isPhone ? 9 : 10, color: '#8aa699', letterSpacing: 1 }}>
              {['東','南','西','北'][i]} {!rs.isPhone && `· ${(seats[i].name || '').slice(0, 10)}`}
              {seats[i].disconnected && <span style={{ color: '#e07b6b' }}> ✕</span>}
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: rs.isPhone ? 14 : 18, fontWeight: 700, color: v >= 0 ? '#e8ebe7' : '#e07b6b' }}>{v >= 0 ? '+' : ''}{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpponentSeat({ seat, idx, position, state, tweaks, rs }) {
  const hand = state.hands[idx];
  const melds = state.melds[idx];
  const oppFlowers = state.flowers ? state.flowers[idx] : [];
  const isTurn = state.turn === idx;

  if (rs.isPhone) {
    return (
      <div style={tableStyles.opponentPill(position, isTurn)}>
        <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 14, color: '#e0c97e' }}>{['東','南','西','北'][idx]}</span>
        <span style={{ fontFamily: 'Inter', fontSize: 11, color: isTurn ? '#fff' : '#8aa699', fontWeight: isTurn ? 600 : 400, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seat.name}</span>
        {seat.disconnected && <span style={{ fontSize: 10, color: '#e07b6b' }}>✕</span>}
        {isTurn && <span style={tableStyles.turnDot} />}
        <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#8aa699' }}>🀫×{hand.length}</span>
        {melds.length > 0 && (
          <div style={{ display: 'flex', gap: 2 }}>
            {melds.map((m, mi) => <MeldGroup key={mi} meld={m} size="xs" rotate={0} />)}
          </div>
        )}
        {oppFlowers.length > 0 && <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 10, color: '#b0302b' }}>花·{oppFlowers.length}</span>}
      </div>
    );
  }

  const size = rs.isTablet ? 'xs' : (tweaks.density === 'compact' ? 'xs' : 'sm');
  const rotate = position === 'top' ? 180 : position === 'right' ? -90 : 90;
  const handStyle = {
    display: 'flex',
    flexDirection: position === 'left' || position === 'right' ? 'column' : 'row',
    gap: 2, justifyContent: 'center', alignItems: 'center',
  };
  // Render a stable number of face-down tiles keyed by slot index. Since face-down tiles are
  // visually identical, this prevents DOM churn (and the flicker) when a mid-hand tile is discarded.
  const slots = Array.from({ length: hand.length });
  return (
    <div style={tableStyles.opponentBlock(position, rs)}>
      <div style={tableStyles.opponentLabel(position, isTurn)}>
        <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 18, color: '#e0c97e' }}>
          {['東','南','西','北'][idx]}
        </span>
        <span style={{ fontFamily: 'Inter', fontSize: 12, color: isTurn ? '#fff' : '#8aa699', fontWeight: isTurn ? 600 : 400 }}>
          {seat.name}
        </span>
        {seat.disconnected && <span style={{ fontSize: 10, color: '#e07b6b' }}>✕ offline</span>}
        {isTurn && <span style={tableStyles.turnDot} />}
        {oppFlowers.length > 0 && <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 11, color: '#b0302b' }}>花·{oppFlowers.length}</span>}
      </div>
      <div style={handStyle}>
        {slots.map((_, i) => (
          <Tile key={i} size={size} face="down" rotate={rotate} />
        ))}
      </div>
      {melds.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: position === 'left' || position === 'right' ? 'column' : 'row',
          gap: 4, marginTop: 6, flexWrap: 'wrap',
        }}>
          {melds.map((m, mi) => <MeldGroup key={mi} meld={m} size={size} rotate={rotate} />)}
        </div>
      )}
    </div>
  );
}

function MeldGroup({ meld, size, rotate }) {
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {meld.tiles.map((t, i) => (
        <Tile key={t.id || i} tile={t} size={size}
          face={meld.type === 'kong' && meld.concealed && (i === 0 || i === 3) ? 'down' : 'up'}
          rotate={rotate} />
      ))}
    </div>
  );
}

function CenterPond({ state, tweaks, myIdx, rs }) {
  const areaFor = (p) => ['bot', 'right', 'top', 'left'][(p - myIdx + 4) % 4];
  const rotFor = (p) => {
    const rel = (p - myIdx + 4) % 4;
    return ['', 'rotate(-90deg)', 'rotate(180deg)', 'rotate(90deg)'][rel];
  };
  const maxW = rs.isPhone ? 120 : rs.isTablet ? 180 : 240;
  return (
    <div style={tableStyles.pond(rs)}>
      {[0, 1, 2, 3].map((p) => (
        <div key={p} style={{
          gridArea: areaFor(p),
          display: 'flex', justifyContent: 'center', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, maxWidth: maxW, justifyContent: 'center', transform: rotFor(p) }}>
            {state.discards[p].map((t) => (
              <Tile key={t.id} tile={t} size="xs"
                glow={state.lastDiscard && state.lastDiscard.tile.id === t.id ? 'rgba(224,201,126,.9)' : null}
                selected={state.lastDiscard && state.lastDiscard.tile.id === t.id} />
            ))}
          </div>
        </div>
      ))}
      <div style={tableStyles.centerDisc(rs)}>
        <div style={{ fontFamily: 'Inter', fontSize: rs.isPhone ? 9 : 10, color: '#c1a96d', opacity: 0.7, letterSpacing: 2 }}>WALL</div>
        <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 20 : rs.isTablet ? 22 : 28, color: '#e0c97e', fontWeight: 600 }}>{state.wall.length}</div>
      </div>
    </div>
  );
}

// Face-down tile wall hugging the four edges of the felt. Each visual tile stands in for 2 real tiles
// (the traditional 2-high mahjong stack), so all ~72 starting wall tiles fit without overlapping the
// opponent/pond/my-seat zones.
function WallDisplay({ remaining, rs }) {
  if (rs.isPhone || remaining <= 0) return null;
  const stacks = Math.ceil(remaining / 2);
  const per = Math.floor(stacks / 4);
  const rem = stacks % 4;
  // Distribute: 0=top, 1=right, 2=bottom, 3=left. Drain from top first as the wall depletes.
  const counts = [0, 1, 2, 3].map((i) => per + (i < rem ? 1 : 0));
  // Tiles stack flush in both directions — no rotation on the vertical strips, because
  // CSS rotate leaves the layout box at 28×38 and opens a 10px gap between each rotated tile.
  // Portrait xs tiles stacked vertically still read as a wall of tiles along the edge.
  const StackRow = ({ n, vertical }) => (
    <div style={{
      display: 'flex',
      flexDirection: vertical ? 'column' : 'row',
      gap: 1,
      justifyContent: 'center', alignItems: 'center',
      pointerEvents: 'none',
    }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ position: 'relative' }}>
          {/* Stack-of-2 look: a slightly offset shadow tile under the front tile */}
          <div style={{ position: 'absolute', top: 2, left: 2, opacity: 0.55 }}>
            <Tile size="xs" face="down" />
          </div>
          <Tile size="xs" face="down" />
        </div>
      ))}
    </div>
  );
  return (
    <>
      <div style={tableStyles.wallTop(rs)}><StackRow n={counts[0]} /></div>
      <div style={tableStyles.wallRight(rs)}><StackRow n={counts[1]} vertical /></div>
      <div style={tableStyles.wallBottom(rs)}><StackRow n={counts[2]} /></div>
      <div style={tableStyles.wallLeft(rs)}><StackRow n={counts[3]} vertical /></div>
    </>
  );
}

function MySeat({ seat, state, tweaks, myIdx, isMyTurn, canHu, canSelfKong, selectedTileId, setSelectedTileId, onDiscard, onSelfKong, onHu, rs }) {
  const hand = sortTiles(state.hands[myIdx]);
  const melds = state.melds[myIdx];
  const myFlowers = state.flowers ? state.flowers[myIdx] : [];
  const drawn = state.lastDrawn && state.lastDrawn.player === myIdx ? state.lastDrawn.tile : null;
  const sorted = drawn ? sortTiles(hand.filter((t) => t.id !== drawn.id)) : hand;
  const goldenKey = state.goldenKey;
  // Pick the largest tile size that lets the full hand (plus draw + melds) fit without scrolling.
  // Tile widths: xs=28, sm=36, md=46, lg=56. Reserve space for gaps + melds + flowers + padding.
  const totalSlots = sorted.length + (drawn ? 1 : 0);
  const meldTileCount = melds.reduce((a, m) => a + m.tiles.length, 0);
  const available = Math.max(280, rs.w - 32);
  const fitTile = (tileW, gap, meldW) => {
    const meldsW = meldTileCount > 0 ? (meldTileCount * meldW + 20) : 0;
    return totalSlots * (tileW + gap) + meldsW + 24 <= available;
  };
  let tileSize;
  if (!rs.isPhone && fitTile(56, 3, 36)) tileSize = 'lg';
  else if (fitTile(46, 3, 28)) tileSize = 'md';
  else if (fitTile(36, 2, 28)) tileSize = 'sm';
  else tileSize = 'xs';
  const meldSize = (tileSize === 'lg' || tileSize === 'md') ? 'sm' : 'xs';
  const badgeSize = tileSize === 'lg' ? 18 : tileSize === 'md' ? 16 : 14;
  const useTilt = tileSize === 'lg' || tileSize === 'md';

  return (
    <div style={tableStyles.mySeat(rs)}>
      {myFlowers.length > 0 && (
        <div style={tableStyles.flowersRow}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#8aa699', letterSpacing: 2, marginRight: 4 }}>花 +{myFlowers.length}</span>
          {myFlowers.map((f) => <Tile key={f.id} tile={f} size="xs" />)}
        </div>
      )}
      <div style={tableStyles.myHand(rs)}>
        {melds.length > 0 && (
          <div style={{ display: 'flex', gap: rs.isPhone ? 3 : 6, alignItems: 'flex-end', marginRight: rs.isPhone ? 4 : 10, paddingBottom: 4, opacity: 0.9, borderRight: '1px solid rgba(255,255,255,.08)', paddingRight: rs.isPhone ? 6 : 12, flexShrink: 0 }}>
            {melds.map((m, i) => <MeldGroup key={i} meld={m} size={meldSize} />)}
          </div>
        )}
        {sorted.map((t) => {
          const gold = goldenKey && tileKey(t) === goldenKey;
          return (
            <div key={t.id} style={{ position: 'relative', flexShrink: 0 }}>
              <Tile tile={t} size={tileSize} tilt={useTilt}
                selected={selectedTileId === t.id}
                glow={selectedTileId === t.id ? 'rgba(224,201,126,.95)' : (gold ? 'rgba(224,201,126,.55)' : null)}
                onClick={isMyTurn ? () => {
                  if (selectedTileId === t.id) onDiscard(t.id);
                  else setSelectedTileId(t.id);
                } : null}
                dim={!isMyTurn} />
              {gold && <GoldenBadge size={badgeSize} />}
            </div>
          );
        })}
        {drawn && (
          <>
            <div style={{ width: rs.isPhone ? 6 : 12, flexShrink: 0 }} />
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Tile tile={drawn} size={tileSize} tilt={useTilt}
                selected={selectedTileId === drawn.id}
                glow={'rgba(224,201,126,.95)'}
                onClick={isMyTurn ? () => {
                  if (selectedTileId === drawn.id) onDiscard(drawn.id);
                  else setSelectedTileId(drawn.id);
                } : null}
                dim={!isMyTurn} />
              {goldenKey && tileKey(drawn) === goldenKey && <GoldenBadge size={badgeSize} />}
            </div>
          </>
        )}
      </div>
      <div style={tableStyles.actionBar(rs)}>
        {canHu && <button style={{ ...tableStyles.actionBtn(rs), ...tableStyles.huBtn }} onClick={onHu}>胡 HU</button>}
        {canSelfKong && <button style={tableStyles.actionBtn(rs)} onClick={onSelfKong}>杠 KONG</button>}
        {isMyTurn && selectedTileId && <button style={{ ...tableStyles.actionBtn(rs), ...tableStyles.discardBtn }} onClick={() => onDiscard(selectedTileId)}>Discard</button>}
        {isMyTurn && !selectedTileId && !canHu && <div style={tableStyles.waitingLbl}>{rs.isPhone ? 'Tap a tile to select, tap again to discard' : 'Your turn — tap a tile to select, tap again to discard'}</div>}
        {!isMyTurn && <div style={tableStyles.waitingLbl}>Waiting for {['東','南','西','北'][state.turn]}…</div>}
      </div>
    </div>
  );
}

function ClaimPrompt({ options, tile, onChoose, onPass, rs }) {
  return (
    <div style={tableStyles.claimOverlay(rs)}>
      <div style={tableStyles.claimBox(rs)}>
        <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>CLAIM</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '12px 0' }}>
          <Tile tile={tile} size={rs.isPhone ? 'sm' : 'md'} />
          <div style={{ fontFamily: 'Inter', fontSize: rs.isPhone ? 12 : 14, color: '#e8ebe7' }}>was discarded. Claim it?</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {options.map((o, i) => {
            const label = { hu: '胡 HU', pong: '碰 PONG', kong: '杠 KONG', chi: '吃 CHI' }[o.type];
            const styleX = o.type === 'hu' ? tableStyles.huBtn : o.type === 'chi' ? {} : tableStyles.discardBtn;
            return <button key={i} style={{ ...tableStyles.actionBtn(rs), ...styleX }} onClick={() => onChoose(o)}>{label}{o.chow ? ` ${o.chow.join('-')}` : ''}</button>;
          })}
          <button style={tableStyles.actionBtn(rs)} onClick={onPass}>Pass</button>
        </div>
      </div>
    </div>
  );
}

function EventLog({ log, rs }) {
  return (
    <div style={tableStyles.log(rs)}>
      {log.slice(-5).map((l, i) => (
        <div key={i} style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', opacity: 0.5 + i * 0.12 }}>{l}</div>
      ))}
    </div>
  );
}

function ScoreModal({ payload, seats, onNext, hideNext, rs }) {
  const { state, result } = payload;
  return (
    <div style={tableStyles.modalWrap}>
      <div style={tableStyles.modalCard(rs)}>
        {result ? (
          <>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>HAND COMPLETE</div>
            <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 24 : 32, color: '#e0c97e', marginTop: 6 }}>
              {seats[result.winner].name} 胡！
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#8aa699', marginTop: 6 }}>
              {result.selfDraw ? '自摸' : `放炮 by ${seats[result.from].name}`}
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 20 }}>
              {(result.breakdown || []).map((f, i) => (
                <div key={`b${i}`} style={tableStyles.fanRow}>
                  <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 13 : 15, color: '#c3d3ca' }}>{f.name}</span>
                  <span style={{ fontFamily: 'Inter', fontSize: 13, color: '#e0c97e' }}>+{f.value}</span>
                </div>
              ))}
              {result.breakdown && (
                <div style={{ ...tableStyles.fanRow, borderTop: '1px dashed #2a3a30', paddingTop: 8 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 12, color: '#8aa699' }}>Subtotal × 2</span>
                  <span style={{ fontFamily: 'Inter', fontSize: 14, color: '#c3d3ca' }}>{result.multiplierSum} × 2 = {result.multiplied}</span>
                </div>
              )}
              {(result.specials || []).map((f, i) => (
                <div key={`s${i}`} style={tableStyles.fanRow}>
                  <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 13 : 15, color: '#e8ebe7' }}>{f.name}</span>
                  <span style={{ fontFamily: 'Inter', fontSize: 13, color: '#e0c97e', fontWeight: 600 }}>+{f.value}</span>
                </div>
              ))}
              <div style={{ ...tableStyles.fanRow, borderTop: '1px solid #2a3a30', marginTop: 8, paddingTop: 12 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 14, color: '#8aa699' }}>Total {result.selfDraw ? 'each opponent pays' : 'discarder pays'}</span>
                <span style={{ fontFamily: 'Inter', fontSize: rs.isPhone ? 18 : 22, color: '#e0c97e', fontWeight: 700 }}>{result.totalPoints} 分</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>HAND COMPLETE</div>
            <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 24 : 32, color: '#e0c97e', marginTop: 6 }}>流局</div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#8aa699', marginTop: 6 }}>Wall exhausted. No winner.</div>
          </>
        )}
        {hideNext ? (
          <div style={{ ...tableStyles.waitingLbl, marginTop: 24, textAlign: 'center' }}>Waiting for host to start next hand…</div>
        ) : (
          <button style={{ ...tableStyles.actionBtn(rs), ...tableStyles.huBtn, marginTop: 24, width: '100%' }} onClick={onNext}>
            Continue → Next Hand
          </button>
        )}
      </div>
    </div>
  );
}

function MatchOver({ scores, seats, onExit, rs }) {
  const winner = scores.indexOf(Math.max(...scores));
  return (
    <div style={tableStyles.modalWrap}>
      <div style={tableStyles.modalCard(rs)}>
        <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>MATCH COMPLETE</div>
        <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: rs.isPhone ? 30 : 40, color: '#e0c97e', marginTop: 10 }}>
          {seats[winner].name} 勝
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 20 }}>
          {scores.map((v, i) => (
            <div key={i} style={{ ...tableStyles.fanRow, background: i === winner ? 'rgba(224,201,126,.08)' : 'transparent' }}>
              <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 16, color: i === winner ? '#e0c97e' : '#e8ebe7' }}>
                {['東','南','西','北'][i]} {seats[i].name}
              </span>
              <span style={{ fontFamily: 'Inter', fontSize: 18, color: v >= 0 ? '#e0c97e' : '#e07b6b', fontWeight: 700 }}>{v >= 0 ? '+' : ''}{v}</span>
            </div>
          ))}
        </div>
        <button style={{ ...tableStyles.actionBtn(rs), ...tableStyles.huBtn, marginTop: 24, width: '100%' }} onClick={onExit}>
          Back to Lobby
        </button>
      </div>
    </div>
  );
}

const tableStyles = {
  root: (tweaks, rs) => ({
    position: 'fixed', inset: 0,
    background: tweaks.theme === 'paper'
      ? 'radial-gradient(ellipse at top, #f5f1e8 0%, #d9d4c4 100%)'
      : tweaks.theme === 'traditional'
      ? 'radial-gradient(ellipse at top, #3e2a14 0%, #1e140a 100%)'
      : 'radial-gradient(ellipse at top, #1a2420 0%, #0a100d 70%, #05080a 100%)',
    overflow: 'hidden',
    color: '#e8ebe7',
    fontFamily: 'Inter, system-ui',
    WebkitTapHighlightColor: 'transparent',
  }),
  chrome: (rs) => ({
    position: 'absolute', top: 0, left: 0, right: 0,
    display: 'flex',
    flexDirection: rs.isPhone ? 'column' : 'row',
    justifyContent: 'space-between',
    alignItems: rs.isPhone ? 'stretch' : 'center',
    gap: rs.isPhone ? 6 : 0,
    padding: rs.isPhone ? '8px 10px' : '16px 24px',
    zIndex: 5,
  }),
  chromeLeft: (rs) => ({
    display: 'flex', alignItems: 'center',
    gap: rs.isPhone ? 8 : 20,
    flexWrap: rs.isPhone ? 'wrap' : 'nowrap',
  }),
  exitBtn: (rs) => ({
    background: 'rgba(255,255,255,.04)', border: '1px solid #2a3a30',
    color: '#c3d3ca', borderRadius: 8,
    padding: rs.isPhone ? '4px 8px' : '6px 12px',
    cursor: 'pointer', fontFamily: 'Inter', fontSize: rs.isPhone ? 14 : 12,
  }),
  matchBadge: (rs) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    padding: rs.isPhone ? '2px 8px' : '4px 12px', borderLeft: '2px solid #2a3a30',
  }),
  goldenBadge: (rs) => ({
    display: 'flex', flexDirection: 'column',
    padding: rs.isPhone ? '2px 8px' : '4px 12px', borderLeft: '2px solid #2a3a30',
  }),
  netPill: {
    fontFamily: 'Inter', fontSize: 10, letterSpacing: 2, color: '#e0c97e',
    padding: '4px 10px', borderLeft: '2px solid #2a3a30',
  },
  flowersRow: {
    display: 'flex', gap: 3, alignItems: 'center',
    padding: '4px 14px', background: 'rgba(176,48,43,.08)',
    borderRadius: 8, margin: '0 auto 6px', maxWidth: 'fit-content',
  },
  scoreBadge: (rs) => ({
    padding: rs.isPhone ? '3px 6px' : '6px 12px',
    background: 'rgba(0,0,0,.25)', border: '1px solid #1f2b25',
    borderRadius: 8, transition: 'all .2s',
  }),
  scoreActive: {
    borderColor: '#e0c97e',
    boxShadow: '0 0 0 1px rgba(224,201,126,.3), 0 0 20px rgba(224,201,126,.2)',
  },
  tableWrap: (rs) => ({
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    perspective: rs.isPhone ? 0 : 1800,
    paddingTop: rs.isPhone ? 70 : 60,
    paddingBottom: rs.isPhone ? 140 : 0,
  }),
  felt: (tweaks, rs) => ({
    position: 'relative',
    width: rs.isPhone ? '100%' : 'min(1100px, 95vw)',
    height: rs.isPhone ? '100%' : 'min(720px, 82vh)',
    borderRadius: rs.isPhone ? 0 : 24,
    background: tweaks.theme === 'paper'
      ? 'radial-gradient(ellipse at center, #f5f1e8 0%, #e8e3d2 100%)'
      : tweaks.theme === 'traditional'
      ? 'radial-gradient(ellipse at center, #2c5a3a 0%, #1a3f26 100%)'
      : 'radial-gradient(ellipse at center, #1c4530 0%, #0e2a1d 70%, #081812 100%)',
    boxShadow: rs.isPhone
      ? 'none'
      : tweaks.theme === 'paper'
        ? 'inset 0 0 60px rgba(0,0,0,.08), 0 20px 60px rgba(0,0,0,.4)'
        : 'inset 0 0 80px rgba(0,0,0,.5), 0 20px 60px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.04)',
    transform: (rs.isPhone || tweaks.tilt === false) ? 'none' : 'rotateX(10deg)',
    transformStyle: 'preserve-3d',
    transition: 'transform .3s',
    border: rs.isPhone ? 'none' : (tweaks.theme === 'paper' ? '1px solid #c8c0a8' : '1px solid #2a4a38'),
  }),
  opponentBlock: (pos, rs) => {
    const base = { position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 };
    // Opponents sit inside the outer wall ring.
    const inset = rs && rs.isTablet ? 52 : 72;
    if (pos === 'top') return { ...base, top: inset, left: '50%', transform: 'translateX(-50%)' };
    if (pos === 'left') return { ...base, left: inset, top: '50%', transform: 'translateY(-50%)' };
    if (pos === 'right') return { ...base, right: inset, top: '50%', transform: 'translateY(-50%)' };
    return base;
  },
  opponentPill: (pos, active) => {
    // On phone, opponents become horizontal pills along the top.
    const base = {
      position: 'absolute', display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px',
      background: active ? 'rgba(224,201,126,.12)' : 'rgba(0,0,0,.45)',
      border: `1px solid ${active ? 'rgba(224,201,126,.55)' : '#2a3a30'}`,
      borderRadius: 12,
      whiteSpace: 'nowrap',
      maxWidth: '46%',
      overflow: 'hidden',
    };
    if (pos === 'top') return { ...base, top: 6, left: '50%', transform: 'translateX(-50%)' };
    if (pos === 'left') return { ...base, top: 42, left: 6 };
    if (pos === 'right') return { ...base, top: 42, right: 6 };
    return base;
  },
  opponentLabel: (pos, active) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 10px',
    background: active ? 'rgba(224,201,126,.12)' : 'rgba(0,0,0,.35)',
    border: `1px solid ${active ? 'rgba(224,201,126,.55)' : '#2a3a30'}`,
    borderRadius: 16, whiteSpace: 'nowrap',
  }),
  turnDot: { width: 6, height: 6, borderRadius: '50%', background: '#e0c97e', boxShadow: '0 0 8px #e0c97e' },
  pond: (rs) => ({
    position: 'absolute',
    inset: rs.isPhone ? '84px 8px 180px 8px' : rs.isTablet ? '16% 18%' : '20% 22%',
    display: 'grid',
    gridTemplateRows: '1fr 1fr 1fr',
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateAreas: '"tl top tr" "left center right" "bl bot br"',
    pointerEvents: 'none',
  }),
  centerDisc: (rs) => ({
    gridArea: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 2,
    background: 'rgba(0,0,0,.35)',
    border: '1px solid rgba(193,169,109,.25)',
    borderRadius: '50%',
    width: rs.isPhone ? 60 : rs.isTablet ? 80 : 110,
    height: rs.isPhone ? 60 : rs.isTablet ? 80 : 110,
    margin: 'auto',
  }),
  // Visual tile wall hugging the inside edge of the felt. Each side gets ~1/4 of the wall; drained evenly.
  // Opponents sit INSIDE this ring (see opponentBlock inset), and the pond sits further inside still.
  wallTop: (rs) => ({
    position: 'absolute',
    top: rs.isTablet ? 10 : 14,
    left: 0, right: 0,
    display: 'flex', justifyContent: 'center',
    pointerEvents: 'none',
  }),
  wallBottom: (rs) => ({
    position: 'absolute',
    bottom: rs.isTablet ? 210 : 240,
    left: 0, right: 0,
    display: 'flex', justifyContent: 'center',
    pointerEvents: 'none',
  }),
  wallLeft: (rs) => ({
    position: 'absolute',
    left: rs.isTablet ? 10 : 14,
    top: 0, bottom: 0,
    display: 'flex', alignItems: 'center',
    pointerEvents: 'none',
  }),
  wallRight: (rs) => ({
    position: 'absolute',
    right: rs.isTablet ? 10 : 14,
    top: 0, bottom: 0,
    display: 'flex', alignItems: 'center',
    pointerEvents: 'none',
  }),
  mySeat: (rs) => ({
    position: 'absolute',
    bottom: rs.isPhone ? 8 : 16,
    left: '50%',
    transform: rs.isPhone ? 'translateX(-50%)' : 'translateX(-50%) translateZ(30px)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: rs.isPhone ? 6 : 10,
    width: '100%', pointerEvents: 'auto',
  }),
  myHand: (rs) => ({
    display: 'flex',
    gap: rs.isPhone ? 2 : 3,
    alignItems: 'flex-end',
    padding: rs.isPhone ? '6px 8px' : '12px 20px',
    background: 'rgba(0,0,0,.2)',
    borderRadius: rs.isPhone ? 8 : 12,
    backdropFilter: 'blur(4px)',
    maxWidth: '100%',
    overflowX: rs.isPhone ? 'auto' : 'visible',
    overflowY: 'visible',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'thin',
  }),
  actionBar: (rs) => ({
    display: 'flex', gap: rs.isPhone ? 6 : 10,
    alignItems: 'center',
    minHeight: rs.isPhone ? 36 : 44,
    flexWrap: 'wrap', justifyContent: 'center',
    padding: rs.isPhone ? '0 8px' : 0,
  }),
  actionBtn: (rs) => ({
    background: 'rgba(0,0,0,.4)', border: '1px solid #2a3a30',
    color: '#e8ebe7',
    padding: rs.isPhone ? '8px 14px' : '10px 18px',
    borderRadius: 8,
    fontFamily: 'Inter', fontSize: rs.isPhone ? 12 : 13, fontWeight: 600,
    cursor: 'pointer', letterSpacing: 1,
    minHeight: rs.isPhone ? 36 : 40,
  }),
  huBtn: {
    background: 'linear-gradient(180deg, #c9a14a 0%, #8a6d2f 100%)',
    border: '1px solid #e0c97e', color: '#1a1a1a', fontWeight: 700,
  },
  discardBtn: {
    background: 'linear-gradient(180deg, #2a7a50 0%, #1e5a3d 100%)',
    border: '1px solid #3aa068', color: '#fff',
  },
  waitingLbl: {
    fontFamily: 'Inter', fontSize: 11, color: '#6a8578', letterSpacing: 2, textTransform: 'uppercase',
    textAlign: 'center',
  },
  claimOverlay: (rs) => ({
    position: 'fixed',
    bottom: rs.isPhone ? 150 : 120,
    left: '50%', transform: 'translateX(-50%)',
    zIndex: 20,
    width: rs.isPhone ? 'calc(100% - 16px)' : 'auto',
    maxWidth: rs.isPhone ? 'none' : '92vw',
  }),
  claimBox: (rs) => ({
    background: 'linear-gradient(180deg, #151c18 0%, #0e1512 100%)',
    border: '1px solid #e0c97e', borderRadius: 16,
    padding: rs.isPhone ? 14 : 20,
    boxShadow: '0 20px 40px rgba(0,0,0,.6), 0 0 40px rgba(224,201,126,.1)',
  }),
  log: (rs) => ({
    position: 'absolute', left: 16, bottom: 16,
    display: 'flex', flexDirection: 'column', gap: 2,
    maxWidth: 200, pointerEvents: 'none',
  }),
  modalWrap: {
    position: 'fixed', inset: 0, background: 'rgba(5,8,10,.7)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30,
    padding: 12,
  },
  modalCard: (rs) => ({
    background: 'linear-gradient(180deg, #151c18 0%, #0e1512 100%)',
    border: '1px solid #2a3a30', borderRadius: 16,
    padding: rs.isPhone ? 20 : 28,
    width: rs.isPhone ? '100%' : 'min(420px, 92vw)',
    maxHeight: '92vh', overflowY: 'auto',
    boxShadow: '0 30px 80px rgba(0,0,0,.6)',
  }),
  fanRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0',
  },
};

Object.assign(window, { GameTable });
