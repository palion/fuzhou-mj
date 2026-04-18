// Main table UI — dark charcoal + jade, slight 3D tilt.
// Supports solo (local AI), host (authoritative local engine + broadcast), and client (renders host state + sends actions).

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

function GameTable({ seats, networking, tweaks, onExit, scoringCfg }) {
  const role = networking?.role || 'solo';
  const isClient = role === 'client';
  const myIdx = networking?.mySeatIdx ?? 0;

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
  const respondedForRef = React.useRef(null); // discard id we've already answered

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
    } else if (role === 'client') {
      networking.handlers.onMessage = (msg) => {
        if (!msg) return;
        if (msg.type === 'state') {
          setState(msg.state);
          if (msg.round != null) setRound(msg.round);
          if (msg.hand != null) setHand(msg.hand);
          if (msg.scores) setScores(msg.scores);
        } else if (msg.type === 'score') {
          setShowScore(msg.payload);
        } else if (msg.type === 'next-hand') {
          setShowScore(null);
          respondedForRef.current = null;
        } else if (msg.type === 'exit') {
          onExit();
        }
      };
    }
    return () => { if (networking?.handlers) networking.handlers.onMessage = null; };
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
      if (seat.kind === 'human') {
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
      if (seat.kind === 'ai') {
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
    <div style={tableStyles.root(tweaks)}>
      <TableChrome
        round={round} hand={hand} roundWind={state.roundWind}
        wallRemaining={state.wall.length}
        goldenKey={state.goldenKey}
        scores={scores} seats={seats} turn={state.turn}
        onExit={onExit}
        networking={networking}
      />
      <div style={tableStyles.tableWrap}>
        <div style={tableStyles.felt(tweaks)}>
          {[0, 1, 2, 3].filter((i) => i !== myIdx).map((i) => (
            <OpponentSeat key={i} seat={seats[i]} idx={i}
              position={positionOfSeat(i)} state={state} tweaks={tweaks} />
          ))}
          <CenterPond state={state} tweaks={tweaks} myIdx={myIdx} />
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
          />
        </div>
      </div>

      {pendingClaims && (
        <ClaimPrompt options={pendingClaims.options} tile={pendingClaims.tile}
          onChoose={takeMyClaim} onPass={passClaim} />
      )}

      <EventLog log={log} />

      {showScore && (
        showScore.matchOver
          ? <MatchOver scores={showScore.scores} seats={seats} onExit={onExit} />
          : <ScoreModal payload={showScore} seats={seats} onNext={startNextHand} hideNext={isClient} />
      )}
    </div>
  );
}

