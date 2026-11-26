/* Smoke test — dsh-reply-reader host half. Fully offline.
 *
 * 覆盖：
 *  - manifest 自洽：main/types/exports 指向的文件真实存在且被 files 白名单覆盖
 *  - lib/index.d.ts 真的声明了 name / inject / apply
 *  - patch 插入的行 id/name 与 package.json 一致
 *  - /read-aloud/hello、/meta、/check-update、/upgrade、未知路径
 *  - 本地 link 安装 → 在线升级被拒绝（ok='local'）
 *  - 本地 registry（node:http）+ 假包管理器 → 升级成功链路（注入参数含 @9.9.9）
 *  - 磁盘版本比进程新（stale）→ 只提示重启，拒绝再次升级
 *  - registry 不可达 → 静默降级（latest=null，不报成功）
 *  - 离线开关 DSH_REPLY_READER_NO_UPDATE_CHECK=1 生效
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

let failures = 0
function assert(cond, label) {
  if (cond) console.log('  ✓ ' + label)
  else { failures++; console.error('  ✗ ' + label) }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log('  ✓ ' + label); return }
  failures++
  console.error('  ✗ ' + label + '\n    actual=' + JSON.stringify(actual) + '\n    expected=' + JSON.stringify(expected))
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const NAME = pkg.name
const VERSION = pkg.version

// ---------------------------------------------------------------- manifest
console.log('\n[manifest]')
const declaredPaths = []
const addExportPath = (value, key) => {
  if (typeof value === 'string') { declaredPaths.push([key, value]); return }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) addExportPath(v, key + '.' + k)
  }
}
addExportPath(pkg.main, 'main')
addExportPath(pkg.types, 'types')
for (const [key, value] of Object.entries(pkg.exports || {})) {
  if (key === './package.json') continue
  addExportPath(value, 'exports' + key)
}

const filesList = pkg.files || []
function coveredByFiles(rel) {
  return filesList.some((entry) => {
    if (entry.endsWith('/*.json')) {
      const dir = entry.slice(0, -'/*.json'.length)
      return rel.startsWith(dir + '/') && rel.endsWith('.json') && !rel.slice(dir.length + 1).includes('/')
    }
    return rel === entry || rel.startsWith(entry + '/')
  })
}

for (const [label, rel] of declaredPaths) {
  // Wildcard exports describe a family, not one file: the locale JSONs are
  // checked separately below.
  if (rel.includes('*')) continue
  const clean = rel.replace(/^\.\//, '')
  assert(fs.existsSync(path.join(ROOT, clean)), label + ' 指向的文件存在: ' + rel)
  assert(coveredByFiles(clean), label + ' 被 files 白名单覆盖: ' + rel)
}

const dts = fs.readFileSync(path.join(ROOT, 'lib', 'index.d.ts'), 'utf8')
assert(/export declare const name: 'dsh-reply-reader'/.test(dts), 'index.d.ts 声明 name 字面量')
assert(/export declare const inject: readonly \[/.test(dts), 'index.d.ts 声明 inject 元组')
assert(/export declare function apply\(ctx: unknown\): void/.test(dts), 'index.d.ts 声明 apply')

assert(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch 指向 cordis.patch.yml')
assert(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform = web')
const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
assert(patch.includes("id: read-aloud"), 'patch 使用 id read-aloud')
assert(patch.includes("name: '" + NAME + "'"), 'patch 的 name 与包名一致')
assert(!/\$VAR|TBD/.test(pkg.description), 'description 不是模板占位')

for (const locale of ['en', 'zh']) {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'locale', locale + '.json'), 'utf8'))
  assert(doc.meta && typeof doc.meta.title === 'string' && doc.meta.title.length > 1, 'locale/' + locale + '.json 有 meta.title')
  assert(doc.meta && typeof doc.meta.description === 'string' && doc.meta.description.length > 5, 'locale/' + locale + '.json 有 meta.description')
}

// ---------------------------------------------------------------- fixtures
console.log('\n[host routes]')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drr-fixture-'))
let fakeManagerLog = ''

/** Build `<profile>/node_modules/dsh-reply-reader` and import a fresh module copy. */
function makeProfile(id, depSpec) {
  const profileRoot = path.join(tmpRoot, id)
  const installed = path.join(profileRoot, 'node_modules', NAME)
  fs.mkdirSync(path.join(installed, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: NAME, version: VERSION, main: 'lib/index.js', type: 'module' }))
  fs.copyFileSync(path.join(ROOT, 'lib', 'index.js'), path.join(installed, 'lib', 'index.js'))
  fs.writeFileSync(path.join(profileRoot, 'package.json'), JSON.stringify({
    name: 'dsh-profile-test',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', NAME] } },
    dependencies: { [NAME]: depSpec },
  }))
  return { profileRoot, installed }
}

