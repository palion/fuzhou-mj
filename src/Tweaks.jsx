// Tweaks panel — exposes AI personalities, animation, theme, density, tile style, house rules
function TweaksPanel({ tweaks, setTweaks, scoringCfg, setScoringCfg, onClose }) {
  return (
    <div style={twkStyles.panel}>
      <div style={twkStyles.header}>
        <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, letterSpacing: 2, color: '#e0c97e' }}>TWEAKS</div>
        <button onClick={onClose} style={twkStyles.close}>×</button>
      </div>
      <div style={twkStyles.body}>
        <Section title="Table theme">
          <ChipRow value={tweaks.theme} set={(v) => setTweaks({ ...tweaks, theme: v })}
            options={[['dark', 'Dark modern'], ['traditional', 'Traditional green'], ['paper', 'Paper minimal']]} />
        </Section>
        <Section title="Perspective">
          <ChipRow value={tweaks.tilt === false ? 'flat' : 'tilt'} set={(v) => setTweaks({ ...tweaks, tilt: v === 'tilt' })}
            options={[['tilt', 'Slight 3D'], ['flat', 'Top-down']]} />
        </Section>
        <Section title="Animation">
          <ChipRow value={tweaks.animIntensity} set={(v) => setTweaks({ ...tweaks, animIntensity: v })}
            options={[['off', 'Off'], ['normal', 'Normal'], ['high', 'Lingering']]} />
        </Section>
        <Section title="Layout density">
          <ChipRow value={tweaks.density} set={(v) => setTweaks({ ...tweaks, density: v })}
            options={[['compact', 'Compact'], ['normal', 'Normal']]} />
        </Section>
        <Section title="Tile style">
          <ChipRow value={tweaks.tileStyle} set={(v) => setTweaks({ ...tweaks, tileStyle: v })}
            options={[['ivory', 'Ivory serif'], ['crisp', 'Crisp modern'], ['dark', 'Dark stone'], ['parchment', 'Parchment']]} />
        </Section>
        <Section title="House rules · Scoring (番 values)">
          <ScoringRow label="清一色 Clean hand" k="cleanHand" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="碰碰胡 All pungs" k="allPungs" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="字一色 All honors" k="allHonors" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="大三元 Big 3 dragons" k="bigThreeDragons" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="小三元 Small 3 dragons" k="smallThreeDragons" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="大四喜 Big 4 winds" k="bigFourWinds" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="七对 Seven pairs" k="sevenPairs" cfg={scoringCfg} set={setScoringCfg} max={16} />
          <ScoringRow label="自摸 Self-draw" k="selfDraw" cfg={scoringCfg} set={setScoringCfg} max={8} />
          <ScoringRow label="门清 Concealed" k="concealed" cfg={scoringCfg} set={setScoringCfg} max={8} />
          <ScoringRow label="Cap (限番)" k="limitFans" cfg={scoringCfg} set={setScoringCfg} max={32} />
          <ScoringRow label="Base points / 番" k="basePoints" cfg={scoringCfg} set={setScoringCfg} max={10} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#8aa699', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  );
}

function ChipRow({ value, set, options }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => set(v)} style={{
          background: value === v ? 'linear-gradient(180deg, #2a7a50 0%, #1e5a3d 100%)' : 'rgba(0,0,0,.3)',
          border: `1px solid ${value === v ? '#3aa068' : '#2a3a30'}`,
          color: value === v ? '#fff' : '#c3d3ca',
          borderRadius: 16, padding: '5px 10px', fontSize: 11, cursor: 'pointer',
          fontFamily: 'Inter',
        }}>{label}</button>
      ))}
    </div>
  );
}

function ScoringRow({ label, k, cfg, set, max }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', gap: 8 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 12, color: '#c3d3ca', flex: 1 }}>{label}</span>
      <input
        type="range" min={0} max={max} step={1}
        value={cfg[k]}
        onChange={(e) => set({ ...cfg, [k]: Number(e.target.value) })}
        style={{ width: 100 }}
      />
      <span style={{ fontFamily: 'Inter', fontSize: 12, color: '#e0c97e', width: 28, textAlign: 'right' }}>{cfg[k]}</span>
    </div>
  );
}

const twkStyles = {
  panel: {
    position: 'fixed', right: 16, top: 16, bottom: 16,
    width: 340,
    background: 'linear-gradient(180deg, #151c18 0%, #0e1512 100%)',
    border: '1px solid #2a3a30',
    borderRadius: 14,
    boxShadow: '0 20px 60px rgba(0,0,0,.6)',
    zIndex: 50,
    display: 'flex', flexDirection: 'column',
    color: '#e8ebe7',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid #1f2b25',
  },
  close: {
    background: 'transparent', border: 'none', color: '#8aa699',
    fontSize: 24, cursor: 'pointer', lineHeight: 1,
  },
  body: { padding: 16, overflow: 'auto', flex: 1 },
};

Object.assign(window, { TweaksPanel });
