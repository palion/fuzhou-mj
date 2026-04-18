// Tile definitions and rendering for Fuzhou Mahjong
// Suits: m=万 (character), p=饼/筒 (dots), s=条 (bamboo)
// Honors: wind (E/S/W/N), dragon (R/G/W = 中/發/白)
// Each tile has 4 copies in the wall.

const SUITS = {
  m: { name: '萬', color: '#1a1a1a' },
  p: { name: '筒', color: '#1a1a1a' },
  s: { name: '條', color: '#1a5b2e' },
};

const WINDS = { E: '東', S: '南', W: '西', N: '北' };
const DRAGONS = { R: '中', G: '發', W: '白' };

// Fuzhou: 144 tiles — 3 suits × 9 × 4 + 4 winds × 4 + 3 dragons × 4 + 8 flowers
const FLOWERS = { 1: '梅', 2: '蘭', 3: '菊', 4: '竹' }; // plum/orchid/chrysanthemum/bamboo
const SEASONS = { 1: '春', 2: '夏', 3: '秋', 4: '冬' }; // spring/summer/autumn/winter
function buildWallSpec() {
  const spec = [];
  for (const suit of ['m', 'p', 's']) {
    for (let n = 1; n <= 9; n++) {
      for (let c = 0; c < 4; c++) spec.push({ suit, n, id: `${suit}${n}_${c}` });
    }
  }
  for (const w of Object.keys(WINDS)) {
    for (let c = 0; c < 4; c++) spec.push({ suit: 'w', n: w, id: `w${w}_${c}` });
  }
  for (const d of Object.keys(DRAGONS)) {
    for (let c = 0; c < 4; c++) spec.push({ suit: 'd', n: d, id: `d${d}_${c}` });
  }
  for (const n of [1,2,3,4]) spec.push({ suit: 'f', n, id: `f${n}` });
  for (const n of [1,2,3,4]) spec.push({ suit: 'z', n, id: `z${n}` });
  return spec;
}
function isFlower(t) { return t && (t.suit === 'f' || t.suit === 'z'); }

function tileKey(t) {
  return `${t.suit}${t.n}`;
}

function tileLabel(t) {
  if (t.suit === 'm') return { top: String(t.n), bot: '萬', color: t.n === 1 || /[1-9]/.test(String(t.n)) ? (t.n % 2 === 0 ? '#1a1a1a' : '#b0302b') : '#1a1a1a' };
  if (t.suit === 'p') return { top: String(t.n), bot: '筒', color: '#1a1a1a' };
  if (t.suit === 's') return { top: String(t.n), bot: '條', color: '#1a5b2e' };
  if (t.suit === 'w') return { top: WINDS[t.n], bot: '', color: '#1a1a1a', big: true };
  if (t.suit === 'd') {
    const c = t.n === 'R' ? '#b0302b' : t.n === 'G' ? '#1a5b2e' : '#2a2a2a';
    const glyph = t.n === 'W' ? '  ' : DRAGONS[t.n];
    return { top: glyph, bot: '', color: c, big: true, isWhite: t.n === 'W' };
  }
  if (t.suit === 'f') return { top: FLOWERS[t.n], bot: '', color: '#b0302b', big: true };
  if (t.suit === 'z') return { top: SEASONS[t.n], bot: '', color: '#1a5b2e', big: true };
  return { top: '?', bot: '', color: '#000' };
}

// Sort order for hand display
function tileSortVal(t) {
  const suitOrder = { m: 0, p: 1, s: 2, w: 3, d: 4, f: 5, z: 6 };
  if (t.suit === 'w') {
    const o = { E: 0, S: 1, W: 2, N: 3 };
    return suitOrder[t.suit] * 100 + o[t.n];
  }
  if (t.suit === 'd') {
    const o = { R: 0, G: 1, W: 2 };
    return suitOrder[t.suit] * 100 + o[t.n];
  }
  return suitOrder[t.suit] * 100 + t.n;
}

function sortTiles(tiles) {
  return [...tiles].sort((a, b) => tileSortVal(a) - tileSortVal(b));
}

