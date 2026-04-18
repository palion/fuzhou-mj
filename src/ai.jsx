// Intermediate-strength AI for Fuzhou Mahjong
// Strategy: evaluate hand efficiency (shanten), prefer keeping honors/pairs/pungs, discard isolated tiles
// Also supports personalities that bias toward aggression/defense/speed/style

const AI_PERSONALITIES = {
  balanced: { name: 'Balanced', agg: 0.5, defense: 0.5, speed: 0.5, style: 'normal' },
  aggressive: { name: 'Aggressive', agg: 0.9, defense: 0.2, speed: 0.7, style: 'big-hand' },
  defensive: { name: 'Defensive', agg: 0.2, defense: 0.9, speed: 0.4, style: 'safe' },
  speedy: { name: 'Speedy', agg: 0.6, defense: 0.3, speed: 0.95, style: 'fast-win' },
};

// Count how many useful neighbors each tile has
function tileUsefulness(tile, hand) {
  let u = 0;
  const k = tileKey(tile);
  const same = hand.filter((t) => tileKey(t) === k).length;
  u += same * 3; // pairs/triplets
  if (['m', 'p', 's'].includes(tile.suit)) {
    for (let d = 1; d <= 2; d++) {
      const near = hand.filter((t) => t.suit === tile.suit && Math.abs(t.n - tile.n) === d).length;
      u += near * (3 - d);
    }
  } else {
    // honors: useful only if pairs/triplets possible
    if (same >= 1) u += 2;
  }
  return u;
}

// Estimate shanten (distance to winning) — simplified count of completed/partial sets
function estimateShanten(hand, melds) {
  // Count pairs and partial sets
  const counts = {};
  for (const t of hand) counts[tileKey(t)] = (counts[tileKey(t)] || 0) + 1;
  let pairs = 0, triplets = 0, partials = 0;
  for (const [k, c] of Object.entries(counts)) {
    if (c >= 3) { triplets++; }
    else if (c === 2) { pairs++; }
    // partial runs
  }
  // Partial runs in number suits
  for (const suit of ['m', 'p', 's']) {
    for (let n = 1; n <= 9; n++) {
      const a = counts[`${suit}${n}`] || 0;
      const b = counts[`${suit}${n+1}`] || 0;
      if (a > 0 && b > 0) partials++;
    }
  }
  // Fuzhou: 5 sets + 1 pair
  const setsNeeded = 5 - melds.length - triplets;
  return Math.max(0, setsNeeded * 2 - pairs - partials);
}

function chooseDiscard(state, player, personality = AI_PERSONALITIES.balanced) {
  const hand = state.hands[player];
  // Safety: tiles already discarded by others are "safe" against those players
  const allDiscards = state.discards.flat();
  const safetyScore = (t) => allDiscards.filter((d) => tileKey(d) === tileKey(t)).length;

  // Rank tiles by keep-value (higher = keep). Discard the lowest.
  const ranked = hand.map((t, i) => {
    const u = tileUsefulness(t, hand);
    // For aggressive play, prefer keeping honors for big hands
    const honorBonus = (t.suit === 'd' || t.suit === 'w') ? (personality.agg > 0.7 ? 2 : 0.5) : 0;
    // Defensive: prefer discarding "dangerous" (not seen) tiles LAST → we subtract safety from keep score
    const danger = personality.defense > 0.6 ? (4 - safetyScore(t)) * 0.3 : 0;
    const keepScore = u + honorBonus - danger;
    return { i, t, keepScore };
  });
  ranked.sort((a, b) => a.keepScore - b.keepScore);
  // Discard lowest keep-value tile
  return ranked[0].t;
}

function decideClaim(claims, state, personality = AI_PERSONALITIES.balanced) {
  // Given available claims for a player, decide whether to claim.
  // Priority: Hu > Kong > Pong > Chi. Personality tilts.
  if (!claims.length) return null;
  // Hu: always take (unless very defensive and tiny fan maybe, but here: always take)
  const hu = claims.find((c) => c.type === 'hu');
  if (hu) return hu;
  const kong = claims.find((c) => c.type === 'kong');
  const pong = claims.find((c) => c.type === 'pong');
  const chi = claims.find((c) => c.type === 'chi');

  const player = claims[0].player;
  const hand = state.hands[player];
  const shanten = estimateShanten(hand, state.melds[player]);

  if (kong && personality.speed > 0.5) return kong;
  if (pong) {
    // Take pong if speeds us up or hand is focused on pungs (5-set Fuzhou raises threshold)
    const keepExposed = personality.agg > 0.3 && shanten <= 7;
    if (keepExposed) return pong;
  }
  if (chi && personality.speed > 0.6 && shanten <= 6) {
    return chi;
  }
  return null; // pass
}

function decideSelfKong(opts, state, player, personality) {
  if (!opts.length) return null;
  // Concealed kong usually good
  const concealed = opts.find((o) => o.type === 'concealed-kong');
  if (concealed) return concealed;
  // Added kong: only if we're safely ahead
  if (personality.speed > 0.6) return opts[0];
  return null;
}

Object.assign(window, { AI_PERSONALITIES, chooseDiscard, decideClaim, decideSelfKong, estimateShanten });
