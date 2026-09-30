import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Listens for the browser's install offer before the app renders (see lib/install.ts)
import './lib/install'
// Self-hosted fonts (no third-party requests from a self-hosted app); Latin subset covers æøå
import '@fontsource/schibsted-grotesk/latin-400.css'
import '@fontsource/schibsted-grotesk/latin-500.css'
import '@fontsource/schibsted-grotesk/latin-600.css'
import '@fontsource/schibsted-grotesk/latin-700.css'
import '@fontsource/libre-caslon-display/latin-400.css'
import '@fontsource/libre-caslon-text/latin-400.css'
import '@fontsource/libre-caslon-text/latin-400-italic.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Makes the app installable with an offline page (see public/sw.js). Not in dev,
// where a service worker would get in the way of Vite's hot reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not a secure context, e.g. plain HTTP */ })
  })
}