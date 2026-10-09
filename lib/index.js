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
 *   DSH_POCKET_PROFILE_ROOT=<dir>  the profile this copy is installed into, when
 *                                  it cannot be discovered by walking (tests,
 *                                  and link:/file: installs in an unusual home)
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
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
  /** This package's own directory — the one holding package.json. */
  const PACKAGE_ROOT = path.join(path.dirname(here), '..')
  let VERSION = ''
  try {
    VERSION = String((req(path.join(PACKAGE_ROOT, 'package.json')) || {}).version || '')
  } catch (err) { /* ignore: version falls back to empty string */ }

  /**
   * The version sitting on disk *right now*, as opposed to `VERSION`.
   *
   * `VERSION` is read once, when this module is first imported, so it describes
   * the code this process is running — not what the user has installed. The two
   * drift apart the moment the package is replaced in place, which is the normal
   * case here: the client half is served from disk and hot-reloads, while this
   * half lives in an already-imported Node module with no unload path.
   *
   * That drift is invisible from inside one process and produces genuinely
   * confusing reports: "the settings row says v0.1.4 while the checkout is
   * v0.1.7", or a button that fails with "cannot locate the profile install
   * root". Re-reading the manifest per request costs one ~2 KB read and turns an
   * unexplainable state into a named one.
   *
   * Must read the file directly: `req()` on a .json goes through the CJS loader,
   * so it would hand back the very cache this function exists to bypass.
   */
  function installedVersion() {
    try {
      const raw = fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
      return String((JSON.parse(raw) || {}).version || '')
    } catch (err) { return '' }
  }

  /**
   * True when the code in this process is older than the package on disk.
   *
   * Upgrading an already-stale process cannot help — the newer files are in
   * place and only a restart picks them up — so the row must say that instead of
   * offering an upgrade that will either do nothing or make the mismatch worse.
   */
  function isStale() {
    const onDisk = installedVersion()
    return !!(onDisk && VERSION && onDisk !== VERSION)
  }

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
  // The registry list itself lives in registryCandidates() above.
  const UPDATE_CHECK_DISABLED = () => !!process.env.DSH_POCKET_NO_UPDATE_CHECK

  let latestVersion = null
  let updateChecked = false
  let checkInFlight = null
  /** Why the last registry lookup produced nothing; surfaced instead of a silent null. */
  let updateError = ''

  /**
   * Registry candidates, tried in order until one answers.
   *
   * A single hard-coded `registry.npmjs.org` was a real defect on the machine
   * this plugin runs on: a NAS behind a mainland-China uplink frequently cannot
   * reach npmjs at all, so the lookup timed out, `latestVersion` stayed null, and
   * the settings row said "未检测更新" — which reads like "there is no update"
   * rather than "the check never completed". A mirror is the difference between
   * the feature working and looking broken.
   */
  function registryCandidates() {
    const override = String(process.env.DSH_POCKET_REGISTRY || '').trim()
    if (override) return [override.replace(/\/+$/, '')]
    return [
      'https://registry.npmjs.org',
      'https://registry.npmmirror.com',
    ]
  }

  /** Look up the latest published version; de-duplicated and offline-silent. */
  function checkUpdate() {
    if (UPDATE_CHECK_DISABLED()) {
      updateChecked = true
      latestVersion = null
      updateError = 'disabled'
      return Promise.resolve(null)
    }
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      const failures = []
      updateError = ''
      for (const base of registryCandidates()) {
        try {
          const doc = await httpsGetJson(base + '/' + name + '/latest')
          const version = doc && typeof doc === 'object' ? String(doc.version || '') : ''
          if (version) {
            latestVersion = version
            updateChecked = true
            return latestVersion
          }
          failures.push(base + ': no version field')
        } catch (err) {
          failures.push(base + ': ' + String((err && err.message) || err))
        }
      }
      // Every candidate failed. Record why rather than degrading to an
      // indistinguishable null, so the UI can say "the check did not run".
      latestVersion = null
      updateError = failures.join('; ').slice(0, 400) || 'no registry candidates'
      updateChecked = true
      return null
    })().finally(() => { checkInFlight = null })
    return checkInFlight
  }

  /**
   * Walk up from this module looking for the profile root (a package.json that
   * declares `dsh.profile`). Works for hoisted and pnpm virtual-store layouts;
   * this package's own manifest declares only dsh.client/dsh.bundle, so it can
   * never match itself.
   */
  function readProfileManifest(dir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      return pkg && pkg.dsh && pkg.dsh.profile ? pkg : null
    } catch (err) {
      return null
    }
  }

  function realpathOrNull(target) {
    try { return fs.realpathSync(target) } catch (err) { return null }
  }

  /**
   * Locate the profile this copy is installed into.
   *
   * Three strategies, in order, because "walk up from `import.meta.url`" is only
   * correct for one of the two ways a plugin can be installed:
   *
   *   1. an explicit override, for layouts nothing else can describe;
   *   2. the upward walk — right whenever the module really lives inside the
   *      profile (a registry install);
   *   3. the profile scan — required for `link:`/`file:`/`workspace:` installs,
   *      where Node resolves this module to the *source checkout*. The walk then
   *      starts outside the profile, finds nothing, and returns null — which
   *      silently disables `localInstall` and with it the guard that refuses to
   *      replace a checkout with a published copy (see runUpgrade).
   */
  function findProfileRoot() {
    const override = String(process.env.DSH_POCKET_PROFILE_ROOT || '').trim()
    if (override && readProfileManifest(override)) return override

    let dir = path.dirname(here)
    for (let i = 0; i < 8; i++) {
      if (readProfileManifest(dir)) return dir
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }

    const home = String(process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
    const profilesDir = path.join(home, 'profiles')
    let profileNames = []
    try {
      profileNames = fs.readdirSync(profilesDir)
    } catch (err) {
      return null
    }

    // Identity first: a profile whose `node_modules/<name>` really is this
    // package. That is exact, and it survives several profiles installing us.
    const self = realpathOrNull(PACKAGE_ROOT)
    const declared = []
    for (const profileName of profileNames) {
      const root = path.join(profilesDir, profileName)
      const pkg = readProfileManifest(root)
      if (!pkg) continue
      const linked = realpathOrNull(path.join(root, 'node_modules', name))
      if (self !== null && linked === self) return root
      if (pkg.dependencies && pkg.dependencies[name]) declared.push(root)
    }
    // Otherwise only a profile that declares a dependency on us can be it. More
    // than one and the answer would be a guess, so decline rather than guess.
    return declared.length === 1 ? declared[0] : null
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

      // Order matters: staleness is checked *before* anything is installed. A
      // process running older code than the package on disk cannot be repaired
      // by installing: the newer files are already there and only a restart
      // picks them up. Installing over it would also leave the answer to "what
      // is actually installed?" unknowable until the next restart.
      if (isStale()) {
        upgrade.ok = 'stale'
        upgrade.message = 'This process is running v' + VERSION + ' while v' + installedVersion() +
          ' is already installed on disk — restart dsh web to load it (an upgrade cannot help).'
      } else {
        const profileRootForCheck = findProfileRoot()
        const localSpec = profileRootForCheck ? localInstallOf(profileRootForCheck) : null
        if (localSpec) {
          upgrade.ok = 'local'
          upgrade.message = 'This is a local install (' + localSpec + '); online upgrade skipped — edit the source directly.'
        } else if (!target || !VERSION || !semverGt(target, VERSION)) {
          upgrade.ok = 'skip'
          upgrade.message = target ? 'Already up to date (v' + VERSION + ')' : 'No update information (unpublished or offline)'
        } else if (!profileRootForCheck) {
          // This used to surface as "cannot locate the profile install root" —
          // accurate, but nothing a user can act on. Name the command instead.
          upgrade.ok = 'fail'
          upgrade.message = 'Cannot tell which profile this copy is installed into, so there is nothing to upgrade in place. ' +
            'Install explicitly: dsh plugin --profile <profile> add ' + name + '@' + target
        } else {
          const result = await runInstall(profileRootForCheck, target)
          upgrade.log = String((result && result.log) || '').slice(-2000)
          upgrade.ok = 'ok'
          upgrade.message = 'Upgraded to v' + target + '; restart dsh web to apply'
        }
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
    const onDisk = installedVersion()
    return {
      name,
      /** The version of the code loaded in this process. */
      version: VERSION,
      /**
       * The version on disk, which differs whenever the package was replaced
       * under a running process. Published so the settings row can say "restart
       * dsh web" instead of showing a version number nobody can account for.
       */
      installedVersion: onDisk,
      /** `version !== installedVersion` — i.e. a restart is pending. */
      stale: !!(onDisk && VERSION && onDisk !== VERSION),
      latest: latestVersion,
      updateChecked,
      updateAvailable: !!(latestVersion && VERSION && semverGt(latestVersion, VERSION)),
      upgrade: { running: upgrade.running, ok: upgrade.ok, message: upgrade.message },
      localInstall: profileRoot ? localInstallOf(profileRoot) : null,
      /**
       * Where the host half believes it is installed. Published because "the
       * upgrade path declined / declined nothing" is only diagnosable together
       * with the root it looked at — and because a `link:` install is exactly the
       * case where that root used to be found as null.
       */
      profileRoot: profileRoot || null,
      updateDisabled: UPDATE_CHECK_DISABLED(),
      // An empty `latest` has two very different causes — "the registry says you
      // are current" and "the registry was never reached" — and the settings row
      // has to be able to tell them apart.
      updateError: updateError || '',
      registries: registryCandidates(),
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

  /**
   * Serve `lib/probe-src.js` verbatim.
   *
   * The geometry probe is real source in its own file (lintable, diffable,
   * unit-tested by scripts/smoke-probe.js) rather than an escaped string inside
   * the bundle, and the browser half pulls it from here when the page is opened
   * with `?pocket=probe`. Serving it beats asking the user to paste a snippet
   * into a phone: in-app WebViews have no console, and "type this URL" is a
   * supportable instruction where "open remote debugging" is not.
   *
   * Read lazily and cached after the first hit, so a probe request is the only
   * thing that ever touches the filesystem. `no-store` because a cached probe is
   * a probe that lies about the build it is describing.
   */
  function sendProbeScript(res) {
    let body = ''
    try {
      body = fs.readFileSync(path.join(path.dirname(here), 'probe-src.js'), 'utf8')
    } catch (err) {
      sendJson(res, 500, {
        error: 'probe source is missing from this install',
        detail: String((err && err.message) || err),
        expectedAt: path.join(path.dirname(here), 'probe-src.js'),
      })
      return
    }
    try {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
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

      if (pathname === '/pocket/probe.js') {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }); return }
        sendProbeScript(res)
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
        routes: ['/pocket/hello', '/pocket/meta', '/pocket/probe.js',
          'POST /pocket/check-update', 'POST /pocket/upgrade'],
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

  // Plain console.log, like the other out-of-tree plugins: `ctx.logger` is not
  // guaranteed to exist, and "did the host half load at all?" has to be
  // answerable from the server log — that is the first question when the browser
  // side reports an unreachable host half.
  console.log('[' + name + '] host half active, version v' + (VERSION || '?') +
    ', routes under /pocket')
}

export { name, inject, apply }
