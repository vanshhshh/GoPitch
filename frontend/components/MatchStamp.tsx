"use client";

/**
 * MatchStamp — the product's signature element (per frontend-design skill guidance).
 * The whole product's job is turning a founder's manual investor-fit judgment into a
 * legible, trustworthy number. This renders that number the way a diligence memo would
 * annotate a document: a small circular stamp, not a generic progress bar or badge pill.
 */
export function MatchStamp({ score, size = 44 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const toneClass =
    score >= 70 ? "text-verified" : score >= 45 ? "text-signal" : "text-ink-soft";
  const strokeColor = score >= 70 ? "#1F6F5C" : score >= 45 ? "#B8862E" : "#9AA0A6";

  return (
    <div className="relative inline-flex items-center justify-center animate-fade-up" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EDEFEB" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <span className={`absolute font-mono text-[11px] font-medium ${toneClass}`}>{Math.round(score)}</span>
    </div>
  );
}
