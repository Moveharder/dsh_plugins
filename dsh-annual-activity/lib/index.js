/**
 * 全年活跃记录 (dsh-annual-activity) — host half.
 *
 * 纯本地的活跃度统计引擎：
 *
 *  1. 扫描 $DSH_HOME/sessions/<项目目录>/<会话目录>/ 下的会话日志
 *     （session.v3.jsonl.zstd / session.jsonl.zstd / 明文 session.jsonl；
 *      Node >= 22.15 原生 node:zlib zstd 解压，支持多帧拼接与损坏尾帧容错）；
 *  2. 逐条事件按 **本地日历日**（宿主时区，与用户看到的日期一致）分桶，聚合：
 *     会话数 / 轮次(turn) / 步骤(step) / 提问数 / 工具调用 / Token（输入+输出）；
 *  3. 活跃等级由「轮次」主口径决定（0 / 1 / 2-5 / 6-15 / 16+），并把阈值随快照下发，
 *     保证面板色块深度与口径永远一致；
 *  4. Host 半区只暴露只读 HTTP 路由（/activity/pull、/activity/hello、
 *     POST /activity/refresh），供浏览器半区轮询渲染。
 *
 * 增量策略：以「stat 全部会话文件的 mtime + size」为失效依据，只重新解析变化的
 * 文件；后台每 60s 保活重扫一次，所以「今天」的色块会随会话进行自动变深，
 * 不需要等到第二天。
 *
 * 安装为 web profile 组合中的一行：
 *   - id: activity
 *     name: 'dsh-annual-activity'
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const name = 'dsh-annual-activity'
// webServer 是 web-app 层服务（等 webStartup 就绪后路由才能注册）；timer 提供
// 随插件卸载自动清理的周期任务。两者都必须列入 inject，否则 apply 可能过早执行。
const inject = ['timer', 'webServer']

// 两次自动重扫之间的最小间隔（毫秒）：轮询风暴下限流
const RESCAN_MIN_INTERVAL = 5000
// 后台保活重扫周期：今天的新活动即使面板关着也会被记账
const BACKGROUND_RESCAN_MS = 60 * 1000
// 负载里最多携带的会话条数（按最近活跃倒序；总量指标不受影响）
const MAX_SESSIONS_IN_PAYLOAD = 400
// npm registry 版本检查周期（启动时各查一次；离线静默降级）
const UPDATE_CHECK_INTERVAL = 6 * 3600 * 1000

/**
 * 活跃等级（0-4）的唯一事实源：Host 计算并下发给浏览器。
 * 主口径 = 当日「轮次」(turn)：一次用户提问到 agent 收尾算一轮，最贴近
 * 「今天和 DSH 干了多少活」的直觉；Token / 工具调用 / 会话数作为悬浮明细展示，
 * 不参与定级（避免长上下文任务把色块一次性顶到最深）。
 */
const LEVELS = [
  { level: 0, label: '未活跃', min: 0, max: 0 },
  { level: 1, label: '轻', min: 1, max: 1 },
  { level: 2, label: '中', min: 2, max: 5 },
  { level: 3, label: '高', min: 6, max: 15 },
  { level: 4, label: '极高', min: 16, max: null },
]

function levelOf(turns) {
  const t = Number(turns) || 0
  if (t <= 0) return 0
  if (t === 1) return 1
  if (t <= 5) return 2
  if (t <= 15) return 3
  return 4
}

