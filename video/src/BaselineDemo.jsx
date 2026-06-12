import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const COURT = "#0f3d2e";
const CHALK = "#f4f1e8";
const BALL = "#d8e63a";
const CLAY = "#e07a4f";

const BESTS = [
  { bracket: "10s", rank: 3, color: "#9ad1ff" },
  { bracket: "12s", rank: 13, color: "#5fd0a5" },
  { bracket: "14s", rank: 11, color: BALL },
  { bracket: "16s", rank: 25, color: "#e8b54a" },
  { bracket: "18s", rank: 61, color: CLAY },
];

function TitleCard({ title, subtitle, progress }) {
  const opacity = interpolate(progress, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);
  const y = interpolate(progress, [0, 0.2], [40, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity }}>
      <div style={{ transform: `translateY(${y}px)`, textAlign: "center", maxWidth: 1200 }}>
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 96,
            fontWeight: 900,
            color: CHALK,
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ marginTop: 24, fontSize: 32, color: "#c9c4b4", fontFamily: "system-ui" }}>{subtitle}</div>
        )}
      </div>
    </AbsoluteFill>
  );
}

function BestCards({ progress }) {
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
        {BESTS.map((b, i) => {
          const cardProgress = spring({
            frame: progress * 30 - i * 4,
            fps: 30,
            config: { damping: 14 },
          });
          const scale = interpolate(cardProgress, [0, 1], [0.7, 1]);
          const opacity = interpolate(cardProgress, [0, 1], [0, 1]);
          return (
            <div
              key={b.bracket}
              style={{
                width: 180,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                padding: "18px 16px",
                transform: `scale(${scale})`,
                opacity,
              }}
            >
              <div style={{ height: 4, background: b.color, marginBottom: 12 }} />
              <div style={{ color: "#c9c4b4", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Boys' {b.bracket}
              </div>
              <div style={{ color: CHALK, fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>#{b.rank}</div>
              <div style={{ color: "#c9c4b4", fontSize: 13 }}>career best</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function ChartMock({ progress, playerName }) {
  const points = [
    [0, 0.82],
    [0.15, 0.72],
    [0.3, 0.55],
    [0.45, 0.48],
    [0.6, 0.42],
    [0.75, 0.35],
    [0.9, 0.28],
    [1, 0.22],
  ];
  const path = points
    .map(([x, y], i) => {
      const px = 120 + x * 1500;
      const py = 120 + y * 700;
      return `${i === 0 ? "M" : "L"} ${px} ${py}`;
    })
    .join(" ");
  const draw = interpolate(progress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill style={{ padding: 100 }}>
      <div style={{ color: CHALK, fontSize: 42, fontWeight: 700, marginBottom: 8 }}>{playerName}</div>
      <div style={{ color: "#c9c4b4", fontSize: 22, marginBottom: 32 }}>
        Ranking history · hover for list context · USTA source links
      </div>
      <svg width="1680" height="820" viewBox="0 0 1680 820">
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={120}
            y1={120 + i * 175}
            x2={1620}
            y2={120 + i * 175}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="4 8"
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke={BALL}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={2400}
          strokeDashoffset={2400 * (1 - draw)}
        />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={120 + x * 1500}
            cy={120 + y * 700}
            r={8}
            fill={BALL}
            opacity={draw > x ? 1 : 0.2}
          />
        ))}
        <text x={120} y={60} fill="#c9c4b4" fontSize={18}>
          #1
        </text>
        <text x={120} y={820} fill="#c9c4b4" fontSize={18}>
          2001 → present
        </text>
      </svg>
    </AbsoluteFill>
  );
}

function FeatureList({ progress }) {
  const features = [
    "Search two decades of USTA junior lists",
    "Singles, doubles & combined — charted by age bracket",
    "Season overlay compare — stack different years on one axis",
    "Hover any point to see who was ranked nearby",
    "Every snapshot links back to TennisLink",
  ];
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px" }}>
      <div style={{ color: CHALK, fontSize: 52, fontWeight: 800, marginBottom: 40 }}>Baseline.</div>
      {features.map((f, i) => {
        const itemProgress = interpolate(progress, [i * 0.12, i * 0.12 + 0.2], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={f}
            style={{
              color: CHALK,
              fontSize: 30,
              marginBottom: 18,
              opacity: itemProgress,
              transform: `translateX(${(1 - itemProgress) * 30}px)`,
              display: "flex",
              gap: 16,
              alignItems: "center",
            }}
          >
            <span style={{ color: BALL, fontWeight: 800 }}>→</span> {f}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

export function BaselineDemo({ playerName = "Zachary Ebenfeld" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${COURT} 0%, #0a2c21 100%)`,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <Sequence from={0} durationInFrames={90}>
        <TitleCard
          title={
            <>
              Baseline<span style={{ color: BALL }}>.</span>
            </>
          }
          subtitle="USTA junior ranking history"
          progress={frame / 90}
        />
      </Sequence>

      <Sequence from={90} durationInFrames={120}>
        <FeatureList progress={(frame - 90) / 120} />
      </Sequence>

      <Sequence from={210} durationInFrames={120}>
        <BestCards progress={(frame - 210) / 120} />
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 60 }}>
          <div style={{ color: "#c9c4b4", fontSize: 24, opacity: interpolate((frame - 210) / 40, [0, 1], [0, 1]) }}>
            Example: {playerName} · Florida
          </div>
        </AbsoluteFill>
      </Sequence>

      <Sequence from={330} durationInFrames={120}>
        <ChartMock progress={(frame - 330) / 120} playerName={playerName} />
      </Sequence>
    </AbsoluteFill>
  );
}
