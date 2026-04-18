// Mahjong game engine — Fuzhou ruleset
// Core concepts: wall, hand, melds (exposed sets), discards, turn state
// Claims: Chi (run, from left player only), Pong (triplet, any), Kong (quadruplet), Hu (win)

// Seed-able RNG
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newGame({ seed = Date.now(), dealer = 0, roundWind = 'E', seatWinds = ['E', 'S', 'W', 'N'], dealerStreak = 0 } = {}) {
  const rng = mkRng(seed);
  const wall = shuffle(buildWallSpec(), rng);
  const hands = [[], [], [], []];
  const flowers = [[], [], [], []];
  // Fuzhou: 16 tiles each, dealer gets 17th
  for (let i = 0; i < 16; i++) {
    for (let p = 0; p < 4; p++) hands[p].push(wall.shift());
  }
  hands[dealer].push(wall.shift());

  // Reveal flowers & replace (Fuzhou custom: dealer first, then counter-clockwise)
  const replaceFlowers = (p) => {
    for (let i = hands[p].length - 1; i >= 0; i--) {
      const t = hands[p][i];
      if (isFlower(t)) {
        flowers[p].push(hands[p].splice(i, 1)[0]);
      }
    }
    while (true) {
      const needed = (p === dealer ? 17 : 16) - hands[p].length;
      if (needed <= 0) break;
      const t = wall.pop();
      if (!t) break;
      if (isFlower(t)) flowers[p].push(t);
      else hands[p].push(t);
    }
  };
  for (let i = 0; i < 4; i++) replaceFlowers((dealer + i) % 4);

  // Golden tile: flip indicator, next-in-sequence is the wild
  const indicatorIdx = Math.floor(rng() * wall.length);
  const indicator = wall[indicatorIdx];
  const goldenKey = nextTileKey(indicator);

  const state = {
    wall, hands, flowers,
    melds: [[], [], [], []],
    discards: [[], [], [], []],
    turn: dealer, dealer, roundWind, seatWinds,
    phase: 'discard',
    lastDiscard: null, lastDrawn: null, justDiscarded: false,
    hu: null, kongPending: null,
    log: [],
    indicator, goldenKey,
    instantPoints: [0, 0, 0, 0],
    dealerStreak,
    discardCount: 0,
    claimsMade: 0,
    selfDrawOnly: [false, false, false, false],
  };

  // Blessing of Heaven: dealer's initial 17 tiles form a winning hand
  if (isWinningHand(hands[dealer], 0, goldenKey)) {
    state.hu = { winner: dealer, from: dealer, tile: hands[dealer][hands[dealer].length - 1], selfDraw: true, blessing: 'heaven' };
    state.phase = 'end';
    state.log.push(`${seatName(dealer)} 天胡！`);
    return state;
  }

  // Robbing the Gold: non-dealer whose 16 tiles + one gold forms a winning hand
  // Priority: nearest to dealer CCW.
  const goldSuit = goldenKey[0];
  const goldRest = goldenKey.slice(1);
  const goldN = (goldSuit === 'm' || goldSuit === 'p' || goldSuit === 's') ? parseInt(goldRest) : goldRest;
  for (let i = 1; i < 4; i++) {
    const p = (dealer + i) % 4;
    const fakeGold = { suit: goldSuit, n: goldN, id: `robbed_gold_${p}` };
    if (isWinningHand([...hands[p], fakeGold], 0, goldenKey)) {
      hands[p].push(fakeGold);
      state.hu = { winner: p, from: p, tile: fakeGold, selfDraw: true, robbingGold: true };
      state.phase = 'end';
      state.log.push(`${seatName(p)} 抢金！`);
      return state;
    }
  }

  return state;
}

// What's the "next" tile key for the golden indicator?
function nextTileKey(t) {
  if (t.suit === 'm' || t.suit === 'p' || t.suit === 's') {
    return `${t.suit}${t.n === 9 ? 1 : t.n + 1}`;
  }
  if (t.suit === 'w') {
    const order = ['E','S','W','N'];
    return `w${order[(order.indexOf(t.n) + 1) % 4]}`;
  }
  if (t.suit === 'd') {
    const order = ['R','G','W'];
    return `d${order[(order.indexOf(t.n) + 1) % 3]}`;
  }
  // flowers: golden falls back to a honor
  return 'dR';
}

