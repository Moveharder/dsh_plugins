/**
 * Host-half smoke test — no network, no real installs.
 *
 * The host half is small but it owns the riskiest code in the package: the
 * online-upgrade path, which shells out to a package manager. So the test does
 * not merely call the routes — it builds throwaway profile layouts in a temp
 * directory and asserts the *decisions*:
 *
 *   - a local (link/file/tarball) install must refuse to upgrade, because
 *     `pnpm add <name>@latest` would replace the user's source checkout with a
 *     published copy and silently discard their edits;
 *   - a registry install must upgrade, and must invoke the package manager with
 *     exactly `add <name>@<version>`;
 *   - an unreachable registry must degrade silently, never report success.
 *
 * Every external dependency (registry base, package manager binary) is
 * injectable through an environment variable, which is what makes the whole
 * path testable offline.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.join(here, '..')
const PKG = 'dsh-pocket-ui'

let passed = 0
async function check(label, fn) {
  await fn()
  passed += 1
  console.log('  ok  ' + label)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const cleanup = []
async function tmpdir(prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
  cleanup.push(dir)
  return dir
}

/**
 * Materialise a fake profile containing a copy of this plugin, so the host
 * half's `findProfileRoot()` walk lands somewhere predictable.
 */
async function makeProfile({ dependencySpec }) {
  const root = await tmpdir('pocket-profile-')
  const installed = path.join(root, 'node_modules', PKG)
  await fsp.mkdir(path.join(installed, 'lib'), { recursive: true })
  await fsp.copyFile(path.join(pkgRoot, 'lib', 'index.js'), path.join(installed, 'lib', 'index.js'))
  await fsp.copyFile(path.join(pkgRoot, 'package.json'), path.join(installed, 'package.json'))
  await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', PKG] } },
    dependencies: { [PKG]: dependencySpec },
  }, null, 2))
  return { root, entry: path.join(installed, 'lib', 'index.js') }
}

/** Import a plugin copy without ESM cache collisions. */
let importSeq = 0
async function loadHostHalf(entry) {
  importSeq += 1
  return import(pathToFileURL(entry).href + '?v=' + importSeq)
}

/** Minimal ctx capturing the registered route and disposers. */
function makeCtx() {
  const routes = []
  const logs = []
  const disposers = []
  return {
    routes,
    logs,
    disposers,
    webServer: {
      // Mirrors the real service: duplicate (kind, path) throws, and register
      // returns the disposer that removes the route. Both halves matter — the
      // throwing half is what made the hot-remount bug observable.
      register(route) {
        if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        }
        routes.push(route)
        return () => {
          const i = routes.indexOf(route)
          if (i !== -1) routes.splice(i, 1)
        }
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    get: () => null,
    logger: { info: (m) => logs.push(m) },
  }
}

/** Run every disposer the plugin registered, as an unload would. */
function unload(ctx) {
  for (const dispose of ctx.disposers.splice(0)) dispose()
}

/** Minimal req/res pair. */
function callRoute(route, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const chunks = []
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) {
        chunks.push(body)
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(chunks.join('')) }) } catch (err) { reject(err) }
      },
    }
    Promise.resolve(route.handler({ url: pathname, method }, res)).catch(reject)
  })
}

/** A stand-in package manager that records its argv instead of installing. */
async function makeFakePkgManager() {
  const dir = await tmpdir('pocket-pm-')
  const log = path.join(dir, 'argv.log')
  const bin = path.join(dir, 'fake-pm.sh')
  await fsp.writeFile(bin, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 })
  return { bin, log }
}

async function readLog(file) {
  try { return (await fsp.readFile(file, 'utf8')).trim() } catch (err) { return '' }
}

/** A local registry that answers `/<pkg>/latest`. */
function startRegistry(payload, status = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
    server.listen(0, '127.0.0.1', () => {
      cleanup.push(server)
      resolve({ url: 'http://127.0.0.1:' + server.address().port, server })
    })
  })
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

const ENV_KEYS = ['DSH_POCKET_REGISTRY', 'DSH_POCKET_NO_UPDATE_CHECK', 'DSH_POCKET_PKG_MANAGER']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function setEnv(patch) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, patch)
}

