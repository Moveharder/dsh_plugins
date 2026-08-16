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
 *     name: '@spartaattack/dsh-whale-copilot'
 *
 * The package also declares `dsh.client: { platform: 'web' }`, so
 * @deepseek-ai/dsh-client-modules automatically serves `exports["./client"]`
 * (lib/client.js) as the browser half at /plugins/<name>/client.js and adds it
 * to the window.__DSH_BOOT__ graph.
 */

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
      case 'tool/call':
        setPhase(id, 'tool', data.name)
        push('tool', id, '执行动作 ' + data.name, 'tool', { tool: data.name })
        break
      case 'tool/result':
        if (data.error) {
          setPhase(id, 'thinking', '')
          push('error', id, '工具出错', 'sad', { tool: '' })
        } else {
          setPhase(id, 'thinking', '')
        }
        break
      case 'turn/end': {
        const kind = data.reason && data.reason.kind
        setPhase(id, 'idle', '')
        if (kind === 'completed') push('done', id, '任务完成', 'celebrate')
        else if (kind === 'error') push('error', id, '回合出错', 'sad')
        else push('info', id, '回合结束 (' + (kind || '?') + ')', 'idle')
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
        if (req.method !== 'GET' && req.method !== 'HEAD') {
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
        if (pathname === '/whale/pull') {
          const since = Number(url.searchParams.get('since'))
          const fresh = (!Number.isFinite(since) || since < 0)
            ? log
            : log.filter((e) => e.seq > since)
          sendJson(res, 200, {
            seq,
            sessions: Array.from(sessions.values()),
            events: fresh
          })
        } else if (pathname === '/whale/hello') {
          sendJson(res, 200, { name: 'DSWhale', seq })
        } else {
          sendJson(res, 404, { error: 'not found' })
        }
      }
    })
  }

  console.log('[dsh-whale-copilot] host half active, live agents: ' + sessions.size)
}

export { name, inject, apply }