// Generic Tile component
function Tile({ tile, size = 'md', face = 'up', selected, dim, onClick, style, rotate, tilt, glow }) {
  const sizes = {
    xs: { w: 28, h: 38, font: 14, subfont: 8, r: 3 },
    sm: { w: 36, h: 50, font: 18, subfont: 10, r: 4 },
    md: { w: 46, h: 64, font: 22, subfont: 12, r: 5 },
    lg: { w: 56, h: 80, font: 28, subfont: 14, r: 6 },
    xl: { w: 64, h: 92, font: 32, subfont: 16, r: 7 },
  };
  const s = sizes[size] || sizes.md;
  const label = face === 'up' && tile ? tileLabel(tile) : null;
  const wrapStyle = {
    width: s.w, height: s.h,
    position: 'relative',
    transform: [
      rotate ? `rotate(${rotate}deg)` : '',
      selected ? 'translateY(-12px)' : '',
      tilt ? 'rotateX(8deg)' : '',
    ].filter(Boolean).join(' '),
    transition: 'transform .18s ease, box-shadow .18s ease',
    cursor: onClick ? 'pointer' : 'default',
    opacity: dim ? 0.55 : 1,
    ...style,
  };
  const faceStyle = face === 'up' ? {
    width: '100%', height: '100%',
    borderRadius: s.r,
    background: 'linear-gradient(180deg, #faf5e8 0%, #eadfc7 100%)',
    boxShadow: selected
      ? `0 10px 18px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.8), inset 0 -3px 0 #c9b894, 0 0 0 2px ${glow || 'rgba(82,190,128,.8)'}`
      : `0 3px 0 #a89671, 0 5px 10px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.8)`,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  } : {
    width: '100%', height: '100%',
    borderRadius: s.r,
    background: 'linear-gradient(135deg, #1c5a3a 0%, #103826 100%)',
    boxShadow: `0 3px 0 #0a2a1a, 0 5px 10px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.15)`,
    border: '1px solid #2a6a4a',
  };
  return (
    <div style={wrapStyle} onClick={onClick} className="mj-tile">
      <div style={faceStyle}>
        {label && (
          <>
            {/* top pip / number */}
            {tile.suit === 'p' ? <DotsGlyph n={tile.n} color={label.color} size={s.font * 1.4} /> :
             tile.suit === 's' ? <BambooGlyph n={tile.n} size={s.font * 1.5} /> :
             tile.suit === 'm' ? (
               <>
                 <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: s.font, color: label.color, fontWeight: 700, lineHeight: 1 }}>{label.top}</div>
                 <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: s.subfont * 1.6, color: label.color, marginTop: 2 }}>{label.bot}</div>
               </>
             ) : label.isWhite ? (
               <div style={{
                 width: '70%', height: '60%', border: `2px solid ${label.color}`, borderRadius: 2,
                 boxShadow: `inset 0 0 0 2px #faf5e8, inset 0 0 0 4px ${label.color}`,
               }} />
             ) : (
               <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: s.font * 1.3, color: label.color, fontWeight: 700, lineHeight: 1 }}>{label.top}</div>
             )}
          </>
        )}
      </div>
    </div>
  );
}

// Draw dots for 筒 tiles
function DotsGlyph({ n, color, size }) {
  const positions = {
    1: [[0.5, 0.5]],
    2: [[0.5, 0.25], [0.5, 0.75]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.3, 0.25], [0.7, 0.25], [0.3, 0.75], [0.7, 0.75]],
    5: [[0.3, 0.25], [0.7, 0.25], [0.5, 0.5], [0.3, 0.75], [0.7, 0.75]],
    6: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
    7: [[0.3, 0.15], [0.5, 0.15], [0.7, 0.15], [0.3, 0.5], [0.7, 0.5], [0.3, 0.85], [0.7, 0.85]],
    8: [[0.3, 0.18], [0.7, 0.18], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.3, 0.82], [0.7, 0.82]],
    9: [[0.25, 0.2], [0.5, 0.2], [0.75, 0.2], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.25, 0.8], [0.5, 0.8], [0.75, 0.8]],
  };
  const pts = positions[n] || [];
  const colors = {
    1: '#b0302b', 2: '#1a5b2e', 3: '#1a5b2e',
    4: '#b0302b', 5: '#1a1a1a', 6: '#1a5b2e',
    7: '#b0302b', 8: '#1a5b2e', 9: '#b0302b',
  };
  const c = colors[n];
  const dotSize = size * 0.16;
  return (
    <div style={{ position: 'relative', width: size * 0.8, height: size * 0.8 }}>
      {pts.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${p[0] * 100}%`, top: `${p[1] * 100}%`,
          width: dotSize, height: dotSize,
          borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, ${c === '#1a1a1a' ? '#333' : c}, ${c})`,
          transform: 'translate(-50%,-50%)',
          boxShadow: 'inset 0 -1px 1px rgba(0,0,0,.3)',
        }} />
      ))}
    </div>
  );
}