function isGolden(t, goldenKey) { return t && tileKey(t) === goldenKey; }

// --- Hand analysis: can these 14 tiles (concealed + melded count) form a winning hand? ---
// A winning hand is 4 sets + 1 pair. A set is a pung (3 same) or chow (3 consecutive same suit).
// Honors cannot form chows.

function countMap(tiles) {
  const m = new Map();
  for (const t of tiles) {
    const k = tileKey(t);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function canFormSets(countObj, needed) {
  // countObj: plain object {key: count}. needed: number of sets required.
  if (needed === 0) {
    return Object.values(countObj).every((v) => v === 0);
  }
  // Find first non-zero tile
  const keys = Object.keys(countObj).sort();
  let firstKey = null;
  for (const k of keys) if (countObj[k] > 0) { firstKey = k; break; }
  if (!firstKey) return true;
  // Try pung
  if (countObj[firstKey] >= 3) {
    countObj[firstKey] -= 3;
    if (canFormSets(countObj, needed - 1)) { countObj[firstKey] += 3; return true; }
    countObj[firstKey] += 3;
  }
  // Try chow (only for suits m/p/s, needs firstKey, +1, +2)
  const suit = firstKey[0];
  if (suit === 'm' || suit === 'p' || suit === 's') {
    const n = parseInt(firstKey.slice(1));
    if (n <= 7) {
      const k2 = `${suit}${n+1}`, k3 = `${suit}${n+2}`;
      if ((countObj[k2] || 0) > 0 && (countObj[k3] || 0) > 0) {
        countObj[firstKey]--; countObj[k2]--; countObj[k3]--;
        if (canFormSets(countObj, needed - 1)) {
          countObj[firstKey]++; countObj[k2]++; countObj[k3]++;
          return true;
        }
        countObj[firstKey]++; countObj[k2]++; countObj[k3]++;
      }
    }
  }
  return false;
}

function isWinningHand(tiles, exposedSetCount = 0, goldenKey = null) {
  const needSets = 5 - exposedSetCount;
  const targetLen = 2 + needSets * 3;
  if (tiles.length !== targetLen) return false;
  // Separate wilds
  let wilds = 0;
  const regular = [];
  for (const t of tiles) {
    if (goldenKey && tileKey(t) === goldenKey) wilds++;
    else regular.push(t);
  }
  const counts = {};
  for (const t of regular) {
    const k = tileKey(t);
    counts[k] = (counts[k] || 0) + 1;
  }
  // Try each pair candidate (including wild pair)
  const tryPair = (pairKey, wildUsedForPair) => {
    const remainWilds = wilds - wildUsedForPair;
    return canFormSetsWild(counts, needSets, remainWilds);
  };
  // Pair from regular
  for (const k of Object.keys(counts)) {
    if (counts[k] >= 2) {
      counts[k] -= 2;
      if (canFormSetsWild(counts, needSets, wilds)) { counts[k] += 2; return true; }
      counts[k] += 2;
    }
    // Pair with 1 regular + 1 wild
    if (counts[k] >= 1 && wilds >= 1) {
      counts[k] -= 1;
      if (canFormSetsWild(counts, needSets, wilds - 1)) { counts[k] += 1; return true; }
      counts[k] += 1;
    }
  }
  // Pair from 2 wilds
  if (wilds >= 2) {
    if (canFormSetsWild(counts, needSets, wilds - 2)) return true;
  }
  return false;
}

function canFormSetsWild(counts, needed, wilds) {
  if (needed === 0) {
    return wilds === 0 && Object.values(counts).every((v) => v === 0);
  }
  const keys = Object.keys(counts).sort();
  let firstKey = null;
  for (const k of keys) if (counts[k] > 0) { firstKey = k; break; }
  if (!firstKey) {
    // Use wilds as pungs
    if (wilds >= 3) return canFormSetsWild(counts, needed - 1, wilds - 3);
    return false;
  }
  // Pung from regulars
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormSetsWild(counts, needed - 1, wilds)) { counts[firstKey] += 3; return true; }
    counts[firstKey] += 3;
  }
  // Pung with 2 reg + 1 wild
  if (counts[firstKey] >= 2 && wilds >= 1) {
    counts[firstKey] -= 2;
    if (canFormSetsWild(counts, needed - 1, wilds - 1)) { counts[firstKey] += 2; return true; }
    counts[firstKey] += 2;
  }
  // Pung with 1 reg + 2 wild
  if (counts[firstKey] >= 1 && wilds >= 2) {
    counts[firstKey] -= 1;
    if (canFormSetsWild(counts, needed - 1, wilds - 2)) { counts[firstKey] += 1; return true; }
    counts[firstKey] += 1;
  }
  // Chow (suits only)
  const suit = firstKey[0];
  if (suit === 'm' || suit === 'p' || suit === 's') {
    const n = parseInt(firstKey.slice(1));
    if (n <= 7) {
      const k2 = `${suit}${n+1}`, k3 = `${suit}${n+2}`;
      for (let w2 = 0; w2 <= 1; w2++) for (let w3 = 0; w3 <= 1; w3++) {
        const need2 = 1 - w2, need3 = 1 - w3;
        const have2 = (counts[k2] || 0), have3 = (counts[k3] || 0);
        if (have2 >= need2 && have3 >= need3 && wilds >= w2 + w3) {
          counts[firstKey]--;
          if (need2) counts[k2]--;
          if (need3) counts[k3]--;
          if (canFormSetsWild(counts, needed - 1, wilds - w2 - w3)) {
            counts[firstKey]++;
            if (need2) counts[k2]++;
            if (need3) counts[k3]++;
            return true;
          }
          counts[firstKey]++;
          if (need2) counts[k2]++;
          if (need3) counts[k3]++;
        }
      }
    }
  }
  return false;
}

