/**
 * DSH Reply Reader (dsh-reply-reader) — host half.
 *
 * The feature itself is entirely browser-side (Web Speech API): this half owns
 * only the pieces a pure Client plugin cannot have —
 *
 *  1. the loaded version, read from package.json at import time;
 *  2. the online-update channel mandated by this workspace (see
 *     DSH插件开发流程.md §4bis): check npm, refuse to overwrite a local
 *     link/file install, and upgrade the profile in place;
 *  3. read-only HTTP routes under /read-aloud for the panel's version block.
 *
 * Routes:
 *   GET  /read-aloud/hello          → { ok, name, version, installedVersion, stale }
 *   GET  /read-aloud/meta           → ReplyReaderMeta
 *   POST /read-aloud/check-update   → ReplyReaderMeta (force a registry check)
 *   POST /read-aloud/upgrade        → ReplyReaderMeta (with upgrade result)
 *
 * Everything degrades silently: registry failures never affect speaking.
 *
 * Test hooks (so the smoke suite can run fully offline):
 *   DSH_REPLY_READER_NO_UPDATE_CHECK=1   disable registry checks entirely
 *   DSH_REPLY_READER_REGISTRY=<url>      registry base (http:// endpoint allowed)
 *   DSH_REPLY_READER_PKG_MANAGER=<bin>   installer binary (fake pnpm in tests)
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { execFile } from 'node:child_process'

const name = 'dsh-reply-reader'
// webServer is a web-app service (routes may only register after webStartup is
// ready); timer supplies the periodic update check that is disposed with the
// plugin. Both must be declared so apply never runs too early.
const inject = ['timer', 'webServer']

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/read-aloud'
/** Registry check period: once at activation, then every 6 hours. */
const UPDATE_CHECK_INTERVAL = 6 * 3600 * 1000

const here = fileURLToPath(import.meta.url)
const PKG_PATH = path.resolve(path.dirname(here), '..', 'package.json')

/**
 * Read the package version from disk. Called once at import time for `VERSION`
 * (the code this process loaded) and per request for `installedVersion` (what
 * is currently on disk, bypassing the CJS json cache the way the manual requires).
 * @returns {string} semver, or '' when the manifest cannot be read.
 */
function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : ''
  } catch (err) {
    return ''
  }
}

const VERSION = readPkgVersion()

function semverParts(v) {
  return String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
}

/**
 * Compare the numeric part of two semver strings (prerelease counts as 0).
 * @returns {boolean} true when `a` is newer than `b`.
 */
function semverGt(a, b) {
  const pa = semverParts(a)
  const pb = semverParts(b)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

/**
 * GET one JSON document with a timeout, redirect support, and a body cap.
 * Picks node:http for http:// endpoints so tests and mirrors need no TLS.
 */
function httpsGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('http://') ? http : https
    const request = lib.get(url, { headers: { 'user-agent': name + '/' + (VERSION || '?') } }, (res) => {
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
      res.on('data', (chunk) => {
        body += chunk
        if (body.length > 200000) request.destroy()
      })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
      })
    })
    request.on('error', reject)
    request.setTimeout(timeoutMs || 8000, () => request.destroy(new Error('timeout')))
  })
}

// Registry base is read per call (never a module constant) so tests can inject it.
const REGISTRY = () => String(process.env.DSH_REPLY_READER_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '')
const UPDATE_DISABLED = () => !!process.env.DSH_REPLY_READER_NO_UPDATE_CHECK

let latestVersion = null
let updateChecked = false
let checkInFlight = null

/**
 * Ask the registry for the published latest version. Concurrent callers share
 * the in-flight promise; every failure leaves `latestVersion` null so the panel
 * simply shows "not published / offline".
 */
function checkUpdate() {
  if (UPDATE_DISABLED()) {
    updateChecked = true
    latestVersion = null
    return Promise.resolve(null)
  }
  if (checkInFlight) return checkInFlight
  checkInFlight = (async () => {
    try {
      const doc = await httpsGetJson(REGISTRY() + '/' + name + '/latest')
      const version = doc && typeof doc === 'object' ? String(doc.version || '') : ''
      latestVersion = version || null
    } catch (err) {
      latestVersion = null
    } finally {
      updateChecked = true
    }
    return latestVersion
  })().finally(() => { checkInFlight = null })
  return checkInFlight
}

/** Real path of this package's root (the link target for a local install). */
const PKG_ROOT = path.resolve(path.dirname(here), '..')

