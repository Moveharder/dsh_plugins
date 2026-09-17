/* Smoke test — dsh-annual-activity host half.
 *
 * 覆盖：
 *  - 多帧 zstd / 明文会话日志解析；损坏尾帧容错
 *  - 事件按本地日历日分桶（turn/step/user-message/tool-call/token）
 *  - Token 双计防护：同一 turn:step 的 chunk 与 message 只记一次
 *  - 「只创建了会话、没有对话」的那天同样算活跃日
 *  - 活跃等级阈值（0/1/2-5/6-15/16+ 轮）
 *  - 会话标题/cwd 富化（storages/session_projcache.json）
 *  - /activity/pull?year= 、/activity/hello 、POST /activity/refresh 路由语义
 *  - seq 稳定性：内容不变时重复 pull 不递增
 *  - 版本/升级：/activity/meta、/activity/check-update、POST /activity/upgrade
 *    （本地 link 安装应被识别并拒绝在线升级，避免把源码开发态换成 registry 版本）
 *  - 离线开关：DSH_ACTIVITY_NO_UPDATE_CHECK=1 时完全不查 registry
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { zstdCompressSync } from 'node:zlib'

let failures = 0
function assert(cond, label) {
  if (cond) { console.log('  ✓ ' + label) } else { failures++; console.error('  ✗ ' + label) }
}
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) console.error('    actual=' + JSON.stringify(actual) + '\n    expected=' + JSON.stringify(expected))
  assert(ok, label)
}

// ---------- fixtures ----------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daa-fixture-'))
const dshHome = path.join(tmpRoot, 'home')
const sessRoot = path.join(dshHome, 'sessions')
fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true })
fs.mkdirSync(sessRoot, { recursive: true })

const jsonl = (...events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n'
function writeZstd(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 两个 zstd 帧拼接：验证多帧解压
  const half = Math.floor(text.length / 2)
  fs.writeFileSync(file, Buffer.concat([
    zstdCompressSync(Buffer.from(text.slice(0, half))),
    zstdCompressSync(Buffer.from(text.slice(half))),
  ]))
}
function writePlain(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

const DAY = 86400000
// 固定为本地时间，避免测试随时区漂移
function at(y, m, d, hh = 10, mm = 0) { return new Date(y, m - 1, d, hh, mm, 0).getTime() }

const Y = 2026
// 会话 A：2026-03-02（8 轮 → level 3）与 2026-03-04（1 轮 → level 1）
const sessionA = jsonl(
  { type: 'session', version: 3, id: 'session-aaa11111', createdAt: at(Y, 3, 2, 9), cwd: '/work/alpha' },
  ...Array.from({ length: 8 }, (_, i) => [
    { type: 'turn/start', seq: i * 10 + 1, time: at(Y, 3, 2, 9, i), data: { turn: i + 1 } },
    { type: 'step/start', seq: i * 10 + 2, time: at(Y, 3, 2, 9, i), data: { turn: i + 1, step: 1 } },
    { type: 'user/message', seq: i * 10 + 3, time: at(Y, 3, 2, 9, i), data: { content: [{ type: 'text', text: 'hi' }] } },
    { type: 'tool/call', seq: i * 10 + 4, time: at(Y, 3, 2, 9, i), data: { turn: i + 1, step: 1, callId: 'c' + i, name: 'bash' } },
    { type: 'assistant/message', seq: i * 10 + 5, time: at(Y, 3, 2, 9, i), data: { turn: i + 1, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 100, outputTokens: 20 } } },
  ]).flat(),
  { type: 'turn/start', seq: 900, time: at(Y, 3, 4, 15), data: { turn: 9 } },
  { type: 'assistant/message', seq: 901, time: at(Y, 3, 4, 15), data: { turn: 9, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 50, outputTokens: 10 } } },
)
writeZstd(path.join(sessRoot, '--work-alpha--', 'session-aaa11111', 'session.v3.jsonl.zstd'), sessionA)

// 会话 B：旧版 chunk 口径 + 与 message 重复的 usage（不得双计）；同一天 20 轮 → level 4
const sessionB = jsonl(
  { type: 'session', version: 0, id: 'session-bbb22222', createdAt: at(Y, 3, 2, 11), cwd: '/work/beta' },
  { type: 'assistant/chunk', seq: 1, time: at(Y, 3, 2, 11, 1), data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 200 } } } },
  { type: 'assistant/message', seq: 2, time: at(Y, 3, 2, 11, 1), data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } }, usage: { inputTokens: 1000, outputTokens: 200 } } },
  ...Array.from({ length: 20 }, (_, i) => ({ type: 'turn/start', seq: 100 + i, time: at(Y, 3, 2, 12, i), data: { turn: i + 1 } })),
)
writePlain(path.join(sessRoot, '--work-beta--', 'session-bbb22222', 'session.jsonl'), sessionB)

// 会话 C：2025 年 + 只有一个 session 头（当天算活跃，轮次为 0 → level 0）
const sessionC = jsonl(
  { type: 'session', version: 0, id: 'session-ccc33333', createdAt: at(2025, 12, 31, 23), cwd: '/work/gamma' },
)
writePlain(path.join(sessRoot, '--work-gamma--', 'session-ccc33333', 'session.jsonl'), sessionC)

// 会话 D：损坏文件（非法 zstd）——不应让整体扫描失败
writePlain(path.join(sessRoot, '--work-broken--', 'session-ddd44444', 'session.jsonl.zstd'), 'not-a-zstd-frame')

// 标题富化
fs.writeFileSync(path.join(dshHome, 'storages', 'session_projcache.json'), JSON.stringify({
  tables: {
    sessions: {
      'session-aaa11111': { identity: { cwd: '/work/alpha' }, rows: { title: { val: 'Alpha 重构' } } },
      'session-bbb22222': { identity: { cwd: '/work/beta' }, rows: { title: { val: 'Beta 脚本' } } },
    },
  },
}))

// ---------- 装载 host 半区 ----------
process.env.DSH_HOME = dshHome
process.env.DSH_ACTIVITY_ROOT = sessRoot
// 离线开关：测试不访问 npm registry（也顺带验证该开关生效）
process.env.DSH_ACTIVITY_NO_UPDATE_CHECK = '1'

// 模拟 profile 安装布局：<profile>/node_modules/dsh-annual-activity/lib/index.js，
// 且 profile 的 package.json 声明 dsh.profile，让 host 能定位安装目录。
// 依赖写成 link:（正是本机当前的安装方式）→ 在线升级应被拒绝。
const profileRoot = path.join(tmpRoot, 'profile')
const installedPkg = path.join(profileRoot, 'node_modules', 'dsh-annual-activity')
fs.mkdirSync(path.join(installedPkg, 'lib'), { recursive: true })
fs.writeFileSync(path.join(installedPkg, 'package.json'), JSON.stringify({ name: 'dsh-annual-activity', version: '1.0.0', main: 'lib/index.js', type: 'module' }))
fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'lib', 'index.js'), path.join(installedPkg, 'lib', 'index.js'))
fs.writeFileSync(path.join(profileRoot, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-annual-activity'] } },
  dependencies: { 'dsh-annual-activity': 'link:/some/local/path' },
}))

const mod = await import(path.join(installedPkg, 'lib', 'index.js'))

eq(mod.name, 'dsh-annual-activity', 'host 导出 name')
assert(Array.isArray(mod.inject) && mod.inject.includes('webServer') && mod.inject.includes('timer'), 'host 导出 inject: timer + webServer')

let route = null
const intervals = []
const logs = []
const ctx = {
  get: () => null,
  on: () => () => {},
  effect: () => () => {},
  setInterval: (fn, ms) => { intervals.push(ms); return () => {} },
  logger: { info: (m) => logs.push(String(m)) },
  webServer: { register: (r) => { route = r; return () => {} } },
}
mod.apply(ctx)
assert(!!route && route.path === '/activity' && route.kind === 'prefix', '注册了 /activity 前缀路由')
assert(intervals.length >= 1, '注册了后台保活重扫定时器')

// ---------- 假的 req/res 驱动路由 ----------
function call(method, url) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {} }
    const res = {
      statusCode: 0, headers: null, body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this },
      end(chunk) { this.body += chunk || ''; resolve({ status: this.statusCode, headers: this.headers, json: () => JSON.parse(this.body || '{}') }) },
      on() { return this }, once() { return this }, setTimeout() { return this },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

const hello = await call('GET', '/activity/hello')
eq(hello.status, 200, 'GET /activity/hello → 200')
assert(hello.json().name === 'dsh-annual-activity', 'hello 返回包名')

const pull = await call('GET', '/activity/pull')
eq(pull.status, 200, 'GET /activity/pull → 200')
const p = pull.json()
eq(p.currentYear, new Date().getFullYear(), 'currentYear = 宿主当前年')
eq(p.years, [2025, 2026, new Date().getFullYear()].filter((v, i, a) => a.indexOf(v) === i), 'years 覆盖 2025/2026')

const d302 = p.days.find((d) => d.day === '2026-03-02')
assert(!!d302, '2026-03-02 出现在活跃日里')
if (d302) {
  eq(d302.turns, 28, '2026-03-02 轮次 = 8(A) + 20(B)')
  eq(d302.activeSessions, 2, '2026-03-02 涉及 2 个会话')
  eq(d302.steps, 8, '2026-03-02 步骤 = 8')
  eq(d302.userMessages, 8, '2026-03-02 提问 = 8')
  eq(d302.toolCalls, 8, '2026-03-02 工具调用 = 8')
  // A：8 步 × 120 = 960；B：只有 1 条 message 计费（chunk 同 turn:step 去重）= 1200
  eq(d302.tokens, 960 + 1200, '2026-03-02 Token 不双计（A 8×120 + B 1200）')
  eq(d302.level, 4, '2026-03-02 等级 = 4（≥16 轮）')
}
const d304 = p.days.find((d) => d.day === '2026-03-04')
if (d304) {
  eq(d304.turns, 1, '2026-03-04 轮次 = 1')
  eq(d304.level, 1, '2026-03-04 等级 = 1')
}

assert(!p.days.some((d) => d.day === '2026-03-03'), '没有活动的日期不出现在 days 里')

// 等级阈值表
const L = p.levels.map((x) => [x.min, x.max])
eq(L, [[0, 0], [1, 1], [2, 5], [6, 15], [16, null]], 'levels 阈值表随负载下发')

// 会话汇总 + 标题富化
const sa = p.sessions.find((s) => s.id === 'session-aaa11111')
if (sa) {
  eq(sa.title, 'Alpha 重构', '会话标题从 projcache 富化')
  eq(sa.project, 'alpha', '项目名取 cwd basename')
  eq(sa.turns, 9, 'session A 轮次 = 9')
  eq(sa.activeDays, 2, 'session A 跨 2 个活跃日')
}
const sc = p.sessions.find((s) => s.id === 'session-ccc33333')
if (sc) eq(sc.activeDays, 1, 'session C 有 1 个活跃日')

// 指定年份只回该年明细
const pull2025 = (await call('GET', '/activity/pull?year=2025')).json()
eq(pull2025.year, 2025, 'pull?year=2025 → year=2025')
assert(pull2025.days.every((d) => d.day.startsWith('2025')), 'pull?year=2025 的 days 只含 2025')
const d2025 = pull2025.days.find((d) => d.day === '2025-12-31')
assert(!!d2025, '只有 session 头的 2025-12-31 也算活跃日')
if (d2025) eq(d2025.level, 0, '无轮次的活跃日等级 = 0（未活跃色）')
assert(pull2025.yearStats['2025'].activeDays === 1, '2025 年活跃日 = 1')
assert(pull2025.yearStats['2026'].activeDays === 2, 'yearStats 里 2026 依然完整（跨年汇总不丢）')

// 非法年份回落当前年
const pullBad = (await call('GET', '/activity/pull?year=abc')).json()
eq(pullBad.year, p.currentYear, '非法 year 参数回落到当前年')

// seq 稳定性
const pull2 = (await call('GET', '/activity/pull')).json()
eq(pull2.seq, p.seq, '内容未变时 seq 不递增')

// 强制重扫
const refresh = await call('POST', '/activity/refresh')
eq(refresh.status, 200, 'POST /activity/refresh → 200')
const refreshGet = await call('GET', '/activity/refresh')
eq(refreshGet.status, 405, 'GET /activity/refresh → 405')

// 未知路径
eq((await call('GET', '/activity/nope')).status, 404, '未知路径 → 404')

// ---------- 版本 / 升级 ----------
const meta = await call('GET', '/activity/meta')
eq(meta.status, 200, 'GET /activity/meta → 200')
const m = meta.json()
eq(m.name, 'dsh-annual-activity', 'meta.name = 包名')
assert(typeof m.version === 'string' && /^\d+\.\d+\.\d+$/.test(m.version), 'meta.version 从 package.json 读取（semver 形状）')
eq(m.latest, null, '离线开关下 latest = null（未查询 registry）')
eq(m.updateAvailable, false, '无最新版本时不报「有更新」')
eq(m.updateDisabled, true, 'meta.updateDisabled 反映离线开关')
eq(m.localInstall, 'link:/some/local/path', 'meta 识别出本地 link 安装')
eq((await call('GET', '/activity/meta')).json().localInstall, 'link:/some/local/path', 'meta 可重复读取（幂等）')

const checkRes = await call('POST', '/activity/check-update')
eq(checkRes.status, 200, 'POST /activity/check-update → 200')
eq(checkRes.json().latest, null, '离线开关下强制检测也不联网 → latest 仍为 null')
eq((await call('GET', '/activity/check-update')).status, 405, 'GET /activity/check-update → 405')

const upRes = await call('POST', '/activity/upgrade')
eq(upRes.status, 200, 'POST /activity/upgrade → 200')
const upJson = upRes.json()
eq(upJson.upgrade.ok, 'local', '本地 link 安装：升级被拒绝并标记为 local（不会覆盖源码开发态）')
assert(String(upJson.upgrade.message).includes('本地安装'), '拒绝原因向用户说明「本地安装」')
assert(!upJson.upgrade.running, '升级结束后 running=false')
eq((await call('GET', '/activity/upgrade')).status, 405, 'GET /activity/upgrade → 405')

// ---------- 在线升级全链路（本地 registry 端点 + 假包管理器，全程离线）----------
// 把安装布局换成一个「registry 版本」的 profile，并让 registry 指向本地 http 端点、
// 包管理器指向一个假 pnpm 脚本，从而在没有网络的情况下跑通成功路径。
const installedPkg2 = path.join(tmpRoot, 'profile2', 'node_modules', 'dsh-annual-activity')
fs.mkdirSync(path.join(installedPkg2, 'lib'), { recursive: true })
fs.writeFileSync(path.join(installedPkg2, 'package.json'), JSON.stringify({ name: 'dsh-annual-activity', version: '1.0.0', main: 'lib/index.js', type: 'module' }))
fs.copyFileSync(path.join(installedPkg, 'lib', 'index.js'), path.join(installedPkg2, 'lib', 'index.js'))
fs.writeFileSync(path.join(tmpRoot, 'profile2', 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-annual-activity'] } },
  dependencies: { 'dsh-annual-activity': '^1.0.0' },
}))
const mod2 = await import(path.join(installedPkg2, 'lib', 'index.js') + '?v=2')
let route2 = null

// 本地 registry：/dsh-annual-activity/latest 返回 9.9.9
const registryHits = []
const registrySrv = http.createServer((req, res) => {
  registryHits.push(req.url)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ name: 'dsh-annual-activity', version: '9.9.9' }))
})
await new Promise((r) => registrySrv.listen(0, '127.0.0.1', r))
const registryPort = registrySrv.address().port

// 假包管理器：记录收到的参数并成功退出
const fakePnpm = path.join(tmpRoot, 'fake-pnpm.sh')
const fakeLog = path.join(tmpRoot, 'fake-pnpm.log')
fs.writeFileSync(fakePnpm, '#!/bin/sh\necho "$@" >> ' + fakeLog + '\nexit 0\n')
fs.chmodSync(fakePnpm, 0o755)

// 环境必须在 apply 之前就位：apply 内部会立刻发起一次版本检查
process.env.DSH_ACTIVITY_REGISTRY = 'http://127.0.0.1:' + registryPort
process.env.DSH_ACTIVITY_PKG_MANAGER = fakePnpm
delete process.env.DSH_ACTIVITY_NO_UPDATE_CHECK

mod2.apply({
  get: () => null, on: () => () => {}, effect: () => () => {},
  setInterval: () => () => {}, logger: { info() {} },
  webServer: { register: (r) => { route2 = r; return () => {} } },
})
function call2(method, url) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0, body: '',
      writeHead(c) { this.statusCode = c; return this },
      end(b) { this.body += b || ''; resolve({ status: this.statusCode, json: () => JSON.parse(this.body || '{}') }) },
      on() { return this },
    }
    Promise.resolve(route2.handler({ method, url, headers: {} }, res)).catch(reject)
  })
}

const meta2 = (await call2('POST', '/activity/check-update')).json()
eq(meta2.localInstall, null, 'registry 版本安装：localInstall 为 null（不阻止在线升级）')
eq(meta2.latest, '9.9.9', '检测到最新版本 9.9.9')
eq(meta2.updateAvailable, true, 'updateAvailable = true')
assert(registryHits.some((u) => u.includes('/dsh-annual-activity/latest')), '确实查询了 registry 的 latest 端点')

const up2 = (await call2('POST', '/activity/upgrade')).json()
eq(up2.upgrade.ok, 'ok', '在线升级成功（假包管理器返回 0）')
assert(String(up2.upgrade.message).includes('9.9.9'), '升级结果提示目标版本 9.9.9')
assert(String(up2.upgrade.message).includes('重启'), '升级结果提示需要重启 dsh web')
assert(fs.readFileSync(fakeLog, 'utf8').includes('add dsh-annual-activity@9.9.9'), '包管理器收到 add dsh-annual-activity@9.9.9')

// 已是最新：让 registry 改口说「latest = 当前版本」（等价于重启后已升级到位）
registrySrv.removeAllListeners('request')
registrySrv.on('request', (req, res) => {
  registryHits.push(req.url)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ name: 'dsh-annual-activity', version: '1.0.0' }))
})
const callsBefore = fs.readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).length
// 先刷新一次 latest（缓存策略：升级前若已有缓存就不再查 registry）
const refreshed = (await call2('POST', '/activity/check-update')).json()
eq(refreshed.latest, '1.0.0', 'registry 改口后 latest 刷新为 1.0.0')
const up3 = (await call2('POST', '/activity/upgrade')).json()
eq(up3.upgrade.ok, 'skip', '已是最新版本时升级为 skip')
const callsAfter = fs.readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).length
eq(callsAfter, callsBefore, 'skip 时不再调用包管理器')

// registry 不可用：静默降级，不报成功
await new Promise((r) => registrySrv.close(r))
const up4 = (await call2('POST', '/activity/upgrade')).json()
assert(['skip', 'fail'].includes(up4.upgrade.ok), 'registry 不可用时升级不报成功（静默降级为 skip/fail）')

delete process.env.DSH_ACTIVITY_REGISTRY
delete process.env.DSH_ACTIVITY_PKG_MANAGER

// 统计口径：活跃率分母 = 已过天数（当前年）/ 全年（历史年）
assert(p.yearStats['2025'].totalDays === 365, '历史年份分母 = 全年天数')
assert(p.yearStats['2026'].totalDays >= 1 && p.yearStats['2026'].totalDays <= 366, '当前年分母 = 已过天数')

// 清理
if (failures === 0) {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  console.log('\n✓ host smoke 全部通过')
} else {
  console.error(`\n✗ host smoke 失败 ${failures} 项（fixture 保留在 ${tmpRoot}）`)
  process.exitCode = 1
}
// 后台保活重扫定时器会一直挂着（宿主里正是靠它保鲜），测试里显式收尾
process.exit(process.exitCode || 0)