// Decompose a winning hand into its sets for scoring.
// Fuzhou: 5 sets + 1 pair (17 tiles). Handles gold tiles as wildcards.
// Returns { ok, pair: {key, tile, wilds}, concealedSets: [{type, key, wilds}], melds }
function decomposeHand(tiles, melds, goldenKey = null) {
  const exposedCount = melds.length;
  const needSets = 5 - exposedCount;

  // Separate gold tiles; they'll be placed as wilds
  let golds = 0;
  const regular = [];
  for (const t of tiles) {
    if (goldenKey && tileKey(t) === goldenKey) golds++;
    else regular.push(t);
  }
  const counts = {};
  const tileByKey = {};
  for (const t of regular) {
    const k = tileKey(t);
    counts[k] = (counts[k] || 0) + 1;
    if (!tileByKey[k]) tileByKey[k] = t;
  }

  function findSets(countObj, remainWilds, acc) {
    if (acc.length === needSets) {
      const allZero = Object.values(countObj).every((v) => v === 0);
      return (allZero && remainWilds === 0) ? [...acc] : null;
    }
    const keys = Object.keys(countObj).sort();
    let firstKey = null;
    for (const k of keys) if (countObj[k] > 0) { firstKey = k; break; }
    if (!firstKey) {
      // No regulars left — consume wilds as pung triplets
      if (remainWilds >= 3) {
        return findSets(countObj, remainWilds - 3, [...acc, { type: 'pung', key: 'GOLD', wilds: 3 }]);
      }
      return null;
    }
    // Pung with 0–3 wilds
    for (let w = 0; w <= 3; w++) {
      const needReg = 3 - w;
      if (w > remainWilds || countObj[firstKey] < needReg) continue;
      countObj[firstKey] -= needReg;
      const r = findSets(countObj, remainWilds - w, [...acc, { type: 'pung', key: firstKey, wilds: w }]);
      countObj[firstKey] += needReg;
      if (r) return r;
    }
    // Chow (suits only)
    const suit = firstKey[0];
    if (suit === 'm' || suit === 'p' || suit === 's') {
      const n = parseInt(firstKey.slice(1));
      if (n <= 7) {
        const k2 = `${suit}${n+1}`, k3 = `${suit}${n+2}`;
        for (let w2 = 0; w2 <= 1; w2++) for (let w3 = 0; w3 <= 1; w3++) {
          const used = w2 + w3;
          if (used > remainWilds) continue;
          const have2 = countObj[k2] || 0, have3 = countObj[k3] || 0;
          if ((w2 === 0 && have2 < 1) || (w3 === 0 && have3 < 1)) continue;
          countObj[firstKey]--;
          if (w2 === 0) countObj[k2]--;
          if (w3 === 0) countObj[k3]--;
          const r = findSets(countObj, remainWilds - used, [...acc, { type: 'chow', key: firstKey, wilds: used }]);
          countObj[firstKey]++;
          if (w2 === 0) countObj[k2]++;
          if (w3 === 0) countObj[k3]++;
          if (r) return r;
        }
      }
    }
    return null;
  }

  // Try pair from regular pair
  for (const pk of Object.keys(counts)) {
    if (counts[pk] >= 2) {
      counts[pk] -= 2;
      const sets = findSets(counts, golds, []);
      counts[pk] += 2;
      if (sets) return { ok: true, pair: { key: pk, tile: tileByKey[pk], wilds: 0 }, concealedSets: sets, melds };
    }
    // Pair = 1 regular + 1 wild
    if (counts[pk] >= 1 && golds >= 1) {
      counts[pk] -= 1;
      const sets = findSets(counts, golds - 1, []);
      counts[pk] += 1;
      if (sets) return { ok: true, pair: { key: pk, tile: tileByKey[pk], wilds: 1 }, concealedSets: sets, melds };
    }
  }
  // Pair = 2 wilds (Golden Pair)
  if (golds >= 2) {
    const sets = findSets(counts, golds - 2, []);
    if (sets) return { ok: true, pair: { key: 'GOLD', tile: null, wilds: 2 }, concealedSets: sets, melds };
  }
  return { ok: false };
}

