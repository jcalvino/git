/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // ── Base ────────────────────────────────────────
        bg:        "#0A0B0F",        // deep navy-black, Bloomberg-style
        "bg-alt":  "#0F1117",        // section backgrounds
        card:      "#151821",        // cards
        "card-alt":"#1C1F2A",        // nested / hover
        border:    "#252935",
        "border-light": "#2F3441",
        // ── Text ────────────────────────────────────────
        text:      "#E8EAED",
        "text-dim":"#9AA0A6",
        muted:     "#6B7280",
        "muted-dim":"#4B5563",
        // ── Brand ───────────────────────────────────────
        accent:     "#00D4FF",       // ciano para destaques
        "accent-dim":"#0099BB",
        "accent-alt":"#7B61FF",      // violeta para analytics
        // ── Signals ─────────────────────────────────────
        positive:    "#00E676",      // verde mais saturado
        "positive-dim":"#00A850",
        negative:    "#FF3D57",
        "negative-dim":"#C62E43",
        warning:     "#FFB020",
        "warning-dim":"#C78A18",
        // ── Chart gradients ─────────────────────────────
        "chart-green": "#00E67680",
        "chart-red":   "#FF3D5780",
        "chart-grid":  "#252935",
      },
      fontFamily: {
        mono:  ["JetBrains Mono", "SF Mono", "Consolas", "monospace"],
        sans:  ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card:    "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.24)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.4)",
        glow:    "0 0 24px rgba(0,212,255,0.15)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
