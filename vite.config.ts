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
  // Two Vitest projects (session 13). "unit": fast tests, full parallelism, the 5 s default timeout.
  // "stats": Monte Carlo-heavy tests (*.stats.test.ts: invariant tables, equivalence, fuzz, goldens,
  // frequency and property tests). They run AFTER unit (groupOrder), on a few workers so they do not
  // starve each other, under ONE project-wide timeout. Never add a per-file or per-test timeout:
  // a new heavy test goes in a *.stats.test.ts file instead.
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'], exclude: ['src/**/*.stats.test.ts'], sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        test: { name: 'stats', environment: 'node', include: ['src/**/*.stats.test.ts'], maxWorkers: 2, testTimeout: 120_000, sequence: { groupOrder: 1 } },
      },
    ],
  },
})