// Available claims when a tile is discarded.
// Fuzhou: gold tile cannot be claimed for Chi/Pong/Kong. Hu-by-claim is blocked
// for players who've discarded a gold earlier (selfDrawOnly).
function availableClaims(state, discardedTile, fromPlayer) {
  const claims = [];
  const isGold = state.goldenKey && tileKey(discardedTile) === state.goldenKey;
  for (let p = 0; p < 4; p++) {
    if (p === fromPlayer) continue;
    const hand = state.hands[p];
    // Hu (放炮) — even on a discarded gold, winning-via-claim is allowed unless the claimant previously discarded gold.
    if (!state.selfDrawOnly[p]) {
      const test = [...hand, discardedTile];
      if (isWinningHand(test, state.melds[p].length, state.goldenKey)) {
        claims.push({ player: p, type: 'hu', tile: discardedTile, from: fromPlayer });
      }
    }
    if (isGold) continue; // Gold cannot form Chi/Pong/Kong from a discard
    const same = hand.filter((t) => tileKey(t) === tileKey(discardedTile));
    if (same.length >= 2) {
      claims.push({ player: p, type: 'pong', tile: discardedTile, from: fromPlayer });
    }
    if (same.length >= 3) {
      claims.push({ player: p, type: 'kong', tile: discardedTile, from: fromPlayer });
    }
    if ((fromPlayer + 1) % 4 === p && (discardedTile.suit === 'm' || discardedTile.suit === 'p' || discardedTile.suit === 's')) {
      const n = discardedTile.n;
      const has = (k) => hand.some((t) => tileKey(t) === k);
      const chows = [];
      if (n >= 3 && has(`${discardedTile.suit}${n-2}`) && has(`${discardedTile.suit}${n-1}`)) chows.push([n-2, n-1]);
      if (n >= 2 && n <= 8 && has(`${discardedTile.suit}${n-1}`) && has(`${discardedTile.suit}${n+1}`)) chows.push([n-1, n+1]);
      if (n <= 7 && has(`${discardedTile.suit}${n+1}`) && has(`${discardedTile.suit}${n+2}`)) chows.push([n+1, n+2]);
      for (const [a, b] of chows) {
        claims.push({ player: p, type: 'chi', tile: discardedTile, from: fromPlayer, chow: [a, b] });
      }
    }
  }
  return claims;
}