function TableChrome({ round, hand, roundWind, wallRemaining, goldenKey, scores, seats, turn, onExit, networking }) {
  const windCh = { E: '東', S: '南', W: '西', N: '北' }[roundWind];
  const goldenTile = goldenKey ? parseGoldenKey(goldenKey) : null;
  const friends = networking?.role === 'host' ? (networking.connections ? networking.connections.size : 0) : null;
  return (
    <div style={tableStyles.chrome}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <button style={tableStyles.exitBtn} onClick={onExit}>← Exit</button>
        <div style={tableStyles.matchBadge}>
          <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 20, color: '#e0c97e' }}>{windCh}場</div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#8aa699', letterSpacing: 2 }}>ROUND {round}·{hand}</div>
        </div>
        <div style={tableStyles.wallBadge}>
          <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 1 }}>WALL</div>
          <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 22, color: '#e8ebe7' }}>{wallRemaining}</div>
        </div>
        {goldenTile && (
          <div style={tableStyles.goldenBadge} title={`Golden (wild): ${tileDesc(goldenTile)}`}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#c9a14a', letterSpacing: 2 }}>金 GOLDEN</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <div style={{ position: 'relative' }}>
                <Tile tile={goldenTile} size="xs" />
                <GoldenBadge size={14} />
              </div>
              <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 13, color: '#e0c97e' }}>{tileDesc(goldenTile)}</span>
            </div>
          </div>
        )}
        {networking && (
          <div style={tableStyles.netPill}>
            <span style={{ color: '#8aa699' }}>{networking.role === 'host' ? 'HOST' : 'CLIENT'}</span>
            {friends != null && <span> · {friends} linked</span>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {scores.map((v, i) => (
          <div key={i} style={{ ...tableStyles.scoreBadge, ...(turn === i ? tableStyles.scoreActive : {}) }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#8aa699', letterSpacing: 1 }}>{['東','南','西','北'][i]} · {(seats[i].name || '').slice(0, 10)}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: v >= 0 ? '#e8ebe7' : '#e07b6b' }}>{v >= 0 ? '+' : ''}{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpponentSeat({ seat, idx, position, state, tweaks }) {
  const hand = state.hands[idx];
  const melds = state.melds[idx];
  const oppFlowers = state.flowers ? state.flowers[idx] : [];
  const isTurn = state.turn === idx;
  const size = tweaks.density === 'compact' ? 'xs' : 'sm';
  const rotate = position === 'top' ? 180 : position === 'right' ? -90 : 90;
  const handStyle = {
    display: 'flex',
    flexDirection: position === 'left' || position === 'right' ? 'column' : 'row',
    gap: 2, justifyContent: 'center', alignItems: 'center',
  };
  return (
    <div style={tableStyles.opponentBlock(position)}>
      <div style={tableStyles.opponentLabel(position, isTurn)}>
        <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 18, color: '#e0c97e' }}>
          {['東','南','西','北'][idx]}
        </span>
        <span style={{ fontFamily: 'Inter', fontSize: 12, color: isTurn ? '#fff' : '#8aa699', fontWeight: isTurn ? 600 : 400 }}>
          {seat.name}
        </span>
        {isTurn && <span style={tableStyles.turnDot} />}
        {oppFlowers.length > 0 && <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 11, color: '#b0302b' }}>花·{oppFlowers.length}</span>}
      </div>
      <div style={handStyle}>
        {hand.map((t) => (
          <Tile key={t.id} tile={t} size={size} face="down" rotate={rotate} />
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

function CenterPond({ state, tweaks, myIdx }) {
  const areaFor = (p) => ['bot', 'right', 'top', 'left'][(p - myIdx + 4) % 4];
  const rotFor = (p) => {
    const rel = (p - myIdx + 4) % 4;
    return ['', 'rotate(-90deg)', 'rotate(180deg)', 'rotate(90deg)'][rel];
  };
  return (
    <div style={tableStyles.pond}>
      {[0, 1, 2, 3].map((p) => (
        <div key={p} style={{
          gridArea: areaFor(p),
          display: 'flex', justifyContent: 'center', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, maxWidth: 240, justifyContent: 'center', transform: rotFor(p) }}>
            {state.discards[p].map((t) => (
              <Tile key={t.id} tile={t} size="xs"
                glow={state.lastDiscard && state.lastDiscard.tile.id === t.id ? 'rgba(224,201,126,.9)' : null}
                selected={state.lastDiscard && state.lastDiscard.tile.id === t.id} />
            ))}
          </div>
        </div>
      ))}
      <div style={tableStyles.centerDisc}>
        <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 18, color: '#c1a96d', opacity: 0.6 }}>福州</div>
        <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 14, color: '#c1a96d', opacity: 0.5, letterSpacing: 4 }}>麻將</div>
      </div>
    </div>
  );
}

function MySeat({ seat, state, tweaks, myIdx, isMyTurn, canHu, canSelfKong, selectedTileId, setSelectedTileId, onDiscard, onSelfKong, onHu }) {
  const hand = sortTiles(state.hands[myIdx]);
  const melds = state.melds[myIdx];
  const myFlowers = state.flowers ? state.flowers[myIdx] : [];
  const drawn = state.lastDrawn && state.lastDrawn.player === myIdx ? state.lastDrawn.tile : null;
  const sorted = drawn ? sortTiles(hand.filter((t) => t.id !== drawn.id)) : hand;
  const goldenKey = state.goldenKey;

  return (
    <div style={tableStyles.mySeat}>
      {myFlowers.length > 0 && (
        <div style={tableStyles.flowersRow}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#8aa699', letterSpacing: 2, marginRight: 4 }}>花 +{myFlowers.length}</span>
          {myFlowers.map((f) => <Tile key={f.id} tile={f} size="xs" />)}
        </div>
      )}
      <div style={tableStyles.myHand}>
        {melds.length > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginRight: 10, paddingBottom: 4, opacity: 0.9, borderRight: '1px solid rgba(255,255,255,.08)', paddingRight: 12 }}>
            {melds.map((m, i) => <MeldGroup key={i} meld={m} size="sm" />)}
          </div>
        )}
        {sorted.map((t) => {
          const gold = goldenKey && tileKey(t) === goldenKey;
          return (
            <div key={t.id} style={{ position: 'relative' }}>
              <Tile tile={t} size="lg" tilt
                selected={selectedTileId === t.id}
                glow={selectedTileId === t.id ? 'rgba(224,201,126,.95)' : (gold ? 'rgba(224,201,126,.55)' : null)}
                onClick={isMyTurn ? () => {
                  if (selectedTileId === t.id) onDiscard(t.id);
                  else setSelectedTileId(t.id);
                } : null}
                dim={!isMyTurn} />
              {gold && <GoldenBadge size={18} />}
            </div>
          );
        })}
        {drawn && (
          <>
            <div style={{ width: 12 }} />
            <div style={{ position: 'relative' }}>
              <Tile tile={drawn} size="lg" tilt
                selected={selectedTileId === drawn.id}
                glow={'rgba(224,201,126,.95)'}
                onClick={isMyTurn ? () => {
                  if (selectedTileId === drawn.id) onDiscard(drawn.id);
                  else setSelectedTileId(drawn.id);
                } : null}
                dim={!isMyTurn} />
              {goldenKey && tileKey(drawn) === goldenKey && <GoldenBadge size={18} />}
            </div>
          </>
        )}
      </div>
      <div style={tableStyles.actionBar}>
        {canHu && <button style={{ ...tableStyles.actionBtn, ...tableStyles.huBtn }} onClick={onHu}>胡 HU</button>}
        {canSelfKong && <button style={tableStyles.actionBtn} onClick={onSelfKong}>杠 KONG</button>}
        {isMyTurn && selectedTileId && <button style={{ ...tableStyles.actionBtn, ...tableStyles.discardBtn }} onClick={() => onDiscard(selectedTileId)}>Discard</button>}
        {isMyTurn && !selectedTileId && !canHu && <div style={tableStyles.waitingLbl}>Your turn — tap a tile to select, tap again to discard</div>}
        {!isMyTurn && <div style={tableStyles.waitingLbl}>Waiting for {['東','南','西','北'][state.turn]}…</div>}
      </div>
    </div>
  );
}