function apply(ctx) {
  // ---- 版本：从本包自己的 package.json 读取（唯一事实来源，避免手写漂移）----
  const here = fileURLToPath(import.meta.url)
  const req = createRequire(import.meta.url)
  let VERSION = ''
  try { VERSION = String((req(path.join(path.dirname(here), '..', 'package.json')) || {}).version || '') } catch (err) { /* ignore */ }

  // ---- 目录解析：DSH_ACTIVITY_ROOT（测试注入）> $DSH_HOME/sessions > ~/.dsh/sessions ----
  function resolveDshHome() {
    if (process.env.DSH_HOME) return process.env.DSH_HOME
    return path.join(os.homedir(), '.dsh')
  }
  function resolveSessionsRoot() {
    if (process.env.DSH_ACTIVITY_ROOT) return process.env.DSH_ACTIVITY_ROOT
    return path.join(resolveDshHome(), 'sessions')
  }

  // ================= 本地日期工具 =================

  function pad2(n) { return n < 10 ? '0' + n : '' + n }

  /** 时间戳 → 本地日历日 'YYYY-MM-DD'（宿主时区） */
  function dayKey(ts) {
    const d = new Date(ts)
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }

  /** 'YYYY-MM-DD' → 本地当日 00:00 的时间戳（用于算连登） */
  function dayStartMs(key) {
    const [y, m, d] = String(key).split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1).getTime()
  }

  // ================= 会话日志解析 =================

  const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const zstdDecompressAsync = promisify(zstdDecompress)

  /** 多帧 zstd 解压：逐帧解压拼接；尾部不完整/损坏帧静默跳过（等下次 mtime 变化重扫）。 */
  async function decompressZstdFrames(buf) {
    const starts = []
    let i = 0
    while (i < buf.length - 3) {
      const idx = buf.indexOf(ZSTD_MAGIC, i)
      if (idx < 0) break
      starts.push(idx)
      i = idx + 4
    }
    if (!starts.length) throw new Error('invalid zstd: no frame magic')
    let out = ''
    for (let f = 0; f < starts.length; f++) {
      const end = f + 1 < starts.length ? starts[f + 1] : buf.length
      try {
        out += (await zstdDecompressAsync(buf.subarray(starts[f], end))).toString('utf8')
      } catch (err) { /* 尾部不完整帧：跳过 */ }
    }
    return out
  }

  function numOr0(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0 }

  /**
   * 解析一份会话 JSONL，返回 { sessionId, cwd, createdAt, lastActive, days, totals }。
   *
   * 分桶口径：
   *  - `turn/start` / `step/start` / `user/message` / `tool/call` 按自身 `time` 落桶；
   *  - Token 只认「一步一条」的权威记录：v3 日志是 `assistant/message.usage`，
   *    旧版日志是 `assistant/chunk(chunk.type==='usage').usage`；同一会话里两种
   *    形态不会混用（版本切换），并按 turn:step 去重双保险，绝不重复计数；
   *  - `session` 头事件（含 createdAt/cwd）也要落桶：即使某天只创建了会话没有对话，
   *    这一天仍然算「活跃」——它是真实发生过的事实。
   */
  function parseSessionText(text) {
    let sessionId = ''
    let cwd = ''
    let createdAt = 0
    let lastActive = 0
    let parsedVersion = 0
    const days = new Map() // 'YYYY-MM-DD' -> { turns, steps, userMessages, toolCalls, inputTokens, outputTokens, usageSteps }
    const touchedDays = new Set() // 出现过任何事件（含仅创建会话）的本地日
    const seenUsageStep = new Set() // 'turn:step' → 防止 chunk/message 双计
    const totals = { turns: 0, steps: 0, userMessages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }

    function bucket(ts) {
      const key = dayKey(ts)
      touchedDays.add(key)
      let d = days.get(key)
      if (!d) {
        d = { turns: 0, steps: 0, userMessages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, usageSteps: 0 }
        days.set(key, d)
      }
      return d
    }

    const lines = text.split('\n')
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      if (!line) continue
      let ev
      try { ev = JSON.parse(line) } catch (err) { continue }
      const t = typeof ev.time === 'number' && ev.time > 0 ? ev.time : 0
      if (t && t > lastActive) lastActive = t

      if (ev.type === 'session') {
        sessionId = String(ev.id || sessionId || '')
        cwd = typeof ev.cwd === 'string' ? ev.cwd : cwd
        createdAt = Number(ev.createdAt) || createdAt
        parsedVersion = Number(ev.version) || parsedVersion
        // 会话创建本身不增加轮次，但要让这一天出现在活跃集合里：
        // 只要当天创建过会话（哪怕还没有对话），这天也算真实发生过活动。
        if (createdAt) bucket(createdAt)
        continue
      }

      if (!t) continue
      const data = ev.data || {}

      if (ev.type === 'turn/start') {
        bucket(t).turns += 1
        totals.turns += 1
        continue
      }
      if (ev.type === 'step/start') {
        bucket(t).steps += 1
        totals.steps += 1
        continue
      }
      if (ev.type === 'user/message') {
        bucket(t).userMessages += 1
        totals.userMessages += 1
        continue
      }
      if (ev.type === 'tool/call') {
        bucket(t).toolCalls += 1
        totals.toolCalls += 1
        continue
      }

      // Token：v3 assistant/message.usage
      if (ev.type === 'assistant/message' && data.usage && typeof data.usage === 'object') {
        const stepKey = data.turn + ':' + data.step
        if (typeof data.turn === 'number' && typeof data.step === 'number') {
          if (seenUsageStep.has(stepKey)) continue
          seenUsageStep.add(stepKey)
        }
        const inp = numOr0(data.usage.inputTokens)
        const outp = numOr0(data.usage.outputTokens)
        const d = bucket(t)
        d.inputTokens += inp
        d.outputTokens += outp
        d.usageSteps += 1
        totals.inputTokens += inp
        totals.outputTokens += outp
        continue
      }
      // Token：旧版 assistant/chunk(chunk.type === 'usage')
      if (ev.type === 'assistant/chunk') {
        const chunk = data.chunk
        if (!chunk || chunk.type !== 'usage' || !chunk.usage) continue
        const stepKey = data.turn + ':' + data.step
        if (typeof data.turn === 'number' && typeof data.step === 'number') {
          if (seenUsageStep.has(stepKey)) continue
          seenUsageStep.add(stepKey)
        }
        const inp = numOr0(chunk.usage.inputTokens)
        const outp = numOr0(chunk.usage.outputTokens)
        const d = bucket(t)
        d.inputTokens += inp
        d.outputTokens += outp
        d.usageSteps += 1
        totals.inputTokens += inp
        totals.outputTokens += outp
      }
    }

    return { sessionId, cwd, createdAt, lastActive, version: parsedVersion, days, touchedDays, totals }
  }

  // ================= 文件级缓存 + 扫描 =================

  // filePath -> { mtimeMs, size, parsed }
  const parseCache = new Map()
  let snapshot = null
  let snapshotJson = ''
  let seq = 0
  let scanning = false
  let scanPromise = null
  let lastScanFinishedAt = 0
  let lastScanError = ''
  let scanErrorCount = 0
  let forceNextScan = true

  async function listDirSafe(dir) {
    try { return await fsp.readdir(dir) } catch (err) { return [] }
  }
  async function statOrNull(p) {
    try { return await fsp.stat(p) } catch (err) { return null }
  }

  /** 定位会话日志：优先 v3 zstd → zstd → 明文 */
  async function resolveSessionFile(sessPath) {
    const candidates = ['session.v3.jsonl.zstd', 'session.jsonl.zstd', 'session.v3.jsonl', 'session.jsonl']
    for (const c of candidates) {
      const p = path.join(sessPath, c)
      if (await statOrNull(p)) return p
    }
    return null
  }

  /** 读一个会话日志并解析（带 mtime + size 缓存）。 */
  async function parseSessionFile(file) {
    const st = await statOrNull(file)
    if (!st) return null
    const cached = parseCache.get(file)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.parsed
    let text
    try {
      if (file.endsWith('.zstd')) text = await decompressZstdFrames(await fsp.readFile(file))
      else text = await fsp.readFile(file, 'utf8')
    } catch (err) {
      scanErrorCount++
      lastScanError = String((err && err.message) || err)
      return null
    }
    const parsed = parseSessionText(text)
    parseCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, parsed })
    return parsed
  }

  /** 会话标题富化：storages/session_projcache.json 的 title 投影（best-effort，带 mtime 缓存）。 */
  let titleCache = { mtimeMs: -1, map: {} }
  async function loadTitleMap() {
    const file = path.join(resolveDshHome(), 'storages', 'session_projcache.json')
    const st = await statOrNull(file)
    if (!st) return {}
    if (titleCache.mtimeMs === st.mtimeMs) return titleCache.map
    const map = {}
    try {
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'))
      const tables = raw && raw.tables && raw.tables.sessions
      if (tables && typeof tables === 'object') {
        for (const [id, rec] of Object.entries(tables)) {
          const title = rec && rec.rows && rec.rows.title && rec.rows.title.val
          const cwd = rec && rec.identity && rec.identity.cwd
          if ((typeof title === 'string' && title) || (typeof cwd === 'string' && cwd)) {
            map[id] = { title: typeof title === 'string' ? title : '', cwd: typeof cwd === 'string' ? cwd : '' }
          }
        }
      }
    } catch (err) { /* 富化失败不影响主流程 */ }
    titleCache = { mtimeMs: st.mtimeMs, map }
    return map
  }

  function baseName(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '(未知项目)' }

  /** 全量扫描（增量利用 parseCache）并重建快照。 */
  async function scanOnce() {
    const started = Date.now()
    scanErrorCount = 0
    const root = resolveSessionsRoot()
    const titles = await loadTitleMap()
    const seenFiles = new Set()
    const perSession = []

    const projectDirs = await listDirSafe(root)
    for (const proj of projectDirs) {
      const projPath = path.join(root, proj)
      const projSt = await statOrNull(projPath)
      if (!projSt || !projSt.isDirectory()) continue
      const sessDirs = await listDirSafe(projPath)
      for (const sess of sessDirs) {
        const sessPath = path.join(projPath, sess)
        const sessSt = await statOrNull(sessPath)
        if (!sessSt || !sessSt.isDirectory()) continue
        const file = await resolveSessionFile(sessPath)
        if (!file) continue
        seenFiles.add(file)
        const parsed = await parseSessionFile(file)
        if (!parsed) continue
        perSession.push({ dir: sess, file, parsed })
      }
    }

    // 清理已消失文件的缓存条目
    for (const key of Array.from(parseCache.keys())) {
      if (!seenFiles.has(key)) parseCache.delete(key)
    }

    // ---- 聚合：按天 + 按会话 ----
    const daysAgg = new Map() // day -> metrics
    const sessions = []

    for (const entry of perSession) {
      const p = entry.parsed
      const sessionId = p.sessionId || path.basename(entry.dir)
      const cwd = p.cwd || ''
      const enriched = titles[sessionId]
      const title = (enriched && enriched.title) || ''
      // 日志头缺 cwd 时用投影里的 cwd 兜底（项目维度更完整）
      const projectCwd = cwd || (enriched && enriched.cwd) || ''

      let tokens = 0
      let turns = 0
      const sessionDays = []
      // 以 touchedDays 为准：即使某天只有会话创建、没有产生指标，也是活跃日
      for (const key of Array.from(p.touchedDays).sort()) {
        const d = p.days.get(key) || { turns: 0, steps: 0, userMessages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
        const inp = d.inputTokens
        const outp = d.outputTokens
        tokens += inp + outp
        turns += d.turns
        const dayTurns = d.turns
        let agg = daysAgg.get(key)
        if (!agg) {
          agg = { day: key, sessions: [], turns: 0, steps: 0, userMessages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
          daysAgg.set(key, agg)
        }
        agg.sessions.push(sessionId)
        agg.turns += dayTurns
        agg.steps += d.steps
        agg.userMessages += d.userMessages
        agg.toolCalls += d.toolCalls
        agg.inputTokens += inp
        agg.outputTokens += outp
        sessionDays.push({ day: key, turns: dayTurns, tokens: inp + outp })
      }

      sessions.push({
        id: sessionId,
        title,
        project: baseName(projectCwd),
        cwd: projectCwd,
        createdAt: p.createdAt,
        lastActive: p.lastActive,
        turns,
        tokens,
        days: sessionDays.sort((a, b) => (a.day < b.day ? -1 : 1)),
      })
    }

    // 天 → 数组（会话去重、等级计算）
    const days = Array.from(daysAgg.values()).map((d) => ({
      day: d.day,
      activeSessions: new Set(d.sessions).size,
      turns: d.turns,
      steps: d.steps,
      userMessages: d.userMessages,
      toolCalls: d.toolCalls,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      tokens: d.inputTokens + d.outputTokens,
      level: levelOf(d.turns),
    })).sort((a, b) => (a.day < b.day ? -1 : 1))

    const years = Array.from(new Set(days.map((d) => Number(d.day.slice(0, 4))))).sort((a, b) => a - b)
    sessions.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))

    const next = {
      days,
      years,
      sessions: sessions.slice(0, MAX_SESSIONS_IN_PAYLOAD).map((s) => ({
        id: s.id,
        title: s.title,
        project: s.project,
        createdAt: s.createdAt,
        lastActive: s.lastActive,
        turns: s.turns,
        tokens: s.tokens,
        activeDays: s.days.length,
      })),
      sessionCount: sessions.length,
      levels: LEVELS,
      scannedAt: Date.now(),
      scanMs: Date.now() - started,
      errors: scanErrorCount,
    }

    const json = JSON.stringify(next)
    // 内容指纹（排除扫描耗时/时间戳）：未变则不递增 seq，客户端可据此跳过重渲染
    const stable = json.replace(/"scannedAt":\d+,"scanMs":\d+/, '')
    if (stable !== snapshotJson) {
      snapshotJson = stable
      seq += 1
    }
    snapshot = next
    lastScanFinishedAt = Date.now()
    return snapshot
  }

  /** 带并发去重 + 最小间隔限流的扫描入口。 */
  async function ensureScan(force) {
    if (scanPromise) return scanPromise
    const fresh = lastScanFinishedAt > 0 && Date.now() - lastScanFinishedAt < RESCAN_MIN_INTERVAL
    if (!force && !forceNextScan && fresh && snapshot) return snapshot
    forceNextScan = false
    scanning = true
    scanPromise = scanOnce()
      .catch((err) => {
        lastScanError = String((err && err.message) || err)
        scanErrorCount++
        return snapshot
      })
      .finally(() => { scanning = false; scanPromise = null })
    return scanPromise
  }

  // ================= 统计派生（活跃率 / 连登）=================

  /**
   * 基于「活跃日集合」计算面板统计。口径：
   *  - 活跃率分母：当前年份用「已过天数」（今天也算一天），历史年份用全年天数
   *    —— 避免 1 月的活跃率被 365 稀释；
   *  - 周连登：以周一为一周起点，从「本周 / 上周」向前数连续有活跃日的周数
   *    （上周仍有记录就算连登未断，给跨周末的工作流留出余量）；
   *  - 最长连续：年内连续有活跃日的最长天数。
   */
  function statsForYear(year, daySet, todayKey, todayMs) {
    const dayKeys = Array.from(daySet).filter((k) => Number(k.slice(0, 4)) === year).sort()
    const activeDays = dayKeys.length
    // 已过天数 =（今年第一天 00:00 → 今天 00:00 的天数）+ 1；历史年份即全年天数
    const elapsed = Math.floor((dayStartMs(todayKey) - new Date(year, 0, 1).getTime()) / 86400000) + 1
    const totalDays = year === Number(todayKey.slice(0, 4)) ? Math.max(1, elapsed) : daysInYear(year)
    const rate = totalDays > 0 ? activeDays / totalDays : 0

    // ---- 周连登 ----
    const weeks = new Set()
    const sortedWeeks = []
    for (const k of dayKeys) {
      const ms = dayStartMs(k)
      const dow = (new Date(ms).getDay() + 6) % 7 // 0 = 周一
      const monday = ms - dow * 86400000
      if (!weeks.has(monday)) { weeks.add(monday); sortedWeeks.push(monday) }
    }
    let longestWeekStreak = 0
    let run = 0
    for (let i = 0; i < sortedWeeks.length; i++) {
      run = i > 0 && sortedWeeks[i] - sortedWeeks[i - 1] === 7 * 86400000 ? run + 1 : 1
      if (run > longestWeekStreak) longestWeekStreak = run
    }
    const todayDow = (new Date(todayMs).getDay() + 6) % 7
    const thisMonday = dayStartMs(todayKey) - todayDow * 86400000
    let weekStreak = 0
    if (sortedWeeks.length) {
      const lastWeek = sortedWeeks[sortedWeeks.length - 1]
      if (lastWeek === thisMonday || lastWeek === thisMonday - 7 * 86400000) {
        let cursor = lastWeek
        while (weeks.has(cursor)) { weekStreak += 1; cursor -= 7 * 86400000 }
      }
    }

    // ---- 年内最长连续活跃天数 ----
    let longestDayStreak = 0
    let streak = 0
    let prev = null
    for (const k of dayKeys) {
      const ms = dayStartMs(k)
      streak = prev != null && ms - prev === 86400000 ? streak + 1 : 1
      if (streak > longestDayStreak) longestDayStreak = streak
      prev = ms
    }

    return { year, activeDays, totalDays, rate, weekStreak, longestWeekStreak, longestDayStreak }
  }

  function daysInYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
  }

  /** 生成完整负载（含派生统计 + 各年汇总）。 */
  function buildPayload() {
    const now = new Date()
    const todayKey = dayKey(now.getTime())
    const snap = snapshot || { days: [], years: [], sessions: [], sessionCount: 0, levels: LEVELS, scannedAt: 0, errors: 0 }
    const daySet = new Set(snap.days.map((d) => d.day))
    const years = snap.years.slice()
    if (!years.includes(now.getFullYear())) years.push(now.getFullYear())
    years.sort((a, b) => a - b)

    const yearStats = {}
    for (const y of years) yearStats[y] = statsForYear(y, daySet, todayKey, now.getTime())

    const byDay = {}
    for (const d of snap.days) byDay[d.day] = d

    const totalTurns = snap.days.reduce((a, d) => a + d.turns, 0)
    const totalTokens = snap.days.reduce((a, d) => a + d.tokens, 0)
    const projects = new Set(snap.sessions.map((s) => s.project)).size

    return {
      version: VERSION,
      seq,
      today: todayKey,
      currentYear: now.getFullYear(),
      years,
      yearStats,
      byDay,
      levels: LEVELS,
      sessions: snap.sessions,
      sessionCount: snap.sessionCount,
      projects,
      totalTurns,
      totalTokens,
      scannedAt: snap.scannedAt,
      scanMs: snap.scanMs,
      scanErrors: snap.errors,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  }

  // ================= 版本与在线升级 =================
  // 与 dsh-whale-copilot / oh-my-dshtoken 同款：启动时 + 每 6h 查 npm registry，
  // 发现新版本后可一键在本插件安装目录执行 pnpm/npm 安装，重启 dsh web 生效。
  // 全程离线静默降级；升级只替换安装文件，不卸载当前插件。

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
      // 按协议选模块：便于把 registry 指到本地 http 端点（测试 / 内网镜像）
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

  // registry 基址：默认 npm 官方；可用 DSH_ACTIVITY_REGISTRY 指向内网镜像（或测试端点）
  const REGISTRY = () => String(process.env.DSH_ACTIVITY_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '')

  let latestVersion = null
  let updateChecked = false
  let checkInFlight = null
  // 关闭在线检查（离线环境 / 测试 / 只想完全禁网的场景）：设了就不查 registry，
  // 面板显示「未检测」，其余功能不受影响。
  const UPDATE_CHECK_DISABLED = () => !!process.env.DSH_ACTIVITY_NO_UPDATE_CHECK
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
        latestVersion = null
      } finally {
        updateChecked = true
      }
      return latestVersion
    })().finally(() => { checkInFlight = null })
    return checkInFlight
  }

  // 定位 profile 根目录：从本模块所在位置向上找「package.json 含 dsh.profile」的目录
  // （兼容 hoisted 与 pnpm .pnpm 虚拟存储两种布局；本包自己的 package.json 只有
  //  dsh.client / dsh.bundle，不会误判）
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

  // 本包是否为「本地目录 / link / file / tarball」安装：这类安装是源码开发态，
  // 直接跑 `pnpm add <npm 包>` 会把 link 换成 registry 版本，反而让本地源码改动失效。
  // 因此识别出来后拒绝在线升级，并给出正确的升级路径。
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
        // Windows 上需要 shell: true 才能正确解析 .cmd 与 PATH 中的可执行文件
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
        else reject(new Error(bin + ' 退出码 ' + code + '\n' + String(out).slice(-1500)))
      })
    })
  }

  async function runInstall(profileRoot, target) {
    // 包管理器可用 DSH_ACTIVITY_PKG_MANAGER 覆盖（测试注入假 pnpm / 用 corepack 等）
    const override = process.env.DSH_ACTIVITY_PKG_MANAGER
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
        throw new Error('pnpm 失败：' + String((pnpmErr && pnpmErr.message) || pnpmErr).slice(0, 600) +
          '；npm 失败：' + String((npmErr && npmErr.message) || npmErr).slice(0, 600))
      }
    }
  }

  async function runUpgrade() {
    if (upgrade.running) return upgrade
    if (!latestVersion) { try { await checkUpdate() } catch (err) { /* ignore */ } }
    upgrade.running = true
    upgrade.ok = null
    upgrade.message = ''
    upgrade.log = ''
    try {
      const target = latestVersion
      // 本地 link/file 安装：不能走 registry 升级（会把源码开发态换成发布版）
      const profileRootForCheck = findProfileRoot()
      const localSpec = profileRootForCheck ? localInstallOf(profileRootForCheck) : null
      if (localSpec) {
        upgrade.ok = 'local'
        upgrade.message = '当前是本地安装（' + localSpec + '），已跳过在线升级：直接改源码即可；要发布请用 scripts/publish-plugin.sh'
      } else if (!target || !VERSION || !semverGt(target, VERSION)) {
        upgrade.ok = 'skip'
        upgrade.message = target ? '已是最新版本（v' + VERSION + '）' : '暂无更新信息（未发布或离线）'
      } else {
        const profileRoot = profileRootForCheck || (() => { throw new Error('无法定位插件安装目录（profile）') })()
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
    return upgrade
  }

  /** 版本/升级元信息（面板底部「设置」里展示，与活动数据分开、可独立轮询）。 */
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

  // ================= HTTP 路由（只读，仅本地回环可见）=================

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
    } catch (err) { /* 连接已断开 */ }
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: '/activity',
    handler: async (req, res) => {
      let pathname = '/'
      try { pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname } catch (err) { pathname = req.url || '/' }
      const url = (() => { try { return new URL(req.url || '/', 'http://127.0.0.1') } catch (err) { return null } })()

      if (pathname === '/activity/hello') {
        sendJson(res, 200, { ok: true, name, version: VERSION })
        return
      }

      if (pathname === '/activity/refresh') {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        try { await ensureScan(true) } catch (err) { /* 已降级 */ }
        sendJson(res, 200, { ok: true, seq, scannedAt: lastScanFinishedAt })
        return
      }

      if (pathname === '/activity/pull') {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const yearParam = url ? Number(url.searchParams.get('year')) : NaN
        const wantYear = Number.isFinite(yearParam) && yearParam > 1970 ? yearParam : null
        try {
          await ensureScan(false)
          const payload = buildPayload()
          const y = wantYear && payload.years.includes(wantYear) ? wantYear : payload.currentYear
          // 只回该年的日明细（负载有界）；跨年汇总仍在 yearStats 里完整给出
          const days = Object.values(payload.byDay).filter((d) => Number(d.day.slice(0, 4)) === y)
          sendJson(res, 200, {
            ...payload,
            byDay: undefined,
            year: y,
            days,
            stats: payload.yearStats[y] || null,
            scanning,
            lastError: lastScanError,
          })
        } catch (err) {
          sendJson(res, 500, { error: String((err && err.message) || err), version: VERSION })
        }
        return
      }

      // ---- 版本 / 升级元信息 ----
      if (pathname === '/activity/meta') {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }); return }
        sendJson(res, 200, metaPayload())
        return
      }

      // ---- 手动检测更新（强制查一次 registry，忽略 6h 周期）----
      if (pathname === '/activity/check-update') {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        try { await checkUpdate() } catch (err) { /* 离线静默 */ }
        sendJson(res, 200, metaPayload())
        return
      }

      // ---- 在线升级（仅 registry 安装；本地 link/file 安装会被拒绝并说明）----
      if (pathname === '/activity/upgrade') {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const state = await runUpgrade()
        sendJson(res, 200, { ...metaPayload(), upgrade: { running: state.running, ok: state.ok, message: state.message, log: state.log } })
        return
      }

      sendJson(res, 404, {
        error: 'not found',
        routes: ['/activity/pull', '/activity/hello', '/activity/meta', 'POST /activity/refresh', 'POST /activity/check-update', 'POST /activity/upgrade'],
      })
    },
  })

  // ---- 后台保活重扫：面板关着也让「今天」保持新鲜 ----
  ctx.setInterval(() => { void ensureScan(false) }, BACKGROUND_RESCAN_MS)

  // ---- 版本检查：启动时 + 每 6h（离线/未发布时静默降级，不阻塞任何功能）----
  void checkUpdate()
  ctx.setInterval(() => { void checkUpdate() }, UPDATE_CHECK_INTERVAL)

  // ---- 启动即预热一次（不阻塞 apply）----
  void ensureScan(true)

  ctx.logger?.info?.(`[${name}] 全年活跃记录 host 就绪 · v${VERSION} · 会话根目录 ${resolveSessionsRoot()}`)
}

export { name, inject, apply }