try {
  // -- contract ------------------------------------------------------------
  const bare = await loadHostHalf(path.join(pkgRoot, 'lib', 'index.js'))

  await check('host half exports the loader contract', () => {
    assert.equal(bare.name, PKG)
    assert.ok(Array.isArray(bare.inject))
    assert.equal(typeof bare.apply, 'function')
  })

  await check('host half injects webServer before registering routes', () => {
    // Without webServer in inject, apply can run before webStartup is ready and
    // the route registration is silently lost.
    assert.ok(bare.inject.includes('webServer'), 'inject must include webServer')
  })

  // -- routes --------------------------------------------------------------
  setEnv({ DSH_POCKET_NO_UPDATE_CHECK: '1' })
  const offline = await makeProfile({ dependencySpec: '^0.0.1' })
  const mod = await loadHostHalf(offline.entry)
  const ctx = makeCtx()
  mod.apply(ctx)

  await check('registers exactly one prefix route under /pocket', () => {
    assert.equal(ctx.routes.length, 1)
    assert.equal(ctx.routes[0].kind, 'prefix')
    assert.equal(ctx.routes[0].path, '/pocket')
  })

  await check('schedules a periodic update re-check that unload clears', () => {
    // The interval is a raw timer owned by ctx.effect (house style in the core
    // packages). Spy on the globals to prove it is both created and cleared —
    // `ctx.setInterval` would bind to the timer service's fiber, not ours, and
    // outlive the plugin.
    const realSet = globalThis.setInterval
    const realClear = globalThis.clearInterval
    const created = []
    const cleared = []
    globalThis.setInterval = (fn, ms) => { const h = { fn, ms, unref() {} }; created.push(h); return h }
    globalThis.clearInterval = (h) => { cleared.push(h) }
    try {
      const spyCtx = makeCtx()
      const spyMod = mod
      spyMod.apply(spyCtx)
      assert.equal(created.length, 1, 'exactly one interval created')
      assert.equal(created[0].ms, 6 * 3600 * 1000)
      unload(spyCtx)
      assert.equal(cleared.length, 1, 'the interval must be cleared on unload')
      assert.equal(cleared[0], created[0], 'the same timer handle is cleared')
    } finally {
      globalThis.setInterval = realSet
      globalThis.clearInterval = realClear
    }
  })

  await check('unload releases the route so a hot remount works', async () => {
    // Reproduces the reported failure. `webServer.register` is a service method,
    // so its disposer is NOT tracked by ctx — discarding it left the route in the
    // table and the next mount died with:
    //   webserver: duplicate prefix route "/pocket"
    const remount = await makeProfile({ dependencySpec: '^0.0.1' })
    const m = await loadHostHalf(remount.entry)
    const c = makeCtx()

    m.apply(c)
    assert.equal(c.routes.length, 1, 'first mount registers the route')

    unload(c)
    assert.equal(c.routes.length, 0, 'unload must release the route')

    // Same context again: would throw "duplicate prefix route" if it leaked.
    m.apply(c)
    assert.equal(c.routes.length, 1, 'second mount registers cleanly')

    unload(c)
    assert.equal(c.routes.length, 0, 'second unload also releases')
  })

  await check('GET /pocket/hello reports the package version', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
    const res = await callRoute(ctx.routes[0], '/pocket/hello')
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.version, pkg.version)
  })

  await check('GET /pocket/meta degrades silently with checks disabled', async () => {
    const res = await callRoute(ctx.routes[0], '/pocket/meta')
    assert.equal(res.status, 200)
    assert.equal(res.body.updateDisabled, true)
    assert.equal(res.body.latest, null)
    assert.equal(res.body.updateAvailable, false)
    assert.equal(res.body.updateChecked, true)
  })

  await check('unknown routes 404 with a route index', async () => {
    const res = await callRoute(ctx.routes[0], '/pocket/nope')
    assert.equal(res.status, 404)
    assert.ok(Array.isArray(res.body.routes))
  })

  await check('mutating routes reject GET', async () => {
    const res = await callRoute(ctx.routes[0], '/pocket/upgrade', 'GET')
    assert.equal(res.status, 405)
  })

  // -- registry reachable --------------------------------------------------
  const registry = await startRegistry({ version: '9.9.9' })
  setEnv({ DSH_POCKET_REGISTRY: registry.url })
  const reachable = await makeProfile({ dependencySpec: '^0.0.1' })
  const mod2 = await loadHostHalf(reachable.entry)
  const ctx2 = makeCtx()
  mod2.apply(ctx2)
  await new Promise((r) => setTimeout(r, 150)) // let the startup check settle

  await check('a reachable registry produces an update offer', async () => {
    const res = await callRoute(ctx2.routes[0], '/pocket/check-update', 'POST')
    assert.equal(res.body.latest, '9.9.9')
    assert.equal(res.body.updateAvailable, true)
  })

  // -- local install protection (the pitfall this test exists for) ----------
  await check('a local link install refuses to upgrade', async () => {
    // A source checkout: upgrading would swap it for a published copy.
    const linked = await makeProfile({ dependencySpec: 'link:/somewhere/dsh-pocket-ui' })
    const modLink = await loadHostHalf(linked.entry)
    const ctxLink = makeCtx()
    modLink.apply(ctxLink)
    await new Promise((r) => setTimeout(r, 150))

    const res = await callRoute(ctxLink.routes[0], '/pocket/upgrade', 'POST')
    assert.equal(res.body.upgrade.ok, 'local',
      'a link: install must never be replaced by a published copy')
    assert.match(res.body.upgrade.message, /local install/i)
    assert.match(res.body.upgrade.message, /link:/)
  })

  await check('a tarball install also refuses to upgrade', async () => {
    const tarball = await makeProfile({ dependencySpec: './dsh-pocket-ui-0.1.0.tgz' })
    const mod3 = await loadHostHalf(tarball.entry)
    const ctx3 = makeCtx()
    mod3.apply(ctx3)
    const res = await callRoute(ctx3.routes[0], '/pocket/upgrade', 'POST')
    assert.equal(res.body.upgrade.ok, 'local')
  })

  // -- registry install upgrades -------------------------------------------
  await check('a registry install upgrades via the injected package manager', async () => {
    const pm = await makeFakePkgManager()
    setEnv({ DSH_POCKET_REGISTRY: registry.url, DSH_POCKET_PKG_MANAGER: pm.bin })
    const reg = await makeProfile({ dependencySpec: '^0.0.1' })
    const mod4 = await loadHostHalf(reg.entry)
    const ctx4 = makeCtx()
    mod4.apply(ctx4)
    await new Promise((r) => setTimeout(r, 150))

    const res = await callRoute(ctx4.routes[0], '/pocket/upgrade', 'POST')
    assert.equal(res.body.upgrade.ok, 'ok', res.body.upgrade.message)
    assert.match(res.body.upgrade.message, /restart dsh web/i)

    const argv = await readLog(pm.log)
    // Compare on the profile basename: macOS resolves /var -> /private/var.
    assert.ok(argv.includes('--dir'), 'must pass --dir <profile>, got: ' + argv)
    assert.ok(argv.includes(path.basename(reg.root)),
      'must target the profile root, got: ' + argv)
    assert.ok(argv.includes('add ' + PKG + '@9.9.9'),
      'must pin the exact target version, got: ' + argv)
  })

  // -- registry unreachable ------------------------------------------------
  await check('an unreachable registry never reports success', async () => {
    // Port 1 is reserved and refuses connections immediately.
    setEnv({ DSH_POCKET_REGISTRY: 'http://127.0.0.1:1' })
    const dead = await makeProfile({ dependencySpec: '^0.0.1' })
    const mod5 = await loadHostHalf(dead.entry)
    const ctx5 = makeCtx()
    mod5.apply(ctx5)

    const meta = await callRoute(ctx5.routes[0], '/pocket/meta')
    assert.equal(meta.body.latest, null)
    assert.equal(meta.body.updateAvailable, false)

    const res = await callRoute(ctx5.routes[0], '/pocket/upgrade', 'POST')
    assert.notEqual(res.body.upgrade.ok, 'ok', 'offline must not claim success')
    assert.equal(res.body.upgrade.ok, 'skip')
  })
} finally {
  setEnv(savedEnv)
  for (const item of cleanup) {
    try {
      if (typeof item === 'function') item()
      else if (item.close) item.close()
      else await fsp.rm(item, { recursive: true, force: true })
    } catch (err) { /* best effort */ }
  }
}

console.log('\nhost smoke: ' + passed + ' checks passed')
