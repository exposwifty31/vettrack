import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        // Danger surface — must match red `--destructive` in src/index.css (not default shadcn gray).
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        status: {
          ok: "hsl(var(--status-ok))",
          issue: "hsl(var(--status-issue))",
          maintenance: "hsl(var(--status-maintenance))",
          sterilized: "hsl(var(--status-sterilized))",
        },

        ivory: {
          bg:       "rgb(var(--ivory-bg) / <alpha-value>)",
          surface:  "rgb(var(--ivory-surface) / <alpha-value>)",
          border:   "rgb(var(--ivory-border) / <alpha-value>)",
          borderMd: "rgb(var(--ivory-borderMd) / <alpha-value>)",
          text:     "rgb(var(--ivory-text) / <alpha-value>)",
          text2:    "rgb(var(--ivory-text2) / <alpha-value>)",
          text3:    "rgb(var(--ivory-text3) / <alpha-value>)",
          navy:     "rgb(var(--ivory-navy) / <alpha-value>)",
          green:    "rgb(var(--ivory-green) / <alpha-value>)",
          greenMid: "rgb(var(--ivory-greenMid) / <alpha-value>)",
          greenBg:  "rgb(var(--ivory-greenBg) / <alpha-value>)",
          ok:       "#16a34a",
          warn:     "#d97706",
          err:      "#dc2626",
          info:     "#2563eb",
        },

        emergency: {
          bg:         "rgb(var(--emergency-bg) / <alpha-value>)",
          surface:    "rgb(var(--emergency-surface) / <alpha-value>)",
          border:     "rgb(var(--emergency-border) / <alpha-value>)",
          borderMd:   "rgb(var(--emergency-border-md) / <alpha-value>)",
          text:       "rgb(var(--emergency-text) / <alpha-value>)",
          text2:      "rgb(var(--emergency-text2) / <alpha-value>)",
          accent:     "rgb(var(--emergency-accent) / <alpha-value>)",
          accentSoft: "rgb(var(--emergency-accent-soft) / <alpha-value>)",
          amber:      "rgb(var(--emergency-amber) / <alpha-value>)",
        },

        offline: {
          bg:     "rgb(var(--offline-bg) / <alpha-value>)",
          border: "rgb(var(--offline-border) / <alpha-value>)",
          text:   "rgb(var(--offline-text) / <alpha-value>)",
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius)',
        xl: 'var(--radius-xl)',
        "2xl": 'var(--radius-2xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        surface: 'var(--shadow-surface)',
      },
      fontFamily: {
        sans: [
          "Heebo",
          "Plus Jakarta Sans",
          "Noto Sans Hebrew",
          "Rubik",
          "system-ui",
          "sans-serif",
        ],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        num: ["DM Mono", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        enter: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        reward: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        instant: "var(--motion-instant)",
        quick:   "var(--motion-quick)",
        enter:   "var(--motion-enter)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /** Route entrance — small translate only (large values feel like jump / CLS with lazy routes) */
        "page-enter": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pro-rise": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "page-enter": "page-enter 0.22s ease-out both",
        "pro-rise": "pro-rise 620ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "slide-in": "slide-in 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("tailwindcss-rtl")],
} satisfies Config;
