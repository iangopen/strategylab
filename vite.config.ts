/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The public base path comes from VITE_BASE (default "/"). GitHub Pages serves the app under
// "/strategylab/" (npm run build:pages, and CI's deploy and E2E builds); a host at the domain
// root needs no change. Never hardcode a base path in app code: assets and the worker resolve
// relative to import.meta.url, and share links are built from location.origin + location.pathname.
const base = process.env.VITE_BASE || '/'
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(`VITE_BASE must start and end with "/" (got "${base}")`)
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Many tests are deterministic Monte Carlo runs (fixed seeds) taking 1-4 s on an idle machine.
    // Vitest's 5 s default is a harness budget, not an assertion: under parallel-file CPU load it
    // timed out the Paroli equivalence test once (5.9 s). 60 s keeps CI's smaller runners honest
    // without touching any assertion.
    testTimeout: 60_000,
  },
})
