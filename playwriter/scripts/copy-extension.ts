/**
 * Copy the built extension to the playwriter package for publishing.
 * This allows the standalone chromium mode to load the extension.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const srcExtensionDir = path.resolve(__dirname, '../../extension/dist')
const destExtensionDir = path.resolve(__dirname, '../extension')

// Check if extension is built
if (!fs.existsSync(srcExtensionDir)) {
  console.log('Extension not built yet, skipping copy. Run `pnpm build` in extension/ first.')
  process.exit(0)
}

// Remove old extension dir if exists
if (fs.existsSync(destExtensionDir)) {
  fs.rmSync(destExtensionDir, { recursive: true })
}

// Copy extension dist
fs.cpSync(srcExtensionDir, destExtensionDir, { recursive: true })

console.log(`Copied extension from ${srcExtensionDir} to ${destExtensionDir}`)
