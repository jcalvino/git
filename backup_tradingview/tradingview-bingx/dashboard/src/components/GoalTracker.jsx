import React from "react";

const GOAL_USDT = 30000;
const START_CAPITAL = 128;
const GOAL_DATE = new Date("2026-12-31");

export function GoalTracker({ currentCapital }) {
  const capital = currentCapital ?? START_CAPITAL;
  const today = new Date();

  // Progress
  const gained = Math.max(0, capital - START_CAPITAL);
  const needed = GOAL_USDT - START_CAPITAL;
  const progressPct = Math.min(100, (gained / needed) * 100);

  // Time left
  const msLeft = GOAL_DATE - today;
  const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  const monthsLeft = daysLeft / 30.44;

  // Required monthly return to hit goal from here
  const requiredMonthly =
    monthsLeft > 0 && capital > 0
      ? (Math.pow(GOAL_USDT / capital, 1 / monthsLeft) - 1) * 100
      : 0;

  // Multiplier still needed
  const multiplierNeeded = capital > 0 ? GOAL_USDT / capital : 0;

  // Color for required return
  const returnColor =
    requiredMonthly < 20
      ? "text-positive"
      : requiredMonthly < 50
      ? "text-accent"
      : "text-negative";

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-muted tracking-wider">GOAL 2026 — $30,000 USDT</h2>
        <span className="text-xs text-muted">{daysLeft} days remaining</span>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 bg-bg rounded-full overflow-hidden mb-3">
        <div
          className="absolute inset-y-0 left-0 bg-accent rounded-full transition-all duration-700"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
        <Stat label="Current capital" value={`$${capital.toFixed(2)}`} color="text-accent" />
        <Stat label="Goal" value={`$${GOAL_USDT.toLocaleString()}`} />
        <Stat label="Still needed" value={`${multiplierNeeded.toFixed(1)}x`} />
        <Stat
          label="Required monthly return"
          value={`${requiredMonthly.toFixed(1)}%`}
          color={returnColor}
        />
      </div>

      {/* Milestone checkpoints */}
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs text-muted mb-2">Milestones</p>
        <div className="flex flex-wrap gap-2">
          {MILESTONES.map((m) => {
            const hit = capital >= m.value;
            return (
              <span
                key={m.label}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  hit
                    ? "border-positive/50 bg-positive/10 text-positive"
                    : "border-border text-muted"
                }`}
              >
                {hit ? "✓ " : ""}
                {m.label}
              </span>
            );
          })}
        </div>
      </div>

      {requiredMonthly > 50 && (
        <p className="mt-3 text-xs text-muted border-t border-border pt-3">
          The required monthly return ({requiredMonthly.toFixed(1)}%) is aggressive.
          Focus on consistency — each winning trade increases the capital base and reduces the required return.
        </p>
      )}
    </div>
  );
}

const MILESTONES = [
  { label: "$256 (2x)", value: 256 },
  { label: "$500", value: 500 },
  { label: "$1k", value: 1000 },
  { label: "$2.5k", value: 2500 },
  { label: "$5k", value: 5000 },
  { label: "$10k", value: 10000 },
  { label: "$20k", value: 20000 },
  { label: "$30k", value: 30000 },
];

function Stat({ label, value, color = "text-text" }) {
  return (
    <div className="bg-bg rounded p-2">
      <div className="text-muted text-xs mb-0.5">{label}</div>
      <div className={`font-semibold ${color}`}>{value}</div>
    </div>
  );
}