function realOrSelf(p) {
  try { return fs.realpathSync(p) } catch (err) { return p }
}

function isProfileRoot(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return !!(pkg && pkg.dsh && pkg.dsh.profile)
  } catch (err) {
    return false
  }
}

/**
 * Candidate profile directories, most specific first:
 *  1. `DSH_PROFILE_DIR` (set by a profile-launched Harness),
 *  2. directories above this module's *resolved* path (normal installs),
 *  3. every `$DSH_HOME/profiles/<name>` — required for `link:` installs, because
 *     Node resolves the symlink out of the profile, so walking up from the
 *     workspace copy never reaches it.
 * @returns {string[]} absolute candidate directories.
 */
function profileCandidates() {
  const list = []
  const envDir = process.env.DSH_PROFILE_DIR
  if (envDir) list.push(envDir)
  let dir = path.dirname(here)
  for (let i = 0; i < 8; i++) {
    list.push(dir)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  try {
    for (const entry of fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true })) {
      if (entry.isDirectory()) list.push(path.join(home, 'profiles', entry.name))
    }
  } catch (err) { /* no profiles directory */ }
  return [...new Set(list)].filter(isProfileRoot)
}

/**
 * The profile that owns this package: prefer the one whose `node_modules/<name>`
 * resolves to this exact copy, then one declaring a dependency on it, then any
 * profile found above (first install, nothing recorded yet).
 * @returns {string|null} absolute profile directory.
 */
function findProfileRoot() {
  const candidates = profileCandidates()
  const mine = realOrSelf(PKG_ROOT)
  for (const dir of candidates) {
    if (realOrSelf(path.join(dir, 'node_modules', name)) === mine && fs.existsSync(path.join(dir, 'node_modules', name))) return dir
  }
  for (const dir of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      if (pkg.dependencies && pkg.dependencies[name] !== undefined) return dir
    } catch (err) { /* unreadable; try next */ }
  }
  return candidates[0] || null
}

/**
 * The profile dependency spec when this package is a source/local install.
 * Such an install must never be replaced by `pnpm add <name>@latest`: that would
 * swap the user's link for a registry copy and silently discard local edits.
 * @returns {string|null} the offending spec, or null for a registry install.
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

/**
 * Disk version vs. the version this process loaded. After an in-place upgrade
 * the running code stays old until `dsh web` restarts; the panel must say so
 * instead of offering an upgrade that cannot help.
 */
function installState() {
  const installedVersion = readPkgVersion()
  return {
    installedVersion,
    stale: !!installedVersion && !!VERSION && installedVersion !== VERSION,
  }
}

const upgrade = { running: false, ok: null, message: '' }

function execPipe(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    let child
    try {
      // Windows needs shell:true to resolve .cmd shims from PATH.
      child = execFile(bin, args, {
        timeout: timeoutMs || 240000,
        maxBuffer: 8 * 1024 * 1024,
        shell: isWin,
        windowsHide: isWin,
      })
    } catch (err) {
      reject(err)
      return
    }
    let out = ''
    if (child.stdout) child.stdout.on('data', (d) => { out += d })
    if (child.stderr) child.stderr.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ log: out })
      else reject(new Error(bin + ' 退出码 ' + code + '\n' + String(out).slice(-1500)))
    })
  })
}

/** Install one registry version into the profile: pnpm first, npm as fallback. */
async function runInstall(profileRoot, target) {
  const override = process.env.DSH_REPLY_READER_PKG_MANAGER
  const bin = (b) => (process.platform === 'win32' ? b + '.cmd' : b)
  if (override) return execPipe(override, ['--dir', profileRoot, 'add', name + '@' + target], 240000)
  try {
    return await execPipe(bin('pnpm'), ['--dir', profileRoot, 'add', name + '@' + target], 240000)
  } catch (pnpmErr) {
    try {
      return await execPipe(bin('npm'), ['--prefix', profileRoot, 'install', name + '@' + target, '--no-audit', '--no-fund'], 240000)
    } catch (npmErr) {
      throw new Error('pnpm 失败：' + String((pnpmErr && pnpmErr.message) || pnpmErr).slice(0, 600) +
        '；npm 失败：' + String((npmErr && npmErr.message) || npmErr).slice(0, 600))
    }
  }
}

/**
 * Upgrade the profile in place (never remove+add): a failed install must leave
 * the current plugin installed. Branch order matters — a stale process, a local
 * source install, and "already latest" each need a different answer.
 * @returns {Promise<typeof upgrade>} the final upgrade state.
 */
