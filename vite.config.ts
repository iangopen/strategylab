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
  },
})
