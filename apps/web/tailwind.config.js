import containerQueries from '@tailwindcss/container-queries'

// Chart & Ledger palette: each Tailwind colour scale reads a ramp of CSS variables defined in
// src/index.css, so existing classes (bg-gray-900, text-amber-400, …) use the new palette and a
// light theme can redefine the variables without touching components.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const ramp = (name) => Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]))

const sea = ramp('sea')
const brass = ramp('brass')

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    // Tailwind's defaults plus `wide` (large size class, detail panes) and `ultra` (4K / extra large),
    // listed in ascending order so later breakpoints win
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      wide: '1440px',
      '2xl': '1536px',
      ultra: '2200px',
    },
    extend: {
      colors: {
        gray: sea,               // neutrals, slightly sea-blue
        amber: brass,            // primary actions, your money
        red: ramp('port'),       // deficit, destructive
        green: ramp('starboard'), // surplus, success
        emerald: ramp('starboard'),
        blue: ramp('slate'),     // savings, informational
        purple: ramp('plum'),    // custom splits, secondary series
        orange: ramp('lantern'), // warnings, needs attention
        sea,
        brass,
        // Semantic aliases
        brand: {
          primary: brass[400],
          'primary-hover': brass[300],
        },
        surface: {
          base: sea[950],    // page background
          raised: sea[900],  // cards, nav bars
          overlay: sea[800], // inputs, modals, elevated surfaces
        },
      },
      fontFamily: {
        // Interface and body text
        sans: ['"Schibsted Grotesk"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        // Page titles and headline figures
        display: ['"Libre Caslon Display"', '"Libre Caslon Text"', 'Georgia', '"Times New Roman"', 'serif'],
        // The pirate voice: empty states, asides (used sparingly, italic)
        serif: ['"Libre Caslon Text"', 'Georgia', '"Times New Roman"', 'serif'],
        // Labels, codes, column heads
        mono: ['"IBM Plex Mono"', 'ui-monospace', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      // Bottom sheets (phone dialogs) slide up from the screen edge
      keyframes: {
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        'sheet-up': 'sheet-up 200ms ease-out',
      },
    },
  },
  // `@container` + `@[600px]:…` variants: widgets and tables respond to their own width, not the viewport
  plugins: [containerQueries],
}
