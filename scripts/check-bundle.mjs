#!/usr/bin/env node
/**
 * Guard the bundle contract of the repo root.
 *
 * The root package is what a GitHub-URL install puts in the profile, so it has
 * to be a DSH bundle:
 *
 *   1. `dsh.bundle.patch` must name a patch file that ships in the package.
 *   2. That patch's `insert` rows must name packages the root depends on,
 *      otherwise the rows cannot be resolved at boot.
 *   3. Every dependency that the patch names must itself declare
 *      `dsh.bundle.patch` and ship the file, since it is installed on its own.
 *
 * Missing (1) is the failure this check exists for: DSH treats the root as a
 * plain dependency, so the install is rolled back in the GUI and warns
 * `declares no dsh.bundle — installed as a plain dependency` on the CLI.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

const manifest = readManifest(root)
const patchRel = manifest.dsh?.bundle?.patch
if (patchRel === undefined) {
  failures.push(`${manifest.name}: package.json declares no dsh.bundle.patch — a GitHub install of this repo is rolled back as "not-a-bundle"`)
}

const rowNames = []
if (patchRel !== undefined) {
  const patchPath = resolve(root, patchRel)
  if (!existsSync(patchPath)) {
    failures.push(`${manifest.name}: dsh.bundle.patch points at a missing file: ${patchRel}`)
  } else {
    const patch = readFileSync(patchPath, 'utf8')
    for (const [, name] of patch.matchAll(/^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/gm)) rowNames.push(name)
    if (rowNames.length === 0) failures.push(`${manifest.name}: ${patchRel} declares no insert rows`)
  }
}

const dependencies = manifest.dependencies ?? {}
for (const name of rowNames) {
  if (!(name in dependencies)) {
    failures.push(`${manifest.name}: patch inserts ${name}, but the root does not depend on it — the row cannot be resolved at boot`)
    continue
  }
  const dir = join(root, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) continue // not installed here; resolved from the registry at install time
  const dep = readManifest(dir)
  if (dep.dsh?.bundle?.patch === undefined) failures.push(`${name}: installed package declares no dsh.bundle.patch`)
  else if (!existsSync(resolve(dir, dep.dsh.bundle.patch))) failures.push(`${name}: dsh.bundle.patch points at a missing file: ${dep.dsh.bundle.patch}`)
}

// DSH refuses to install or load a plugin whose `@deepseek-ai/dsh*` peer range
// does not satisfy the running runtime:
//   semver.satisfies(runtimeVersion, range, { includePrerelease: true })
// An exact pin only ever satisfies the one runtime it names, so every release of
// the harness makes the plugin uninstallable and the profile rolls back. `>=` is
// the form that keeps one build usable across runtimes; an upper bound is fine
// as long as it stays a range (`>=0.2.0-rc.2 <0.3.0`).
const memberManifests = [
  'packages/roundtable/roundtable/package.json',
  'packages/roundtable/tool-roundtable/package.json',
  'packages/client/ui-roundtable/package.json'
]
for (const file of memberManifests) {
  const member = JSON.parse(readFileSync(join(root, file), 'utf8'))
  for (const [name, range] of Object.entries(member.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh')) continue
    if (typeof range !== 'string' || !range.startsWith('>=')) {
      failures.push(`${member.name}: peerDependency ${name}: ${JSON.stringify(range)} is not a range DSH can satisfy on more than one runtime — use ">=<version>" (an exact pin or a caret on 0.x fails every other runtime)`)
    }
  }
}

if (failures.length > 0) {
  console.error('bundle check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`bundle check ok: ${manifest.name} → ${patchRel} → ${rowNames.length} rows (${rowNames.join(', ')})`)
