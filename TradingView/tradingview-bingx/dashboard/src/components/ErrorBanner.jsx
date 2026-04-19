import React from "react";

const LEVEL_STYLE = {
  error:   { bar: "bg-negative/15 border-negative/40", badge: "bg-negative/20 text-negative border border-negative/40", dot: "bg-negative" },
  warning: { bar: "bg-yellow-500/10 border-yellow-500/30", badge: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30", dot: "bg-yellow-400" },
  info:    { bar: "bg-accent/10 border-accent/20", badge: "bg-accent/10 text-accent border border-accent/20", dot: "bg-accent" },
};

/**
 * Persistent banner shown above tab navigation whenever the bot
 * reports errors or warnings. Fetched from GET /api/errors every 15s.
 */
export function ErrorBanner({ errorsData, onDismiss }) {
  if (!errorsData?.hasActive && !errorsData?.errors?.length) return null;

  const items = errorsData?.errors ?? [];
  const hasErrors   = items.some((e) => e.level === "error"   && !e.dismissed);
  const hasWarnings = items.some((e) => e.level === "warning"  && !e.dismissed);
  const hasInfo     = items.some((e) => e.level === "info"     && !e.dismissed);

  if (!hasErrors && !hasWarnings && !hasInfo) return null;

  const dominant = hasErrors ? "error" : hasWarnings ? "warning" : "info";
  const style    = LEVEL_STYLE[dominant];

  const visibleItems = items
    .filter((e) => !e.dismissed)
    .slice(0, 5);

  return (
    <div className={`mx-6 mt-3 rounded-lg border p-3 ${style.bar}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full animate-pulse ${style.dot}`} />
          <span className="text-xs font-bold text-text tracking-wide">
            {hasErrors ? "BOT ERRORS DETECTED" : hasWarnings ? "BOT WARNINGS" : "BOT STATUS"}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${style.badge}`}>
            {visibleItems.length}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-xs text-muted hover:text-text transition-colors px-2 py-0.5 rounded border border-border hover:border-accent"
        >
          Dismiss all
        </button>
      </div>

      {/* Error list */}
      <div className="space-y-1">
        {visibleItems.map((e) => {
          const s = LEVEL_STYLE[e.level] ?? LEVEL_STYLE.info;
          return (
            <div key={e.id} className="flex items-start gap-2 text-xs">
              <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <span className="text-muted font-mono">[{e.source}]</span>{" "}
                <span className="text-text">{e.message}</span>
                {e.details && Object.keys(e.details).length > 0 && (
                  <span className="text-muted ml-1 truncate">
                    {Object.entries(e.details)
                      .filter(([k]) => k !== "stack")
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </span>
                )}
              </div>
              <span className="text-muted flex-shrink-0">
                {new Date(e.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
