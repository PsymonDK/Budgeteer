import containerQueries from '@tailwindcss/container-queries'

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
        // Brand palette — primary accent colour throughout the app
        brand: {
          primary: '#fbbf24',       // amber-400 — buttons, active states, highlights
          'primary-hover': '#fcd34d', // amber-300 — hover variant of primary
        },
        // Surface palette — background layers (darkest → lightest)
        surface: {
          base: '#030712',   // gray-950 — page background
          raised: '#111827', // gray-900 — cards, nav bars
          overlay: '#1f2937', // gray-800 — inputs, modals, elevated surfaces
        },
      },
    },
  },
  // `@container` + `@[600px]:…` variants: widgets and tables respond to their own width, not the viewport
  plugins: [containerQueries],
}