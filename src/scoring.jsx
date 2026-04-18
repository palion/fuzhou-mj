// Fuzhou 十六番 scoring (simplified but playable)
// Score in 番 (fans). 1 fan ≈ base points; capped at 16.
// House-rules configurable via scoringConfig.

const DEFAULT_SCORING = {
  basePoints: 1,          // points per fan (non-dealer non-self-draw)
  limitFans: 16,          // 番上限
  cleanHand: 4,           // 清一色 (all one suit)
  mixedOneSuit: 2,        // 混一色
  allPungs: 2,            // 碰碰胡
  allHonors: 8,           // 字一色
  allTerminals: 8,        // 幺九
  sevenPairs: 4,          // 七对
  bigThreeDragons: 8,     // 大三元
  smallThreeDragons: 4,   // 小三元
  bigFourWinds: 16,       // 大四喜
  smallFourWinds: 8,      // 小四喜
  dragonTriplet: 1,       // each 箭刻 (dragon pung)
  seatWindPung: 1,        // 门风刻
  roundWindPung: 1,       // 圈风刻
  concealed: 1,           // 门清
  selfDraw: 1,            // 自摸
  lastTile: 1,            // 海底捞月
  robbingKong: 1,         // 抢杠
  kongBonus: 1,           // 杠上开花
  heavenlyHand: 16,       // 天胡
  earthlyHand: 8,         // 地胡
  pureTerminals: 16,      // 清幺九
};

