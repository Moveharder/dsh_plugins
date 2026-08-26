/**
 * oh-my-dshtoken — host half.
 *
 * 纯本地的 AI Token 消耗统计插件（Host 半区）：
 *  1. 扫描 `$DSH_HOME/sessions/<项目目录>/session-*` 下的历史会话日志
 *     （`session.jsonl.zstd`，Node ≥22.15 原生 node:zlib zstd 解压，多帧兼容；
 *      同时兼容未压缩的 `session.jsonl`）；
 *  2. 聚合每个会话的 输入/输出/缓存读取 Token（口径与官方 tokenUsage 投影一致：
 *     inputTokens 为未含缓存的输入，总计 = 输入 + 输出）；
 *  3. 按 项目(cwd)/会话/模型 三个维度输出聚合快照，供浏览器面板轮询渲染；
 *  4. 会话标题从 `$DSH_HOME/storages/session_projcache.json` 尽力富化（缺失时降级短 ID）；
 *  5. 内置在线升级（npm registry latest 对比 + pnpm/npm 安装，模式同 dsh-whale-copilot）。
 *
 * 增量策略：以「stat 全部会话文件的 mtime+size」为失效依据，仅重解析变化的文件，
 * 轮询即可获得准实时数据，无需监听流式事件，天然规避双计。
 *
 * 安装为 web profile 组合中的一行：
 *   - id: dshtoken
 *     name: 'oh-my-dshtoken'
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'

const name = 'oh-my-dshtoken'
// webServer 是 web-app 层服务（等 webStartup 就绪）；列入 inject 让本插件
// 在路由可注册后才激活。timer 提供随卸载自动清理的周期任务。
const inject = ['timer', 'webServer']

// 单次快照里会话明细的最大条数（超出按最近活跃截断，总量仍完整）
const MAX_SESSIONS_IN_PAYLOAD = 1000
// 两次自动重扫之间的最小间隔（毫秒）：轮询风暴下限流
const RESCAN_MIN_INTERVAL = 2000
// 后台保活重扫周期：入口徽标在面板关闭时也保持新鲜
const BACKGROUND_RESCAN_MS = 60 * 1000

function apply(ctx) {
  // ---- 版本：从本包自己的 package.json 读取（唯一事实来源，避免手写漂移）----
  const here = fileURLToPath(import.meta.url)
  const req = createRequire(import.meta.url)
  let VERSION = ''
  try { VERSION = String((req(path.join(path.dirname(here), '..', 'package.json')) || {}).version || '') } catch (err) { /* ignore */ }

  // ---- 数据根目录解析 ----
  // 优先级：DSH_TOKEN_STATS_ROOT（测试注入）> $DSH_HOME/sessions > ~/.dsh/sessions
  function resolveDshHome() {
    if (process.env.DSH_HOME) return process.env.DSH_HOME
    return path.join(os.homedir(), '.dsh')
  }
  function resolveSessionsRoot() {
    if (process.env.DSH_TOKEN_STATS_ROOT) return process.env.DSH_TOKEN_STATS_ROOT
    return path.join(resolveDshHome(), 'sessions')
  }

  // ================= 会话日志解析 =================

  const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const zstdDecompressAsync = promisify(zstdDecompress)

  /** 多帧 zstd 解压：逐帧解压拼接，尾部不完整/损坏帧静默跳过（等下次 mtime 变化重扫）。 */
  async function decompressZstdFrames(buf) {
    const frames = []
    let i = 0
    while (i < buf.length - 3) {
      const idx = buf.indexOf(ZSTD_MAGIC, i)
      if (idx < 0) break
      frames.push(idx)
      i = idx + 4
    }
    if (!frames.length) throw new Error('invalid zstd: no frame magic')
    let out = ''
    for (let f = 0; f < frames.length; f++) {
      const end = f + 1 < frames.length ? frames[f + 1] : buf.length
      try {
        out += (await zstdDecompressAsync(buf.subarray(frames[f], end))).toString('utf8')
      } catch (err) { /* 尾部不完整帧：跳过 */ }
    }
    return out
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n }
  function dayKeyOf(ts) {
    const d = new Date(ts)
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }

  /**
   * 解析一段会话 JSONL 文本，返回该会话的聚合结果。
   *
   * 口径说明（已对账官方 tokenUsage 投影）：
   *  - Token 计数只取 `assistant/chunk`（chunk.type === 'usage'）——它是每步一条的
   *    权威记录（含被取消的步骤）；
   *  - `assistant/message` 自带的 usage 与 chunk 完全重复，只取其 source 的
   *    provider/model 做「步 → 模型」归属，绝不重复计数；
   *  - reasoningTokens 是输出的官方子集指标，单列展示用，不计入输出。
   */
  function parseSessionText(text) {
    let sessionId = ''
    let cwd = ''
    let createdAt = 0
    let lastActive = 0
    const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, steps: 0 }
    const models = new Map()   // modelKey -> { provider, model, inputTokens, outputTokens, cacheReadTokens, steps }
    const days = new Map()     // 'YYYY-MM-DD' -> { inputTokens, outputTokens }
    // usage chunk 先于同步的 assistant/message 到达：先挂起，文本解析完再统一按
    // 「精确 turn:step → 文件内最后已知模型」的顺序归属。
    const pendingUsage = []
    const stepModel = new Map()
    let lastModelKey = null

    for (let li = 0, lines = text.split('\n'); li < lines.length; li++) {
      const line = lines[li]
      if (!line) continue
      let ev
      try { ev = JSON.parse(line) } catch (err) { continue }
      if (typeof ev.time === 'number' && ev.time > lastActive) lastActive = ev.time

      if (ev.type === 'session') {
        sessionId = String(ev.id || '')
        cwd = typeof ev.cwd === 'string' ? ev.cwd : ''
        createdAt = Number(ev.createdAt) || 0
        continue
      }
      if (ev.type === 'assistant/message') {
        const src = ev.data && ev.data.message && ev.data.message.source
        const provider = src && typeof src.provider === 'string' ? src.provider : ''
        const model = src && typeof src.model === 'string' ? src.model : ''
        if (model) {
          const turn = ev.data.turn, step = ev.data.step
          const key = (provider || '?') + '/' + model
          if (typeof turn === 'number' && typeof step === 'number') stepModel.set(turn + ':' + step, key)
          lastModelKey = key
        }
        continue
      }
      if (ev.type === 'assistant/chunk') {
        const chunk = ev.data && ev.data.chunk
        if (!chunk || chunk.type !== 'usage' || !chunk.usage) continue
        const u = chunk.usage
        pendingUsage.push({
          turn: typeof ev.data.turn === 'number' ? ev.data.turn : null,
          step: typeof ev.data.step === 'number' ? ev.data.step : null,
          input: numOr0(u.inputTokens),
          output: numOr0(u.outputTokens),
          cacheRead: numOr0(u.cacheReadTokens),
          cacheWrite: numOr0(u.cacheWriteTokens),
          reasoning: numOr0(u.reasoningTokens),
          time: typeof ev.time === 'number' ? ev.time : 0,
        })
      }
    }

    // 落账：把挂起的 usage 按归属模型并入各维度
    for (const p of pendingUsage) {
      const key = (p.turn != null && p.step != null && stepModel.get(p.turn + ':' + p.step)) || lastModelKey || '未知/未知'
      totals.inputTokens += p.input
      totals.outputTokens += p.output
      totals.cacheReadTokens += p.cacheRead
      totals.cacheWriteTokens += p.cacheWrite
      totals.steps += 1
      let m = models.get(key)
      if (!m) {
        const slash = key.indexOf('/')
        m = { provider: slash > 0 ? key.slice(0, slash) : key, model: slash > 0 ? key.slice(slash + 1) : key, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, steps: 0 }
        models.set(key, m)
      }
      m.inputTokens += p.input
      m.outputTokens += p.output
      m.cacheReadTokens += p.cacheRead
      m.steps += 1
      if (p.time) {
        const dk = dayKeyOf(p.time)
        let d = days.get(dk)
        if (!d) { d = { inputTokens: 0, outputTokens: 0 }; days.set(dk, d) }
        d.inputTokens += p.input
        d.outputTokens += p.output
      }
    }

    return {
      sessionId, cwd, createdAt, lastActive,
      totals,
      models: Object.fromEntries(models),
      days: Object.fromEntries(days),
    }
  }

  function numOr0(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0 }

  // ================= 文件级缓存 + 扫描周期 =================

  // filePath -> { mtimeMs, size, parsed }
  const parseCache = new Map()
  // 全局状态
  let snapshot = null            // 最近一次聚合快照（对象）
  let snapshotJson = ''          // 其序列化形式（变更检测）
  let seq = 0                    // 快照版本号：内容变化才自增
  let scanning = false
  let lastScanFinishedAt = 0
  let forceNextScan = true       // 首次强制
  let errorCount = 0
  let fileCount = 0

  async function listDirSafe(dir) {
    try { return await fsp.readdir(dir) } catch (err) { return [] }
  }

  /** 读一个会话日志文件并解析（带 mtime+size 缓存）。 */
  async function parseSessionFile(file) {
    let st
    try { st = await fsp.stat(file) } catch (err) { return null }
    const cached = parseCache.get(file)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.parsed
    let text
    try {
      if (file.endsWith('.zstd')) text = await decompressZstdFrames(await fsp.readFile(file))
      else text = await fsp.readFile(file, 'utf8')
    } catch (err) { errorCount++; return null }
    const parsed = parseSessionText(text)
    parseCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, parsed })
    return parsed
  }

  /** 标题富化：从 storages/session_projcache.json 读 title 投影（best-effort，带 mtime 缓存）。 */
  let titleCache = { mtimeMs: -1, map: {} }
  async function loadTitleMap() {
    const file = path.join(resolveDshHome(), 'storages', 'session_projcache.json')
    let st = null
    try { st = await fsp.stat(file) } catch (err) { return {} }
    if (titleCache.mtimeMs === st.mtimeMs) return titleCache.map
    try {
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'))
      const tables = raw && raw.tables && raw.tables.sessions
      const map = {}
      if (tables && typeof tables === 'object') {
        for (const [id, rec] of Object.entries(tables)) {
          const t = rec && rec.rows && rec.rows.title && rec.rows.title.val
          if (typeof t === 'string' && t) map[id] = t
        }
      }
      titleCache = { mtimeMs: st.mtimeMs, map }
      return map
    } catch (err) {
      titleCache = { mtimeMs: st.mtimeMs, map: {} }
      return {}
    }
  }

  function baseName(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '(未知项目)' }

  /** 全量扫描（增量利用 parseCache）并重建快照。 */
  async function scanOnce() {
    scanning = true
    errorCount = 0
    try {
      const root = resolveSessionsRoot()
      const titles = await loadTitleMap()
      const seenFiles = new Set()
      const perFile = []

      const projectDirs = await listDirSafe(root)
      for (const proj of projectDirs) {
        const projPath = path.join(root, proj)
        let projSt = null
        try { projSt = await fsp.stat(projPath) } catch (err) { continue }
        if (!projSt.isDirectory()) continue
        const sessDirs = await listDirSafe(projPath)
        for (const sess of sessDirs) {
          const sessPath = path.join(projPath, sess)
          let sessSt = null
          try { sessSt = await fsp.stat(sessPath) } catch (err) { continue }
          if (!sessSt.isDirectory()) continue
          // 同一会话目录可能存在 .zstd 与明文两种形态：优先 .zstd
          const zstdFile = path.join(sessPath, 'session.jsonl.zstd')
          const plainFile = path.join(sessPath, 'session.jsonl')
          let file = null
          try {
            if (await fsp.stat(zstdFile).then(() => true, () => false)) file = zstdFile
            else if (await fsp.stat(plainFile).then(() => true, () => false)) file = plainFile
          } catch (err) { /* ignore */ }
          if (!file) continue
          seenFiles.add(file)
          const parsed = await parseSessionFile(file)
          if (parsed) perFile.push(parsed)
        }
      }

      // 清理已删除文件的缓存条目
      for (const key of Array.from(parseCache.keys())) {
        if (!seenFiles.has(key)) parseCache.delete(key)
      }
      fileCount = perFile.length

      // ---- 聚合三个维度 ----
      const projects = new Map() // cwd -> agg
      const sessionsArr = []
      const modelsAgg = new Map() // modelKey -> agg
      const daysAgg = new Map()
      const grand = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, steps: 0 }

      const emptyProj = (cwd) => ({
        cwd, name: baseName(cwd),
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, steps: 0,
        sessionCount: 0, lastActive: 0, createdAtMin: 0, models: {},
      })

      for (const f of perFile) {
        const t = f.totals
        grand.inputTokens += t.inputTokens
        grand.outputTokens += t.outputTokens
        grand.cacheReadTokens += t.cacheReadTokens
        grand.cacheWriteTokens += t.cacheWriteTokens
        grand.steps += t.steps

        const cwd = f.cwd || '(未知项目)'
        let pj = projects.get(cwd)
        if (!pj) { pj = emptyProj(cwd); projects.set(cwd, pj) }
        pj.inputTokens += t.inputTokens
        pj.outputTokens += t.outputTokens
        pj.cacheReadTokens += t.cacheReadTokens
        pj.cacheWriteTokens += t.cacheWriteTokens
        pj.steps += t.steps
        pj.sessionCount += 1
        if (f.lastActive > pj.lastActive) pj.lastActive = f.lastActive
        if (f.createdAt && (!pj.createdAtMin || f.createdAt < pj.createdAtMin)) pj.createdAtMin = f.createdAt

        // 主模型：按总消耗(输入+输出)最大的那个
        let primaryModel = ''
        let best = -1
        for (const [key, m] of Object.entries(f.models)) {
          const g = m.inputTokens + m.outputTokens
          if (g > best) { best = g; primaryModel = key }
          let ma = modelsAgg.get(key)
          if (!ma) { ma = { key, provider: m.provider, model: m.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, steps: 0, sessionCount: 0 }; modelsAgg.set(key, ma) }
          ma.inputTokens += m.inputTokens
          ma.outputTokens += m.outputTokens
          ma.cacheReadTokens += m.cacheReadTokens
          ma.steps += m.steps
          ma.sessionCount += 1
        }
        // 项目维度的模型细分
        for (const [key, m] of Object.entries(f.models)) {
          let pm = pj.models[key]
          if (!pm) { pm = pj.models[key] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, steps: 0 } }
          pm.inputTokens += m.inputTokens
          pm.outputTokens += m.outputTokens
          pm.cacheReadTokens += m.cacheReadTokens
          pm.steps += m.steps
        }

        sessionsArr.push({
          id: f.sessionId,
          shortId: f.sessionId ? (f.sessionId.length > 14 ? f.sessionId.slice(0, 14) + '…' : f.sessionId) : '?',
          title: titles[f.sessionId] || '',
          cwd,
          projectName: baseName(cwd),
          primaryModel,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          cacheReadTokens: t.cacheReadTokens,
          cacheWriteTokens: t.cacheWriteTokens,
          steps: t.steps,
          createdAt: f.createdAt,
          lastActive: f.lastActive,
        })

        for (const [dk, d] of Object.entries(f.days)) {
          let da = daysAgg.get(dk)
          if (!da) { da = { inputTokens: 0, outputTokens: 0 }; daysAgg.set(dk, da) }
          da.inputTokens += d.inputTokens
          da.outputTokens += d.outputTokens
        }
      }

      const projectsArr = Array.from(projects.values()).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
      sessionsArr.sort((a, b) => b.lastActive - a.lastActive)
      const modelsArr = Array.from(modelsAgg.values()).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
      const daysArr = Array.from(daysAgg.entries())
        .map(([day, v]) => ({ day, inputTokens: v.inputTokens, outputTokens: v.outputTokens }))
        .sort((a, b) => (a.day < b.day ? -1 : 1))
        .slice(-30) // 最近 30 天趋势足够

      const truncated = sessionsArr.length > MAX_SESSIONS_IN_PAYLOAD
      const snap = {
        generatedAt: Date.now(),
        totals: {
          inputTokens: grand.inputTokens,
          outputTokens: grand.outputTokens,
          grandTotal: grand.inputTokens + grand.outputTokens,
          cacheReadTokens: grand.cacheReadTokens,
          cacheWriteTokens: grand.cacheWriteTokens,
          steps: grand.steps,
        },
        counts: {
          projects: projectsArr.length,
          sessions: sessionsArr.length,
          models: modelsArr.length,
          files: fileCount,
          errors: errorCount,
          truncated,
        },
        projects: projectsArr.map((p) => ({ ...p, grandTotal: p.inputTokens + p.outputTokens })),
        sessions: (truncated ? sessionsArr.slice(0, MAX_SESSIONS_IN_PAYLOAD) : sessionsArr).map((s) => ({ ...s, grandTotal: s.inputTokens + s.outputTokens })),
        models: modelsArr.map((m) => ({ ...m, grandTotal: m.inputTokens + m.outputTokens })),
        dailyTrend: daysArr.map((d) => ({ ...d, grandTotal: d.inputTokens + d.outputTokens })),
        sessionsRoot: root,
      }

      // 内容变化检测：序列化比较，变了才 bump seq
      const json = JSON.stringify(snap)
      if (json !== snapshotJson) {
        snapshotJson = json
        snapshot = snap
        seq++
      }
    } finally {
      scanning = false
      lastScanFinishedAt = Date.now()
    }
  }

  /** 带节流的按需重扫：force 或距上次完成超过 RESCAN_MIN_INTERVAL 才真正执行。 */
  let scanChain = Promise.resolve()
  function ensureFresh(force) {
    if (scanning) return scanChain
    if (!force && !forceNextScan && Date.now() - lastScanFinishedAt < RESCAN_MIN_INTERVAL) return scanChain
    forceNextScan = false
    scanChain = scanChain.then(() => scanOnce()).catch((err) => {
      console.error('[' + name + '] 扫描失败:', err && err.message)
    })
    return scanChain
  }

  // ================= 版本检查 + 在线升级（模式同 dsh-whale-copilot）=================

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

  function findProfileRoot() {
    let dir = path.dirname(here)
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        if (pkg && pkg.dsh && pkg.dsh.profile) return dir
      } catch (err) { /* 无 package.json，继续向上 */ }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  }

  function httpsGetJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const r = https.get(url, { headers: { 'user-agent': name + '/' + (VERSION || '?') } }, (res) => {
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

  // 启动时 + 每 6 小时查一次 npm registry；离线/未发布时静默降级。
  let latestVersion = null
  let updateChecked = false
  const CHECK_INTERVAL = 6 * 3600 * 1000
  let checkInFlight = null
  function checkUpdate() {
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      try {
        const doc = await httpsGetJson('https://registry.npmjs.org/' + name + '/latest')
        latestVersion = doc && typeof doc === 'object' ? String(doc.version || '') : ''
        if (!latestVersion) latestVersion = null
      } catch (err) {
        latestVersion = null
      } finally {
        updateChecked = true
      }
      return latestVersion
    })().finally(() => { checkInFlight = null })
    return checkInFlight
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
          windowsHide: isWin
        }, opts || {})
        child = execFile(bin, args, options)
      } catch (err) { reject(err); return }
      let out = ''
      if (child.stdout) child.stdout.on('data', (d) => { out += d })
      if (child.stderr) child.stderr.on('data', (d) => { out += d })
      child.on('error', (err) => reject(err))
      child.on('close', (code) => {
        if (code === 0) resolve({ log: out })
        else reject(new Error(bin + ' 退出码 ' + code + '\n' + String(out).slice(-1500)))
      })
    })
  }
  async function runInstall(profileRoot, target) {
    const bin = (b) => (process.platform === 'win32' ? b + '.cmd' : b)
    try {
      return await execPipe(bin('pnpm'), ['--dir', profileRoot, 'add', name + '@' + target], {}, 240000)
    } catch (pnpmErr) {
      try {
        return await execPipe(bin('npm'), ['--prefix', profileRoot, 'install', name + '@' + target, '--no-audit', '--no-fund'], {}, 240000)
      } catch (npmErr) {
        throw new Error('pnpm 失败：' + String((pnpmErr && pnpmErr.message) || pnpmErr).slice(0, 600) +
          '；npm 失败：' + String((npmErr && npmErr.message) || npmErr).slice(0, 600))
      }
    }
  }
  async function runUpgrade() {
    if (upgrade.running) return
    if (!latestVersion) { try { await checkUpdate() } catch (err) { /* ignore */ } }
    upgrade.running = true
    upgrade.ok = null
    upgrade.message = ''
    upgrade.log = ''
    try {
      const target = latestVersion
      if (!target || !VERSION || !semverGt(target, VERSION)) {
        upgrade.ok = 'skip'
        upgrade.message = target ? '已是最新版本（v' + VERSION + '）' : '暂无更新信息（未发布或离线）'
      } else {
        const profileRoot = findProfileRoot()
        if (!profileRoot) throw new Error('无法定位插件安装目录')
        const result = await runInstall(profileRoot, target)
        upgrade.log = String((result && result.log) || '').slice(-2000)
        upgrade.ok = 'ok'
        upgrade.message = '已升级到 v' + target + '，重启 dsh web 后生效'
      }
    } catch (err) {
      upgrade.ok = 'fail'
      upgrade.message = '自动升级失败：' + String((err && err.message) || err)
      upgrade.log = String((err && err.stack) || upgrade.log).slice(-2000)
    } finally {
      upgrade.running = false
    }
  }

  // ================= HTTP 路由（只读为主，本地回环）=================

  function metaPayload() {
    return {
      version: VERSION,
      latest: latestVersion,
      updateChecked,
      updateAvailable: !!(latestVersion && VERSION && semverGt(latestVersion, VERSION)),
      upgrade: { running: upgrade.running, ok: upgrade.ok, message: upgrade.message },
      scanning,
      seq,
    }
  }

  {
    const sendJson = (res, code, obj) => {
      const body = JSON.stringify(obj)
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache'
      })
      res.end(body)
    }
    ctx.webServer.register({
      kind: 'prefix',
      path: '/dshtoken',
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        let url
        try { url = new URL(req.url || '/', 'http://dshtoken.local') } catch (err) {
          res.writeHead(400); res.end(); return
        }
        const pathname = url.pathname

        if (pathname === '/dshtoken/pull' && req.method !== 'POST') {
          // 触发一次节流重扫（面板打开时高频轮询 → 准实时）
          ensureFresh(false).then(() => {
            const since = Number(url.searchParams.get('since'))
            if (Number.isFinite(since) && since === seq && snapshot) {
              sendJson(res, 200, { ...metaPayload(), unchanged: true })
              return
            }
            sendJson(res, 200, { ...metaPayload(), unchanged: false, data: snapshot })
          })
        } else if (pathname === '/dshtoken/refresh' && req.method === 'POST') {
          // 强制全量重扫（清文件缓存）
          parseCache.clear()
          titleCache = { mtimeMs: -1, map: {} }
          forceNextScan = true
          ensureFresh(true).then(() => sendJson(res, 200, { ok: true, ...metaPayload() }))
        } else if (pathname === '/dshtoken/hello') {
          sendJson(res, 200, { name: 'Oh My DSH Token', version: VERSION, seq })
        } else if (pathname === '/dshtoken/check-update' && req.method === 'POST') {
          checkUpdate().then((v) => {
            sendJson(res, 200, {
              ok: true, version: VERSION, latest: v,
              updateAvailable: !!(v && VERSION && semverGt(v, VERSION))
            })
          }).catch(() => sendJson(res, 200, { ok: false, message: '检查失败' }))
        } else if (pathname === '/dshtoken/check-update') {
          sendJson(res, 405, { error: 'method not allowed' })
        } else if (pathname === '/dshtoken/upgrade' && req.method === 'POST') {
          runUpgrade()
          sendJson(res, 200, { started: true, running: true, message: '升级已开始' })
        } else if (pathname === '/dshtoken/upgrade') {
          sendJson(res, 405, { error: 'method not allowed' })
        } else {
          sendJson(res, 404, { error: 'not found' })
        }
      }
    })
  }

  // ---- 启动：后台首扫 + 保活周期 + 升级检查 ----
  ensureFresh(true)
  ctx.setInterval(() => { ensureFresh(false) }, BACKGROUND_RESCAN_MS)
  checkUpdate()
  ctx.setInterval(() => { checkUpdate() }, CHECK_INTERVAL)

  console.log('[oh-my-dshtoken] host half active, version v' + (VERSION || '?') + ', sessions root: ' + resolveSessionsRoot())
}

export { name, inject, apply }
