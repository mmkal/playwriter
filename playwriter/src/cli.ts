#!/usr/bin/env node

import { cac } from 'cac'
import { startPlayWriterCDPRelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { VERSION } from './utils.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RELAY_PORT = 19988

const cli = cac('playwriter')

cli
  .command('', 'Start the MCP server (default)')
  .option('--host <host>', 'Remote relay server host to connect to (or use PLAYWRITER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('--chromium', 'Launch standalone Chromium with extension (no Chrome needed)')
  .option('--headless', 'Run Chromium in headless mode (requires --chromium)')
  .option('--url <url>', 'URL to open in Chromium (requires --chromium)', { default: 'about:blank' })
  .action(async (options: { host?: string; token?: string; chromium?: boolean; headless?: boolean; url?: string }) => {
    // If --chromium flag, launch browser with extension before starting MCP
    if (options.chromium) {
      const { chromium } = await import('playwright-core')
      const fs = await import('node:fs')
      const os = await import('node:os')

      // Find the extension path
      let extensionPath = path.resolve(__dirname, '../extension')
      if (!fs.existsSync(extensionPath)) {
        extensionPath = path.resolve(__dirname, '../../extension/dist')
      }
      if (!fs.existsSync(extensionPath)) {
        console.error('Error: Extension not found. The package may not include the extension.')
        process.exit(1)
      }

      const manifestPath = path.join(extensionPath, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        console.error(`Error: manifest.json not found at ${manifestPath}`)
        process.exit(1)
      }

      // Create temp user data dir
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwriter-'))

      console.error(`[playwriter] Launching Chromium with extension from: ${extensionPath}`)
      console.error(`[playwriter] User data dir: ${userDataDir}`)

      const browserContext = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: options.headless ?? false,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      })

      const pages = browserContext.pages()
      const page = pages.length > 0 ? pages[0] : await browserContext.newPage()

      if (options.url && options.url !== 'about:blank') {
        await page.goto(options.url)
      }

      console.error('[playwriter] Chromium launched. Extension will auto-connect when MCP starts.')

      // Cleanup browser on exit
      const cleanup = () => {
        browserContext.close().catch(() => {})
      }
      process.on('exit', cleanup)
      process.on('SIGINT', () => {
        cleanup()
        process.exit(0)
      })
      process.on('SIGTERM', () => {
        cleanup()
        process.exit(0)
      })
    }

    // Set env vars for standalone mode
    if (options.chromium) {
      process.env.PLAYWRITER_AUTO_ENABLE = '1'
      process.env.PLAYWRITER_STANDALONE_MODE = '1'
    }

    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

cli
  .command('chromium', 'Launch standalone Chromium with the Playwriter extension (browser only, no MCP)')
  .option('--url <url>', 'URL to open in the browser', { default: 'about:blank' })
  .option('--headless', 'Run in headless mode')
  .option('--user-data-dir <dir>', 'User data directory for Chromium profile')
  .action(async (options: { url: string; headless?: boolean; userDataDir?: string }) => {
    const { chromium } = await import('playwright-core')
    const fs = await import('node:fs')
    const os = await import('node:os')

    // Find the extension path - check both dev and dist locations
    let extensionPath = path.resolve(__dirname, '../extension')
    if (!fs.existsSync(extensionPath)) {
      extensionPath = path.resolve(__dirname, '../../extension/dist')
    }
    if (!fs.existsSync(extensionPath)) {
      console.error('Error: Extension not found. The package may not include the extension.')
      process.exit(1)
    }

    const manifestPath = path.join(extensionPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      console.error(`Error: manifest.json not found at ${manifestPath}`)
      process.exit(1)
    }

    console.log(`Loading extension from: ${extensionPath}`)

    const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'playwriter-'))

    const browserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: options.headless ?? false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    })

    const pages = browserContext.pages()
    const page = pages.length > 0 ? pages[0] : await browserContext.newPage()

    if (options.url !== 'about:blank') {
      await page.goto(options.url)
    }

    console.log('Chromium launched with Playwriter extension.')
    console.log(`User data dir: ${userDataDir}`)
    console.log('')
    console.log('The extension will auto-connect when the relay server starts.')
    console.log('In another terminal, start the MCP with: npx playwriter')
    console.log('')
    console.log('Press Ctrl+C to close the browser.')

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        console.log('\nClosing browser...')
        browserContext.close().finally(resolve)
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
      browserContext.browser()?.on('disconnected', () => resolve())
    })

    process.exit(0)
  })

cli
  .command('serve', 'Start the CDP relay server for remote MCP connections')
  .option('--host <host>', 'Host to bind to', { default: '0.0.0.0' })
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .action(async (options: { host: string; token?: string }) => {
    const token = options.token || process.env.PLAYWRITER_TOKEN
    if (!token) {
      console.error('Error: Authentication token is required.')
      console.error('Provide --token <token> or set PLAYWRITER_TOKEN environment variable.')
      process.exit(1)
    }

    const logger = createFileLogger()

    process.title = 'playwriter-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startPlayWriterCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      logger,
    })

    console.log('Playwriter CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: (configured)`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log('')
    console.log('Endpoints:')
    console.log(`  Extension: ws://${options.host}:${RELAY_PORT}/extension`)
    console.log(`  CDP:       ws://${options.host}:${RELAY_PORT}/cdp/<client-id>?token=<token>`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

cli.help()
cli.version(VERSION)

cli.parse()