// Draw bamboo for 條 tiles (number 1 is a bird traditionally; we'll use simple bamboo/bird)
function BambooGlyph({ n, size }) {
  if (n === 1) {
    // Simple stylized bird (red)
    return (
      <div style={{ fontSize: size * 0.8, lineHeight: 1, color: '#b0302b', fontFamily: "'Noto Serif SC', serif" }}>
        <svg viewBox="0 0 40 40" width={size * 0.9} height={size * 0.9}>
          <ellipse cx="20" cy="22" rx="10" ry="7" fill="#b0302b" />
          <circle cx="26" cy="17" r="4.5" fill="#b0302b" />
          <circle cx="27" cy="16" r="1" fill="#fff" />
          <path d="M 28 20 L 33 18 L 30 20 Z" fill="#e8a02b" />
          <path d="M 10 20 Q 6 24 2 20 Q 6 22 10 22 Z" fill="#1a5b2e" />
          <path d="M 14 26 Q 12 32 14 34" stroke="#b0302b" strokeWidth="1.5" fill="none" />
          <path d="M 18 26 Q 16 32 18 34" stroke="#b0302b" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    );
  }
  // Bamboo sticks arranged
  const cols = n <= 2 ? 1 : n <= 6 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const sticks = [];
  for (let i = 0; i < n; i++) sticks.push(i);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: size * 0.04,
      width: size * 0.85, height: size * 0.85,
      placeItems: 'center',
    }}>
      {sticks.map((i) => (
        <BambooStick key={i} size={size * 0.25} accent={n === 8 ? '#b0302b' : n === 9 ? '#b0302b' : '#1a5b2e'} />
      ))}
    </div>
  );
}

function BambooStick({ size, accent }) {
  return (
    <div style={{
      width: size * 0.4, height: size * 1.1,
      background: `linear-gradient(180deg, ${accent} 0%, #0f3a1c 50%, ${accent} 100%)`,
      borderRadius: size * 0.15,
      position: 'relative',
      boxShadow: 'inset -1px 0 1px rgba(0,0,0,.4), inset 1px 0 1px rgba(255,255,255,.2)',
    }}>
      <div style={{ position: 'absolute', left: '50%', top: '33%', width: '60%', height: 1, background: 'rgba(0,0,0,.4)', transform: 'translateX(-50%)' }} />
      <div style={{ position: 'absolute', left: '50%', top: '66%', width: '60%', height: 1, background: 'rgba(0,0,0,.4)', transform: 'translateX(-50%)' }} />
    </div>
  );
}

function GoldenBadge({ size = 22 }) {
  return (
    <div style={{
      position: 'absolute', top: -6, right: -6,
      width: size, height: size, borderRadius: '50%',
      background: 'radial-gradient(circle at 30% 30%, #fff3a6, #e0a82a 60%, #8a5a10)',
      boxShadow: '0 2px 6px rgba(0,0,0,.5), inset 0 1px 0 #fff8c5',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Noto Serif SC', serif", fontSize: size * 0.6, color: '#3a1f05',
      fontWeight: 700, border: '1px solid #fff3a6',
    }}>金</div>
  );
}

Object.assign(window, {
  SUITS, WINDS, DRAGONS, FLOWERS, SEASONS,
  buildWallSpec, tileKey, tileLabel, tileSortVal, sortTiles, isFlower,
  Tile, DotsGlyph, BambooGlyph, BambooStick, GoldenBadge,
});