function scoreHand(state, cfg = DEFAULT_SCORING) {
  if (!state.hu) return { fans: [], total: 0, dealer: state.dealer, winner: null };
  const winner = state.hu.winner;
  const hand = state.hands[winner];
  const melds = state.melds[winner];
  const selfDraw = state.hu.selfDraw;
  const decomp = decomposeHand(hand, melds);
  const fans = [];

  // Gather all sets (melds + concealed sets)
  const allSets = [];
  // Concealed pair:
  if (decomp.ok) {
    for (const s of decomp.concealedSets) {
      const suit = s.key[0];
      const n = parseInt(s.key.slice(1));
      const tiles = s.type === 'pung'
        ? [{ suit, n: isNaN(n) ? s.key.slice(1) : n }, { suit, n: isNaN(n) ? s.key.slice(1) : n }, { suit, n: isNaN(n) ? s.key.slice(1) : n }]
        : [{ suit, n }, { suit, n: n + 1 }, { suit, n: n + 2 }];
      allSets.push({ type: s.type, tiles, exposed: false });
    }
  }
  for (const m of melds) {
    allSets.push({
      type: m.type === 'kong' ? 'pung' : m.type, // kongs count like pungs for pattern detection
      tiles: m.tiles,
      exposed: !m.concealed,
      isKong: m.type === 'kong',
    });
  }

  const pair = decomp.pair;

  // All tiles combined
  const allTiles = [...hand, ...melds.flatMap((m) => m.tiles)];

  // --- Pattern detection ---
  const suits = new Set(allTiles.map((t) => t.suit));
  const hasHonors = suits.has('w') || suits.has('d');
  const onlyNum = [...suits].filter((s) => ['m', 'p', 's'].includes(s));

  // Clean hand: only one suit, no honors
  if (onlyNum.length === 1 && !hasHonors) {
    fans.push({ name: '清一色', value: cfg.cleanHand });
  } else if (onlyNum.length === 1 && hasHonors) {
    fans.push({ name: '混一色', value: cfg.mixedOneSuit });
  }

  // All pungs (no chows)
  if (allSets.length > 0 && allSets.every((s) => s.type === 'pung')) {
    fans.push({ name: '碰碰胡', value: cfg.allPungs });
  }

  // All honors
  if (allTiles.every((t) => t.suit === 'w' || t.suit === 'd')) {
    fans.push({ name: '字一色', value: cfg.allHonors });
  }

  // All terminals (1/9 only, no honors, no chows except 1-2-3 or 7-8-9? — strictly only terminal tiles)
  const isTerminal = (t) => (['m','p','s'].includes(t.suit) && (t.n === 1 || t.n === 9));
  if (allTiles.length > 0 && allTiles.every(isTerminal)) {
    fans.push({ name: '清幺九', value: cfg.pureTerminals });
  } else if (allTiles.every((t) => isTerminal(t) || t.suit === 'w' || t.suit === 'd')) {
    fans.push({ name: '幺九', value: cfg.allTerminals });
  }

  // Dragon pungs
  let dragonPungs = 0;
  let dragonPairs = 0;
  for (const s of allSets) {
    if (s.type === 'pung' && s.tiles[0].suit === 'd') dragonPungs++;
  }
  if (pair && pair.key[0] === 'd') dragonPairs++;
  if (dragonPungs === 3) fans.push({ name: '大三元', value: cfg.bigThreeDragons });
  else if (dragonPungs === 2 && dragonPairs === 1) fans.push({ name: '小三元', value: cfg.smallThreeDragons });
  else if (dragonPungs > 0) fans.push({ name: `箭刻 ×${dragonPungs}`, value: cfg.dragonTriplet * dragonPungs });

  // Wind pungs
  let windPungs = 0;
  let windPairs = 0;
  const seatWind = state.seatWinds[winner];
  const roundWind = state.roundWind;
  for (const s of allSets) {
    if (s.type === 'pung' && s.tiles[0].suit === 'w') {
      windPungs++;
      if (s.tiles[0].n === seatWind) fans.push({ name: '门风刻', value: cfg.seatWindPung });
      if (s.tiles[0].n === roundWind) fans.push({ name: '圈风刻', value: cfg.roundWindPung });
    }
  }
  if (pair && pair.key[0] === 'w') windPairs++;
  if (windPungs === 4) fans.push({ name: '大四喜', value: cfg.bigFourWinds });
  else if (windPungs === 3 && windPairs === 1) fans.push({ name: '小四喜', value: cfg.smallFourWinds });

  // Seven pairs
  if (melds.length === 0 && hand.length === 14) {
    const counts = {};
    for (const t of hand) counts[tileKey(t)] = (counts[tileKey(t)] || 0) + 1;
    if (Object.values(counts).every((v) => v === 2 || v === 4)) {
      fans.push({ name: '七对', value: cfg.sevenPairs });
    }
  }

  // Concealed / 门清
  const anyExposed = melds.some((m) => !m.concealed);
  if (!anyExposed && selfDraw) fans.push({ name: '门清自摸', value: cfg.concealed + cfg.selfDraw });
  else if (!anyExposed) fans.push({ name: '门清', value: cfg.concealed });
  else if (selfDraw) fans.push({ name: '自摸', value: cfg.selfDraw });

  // Last tile (海底)
  if (state.wall.length === 0 && selfDraw) fans.push({ name: '海底捞月', value: cfg.lastTile });

  // Kong bonus (杠上开花)
  if (state.lastDrawn && state.lastDrawn.afterKong && selfDraw) {
    fans.push({ name: '杠上开花', value: cfg.kongBonus });
  }

  // At least 起胡 — require minimum 1 fan
  const raw = fans.reduce((a, f) => a + f.value, 0);
  const totalFans = Math.min(raw, cfg.limitFans);
  const totalPoints = totalFans * cfg.basePoints;

  return {
    fans,
    totalFans,
    totalPoints,
    dealer: state.dealer,
    winner,
    from: state.hu.from,
    selfDraw,
    decomp,
  };
}

// Payment calculation: returns { deltas: [p0,p1,p2,p3] }
function paymentDeltas(result, state) {
  const deltas = [0, 0, 0, 0];
  if (!result.winner && result.winner !== 0) return { deltas };
  const winner = result.winner;
  const points = result.totalPoints;
  const dealerBonus = (winner === state.dealer || result.from === state.dealer) ? 2 : 1;
  if (result.selfDraw) {
    // Everyone pays winner
    for (let i = 0; i < 4; i++) {
      if (i === winner) continue;
      const pay = points * (i === state.dealer || winner === state.dealer ? 2 : 1);
      deltas[i] -= pay;
      deltas[winner] += pay;
    }
  } else {
    // Only discarder pays, but 2x if dealer involved
    const pay = points * dealerBonus;
    deltas[result.from] -= pay;
    deltas[winner] += pay;
  }
  return { deltas };
}

Object.assign(window, { DEFAULT_SCORING, scoreHand, paymentDeltas });
