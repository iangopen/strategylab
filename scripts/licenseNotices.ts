// Build plugin: write dist/third-party-licenses.txt.
//
// The minifier strips the @license comments from the main bundle, so without this the deployed
// site carries React, react-dom, scheduler and comlink with none of the copyright notices their
// MIT and Apache-2.0 licences require in copies. The list is derived from the modules that
// actually landed in the bundles (the main one AND the simulation worker, which Vite builds
// separately), so it can't drift from package.json. A bundled package with no licence file FAILS
// the build rather than shipping silently.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i

/** The package directory a bundled module comes from, or null for the app's own code. */
export function packageRoot(moduleId: string): string | null {
  // Rollup marks virtual modules with a leading NUL.
  const raw = moduleId.startsWith('\0') ? moduleId.slice(1) : moduleId
  const id = (raw.split('?')[0] ?? '').replace(/\\/g, '/')
  const at = id.lastIndexOf('/node_modules/')
  if (at === -1) return null
  const rest = id.slice(at + '/node_modules/'.length).split('/')
  const depth = rest[0]?.startsWith('@') ? 2 : 1
  return id.slice(0, at) + '/node_modules/' + rest.slice(0, depth).join('/')
}

/**
 * Returns [main, worker] plugins sharing one package set: the worker build runs first (when the
 * main build reaches the worker import) and only records its packages; the main build emits the file.
 */
export function licenseNotices(): { main: Plugin; worker: Plugin } {
  const roots = new Set<string>()
  const collect = (bundle: Record<string, { type: string; moduleIds?: readonly string[] }>) => {
    for (const out of Object.values(bundle)) {
      if (out.type !== 'chunk') continue
      for (const id of out.moduleIds ?? []) {
        const r = packageRoot(id)
        if (r) roots.add(r)
      }
    }
  }

  const worker: Plugin = {
    name: 'strategylab:license-notices-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      collect(bundle)
    },
  }

  const main: Plugin = {
    name: 'strategylab:license-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      collect(bundle)
      const sections: string[] = []
      const missing: string[] = []
      const packages = [...roots]
        .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string } }))
        .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
      for (const { dir, pkg } of packages) {
        const file = readdirSync(dir).find((f) => LICENCE_FILE.test(f))
        if (!file) {
          missing.push(`${pkg.name}@${pkg.version}`)
          continue
        }
        sections.push(`${pkg.name} ${pkg.version} (${pkg.license ?? 'see below'})\n\n${readFileSync(join(dir, file), 'utf8').trim()}`)
      }
      if (missing.length) this.error(`bundled package(s) without a licence file: ${missing.join(', ')}`)
      if (sections.length === 0) this.error('no bundled third-party packages found; the licence collector is broken')

      const rule = '\n\n' + '='.repeat(78) + '\n\n'
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-licenses.txt',
        source:
          'This site ships the third-party packages below. Each entry is followed by\n' +
          'its licence and copyright notice, as that licence requires.' +
          rule +
          sections.join(rule) +
          '\n',
      })
    },
  }
  return { main, worker }
}
