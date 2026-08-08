/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F8F6",
        ink: "#15181C",
        "ink-soft": "#4A5058",
        line: "#E3E6E1",
        "line-soft": "#EDEFEB",
        verified: "#1F6F5C",
        "verified-soft": "#E8F0EC",
        signal: "#B8862E",
        "signal-soft": "#F5EEDF",
        danger: "#A23B34",
        "danger-soft": "#F5E9E7",
      },
      fontFamily: {
        display: ["Newsreader", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        lg: "10px",
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(21, 24, 28, 0.04), 0 1px 1px rgba(21, 24, 28, 0.03)",
        card: "0 1px 3px rgba(21, 24, 28, 0.06), 0 4px 12px rgba(21, 24, 28, 0.04)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
