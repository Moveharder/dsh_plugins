/**
 * dsh-pocket-ui — host half.
 *
 * Mobile adaptation is a purely browser-side concern: the drawer, the bottom
 * sheets and the safe-area handling all live in `lib/client.js`. This half
 * exists for the distribution loop only — it reads the package version from
 * `package.json` (single source of truth) and exposes the three online-update
 * routes so an installed copy can be repaired without a manual
 * `dsh plugin remove/add` round trip.
 *
 * Routes (read-only, loopback only, never part of an approval chain):
 *
 *   GET  /pocket/hello          liveness + version
 *   GET  /pocket/meta           version / latest / upgrade state
 *   POST /pocket/check-update   force one registry lookup (bypasses the 6h cache)
 *   POST /pocket/upgrade        install the latest registry version
 *
 * Environment overrides (all optional; they exist so the update path is
 * testable without network or a real package manager):
 *
 *   DSH_POCKET_NO_UPDATE_CHECK=1   disable registry lookups entirely
 *   DSH_POCKET_REGISTRY=<url>      alternate registry base (mirror / test)
 *   DSH_POCKET_PKG_MANAGER=<bin>   alternate package manager binary
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { execFile } from 'node:child_process'

const name = 'dsh-pocket-ui'

// webServer is a web-app layer service: it must be injected so routes are only
// registered once webStartup is ready. The `timer` service is deliberately NOT
// injected — the update re-check uses a raw interval owned by ctx.effect (see
// the note at the bottom of apply).
const inject = ['webServer']

/** npm registry version-check period (also runs once at startup). */
const UPDATE_CHECK_INTERVAL = 6 * 3600 * 1000

/**
 * Register the version/update surface for the browser half.
 * @param ctx - host plugin context.
 */
