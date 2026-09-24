/** Resolve development peers from one built Harness checkout without installing another runtime. */
import { readdir, readFile, realpath, mkdir, symlink, lstat } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
const harness = resolve(process.argv[2] ?? '../deepseek-harness')
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const packages = new Map()
for (const entry of await readdir(join(harness, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const group = entry.name
  for (const name of await readdir(join(harness, 'packages', group), { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const root = join(harness, 'packages', group, name.name)
    try { const item = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); packages.set(item.name, root) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
for (const name of ['cordis', 'schemastery']) packages.set(`@deepseek-ai/${name}`, join(harness, 'vendor', name))
for (const [name, expected] of Object.entries(manifest.peerDependencies)) {
  const target = packages.get(name)
  if (!target) throw new Error(`Missing Harness peer ${name}`)
  const actual = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).version
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, found ${actual}`)
  await link(name, target)
}
for (const name of ['typescript', '@types/node']) await link(name, await realpath(join(harness, 'node_modules', name)))
const fromOwner = createRequire(join(harness, 'packages/treadmill/treadmill/package.json'))
await link('yaml', dirname(fromOwner.resolve('yaml/package.json')))
await mkdir('node_modules/.bin', { recursive: true })
await symbolic('node_modules/.bin/tsc', resolve('node_modules/typescript/bin/tsc'))
console.log(`Development dependencies use ${harness}; package peers remain external.`)
async function link(name, target) {
  const destination = join('node_modules', name)
  await mkdir(dirname(destination), { recursive: true })
  await symbolic(destination, target)
}
async function symbolic(destination, target) {
  try {
    await lstat(destination)
    if (await realpath(destination) !== await realpath(target)) throw new Error(`Refusing to replace ${destination}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await symlink(target, destination, 'junction')
  }
}