function ClaimPrompt({ options, tile, onChoose, onPass }) {
  return (
    <div style={tableStyles.claimOverlay}>
      <div style={tableStyles.claimBox}>
        <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>CLAIM</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '12px 0' }}>
          <Tile tile={tile} size="md" />
          <div style={{ fontFamily: 'Inter', fontSize: 14, color: '#e8ebe7' }}>was discarded. Claim it?</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {options.map((o, i) => {
            const label = { hu: '胡 HU', pong: '碰 PONG', kong: '杠 KONG', chi: '吃 CHI' }[o.type];
            const styleX = o.type === 'hu' ? tableStyles.huBtn : o.type === 'chi' ? {} : tableStyles.discardBtn;
            return <button key={i} style={{ ...tableStyles.actionBtn, ...styleX }} onClick={() => onChoose(o)}>{label}{o.chow ? ` ${o.chow.join('-')}` : ''}</button>;
          })}
          <button style={tableStyles.actionBtn} onClick={onPass}>Pass</button>
        </div>
      </div>
    </div>
  );
}

function EventLog({ log }) {
  return (
    <div style={tableStyles.log}>
      {log.slice(-5).map((l, i) => (
        <div key={i} style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', opacity: 0.5 + i * 0.12 }}>{l}</div>
      ))}
    </div>
  );
}