// Apply claim (mutating state). Returns new state.
function applyClaim(state, claim) {
  const s = { ...state, hands: state.hands.map(h => [...h]), melds: state.melds.map(m => [...m]), discards: state.discards.map(d => [...d]), flowers: state.flowers.map(f => [...f]), instantPoints: [...state.instantPoints], selfDrawOnly: [...state.selfDrawOnly] };
  if (claim.type !== 'hu') s.claimsMade = (s.claimsMade || 0) + 1;
  const p = claim.player;
  const tile = claim.tile;

  // Remove the discarded tile from the pond of `from`
  const pond = s.discards[claim.from];
  const idx = pond.findIndex((t) => t.id === tile.id);
  if (idx >= 0) pond.splice(idx, 1);

  if (claim.type === 'chi') {
    const [a, b] = claim.chow;
    const suit = tile.suit;
    const remove = (k) => {
      const i = s.hands[p].findIndex((t) => tileKey(t) === k);
      return s.hands[p].splice(i, 1)[0];
    };
    const t1 = remove(`${suit}${a}`);
    const t2 = remove(`${suit}${b}`);
    const meldTiles = [t1, tile, t2].sort((x, y) => tileSortVal(x) - tileSortVal(y));
    s.melds[p].push({ type: 'chow', tiles: meldTiles, from: claim.from, takenTile: tile });
    s.phase = 'discard';
    s.turn = p;
    s.log.push(`${seatName(p)} 吃 ${tileDesc(tile)}`);
  } else if (claim.type === 'pong') {
    const sameIdx = [];
    s.hands[p].forEach((t, i) => { if (tileKey(t) === tileKey(tile) && sameIdx.length < 2) sameIdx.push(i); });
    const taken = sameIdx.sort((a, b) => b - a).map((i) => s.hands[p].splice(i, 1)[0]);
    s.melds[p].push({ type: 'pung', tiles: [...taken, tile], from: claim.from, takenTile: tile });
    s.phase = 'discard';
    s.turn = p;
    s.log.push(`${seatName(p)} 碰 ${tileDesc(tile)}`);
  } else if (claim.type === 'kong') {
    const sameIdx = [];
    s.hands[p].forEach((t, i) => { if (tileKey(t) === tileKey(tile) && sameIdx.length < 3) sameIdx.push(i); });
    const taken = sameIdx.sort((a, b) => b - a).map((i) => s.hands[p].splice(i, 1)[0]);
    s.melds[p].push({ type: 'kong', tiles: [...taken, tile], from: claim.from, concealed: false, takenTile: tile });
    // Kong instant-pay: exposed kong = 1 pt from discarder; concealed = 1 pt from all (handled elsewhere)
    s.instantPoints[p] = (s.instantPoints[p] || 0) + 1;
    s.instantPoints[claim.from] = (s.instantPoints[claim.from] || 0) - 1;
    // Draw replacement, handling flowers
    while (s.wall.length > 0) {
      const t2 = s.wall.pop();
      if (isFlower(t2)) { s.flowers[p].push(t2); s.instantPoints[p]++; continue; }
      s.hands[p].push(t2);
      s.lastDrawn = { player: p, tile: t2, afterKong: true };
      break;
    }
    s.phase = 'discard';
    s.turn = p;
    s.log.push(`${seatName(p)} 杠 ${tileDesc(tile)}`);
  } else if (claim.type === 'hu') {
    // Win by claim (放炮)
    s.hands[p].push(tile);
    s.hu = { winner: p, from: claim.from, tile, selfDraw: false };
    s.phase = 'end';
  }
  return s;
}

function seatName(p) { return ['東', '南', '西', '北'][p]; }
function tileDesc(t) {
  const l = tileLabel(t);
  if (t.suit === 'm' || t.suit === 'p' || t.suit === 's') return `${t.n}${l.bot}`;
  return l.top || (t.suit + t.n);
}

function drawTile(state, player) {
  const s = { ...state, hands: state.hands.map(h => [...h]), flowers: state.flowers.map(f => [...f]), wall: [...state.wall] };
  while (s.wall.length > 0) {
    const t = s.wall.pop();
    if (isFlower(t)) {
      s.flowers[player].push(t);
      s.log.push(`${seatName(player)} 補花 ${tileLabel(t).top}`);
      continue;
    }
    s.hands[player].push(t);
    s.lastDrawn = { player, tile: t, afterKong: false };
    s.phase = 'discard';
    return s;
  }
  s.phase = 'end';
  s.log.push('流局');
  return s;
}

function discardTile(state, player, tileId) {
  const s = { ...state, hands: state.hands.map(h => [...h]), discards: state.discards.map(d => [...d]), selfDrawOnly: [...state.selfDrawOnly] };
  const idx = s.hands[player].findIndex((t) => t.id === tileId);
  if (idx < 0) return state;
  const t = s.hands[player].splice(idx, 1)[0];
  s.discards[player].push(t);
  s.lastDiscard = { tile: t, from: player };
  s.phase = 'claim';
  s.justDiscarded = true;
  s.lastDrawn = null;
  s.discardCount = (s.discardCount || 0) + 1;
  // Discarding a gold tile: discarder can only win by self-draw for the rest of the hand
  if (s.goldenKey && tileKey(t) === s.goldenKey) {
    s.selfDrawOnly[player] = true;
    s.log.push(`${seatName(player)} 打金 — 只能自摸`);
  }
  return s;
}