async function runUpgrade() {
  if (upgrade.running) return upgrade
  if (!latestVersion) {
    try { await checkUpdate() } catch (err) { /* offline: fall through */ }
  }
  upgrade.running = true
  upgrade.ok = null
  upgrade.message = ''
  try {
    const state = installState()
    const target = latestVersion
    const profileRoot = findProfileRoot()
    const localSpec = profileRoot ? localInstallOf(profileRoot) : null
    if (state.stale) {
      upgrade.ok = 'stale'
      upgrade.message = '安装包已是 v' + state.installedVersion + '，当前进程仍是 v' + VERSION +
        '：请重启 dsh web 让新代码生效（进程内升级不会替换已加载的模块）'
    } else if (localSpec) {
      upgrade.ok = 'local'
      upgrade.message = '当前是本地安装（' + localSpec + '），已跳过在线升级：直接改源码即可；要发布请用 scripts/publish-plugin.sh'
    } else if (!target || !VERSION || !semverGt(target, VERSION)) {
      upgrade.ok = 'skip'
      upgrade.message = target ? '已是最新版本（v' + VERSION + '）' : '暂无更新信息（未发布或离线）'
    } else if (!profileRoot) {
      throw new Error('无法定位插件安装目录（profile）')
    } else {
      await runInstall(profileRoot, target)
      upgrade.ok = 'ok'
      upgrade.message = '已升级到 v' + target + '，重启 dsh web 后生效'
    }
  } catch (err) {
    upgrade.ok = 'fail'
    upgrade.message = '自动升级失败：' + String((err && err.message) || err)
  } finally {
    upgrade.running = false
  }
  return upgrade
}

/** Version + update + install facts for the panel's version block. */
function metaPayload() {
  const profileRoot = findProfileRoot()
  const state = installState()
  return {
    name,
    version: VERSION,
    installedVersion: state.installedVersion,
    stale: state.stale,
    latest: latestVersion,
    updateChecked,
    updateAvailable: !!(latestVersion && VERSION && semverGt(latestVersion, VERSION)),
    upgrade: { running: upgrade.running, ok: upgrade.ok, message: upgrade.message },
    localInstall: profileRoot ? localInstallOf(profileRoot) : null,
    updateDisabled: UPDATE_DISABLED(),
  }
}

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
  } catch (err) { /* connection already gone */ }
}

/**
 * Register the host routes and the periodic registry check.
 * @param {object} ctx - Cordis host context (webServer + timer injected).
 */
function apply(ctx) {
  const handler = async (req, res) => {
    let pathname = '/'
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    } catch (err) {
      pathname = req.url || '/'
    }

    if (pathname === ROUTE_PREFIX + '/hello') {
      const state = installState()
      sendJson(res, 200, { ok: true, name, version: VERSION, installedVersion: state.installedVersion, stale: state.stale })
      return
    }

    if (pathname === ROUTE_PREFIX + '/meta') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }); return }
      sendJson(res, 200, metaPayload())
      return
    }

    if (pathname === ROUTE_PREFIX + '/check-update') {
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
      try { await checkUpdate() } catch (err) { /* offline is silent */ }
      sendJson(res, 200, metaPayload())
      return
    }

    if (pathname === ROUTE_PREFIX + '/upgrade') {
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
      const state = await runUpgrade()
      sendJson(res, 200, { ...metaPayload(), upgrade: { running: state.running, ok: state.ok, message: state.message } })
      return
    }

    sendJson(res, 404, {
      error: 'not found',
      routes: [
        'GET ' + ROUTE_PREFIX + '/hello',
        'GET ' + ROUTE_PREFIX + '/meta',
        'POST ' + ROUTE_PREFIX + '/check-update',
        'POST ' + ROUTE_PREFIX + '/upgrade',
      ],
    })
  }

  // Own the route with an effect so unloading the plugin removes it.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'reply-reader: routes')

  // Fire-and-forget version checks: offline / unpublished must never block the panel.
  void checkUpdate()
  ctx.setInterval(() => { void checkUpdate() }, UPDATE_CHECK_INTERVAL)

  // This line is the only evidence that the host half loaded (see the manual §3).
  console.log('[' + name + '] host half active, version v' + (VERSION || '?') + ', routes under ' + ROUTE_PREFIX)
}

export { name, inject, apply }
