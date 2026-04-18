// Fuzhou Mahjong scoring.
// Payout = ((Base + Flower + Gold + DealerCont + Kong) × 2) + Special Hand Points
// Self-draw: every opponent pays; Discard-pay: only discarder pays.

const DEFAULT_SCORING = {
  basePoints: 5,
  flowerPerTile: 1,
  goldPerTile: 1,
  dealerContinuationPerHand: 1,
  openKong: 1,
  concealedKong: 2,
  fullBloom: 6,             // 4-of-a-kind flowers/seasons or 4-of-a-kind same wind/dragon
  allSequences: 10,         // 平胡
  oneFlower: 15,            // 只有一张花
  goldenPair: 20,           // 金雀 (pair = 2 golds)
  threeGoldKnockdown: 30,   // 三金倒 (3 golds, not as triplet)
  goldenDragon: 40,         // 金龙 (3 golds as a concealed triplet)
  robbingTheGold: 50,       // 抢金
  blessingOfEarth: 40,      // 地胡
  blessingOfHeaven: 50,     // 天胡
};

function scoreHand(state, cfg = DEFAULT_SCORING) {
  if (!state.hu) return { fans: [], totalPoints: 0, dealer: state.dealer, winner: null };
  const winner = state.hu.winner;
  const hand = state.hands[winner];
  const melds = state.melds[winner];
  const flowers = state.flowers[winner];
  const selfDraw = state.hu.selfDraw;
  const goldenKey = state.goldenKey;
  const decomp = decomposeHand(hand, melds, goldenKey);

  const fans = [];
  const base = cfg.basePoints;

  // --- Flower points ---
  const flowerCount = flowers.length;
  const flowerPts = flowerCount * cfg.flowerPerTile;

  // --- Gold count (all golds in concealed hand; exposed melds never contain gold) ---
  let goldCount = 0;
  for (const t of hand) if (goldenKey && tileKey(t) === goldenKey) goldCount++;
  const goldPts = goldCount * cfg.goldPerTile;

  // --- Dealer continuation ---
  const dealerCont = (winner === state.dealer) ? (state.dealerStreak || 0) * cfg.dealerContinuationPerHand : 0;

  // --- Kong points ---
  let kongPts = 0;
  for (const m of melds) {
    if (m.type === 'kong') kongPts += m.concealed ? cfg.concealedKong : cfg.openKong;
  }

  // --- Special hands ---
  let special = 0;
  const addSpecial = (name, value) => { if (value > 0) { special += value; fans.push({ name, value, special: true }); } };

  // Blessing / Robbing — mutually exclusive
  if (state.hu.blessing === 'heaven') addSpecial('天胡 Blessing of Heaven', cfg.blessingOfHeaven);
  else if (state.hu.blessing === 'earth') addSpecial('地胡 Blessing of Earth', cfg.blessingOfEarth);
  else if (state.hu.robbingGold) addSpecial('抢金 Robbing the Gold', cfg.robbingTheGold);

  // All Sequences (平胡) — no pungs or kongs anywhere
  if (decomp.ok) {
    const allPungLike = [
      ...decomp.concealedSets.map((s) => s.type),
      ...melds.map((m) => m.type === 'chow' ? 'chow' : 'pung'),
    ];
    if (allPungLike.length > 0 && allPungLike.every((t) => t === 'chow')) {
      addSpecial('平胡 All Sequences', cfg.allSequences);
    }
  }

  // One Flower
  if (flowerCount === 1) addSpecial('只有一张花 One Flower', cfg.oneFlower);

  // Golden Pair / Golden Dragon / Three Gold Knockdown (mutually exclusive at 3 golds)
  if (decomp.ok && decomp.pair && decomp.pair.wilds === 2 && goldCount === 2) {
    addSpecial('金雀 Golden Pair', cfg.goldenPair);
  } else if (goldCount >= 3) {
    let asTriplet = false;
    if (decomp.ok) {
      for (const s of decomp.concealedSets) {
        if (s.type === 'pung' && s.wilds === 3) { asTriplet = true; break; }
      }
    }
    if (asTriplet) addSpecial('金龙 Golden Dragon', cfg.goldenDragon);
    else addSpecial('三金倒 Three Gold Knockdown', cfg.threeGoldKnockdown);
  }

  // Full Bloom: all 4 flowers of same category (flowers-f or seasons-z) OR 4-of-a-kind of same wind/dragon.
  const fCount = flowers.filter((t) => t.suit === 'f').length;
  const zCount = flowers.filter((t) => t.suit === 'z').length;
  let fullBlooms = 0;
  if (fCount === 4) fullBlooms++;
  if (zCount === 4) fullBlooms++;
  // 4-of-a-kind honors across hand + melds
  const honorCounts = {};
  for (const t of hand) if (t.suit === 'w' || t.suit === 'd') honorCounts[tileKey(t)] = (honorCounts[tileKey(t)] || 0) + 1;
  for (const m of melds) for (const t of m.tiles) if (t.suit === 'w' || t.suit === 'd') honorCounts[tileKey(t)] = (honorCounts[tileKey(t)] || 0) + 1;
  for (const c of Object.values(honorCounts)) if (c >= 4) fullBlooms++;
  for (let i = 0; i < fullBlooms; i++) addSpecial('花大开 Full Bloom', cfg.fullBloom);

  // --- Formula ---
  const multiplierSum = base + flowerPts + goldPts + dealerCont + kongPts;
  const multiplied = multiplierSum * 2;
  const totalPoints = multiplied + special;

  // Summary fans shown in UI (base + components first, then specials)
  const breakdown = [
    { name: '基础 Base', value: base },
    ...(flowerPts ? [{ name: `花 Flowers ×${flowerCount}`, value: flowerPts }] : []),
    ...(goldPts ? [{ name: `金 Gold ×${goldCount}`, value: goldPts }] : []),
    ...(dealerCont ? [{ name: `连庄 Dealer Cont. ×${state.dealerStreak}`, value: dealerCont }] : []),
    ...(kongPts ? [{ name: `杠 Kong`, value: kongPts }] : []),
  ];

  return {
    fans: [...breakdown, ...fans],
    breakdown,
    specials: fans,
    base, flowerPts, goldPts, dealerCont, kongPts,
    multiplierSum, multiplied, special,
    totalFans: totalPoints, totalPoints,
    dealer: state.dealer,
    winner,
    from: state.hu.from,
    selfDraw,
    decomp,
  };
}

// Payment: self-draw = everyone pays winner; discard-pay = only discarder pays.
function paymentDeltas(result, state) {
  const deltas = [0, 0, 0, 0];
  if (!result || result.winner == null) return { deltas };
  const pts = result.totalPoints;
  const winner = result.winner;
  if (result.selfDraw) {
    for (let i = 0; i < 4; i++) {
      if (i === winner) continue;
      deltas[i] -= pts;
      deltas[winner] += pts;
    }
  } else {
    deltas[result.from] -= pts;
    deltas[winner] += pts;
  }
  return { deltas };
}

Object.assign(window, { DEFAULT_SCORING, scoreHand, paymentDeltas });