function apply(ctx) {
  // ---- Version: read from this package's own package.json (never hard-coded) ----
  const here = fileURLToPath(import.meta.url)
  const req = createRequire(import.meta.url)
  let VERSION = ''
  try {
    VERSION = String((req(path.join(path.dirname(here), '..', 'package.json')) || {}).version || '')
  } catch (err) { /* ignore: version falls back to empty string */ }

  // ================= version & online upgrade =================

  function semverParts(v) {
    return String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  }

  function semverGt(a, b) {
    const pa = semverParts(a)
    const pb = semverParts(b)
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true
      if ((pa[i] || 0) < (pb[i] || 0)) return false
    }
    return false
  }

  function httpsGetJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      // Pick the module by protocol so DSH_POCKET_REGISTRY can point at a plain
      // http endpoint (local mirror or a test server).
      const lib = String(url).startsWith('http://') ? http : https
      const r = lib.get(url, { headers: { 'user-agent': name + '/' + (VERSION || '?') } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          httpsGetJson(res.headers.location, timeoutMs).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error('http ' + res.statusCode))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c; if (body.length > 200000) r.destroy() })
        res.on('end', () => { try { resolve(JSON.parse(body)) } catch (err) { reject(err) } })
      })
      r.on('error', reject)
      r.setTimeout(timeoutMs || 8000, () => r.destroy(new Error('timeout')))
    })
  }

  // Read process.env at call time (not module scope) so tests can inject.
  const REGISTRY = () => String(process.env.DSH_POCKET_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '')
  const UPDATE_CHECK_DISABLED = () => !!process.env.DSH_POCKET_NO_UPDATE_CHECK

  let latestVersion = null
  let updateChecked = false
  let checkInFlight = null

  /** Look up the latest published version; de-duplicated and offline-silent. */
  function checkUpdate() {
    if (UPDATE_CHECK_DISABLED()) {
      updateChecked = true
      latestVersion = null
      return Promise.resolve(null)
    }
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      try {
        const doc = await httpsGetJson(REGISTRY() + '/' + name + '/latest')
        latestVersion = doc && typeof doc === 'object' ? String(doc.version || '') : ''
        if (!latestVersion) latestVersion = null
      } catch (err) {
        // Offline / unpublished / timeout: degrade silently, never surface.
        latestVersion = null
      } finally {
        updateChecked = true
      }
      return latestVersion
    })().finally(() => { checkInFlight = null })
    return checkInFlight
  }

  /**
   * Walk up from this module looking for the profile root (a package.json that
   * declares `dsh.profile`). Works for hoisted and pnpm virtual-store layouts;
   * this package's own manifest declares only dsh.client/dsh.bundle, so it can
   * never match itself.
   */
  function findProfileRoot() {
    let dir = path.dirname(here)
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        if (pkg && pkg.dsh && pkg.dsh.profile) return dir
      } catch (err) { /* no package.json here, keep walking */ }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  }

  /**
   * Detect a local (link/file/workspace/tarball) install. Those are source
   * checkouts: running `pnpm add <name>@latest` would replace the link with a
   * published copy and silently discard the user's local edits, so the upgrade
   * path refuses and explains instead.
   */
  function localInstallOf(profileRoot) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8'))
      const spec = String((pkg.dependencies && pkg.dependencies[name]) || '')
      if (!spec) return null
      if (/^(link|file|workspace):/.test(spec) || /^\.{0,2}\//.test(spec) || /\.tgz$/i.test(spec)) return spec
      return null
    } catch (err) {
      return null
    }
  }

  const upgrade = { running: false, ok: null, message: '', log: '' }

  function execPipe(bin, args, opts, timeoutMs) {
    return new Promise((resolve, reject) => {
      let child
      try {
        const isWin = process.platform === 'win32'
        const options = Object.assign({
          timeout: timeoutMs || 240000,
          maxBuffer: 8 * 1024 * 1024,
          shell: isWin,
          windowsHide: isWin,
        }, opts || {})
        child = execFile(bin, args, options)
      } catch (err) { reject(err); return }
      let out = ''
      if (child.stdout) child.stdout.on('data', (d) => { out += d })
      if (child.stderr) child.stderr.on('data', (d) => { out += d })
      child.on('error', (err) => reject(err))
      child.on('close', (code) => {
        if (code === 0) resolve({ log: out })
        else reject(new Error(bin + ' exited ' + code + '\n' + String(out).slice(-1500)))
      })
    })
  }

  async function runInstall(profileRoot, target) {
    const override = process.env.DSH_POCKET_PKG_MANAGER
    const bin = (b) => (process.platform === 'win32' ? b + '.cmd' : b)
    if (override) {
      return execPipe(override, ['--dir', profileRoot, 'add', name + '@' + target], {}, 240000)
    }
    try {
      return await execPipe(bin('pnpm'), ['--dir', profileRoot, 'add', name + '@' + target], {}, 240000)
    } catch (pnpmErr) {
      try {
        return await execPipe(bin('npm'), ['--prefix', profileRoot, 'install', name + '@' + target, '--no-audit', '--no-fund'], {}, 240000)
      } catch (npmErr) {
        throw new Error('pnpm failed: ' + String((pnpmErr && pnpmErr.message) || pnpmErr).slice(0, 600) +
          '; npm failed: ' + String((npmErr && npmErr.message) || npmErr).slice(0, 600))
      }
    }
  }

  /** Install the latest version in place. Never removes the current plugin. */
  async function runUpgrade() {
    if (upgrade.running) return upgrade
    if (!latestVersion) { try { await checkUpdate() } catch (err) { /* ignore */ } }
    upgrade.running = true
    upgrade.ok = null
    upgrade.message = ''
    upgrade.log = ''
    try {
      const target = latestVersion
      const profileRootForCheck = findProfileRoot()
      const localSpec = profileRootForCheck ? localInstallOf(profileRootForCheck) : null
      if (localSpec) {
        upgrade.ok = 'local'
        upgrade.message = 'This is a local install (' + localSpec + '); online upgrade skipped — edit the source directly.'
      } else if (!target || !VERSION || !semverGt(target, VERSION)) {
        upgrade.ok = 'skip'
        upgrade.message = target ? 'Already up to date (v' + VERSION + ')' : 'No update information (unpublished or offline)'
      } else {
        const profileRoot = profileRootForCheck || (() => { throw new Error('cannot locate the profile install root') })()
        const result = await runInstall(profileRoot, target)
        upgrade.log = String((result && result.log) || '').slice(-2000)
        upgrade.ok = 'ok'
        upgrade.message = 'Upgraded to v' + target + '; restart dsh web to apply'
      }
    } catch (err) {
      upgrade.ok = 'fail'
      upgrade.message = 'Automatic upgrade failed: ' + String((err && err.message) || err)
      upgrade.log = String((err && err.stack) || upgrade.log).slice(-2000)
    } finally {
      upgrade.running = false
    }
    return upgrade
  }

  /** Version/upgrade metadata, kept separate from UI state so it can be polled alone. */
  function metaPayload() {
    const profileRoot = findProfileRoot()
    return {
      name,
      version: VERSION,
      latest: latestVersion,
      updateChecked,
      updateAvailable: !!(latestVersion && VERSION && semverGt(latestVersion, VERSION)),
      upgrade: { running: upgrade.running, ok: upgrade.ok, message: upgrade.message },
      localInstall: profileRoot ? localInstallOf(profileRoot) : null,
      updateDisabled: UPDATE_CHECK_DISABLED(),
    }
  }

  // ================= HTTP routes =================

  function sendJson(res, code, obj) {
    let body = ''
    try { body = JSON.stringify(obj) } catch (err) { body = '{"error":"serialize failed"}' }
    try {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    } catch (err) { /* connection already closed */ }
  }

  // The route MUST go through ctx.effect. `webServer.register` is a *service*
  // method, not a ctx method, so nothing tracks its disposer for us — calling it
  // bare and discarding the return value leaves the route behind after unload,
  // and the next hot-mount dies with:
  //   webserver: duplicate prefix route "/pocket"
  // (observed when toggling the plugin off/on from the market UI).
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/pocket',
    handler: async (req, res) => {
      let pathname = '/'
      try { pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname } catch (err) { pathname = req.url || '/' }

      if (pathname === '/pocket/hello') {
        sendJson(res, 200, { ok: true, name, version: VERSION })
        return
      }

      if (pathname === '/pocket/meta') {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }); return }
        sendJson(res, 200, metaPayload())
        return
      }

      if (pathname === '/pocket/check-update') {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        try { await checkUpdate() } catch (err) { /* offline, silent */ }
        sendJson(res, 200, metaPayload())
        return
      }

      if (pathname === '/pocket/upgrade') {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const state = await runUpgrade()
        sendJson(res, 200, {
          ...metaPayload(),
          upgrade: { running: state.running, ok: state.ok, message: state.message, log: state.log },
        })
        return
      }

      sendJson(res, 404, {
        error: 'not found',
        routes: ['/pocket/hello', '/pocket/meta', 'POST /pocket/check-update', 'POST /pocket/upgrade'],
      })
    },
  }), name + ': routes')

  // Startup check + periodic re-check; fire-and-forget so a slow registry can
  // never delay plugin activation.
  //
  // A raw timer inside ctx.effect, matching the house style in the core packages
  // (see @deepseek-ai/dsh-client-hmr). `ctx.setInterval` is mixed in from the
  // timer service, and the mixin's proxy resolves `this.ctx` to the *service's*
  // own context rather than the caller's, so the timer would outlive this
  // plugin. unref() keeps a pending check from holding the process open.
  ctx.effect(() => {
    void checkUpdate()
    const timer = setInterval(() => { void checkUpdate() }, UPDATE_CHECK_INTERVAL)
    // Node timers expose unref(); not every host does, and a missing one must not
    // take the plugin down.
    if (typeof timer.unref === 'function') timer.unref()
    return () => { clearInterval(timer) }
  }, name + ': update-check')

  ctx.logger?.info?.(`[${name}] host ready · v${VERSION}`)
}

export { name, inject, apply }
