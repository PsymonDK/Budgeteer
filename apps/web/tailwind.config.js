export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
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
  plugins: []
}