/** Load the host half with a mock context and capture the registered route. */
async function load(installed) {
  const mod = await import(pathToFileURL(path.join(installed, 'lib', 'index.js')).href + '?v=' + Math.random())
  const captured = { route: null, intervals: [], logs: [] }
  const realLog = console.log
  console.log = (...args) => { captured.logs.push(args.join(' ')) }
  try {
    mod.apply({
      effect: (fn) => { fn(); return () => {} },
      setInterval: (fn, ms) => { captured.intervals.push(ms); return () => {} },
      webServer: { register: (route) => { captured.route = route; return () => {} } },
      logger: { info: () => {} },
    })
  } finally {
    console.log = realLog
  }
  return { mod, captured }
}

function call(captured, method, url) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {} }
    const res = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this },
      end(chunk) {
        this.body += chunk || ''
        resolve({ status: this.statusCode, headers: this.headers, json: () => JSON.parse(this.body || '{}') })
      },
      on() { return this },
      once() { return this },
      setTimeout() { return this },
    }
    Promise.resolve(captured.route.handler(req, res)).catch(reject)
  })
}

/** Local npm-compatible registry endpoint; `version=null` answers 404. */
async function startRegistry(version) {
  const server = http.createServer((req, res) => {
    if (!version) { res.writeHead(404); res.end('{}'); return }
    const body = JSON.stringify({ name: NAME, 'dist-tags': { latest: version }, version })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

function writeFakeManager() {
  const file = path.join(tmpRoot, 'fake-pnpm.sh')
  fakeManagerLog = path.join(tmpRoot, 'fake-pnpm.log')
  fs.writeFileSync(file, '#!/bin/sh\nprintf "%s\\n" "$@" > "' + fakeManagerLog + '"\nexit 0\n')
  fs.chmodSync(file, 0o755)
  return file
}

// ---- fixture 1: local link install, checks disabled ----
const local = makeProfile('profile-local', 'link:/some/local/path')
process.env.DSH_REPLY_READER_NO_UPDATE_CHECK = '1'
const first = await load(local.installed)
eq(first.mod.name, NAME, 'host 导出 name')
eq(first.mod.inject, ['timer', 'webServer'], 'host 导出 inject: timer + webServer')
assert(first.captured.logs.some((line) => line.includes('[dsh-reply-reader] host half active')), 'apply 打印启动日志（Host 是否加载的唯一现场证据）')
assert(!!first.captured.route && first.captured.route.path === '/read-aloud' && first.captured.route.kind === 'prefix', '注册 /read-aloud 前缀路由')
assert(first.captured.intervals.includes(6 * 3600 * 1000), '注册 6h 周期检查')

const hello = await call(first.captured, 'GET', '/read-aloud/hello')
eq(hello.status, 200, 'GET /hello → 200')
eq(hello.json().name, NAME, 'hello 返回包名')
eq(hello.json().version, VERSION, 'hello 返回 package.json 版本')
eq(hello.json().stale, false, 'hello 默认 stale=false')

const meta1 = (await call(first.captured, 'GET', '/read-aloud/meta')).json()
eq(meta1.name, NAME, 'meta.name')
eq(meta1.version, VERSION, 'meta.version 来自 package.json')
eq(meta1.installedVersion, VERSION, 'meta.installedVersion 来自磁盘')
eq(meta1.updateDisabled, true, '离线开关生效')
eq(meta1.latest, null, '离线开关下 latest=null')
eq(meta1.updateAvailable, false, '无最新版本时不报有更新')
eq(meta1.localInstall, 'link:/some/local/path', '识别本地 link 安装')
eq((await call(first.captured, 'GET', '/read-aloud/check-update')).status, 405, 'GET /check-update → 405')

const check1 = await call(first.captured, 'POST', '/read-aloud/check-update')
eq(check1.status, 200, 'POST /check-update → 200')
eq(check1.json().latest, null, '离线开关下强制检测也不联网')
eq((await call(first.captured, 'GET', '/read-aloud/upgrade')).status, 405, 'GET /upgrade → 405')

const up1 = (await call(first.captured, 'POST', '/read-aloud/upgrade')).json()
eq(up1.upgrade.ok, 'local', '本地 link 安装：升级被拒绝（ok=local）')
assert(String(up1.upgrade.message).includes('本地安装'), '拒绝原因说明「本地安装」')
assert(!up1.upgrade.running, '升级结束后 running=false')

const nope = await call(first.captured, 'GET', '/read-aloud/nope')
eq(nope.status, 404, '未知路径 → 404')
assert(Array.isArray(nope.json().routes) && nope.json().routes.length === 4, '404 返回路由清单')

// ---- fixture 1b: symlinked (link:) install outside the profile ----
// Node resolves the symlink out of the profile, so the walk-up strategy cannot
// find it; the host must fall back to DSH_PROFILE_DIR / DSH_HOME/profiles/*.
console.log('\n[link install outside the profile]')
const pkgCopy = path.join(tmpRoot, 'pkg-copy')
fs.mkdirSync(path.join(pkgCopy, 'lib'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(pkgCopy, 'package.json'))
fs.copyFileSync(path.join(ROOT, 'lib', 'index.js'), path.join(pkgCopy, 'lib', 'index.js'))
const scanProfile = path.join(tmpRoot, 'profiles', 'desktop')
fs.mkdirSync(path.join(scanProfile, 'node_modules'), { recursive: true })
fs.symlinkSync(pkgCopy, path.join(scanProfile, 'node_modules', NAME), 'dir')
fs.writeFileSync(path.join(scanProfile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', NAME] } },
  dependencies: { [NAME]: 'link:' + pkgCopy },
}))
process.env.DSH_HOME = tmpRoot
process.env.DSH_PROFILE_DIR = scanProfile
const linked = await load(path.join(scanProfile, 'node_modules', NAME))

const linkedMeta = (await call(linked.captured, 'GET', '/read-aloud/meta')).json()
eq(linkedMeta.localInstall, 'link:' + pkgCopy, 'env DSH_PROFILE_DIR：识别 link 安装')
const linkedUp = (await call(linked.captured, 'POST', '/read-aloud/upgrade')).json()
eq(linkedUp.upgrade.ok, 'local', 'link 安装（软链）拒绝在线升级')

delete process.env.DSH_PROFILE_DIR
const scannedMeta = (await call(linked.captured, 'GET', '/read-aloud/meta')).json()
eq(scannedMeta.localInstall, 'link:' + pkgCopy, '无 DSH_PROFILE_DIR 时扫描 $DSH_HOME/profiles 找到 profile')
delete process.env.DSH_HOME

// ---- fixture 2: registry install + local registry + fake package manager ----
console.log('\n[upgrade path]')
delete process.env.DSH_REPLY_READER_NO_UPDATE_CHECK
const registry = await startRegistry('9.9.9')
process.env.DSH_REPLY_READER_REGISTRY = 'http://127.0.0.1:' + registry.port
process.env.DSH_REPLY_READER_PKG_MANAGER = writeFakeManager()
const remote = makeProfile('profile-remote', '^' + VERSION)
const second = await load(remote.installed)

const meta2 = (await call(second.captured, 'GET', '/read-aloud/meta')).json()
eq(meta2.localInstall, null, 'registry 安装时 localInstall=null')
eq(meta2.updateAvailable, false, '未查询前不知道有更新')

const check2 = (await call(second.captured, 'POST', '/read-aloud/check-update')).json()
eq(check2.latest, '9.9.9', '强制检测读到本地 registry 的 9.9.9')
eq(check2.updateAvailable, true, 'updateAvailable=true')
eq(check2.updateChecked, true, 'updateChecked=true')

const up2 = (await call(second.captured, 'POST', '/read-aloud/upgrade')).json()
eq(up2.upgrade.ok, 'ok', 'registry 安装：升级成功')
assert(String(up2.upgrade.message).includes('重启'), '升级成功提示重启 dsh web')
const managerArgs = fs.readFileSync(fakeManagerLog, 'utf8').trim().split('\n')
assert(managerArgs.includes('add') && managerArgs.includes(NAME + '@9.9.9'), '包管理器收到 add <包名>@9.9.9')
assert(
  managerArgs[0] === '--dir' && fs.realpathSync(managerArgs[1]) === fs.realpathSync(remote.profileRoot),
  '包管理器在 profile 根目录执行',
)

// 升级落盘后：进程仍是旧版本 → stale，且拒绝再次升级
fs.writeFileSync(path.join(remote.installed, 'package.json'), JSON.stringify({ name: NAME, version: '9.9.9', main: 'lib/index.js', type: 'module' }))
const staleMeta = (await call(second.captured, 'GET', '/read-aloud/meta')).json()
eq(staleMeta.stale, true, '磁盘版本更新后 meta.stale=true')
eq(staleMeta.installedVersion, '9.9.9', 'meta.installedVersion 回读磁盘')
const up3 = (await call(second.captured, 'POST', '/read-aloud/upgrade')).json()
eq(up3.upgrade.ok, 'stale', 'stale 时拒绝在线升级')
assert(String(up3.upgrade.message).includes('重启'), 'stale 提示重启而不是升级')
await new Promise((resolve) => registry.server.close(resolve))

// ---- fixture 3: registry unreachable → silent degrade ----
console.log('\n[offline degrade]')
delete process.env.DSH_REPLY_READER_REGISTRY
process.env.DSH_REPLY_READER_REGISTRY = 'http://127.0.0.1:1'
const offline = makeProfile('profile-offline', '^' + VERSION)
const third = await load(offline.installed)
const meta3 = (await call(third.captured, 'POST', '/read-aloud/check-update')).json()
eq(meta3.latest, null, 'registry 不可达：latest=null')
eq(meta3.updateAvailable, false, 'registry 不可达：不报有更新')
const up4 = (await call(third.captured, 'POST', '/read-aloud/upgrade')).json()
eq(up4.upgrade.ok, 'skip', 'registry 不可达：升级降级为 skip（不报成功）')

// ---------------------------------------------------------------- cleanup
delete process.env.DSH_REPLY_READER_NO_UPDATE_CHECK
delete process.env.DSH_REPLY_READER_REGISTRY
delete process.env.DSH_REPLY_READER_PKG_MANAGER
fs.rmSync(tmpRoot, { recursive: true, force: true })

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