function ScoreModal({ payload, seats, onNext, hideNext }) {
  const { state, result } = payload;
  return (
    <div style={tableStyles.modalWrap}>
      <div style={tableStyles.modalCard}>
        {result ? (
          <>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>HAND COMPLETE</div>
            <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 32, color: '#e0c97e', marginTop: 6 }}>
              {seats[result.winner].name} 胡！
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#8aa699', marginTop: 6 }}>
              {result.selfDraw ? '自摸' : `放炮 by ${seats[result.from].name}`}
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 20 }}>
              {(result.breakdown || []).map((f, i) => (
                <div key={`b${i}`} style={tableStyles.fanRow}>
                  <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 15, color: '#c3d3ca' }}>{f.name}</span>
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
                  <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 15, color: '#e8ebe7' }}>{f.name}</span>
                  <span style={{ fontFamily: 'Inter', fontSize: 13, color: '#e0c97e', fontWeight: 600 }}>+{f.value}</span>
                </div>
              ))}
              <div style={{ ...tableStyles.fanRow, borderTop: '1px solid #2a3a30', marginTop: 8, paddingTop: 12 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 14, color: '#8aa699' }}>Total {result.selfDraw ? 'each opponent pays' : 'discarder pays'}</span>
                <span style={{ fontFamily: 'Inter', fontSize: 22, color: '#e0c97e', fontWeight: 700 }}>{result.totalPoints} 分</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>HAND COMPLETE</div>
            <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 32, color: '#e0c97e', marginTop: 6 }}>流局</div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#8aa699', marginTop: 6 }}>Wall exhausted. No winner.</div>
          </>
        )}
        {hideNext ? (
          <div style={{ ...tableStyles.waitingLbl, marginTop: 24, textAlign: 'center' }}>Waiting for host to start next hand…</div>
        ) : (
          <button style={{ ...tableStyles.actionBtn, ...tableStyles.huBtn, marginTop: 24, width: '100%' }} onClick={onNext}>
            Continue → Next Hand
          </button>
        )}
      </div>
    </div>
  );
}

function MatchOver({ scores, seats, onExit }) {
  const winner = scores.indexOf(Math.max(...scores));
  return (
    <div style={tableStyles.modalWrap}>
      <div style={tableStyles.modalCard}>
        <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#8aa699', letterSpacing: 2 }}>MATCH COMPLETE</div>
        <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 40, color: '#e0c97e', marginTop: 10 }}>
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
        <button style={{ ...tableStyles.actionBtn, ...tableStyles.huBtn, marginTop: 24, width: '100%' }} onClick={onExit}>
          Back to Lobby
        </button>
      </div>
    </div>
  );
}

