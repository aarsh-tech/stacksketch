import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'

// the file to upload to the Chrome Web Store (and Edge Add-ons): dist/ zipped with manifest.json at its root
const dist = new URL('./dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))

const files = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (!name.endsWith('.map')) files[relative(dist, path).split('\\').join('/')] = readFileSync(path)
  }
}
walk(dist)

if (manifest.description.length > 132) throw new Error(`The manifest description is ${manifest.description.length} characters; the Web Store allows 132.`)
for (const icon of Object.values(manifest.icons ?? {})) if (!files[icon]) throw new Error(`The manifest names ${icon}, but it isn't in dist.`)

const out = new URL('../../release/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
mkdirSync(out, { recursive: true })
const zip = join(out, `stacksketch-extension-${manifest.version}.zip`)
writeFileSync(zip, zipSync(files, { level: 9 }))
console.log(`${Object.keys(files).length} files → ${relative(process.cwd(), zip)} (${(statSync(zip).size / 1024).toFixed(0)} KB)`)