function advanceTurn(state) {
  const s = { ...state };
  s.turn = (s.turn + 1) % 4;
  s.phase = 'draw';
  s.lastDiscard = null;
  return s;
}

// Concealed kong or added kong (from own hand after drawing)
function selfKongOptions(state, player) {
  const opts = [];
  if (state.turn !== player) return opts;
  const counts = new Map();
  const byKey = {};
  for (const t of state.hands[player]) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(t);
  }
  // Concealed kong: 4 of a kind in hand
  for (const [k, c] of counts.entries()) {
    if (c === 4) opts.push({ type: 'concealed-kong', key: k, tiles: byKey[k] });
  }
  // Added kong: tile in hand matches existing exposed pung
  for (const meld of state.melds[player]) {
    if (meld.type === 'pung') {
      const k = tileKey(meld.tiles[0]);
      if (counts.get(k) === 1) {
        opts.push({ type: 'added-kong', key: k, meld });
      }
    }
  }
  return opts;
}

function applySelfKong(state, player, opt) {
  const s = { ...state, hands: state.hands.map(h => [...h]), flowers: state.flowers.map(f => [...f]), melds: state.melds.map(m => [...m]), wall: [...state.wall], instantPoints: [...state.instantPoints] };
  if (opt.type === 'concealed-kong') {
    const tiles = [];
    for (let i = s.hands[player].length - 1; i >= 0; i--) {
      if (tileKey(s.hands[player][i]) === opt.key) tiles.push(s.hands[player].splice(i, 1)[0]);
    }
    s.melds[player].push({ type: 'kong', tiles, concealed: true });
    // Concealed kong: 2 points instant from each opponent
    for (let i = 0; i < 4; i++) if (i !== player) { s.instantPoints[i] -= 2; s.instantPoints[player] += 2; }
    s.log.push(`${seatName(player)} 暗杠`);
  } else {
    const k = opt.key;
    const idx = s.hands[player].findIndex((t) => tileKey(t) === k);
    const t = s.hands[player].splice(idx, 1)[0];
    const meldIdx = s.melds[player].findIndex((m) => m === opt.meld);
    const old = s.melds[player][meldIdx];
    s.melds[player][meldIdx] = { ...old, type: 'kong', tiles: [...old.tiles, t], added: true };
    for (let i = 0; i < 4; i++) if (i !== player) { s.instantPoints[i] -= 1; s.instantPoints[player] += 1; }
    s.log.push(`${seatName(player)} 加杠`);
  }
  while (s.wall.length > 0) {
    const t2 = s.wall.pop();
    if (isFlower(t2)) { s.flowers[player].push(t2); s.instantPoints[player]++; continue; }
    s.hands[player].push(t2);
    s.lastDrawn = { player, tile: t2, afterKong: true };
    break;
  }
  s.phase = 'discard';
  return s;
}

function canDeclareHu(state, player) {
  const hand = state.hands[player];
  const exposedCount = state.melds[player].length;
  const targetLen = 2 + (5 - exposedCount) * 3;
  if (hand.length !== targetLen) return false;
  return isWinningHand(hand, exposedCount, state.goldenKey);
}

function declareHu(state, player) {
  const s = { ...state };
  const huTile = s.hands[player][s.hands[player].length - 1];
  let blessing = null;
  // Blessing of Earth: non-dealer wins on their first draw with no prior claims and only dealer's first discard
  if (player !== s.dealer && s.discardCount === 1 && (s.claimsMade || 0) === 0) {
    blessing = 'earth';
    s.log.push(`${seatName(player)} 地胡！`);
  }
  s.hu = { winner: player, from: player, tile: huTile, selfDraw: true, blessing };
  s.phase = 'end';
  return s;
}

Object.assign(window, {
  mkRng, shuffle, newGame,
  isWinningHand, decomposeHand, nextTileKey, isGolden,
  availableClaims, applyClaim,
  drawTile, discardTile, advanceTurn,
  selfKongOptions, applySelfKong,
  canDeclareHu, declareHu,
  seatName, tileDesc,
});
