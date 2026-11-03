/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm cream canvas, navy headings, deep green/teal accents.
        paper: "#F8F6F1",
        surface: "#FFFFFF",
        "surface-muted": "#F3F1EA",
        ink: "#15181C",
        navy: "#1B2A41",
        teal: "#2A7F7A",
        "teal-soft": "#E5F1EF",
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
        shimmer: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      maxWidth: {
        page: "72rem",
        form: "42rem",
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