const tableStyles = {
  root: (tweaks) => ({
    position: 'fixed', inset: 0,
    background: tweaks.theme === 'paper'
      ? 'radial-gradient(ellipse at top, #f5f1e8 0%, #d9d4c4 100%)'
      : tweaks.theme === 'traditional'
      ? 'radial-gradient(ellipse at top, #3e2a14 0%, #1e140a 100%)'
      : 'radial-gradient(ellipse at top, #1a2420 0%, #0a100d 70%, #05080a 100%)',
    overflow: 'hidden',
    color: '#e8ebe7',
    fontFamily: 'Inter, system-ui',
  }),
  chrome: {
    position: 'absolute', top: 0, left: 0, right: 0,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 24px', zIndex: 5,
  },
  exitBtn: {
    background: 'rgba(255,255,255,.04)', border: '1px solid #2a3a30',
    color: '#c3d3ca', borderRadius: 8, padding: '6px 12px',
    cursor: 'pointer', fontFamily: 'Inter', fontSize: 12,
  },
  matchBadge: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    padding: '4px 12px', borderLeft: '2px solid #2a3a30',
  },
  wallBadge: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    padding: '4px 12px', borderLeft: '2px solid #2a3a30',
  },
  goldenBadge: {
    display: 'flex', flexDirection: 'column',
    padding: '4px 12px', borderLeft: '2px solid #2a3a30',
  },
  netPill: {
    fontFamily: 'Inter', fontSize: 10, letterSpacing: 2, color: '#e0c97e',
    padding: '4px 10px', borderLeft: '2px solid #2a3a30',
  },
  flowersRow: {
    display: 'flex', gap: 3, alignItems: 'center',
    padding: '4px 14px', background: 'rgba(176,48,43,.08)',
    borderRadius: 8, margin: '0 auto 6px', maxWidth: 'fit-content',
  },
  scoreBadge: {
    padding: '6px 12px', background: 'rgba(0,0,0,.25)', border: '1px solid #1f2b25',
    borderRadius: 8, minWidth: 90, transition: 'all .2s',
  },
  scoreActive: {
    borderColor: '#e0c97e',
    boxShadow: '0 0 0 1px rgba(224,201,126,.3), 0 0 20px rgba(224,201,126,.2)',
  },
  tableWrap: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    perspective: 1800, paddingTop: 60,
  },
  felt: (tweaks) => ({
    position: 'relative',
    width: 'min(1100px, 95vw)', height: 'min(720px, 82vh)',
    borderRadius: 24,
    background: tweaks.theme === 'paper'
      ? 'radial-gradient(ellipse at center, #f5f1e8 0%, #e8e3d2 100%)'
      : tweaks.theme === 'traditional'
      ? 'radial-gradient(ellipse at center, #2c5a3a 0%, #1a3f26 100%)'
      : 'radial-gradient(ellipse at center, #1c4530 0%, #0e2a1d 70%, #081812 100%)',
    boxShadow: tweaks.theme === 'paper'
      ? 'inset 0 0 60px rgba(0,0,0,.08), 0 20px 60px rgba(0,0,0,.4)'
      : 'inset 0 0 80px rgba(0,0,0,.5), 0 20px 60px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.04)',
    transform: tweaks.tilt !== false ? 'rotateX(10deg)' : 'none',
    transformStyle: 'preserve-3d',
    transition: 'transform .3s',
    border: tweaks.theme === 'paper' ? '1px solid #c8c0a8' : '1px solid #2a4a38',
  }),
  opponentBlock: (pos) => {
    const base = { position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 };
    if (pos === 'top') return { ...base, top: 16, left: '50%', transform: 'translateX(-50%)' };
    if (pos === 'left') return { ...base, left: 16, top: '50%', transform: 'translateY(-50%)' };
    if (pos === 'right') return { ...base, right: 16, top: '50%', transform: 'translateY(-50%)' };
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
  pond: {
    position: 'absolute', inset: '20% 22%',
    display: 'grid',
    gridTemplateRows: '1fr 1fr 1fr',
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateAreas: '"tl top tr" "left center right" "bl bot br"',
    pointerEvents: 'none',
  },
  centerDisc: {
    gridArea: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,.2)',
    border: '1px solid rgba(193,169,109,.15)',
    borderRadius: '50%',
    width: 120, height: 120, margin: 'auto',
  },
  mySeat: {
    position: 'absolute',
    bottom: 16, left: '50%', transform: 'translateX(-50%) translateZ(30px)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    width: '100%', pointerEvents: 'auto',
  },
  myHand: {
    display: 'flex', gap: 3, alignItems: 'flex-end',
    padding: '12px 20px', background: 'rgba(0,0,0,.2)',
    borderRadius: 12, backdropFilter: 'blur(4px)',
  },
  actionBar: { display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 },
  actionBtn: {
    background: 'rgba(0,0,0,.4)', border: '1px solid #2a3a30',
    color: '#e8ebe7', padding: '10px 18px', borderRadius: 8,
    fontFamily: 'Inter', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', letterSpacing: 1,
  },
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
  },
  claimOverlay: {
    position: 'fixed', bottom: 120, left: '50%', transform: 'translateX(-50%)',
    zIndex: 20,
  },
  claimBox: {
    background: 'linear-gradient(180deg, #151c18 0%, #0e1512 100%)',
    border: '1px solid #e0c97e', borderRadius: 16, padding: 20,
    boxShadow: '0 20px 40px rgba(0,0,0,.6), 0 0 40px rgba(224,201,126,.1)',
  },
  log: {
    position: 'absolute', left: 16, bottom: 16,
    display: 'flex', flexDirection: 'column', gap: 2,
    maxWidth: 200, pointerEvents: 'none',
  },
  modalWrap: {
    position: 'fixed', inset: 0, background: 'rgba(5,8,10,.7)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30,
  },
  modalCard: {
    background: 'linear-gradient(180deg, #151c18 0%, #0e1512 100%)',
    border: '1px solid #2a3a30', borderRadius: 16, padding: 28,
    width: 'min(420px, 92vw)', boxShadow: '0 30px 80px rgba(0,0,0,.6)',
  },
  fanRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0',
  },
};

Object.assign(window, { GameTable });
