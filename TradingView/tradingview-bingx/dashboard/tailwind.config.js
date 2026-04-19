/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0F0F14",
        card: "#1A1A24",
        border: "#2A2A3A",
        accent: "#00D4FF",
        "accent-dim": "#0099BB",
        positive: "#00C853",
        "positive-dim": "#00953D",
        negative: "#FF1744",
        "negative-dim": "#CC1236",
        muted: "#6B7280",
        text: "#E5E7EB",
        "text-dim": "#9CA3AF",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
