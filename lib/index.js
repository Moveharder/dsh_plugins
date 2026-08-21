/**
 * DSWhale — host half.
 *
 * A permanent (package) DSH plugin: listens to agent/session events on the host,
 * aggregates a small session table + bounded event log, and serves them to the
 * browser client over an HTTP route registered on the webServer service.
 *
 * Installed as a normal Cordis row in the web profile composition:
 *
 *   - id: whale
 *     name: 'dsh-whale-copilot'
 *
 * The package also declares `dsh.client: { platform: 'web' }`, so
 * @deepseek-ai/dsh-client-modules automatically serves `exports["./client"]`
 * (lib/client.js) as the browser half at /plugins/<name>/client.js and adds it
 * to the window.__DSH_BOOT__ graph.
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import { execFile } from 'node:child_process'

const name = 'dsh-whale-copilot'
// webServer 是 web-app 层服务（等 webStartup 就绪）；列入 inject 让本插件
// 在路由可注册后才激活，避免 apply 过早执行导致 ctx.get('webServer') 为空。
const inject = ['timer', 'webServer']

function apply(ctx) {
  const agentsSvc = ctx.get('agents')
  const titleSvc = ctx.get('sessionTitle')

  // ---- 内部状态：会话表 + 有界事件日志 ----
  const sessions = new Map()
  const log = []
  const MAX_LOG = 240
  let seq = 0
  const lastTaskPush = new Map()
  const lastThinkPush = new Map()
  // 进行中的提问：sessionId -> Set<callId>（ask_user_question 工具调用，等待用户回答）
  const pendingQuestions = new Map()

  // ---- 版本与在线升级 ----
  // 当前版本：从本包自己的 package.json 读取（唯一事实来源，避免手写漂移）
  const here = fileURLToPath(import.meta.url)
  const req = createRequire(import.meta.url)
  let VERSION = ''
  try { VERSION = String((req(path.join(path.dirname(here), '..', 'package.json')) || {}).version || '') } catch (err) { /* ignore */ }

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

  // 定位 profile 根目录：从本模块所在位置向上找「package.json 含 dsh.profile 字段」的目录
  // （兼容 hoisted 与 pnpm .pnpm 虚拟存储两种布局；插件自身 package.json 只有 dsh.client/bundle，不会误判）
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
      const r = https.get(url, { headers: { 'user-agent': 'dsh-whale-copilot/' + (VERSION || '?') } }, (res) => {
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

  // 版本检查：启动时 + 每 6 小时各查一次 npm 官方仓库；离线/未发布时静默降级，不阻塞任何功能
  let latestVersion = null
  let updateChecked = false
  const CHECK_INTERVAL = 6 * 3600 * 1000
  async function checkUpdate() {
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
  }

  // 升级状态（供客户端轮询展示）：ok = 'ok' 成功 / 'fail' 失败 / 'skip' 无需升级 / null 进行中
  const upgrade = { running: false, ok: null, message: '', log: '' }
  function execPipe(bin, args, opts, timeoutMs) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = execFile(bin, args, Object.assign({ timeout: timeoutMs || 240000, maxBuffer: 8 * 1024 * 1024 }, opts || {}))
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
    // 优先 pnpm（官方安装方式），失败退化 npm
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
        upgrade.message = target ? '已是最新版本（v' + VERSION + '）' : '暂无更新信息'
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

  function shortId(id) {
    if (typeof id !== 'string') return '?'
    return id.length > 10 ? id.slice(0, 10) + '…' : id
  }

  function upsert(agent, patch) {
    const id = agent && (typeof agent === 'string' ? agent : agent.id)
    if (!id) return
    let s = sessions.get(id)
    if (!s) {
      let title = ''
      try {
        if (titleSvc && agent.session) {
          const snap = titleSvc.get(agent.session)
          if (snap && typeof snap.title === 'string') title = snap.title
        }
      } catch (err) { /* title 尽力而为 */ }
      s = { id, title, status: 'idle', phase: 'idle', tool: '' }
      sessions.set(id, s)
    } else if (s.title === '' && titleSvc && agent && agent.session) {
      // 标题是异步生成的：首见会话时可能还没有，之后补拉一次（session/title 事件也会随后刷新）
      try {
        const snap = titleSvc.get(agent.session)
        if (snap && typeof snap.title === 'string' && s.title !== snap.title) s.title = snap.title
      } catch (err) { /* ignore */ }
    }
    if (patch) {
      for (const k of Object.keys(patch)) s[k] = patch[k]
    }
    return s
  }

  function remove(id) { if (id) sessions.delete(id) }

  function setPhase(id, phase, tool) {
    const s = sessions.get(id)
    if (!s) return
    s.phase = phase
    if (tool) s.tool = tool
  }

  function push(type, session, text, mood, extra) {
    const entry = { seq: ++seq, type, session: session || '', text, mood, time: Date.now() }
    if (extra) {
      for (const k of Object.keys(extra)) entry[k] = extra[k]
    }
    log.push(entry)
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
  }

  // ---- 初始种子：已存在的 live agents ----
  try {
    if (agentsSvc) {
      for (const agent of agentsSvc.list()) {
        if (agent) upsert(agent, { status: agent.status || 'idle' })
      }
    }
  } catch (err) { /* ignore */ }

  // ---- session 事件流（所有会话）----
  ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    const id = session.id
    const type = event.type
    const data = event.data || {}
    switch (type) {
      case 'turn/start':
        setPhase(id, 'thinking', '')
        push('think', id, '开始思考', 'thinking')
        break
      case 'step/start':
        setPhase(id, 'thinking', '')
        break
      case 'assistant/chunk': {
        const chunk = data.chunk || {}
        const ctype = chunk.type
        const thinking =
          ctype === 'reasoning-delta' ||
          (ctype === 'block-start' && chunk.blockType === 'reasoning') ||
          (ctype === 'block-end' && chunk.block && chunk.block.type === 'reasoning')
        if (thinking) {
          // 思考 token 流：保持思考状态，间歇性记录（限流防刷屏）
          setPhase(id, 'thinking', '')
          const text = typeof chunk.text === 'string' ? chunk.text : ''
          if (text) {
            const now = Date.now()
            const last = lastThinkPush.get(id) || 0
            if (now - last > 6000) {
              lastThinkPush.set(id, now)
              push('think', id, '思考中…', 'thinking')
            }
          }
        } else {
          // 可见文字流开始 → 回复中
          setPhase(id, 'replying', '')
        }
        break
      }
      case 'assistant/message':
        setPhase(id, 'replying', '')
        push('reply', id, '回复中', 'replying')
        break
      case 'tool/call': {
        const name = data.name || ''
        if (name === 'ask_user_question') {
          // 提问事件：与审批类似——客户端据此暂停移动并抖动提醒。
          let set = pendingQuestions.get(id)
          if (!set) { set = new Set(); pendingQuestions.set(id, set) }
          if (data.callId) set.add(data.callId)
          setPhase(id, 'question', name)
          // 尝试取出第一条问题文本，作为气泡/日志文案
          let askText = ''
          try {
            const parsed = JSON.parse(String(data.arguments || ''))
            const qs = parsed && Array.isArray(parsed.questions) ? parsed.questions : []
            if (qs[0] && typeof qs[0].question === 'string') askText = qs[0].question
          } catch (err) { /* 解析失败则用通用文案 */ }
          push('question', id, '提问: ' + (askText || '请你回答'), 'question', { tool: name, ask: askText })
        } else {
          setPhase(id, 'tool', name)
          push('tool', id, '执行动作 ' + name, 'tool', { tool: name })
        }
        break
      }
      case 'tool/result': {
        // 若该结果是某个进行中提问的回答，则解除提问状态
        const pending = pendingQuestions.get(id)
        if (pending && pending.size) {
          const block = data.message && data.message.content && data.message.content[0]
          const callId =
            (block && block.toolCallId) ||
            (data.message && data.message.source && data.message.source.callId)
          if (callId) pending.delete(callId)
          if (pending.size === 0) {
            pendingQuestions.delete(id)
            setPhase(id, 'thinking', '')
            push('question-done', id, '收到你的回答', 'info')
          }
        }
        if (data.error) {
          setPhase(id, 'thinking', '')
          push('error', id, '工具出错', 'sad', { tool: '' })
        } else if (!pending || !pendingQuestions.has(id)) {
          setPhase(id, 'thinking', '')
        }
        break
      }
      case 'turn/end': {
        pendingQuestions.delete(id)
        const kind = data.reason && data.reason.kind
        setPhase(id, 'idle', '')
        if (kind === 'completed') push('done', id, '任务完成', 'celebrate')
        else if (kind === 'error') push('error', id, '回合出错', 'sad')
        else push('info', id, '回合结束 (' + (kind || '?') + ')', 'idle')
        break
      }
      case 'session/title': {
        // 会话标题是异步生成的（fallback / LLM provider），事件到达后刷新，避免列表一直显示 session id
        const s = sessions.get(id)
        if (s && data && typeof data.title === 'string' && s.title !== data.title) s.title = data.title
        break
      }
      case 'user/message': {
        const now = Date.now()
        const last = lastTaskPush.get(id) || 0
        if (now - last > 10000) {
          lastTaskPush.set(id, now)
          push('task', id, '收到新消息', 'attention')
        }
        break
      }
      default:
        break
    }
  })

  // ---- agent 生命周期 ----
  ctx.on('agent/created', (payload) => {
    const agent = payload && payload.agent
    if (agent) upsert(agent, { status: agent.status || 'idle' })
  })
  ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent
    if (agent) remove(agent.id)
  })
  ctx.on('agent/status', (payload) => {
    const agent = payload && payload.agent
    if (!agent) return
    upsert(agent, { status: payload.status })
    if (payload.status === 'running') setPhase(agent.id, 'thinking', '')
    else setPhase(agent.id, 'idle', '')
  })
  ctx.on('agent/error', (payload) => {
    const agent = payload && payload.agent
    if (agent) push('error', agent.id, '出错了', 'sad')
  })

  // ---- 审批：观察式（调用 next 继续真实审批链，不劫持）----
  ctx.on('approval/request', async (req, next) => {
    if (!req || !req.agent) {
      if (typeof next === 'function') return next()
      return 'unavailable'
    }
    const id = req.agent.id
    const toolName = req.toolName || '?'
    setPhase(id, 'approval', toolName)
    // mood 'approval'：客户端据此触发「暂停移动 + 喷水 + 抖动」的专属审批动画，
    // 与普通 attention（跳一下）区分开。
    push('approval', id, '需要审批: ' + toolName, 'approval', { tool: toolName, reason: req.reason || '' })
    let outcome = 'unavailable'
    try {
      outcome = await next()
    } catch (err) {
      outcome = 'unavailable'
    }
    if (outcome === 'allowed-once') {
      setPhase(id, 'thinking', '')
      push('approve', id, '已批准', 'celebrate')
    } else if (outcome === 'rejected') {
      setPhase(id, 'thinking', '')
      push('reject', id, '审批被拒绝', 'sad')
    } else {
      setPhase(id, 'thinking', '')
      push('info', id, '审批结束 (' + outcome + ')', 'idle')
    }
    return outcome
  })

  // ---- 子代理 ----
  ctx.on('subagent/start', (info) => {
    if (!info) return
    push('sub', info.id, '小助手开工 (' + (info.provider || '?') + ')', 'attention')
  })
  ctx.on('subagent/end', (info) => {
    if (!info) return
    push('sub-end', info.id, '小助手完成', 'celebrate')
  })

  // ---- 工作流 ----
  ctx.on('workflow/start', (info) => {
    if (!info) return
    const wfName = info.meta && info.meta.name ? info.meta.name : 'workflow'
    push('workflow', '', '工作流开始: ' + wfName, 'attention')
  })
  ctx.on('workflow/end', (info, result) => {
    if (!info) return
    const reason = result && result.stopReason
    if (reason === 'completed') push('workflow-done', '', '工作流完成', 'celebrate')
    else push('workflow-error', '', '工作流结束 (' + (reason || '?') + ')', 'sad')
  })

  // ---- 目标 ----
  ctx.on('goal/changed', (payload) => {
    const change = payload && payload.change
    const agent = payload && payload.agent
    const id = agent ? agent.id : ''
    const op = change && change.operation
    if (op === 'create') push('goal', id, '建立新目标', 'attention')
    else if (op === 'complete') push('goal-done', id, '目标完成', 'celebrate')
    else if (op === 'block') push('goal-blocked', id, '目标受阻', 'sad')
    else if (op === 'resume') push('info', id, '目标恢复', 'attention')
    else if (op) push('info', id, '目标更新 (' + op + ')', 'idle')
  })

  // ---- Client 轮询接口（webServer HTTP 路由；webServer 已注入，保证路由可注册）----
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
      path: '/whale',
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        let url
        try {
          url = new URL(req.url || '/', 'http://whale.local')
        } catch (err) {
          res.writeHead(400)
          res.end()
          return
        }
        const pathname = url.pathname
        if (pathname === '/whale/pull' && req.method !== 'POST') {
          const since = Number(url.searchParams.get('since'))
          const fresh = (!Number.isFinite(since) || since < 0)
            ? log
            : log.filter((e) => e.seq > since)
          sendJson(res, 200, {
            seq,
            sessions: Array.from(sessions.values()),
            events: fresh,
            version: VERSION,
            latest: latestVersion,
            updateChecked,
            updateAvailable: !!(latestVersion && VERSION && semverGt(latestVersion, VERSION)),
            upgrade: { running: upgrade.running, ok: upgrade.ok, message: upgrade.message }
          })
        } else if (pathname === '/whale/hello') {
          sendJson(res, 200, { name: 'DSWhale', seq, version: VERSION })
        } else if (pathname === '/whale/upgrade' && req.method === 'POST') {
          // 后台执行：升级状态通过轮询 /whale/pull 返回
          runUpgrade()
          sendJson(res, 200, { started: true, running: true, message: '升级已开始' })
        } else if (pathname === '/whale/upgrade') {
          sendJson(res, 405, { error: 'method not allowed' })
        } else {
          sendJson(res, 404, { error: 'not found' })
        }
      }
    })
  }

  checkUpdate()
  ctx.setInterval(() => { checkUpdate() }, CHECK_INTERVAL)

  console.log('[dsh-whale-copilot] host half active, live agents: ' + sessions.size + ', version v' + (VERSION || '?'))
}

export { name, inject, apply }
