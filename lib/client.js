window.__ModuleLoader__.load({
  id: "@spartaattack/dsh-whale-copilot",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const name = "dsh-whale-copilot";
    const inject = [];

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;

      // ---- 注入样式（作为本插件的 <style> 元素，随插件卸载自动移除）----
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-plugin", "@spartaattack/dsh-whale-copilot");
      styleEl.textContent = `
.dsw-root{position:fixed;left:0;right:0;bottom:0;height:168px;pointer-events:none;z-index:999;font-family:ui-rounded,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;}
.dsw-tank{position:absolute;inset:0;overflow:hidden;background:linear-gradient(180deg,rgba(96,165,250,.10) 0%,rgba(37,99,235,.16) 46%,rgba(8,16,42,.40) 100%);}
.dsw-wave{position:absolute;left:0;width:200%;height:24px;pointer-events:none;}
.dsw-wave svg{width:100%;height:100%;display:block;}
.dsw-wave-1{top:4px;opacity:.45;animation:dsw-wave 16s linear infinite;}
.dsw-wave-2{top:0;opacity:.22;animation:dsw-wave 11s linear infinite reverse;}
@keyframes dsw-wave{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.dsw-bubble{position:absolute;bottom:-20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.85),rgba(255,255,255,.10) 65%);animation:dsw-rise linear infinite;pointer-events:none;}
@keyframes dsw-rise{from{transform:translateY(0);opacity:0}12%{opacity:.75}to{transform:translateY(-188px);opacity:0}}
.dsw-whale{position:absolute;bottom:22px;left:3%;width:216px;cursor:pointer;pointer-events:auto;animation:dsw-swim-cycle 92s ease-in-out infinite;will-change:left;}
@keyframes dsw-swim-cycle{0%{left:2%}50%{left:calc(100% - 238px)}100%{left:2%}}
.dsw-whale-bounce{transform-origin:50% 80%;}
.dsw-whale-inner{animation:dsw-bob 3.6s ease-in-out infinite;}
@keyframes dsw-bob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-8px) rotate(2deg)}}
.dsw-whale-scale{transform-origin:50% 100%;}
.dsw-whale-svg{animation:dsw-face-cycle 92s linear infinite;will-change:transform;}
@keyframes dsw-face-cycle{0%,49.9%{transform:scaleX(1)}50%,100%{transform:scaleX(-1)}}
.dsw-act-celebrate .dsw-whale-bounce{animation:dsw-jump 2.3s ease-in-out 1;}
.dsw-act-attention .dsw-whale-bounce{animation:dsw-jump 1.4s ease-in-out 1;}
@keyframes dsw-jump{0%{transform:translateY(0) rotate(0)}18%{transform:translateY(-66px) rotate(-13deg)}38%{transform:translateY(-22px) rotate(7deg)}58%{transform:translateY(-74px) rotate(-9deg)}78%{transform:translateY(-14px) rotate(4deg)}100%{transform:translateY(0) rotate(0)}}
.dsw-act-approval .dsw-whale{animation-play-state:paused;}
.dsw-act-approval .dsw-whale-inner{animation:none;}
.dsw-act-approval .dsw-whale-bounce{animation:dsw-shake .9s ease-in-out infinite;}
@keyframes dsw-shake{0%,100%{transform:translateX(0) rotate(0)}12%{transform:translateX(-7px) rotate(-3deg)}24%{transform:translateX(7px) rotate(3deg)}36%{transform:translateX(-6px) rotate(-2.5deg)}48%{transform:translateX(6px) rotate(2.5deg)}60%{transform:translateX(-4px) rotate(-1.5deg)}72%{transform:translateX(4px) rotate(1.5deg)}84%{transform:translateX(-2px) rotate(0)}100%{transform:translateX(0) rotate(0)}}
.dsw-tail{animation:dsw-tail 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:85% 50%;}
@keyframes dsw-tail{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(12deg)}}
.dsw-fin{animation:dsw-fin 2.8s ease-in-out infinite;transform-box:fill-box;transform-origin:30% 20%;}
@keyframes dsw-fin{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(10deg)}}
.dsw-eye-sad,.dsw-mouth-sad{display:none;}
.dsw-act-sad .dsw-eye-happy,.dsw-act-sad .dsw-mouth-happy{display:none;}
.dsw-act-sad .dsw-eye-sad,.dsw-act-sad .dsw-mouth-sad{display:block;}
.dsw-act-sad .dsw-whale-inner{animation-duration:5.4s;}
.dsw-spout{opacity:0;transform-box:fill-box;transform-origin:50% 100%;}
.dsw-act-celebrate .dsw-spout,.dsw-act-attention .dsw-spout{animation:dsw-spout 1.6s ease-out 2;}
.dsw-act-approval .dsw-spout{animation:dsw-spout 1.6s ease-out infinite;}
@keyframes dsw-spout{0%{opacity:0;transform:scaleY(.1)}22%{opacity:1;transform:scaleY(1)}80%{opacity:.9}100%{opacity:0;transform:scaleY(1) translateY(-7px)}}
.dsw-drop{opacity:0;}
.dsw-act-celebrate .dsw-drop,.dsw-act-attention .dsw-drop{animation:dsw-drop 1.6s ease-in 2;}
.dsw-act-approval .dsw-drop{animation:dsw-drop 1.6s ease-in infinite;}
@keyframes dsw-drop{0%{opacity:0;transform:translateY(0)}30%{opacity:1}100%{opacity:0;transform:translateY(15px)}}
.dsw-act-thinking .dsw-spout{animation:dsw-think-spout 4s ease-in-out infinite;}
.dsw-act-thinking .dsw-drop{animation:dsw-think-drop 4s ease-in infinite;}
@keyframes dsw-think-spout{0%{opacity:0;transform:scaleY(.05)}8%{opacity:.85;transform:scaleY(.85)}20%{opacity:.65;transform:scaleY(1) translateY(-3px)}36%{opacity:0;transform:scaleY(1) translateY(-9px)}100%{opacity:0;transform:scaleY(.05)}}
@keyframes dsw-think-drop{0%{opacity:0;transform:translateY(0)}16%{opacity:.85}40%{opacity:0;transform:translateY(15px)}100%{opacity:0}}
.dsw-speech{position:absolute;bottom:90px;left:50%;transform:translateX(-52%);background:rgba(255,255,255,.96);color:#0f172a;font-size:13px;font-weight:600;padding:6px 12px;border-radius:14px;white-space:nowrap;box-shadow:0 4px 14px rgba(2,6,23,.28);pointer-events:none;animation:dsw-pop .22s ease-out;}
.dsw-speech::after{content:'';position:absolute;left:26%;bottom:-7px;border:7px solid transparent;border-top-color:rgba(255,255,255,.96);border-bottom:0;}
@keyframes dsw-pop{from{transform:translateX(-52%) translateY(6px) scale(.8);opacity:0}to{transform:translateX(-52%) translateY(0) scale(1);opacity:1}}
.dsw-badge{position:absolute;top:-10px;right:4px;min-width:22px;height:22px;border-radius:11px;background:linear-gradient(135deg,#f43f5e,#e11d48);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 6px;box-shadow:0 2px 8px rgba(225,29,72,.55);animation:dsw-pulse 1.2s ease-in-out infinite;pointer-events:none;}
@keyframes dsw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
.dsw-panel{position:absolute;right:14px;bottom:178px;width:330px;max-width:calc(100vw - 28px);max-height:54vh;background:rgba(10,16,34,.94);border:1px solid rgba(148,163,184,.25);border-radius:16px;color:#e2e8f0;pointer-events:auto;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(2,6,23,.55);backdrop-filter:blur(8px);}
.dsw-panel-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-size:13px;font-weight:700;border-bottom:1px solid rgba(148,163,184,.16);}
.dsw-panel-head .dsw-online{width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block;margin-right:7px;box-shadow:0 0 6px rgba(52,211,153,.8);}
.dsw-panel-head .dsw-offline{background:#f87171;box-shadow:0 0 6px rgba(248,113,113,.8);}
.dsw-panel-actions{display:flex;gap:6px;}
.dsw-panel-gear,.dsw-panel-close{border:none;background:rgba(148,163,184,.14);color:#cbd5e1;width:24px;height:24px;border-radius:8px;cursor:pointer;font-size:12px;line-height:1;}
.dsw-panel-gear:hover,.dsw-panel-close:hover{background:rgba(148,163,184,.3);}
.dsw-panel-body{overflow-y:auto;padding:8px;}
.dsw-settings{padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.14);display:flex;flex-direction:column;gap:9px;}
.dsw-settings-row{display:flex;align-items:center;gap:8px;font-size:12px;}
.dsw-settings-label{flex:none;width:58px;color:#94a3b8;}
.dsw-settings-row input[type=range]{flex:1;accent-color:#4d6bfe;min-width:0;}
.dsw-settings-val{flex:none;width:72px;text-align:right;color:#cbd5e1;font-variant-numeric:tabular-nums;}
.dsw-settings-reset{border:none;background:rgba(77,107,254,.22);color:#bcd0ff;font-size:11.5px;padding:4px 10px;border-radius:8px;cursor:pointer;align-self:flex-start;}
.dsw-settings-reset:hover{background:rgba(77,107,254,.36);}
.dsw-session-list{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;}
.dsw-session{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;cursor:pointer;}
.dsw-session:hover{background:rgba(148,163,184,.12);}
.dsw-dot{width:9px;height:9px;border-radius:50%;flex:none;}
.dsw-dot-idle{background:#64748b;}
.dsw-dot-thinking{background:#38bdf8;box-shadow:0 0 7px rgba(56,189,248,.9);animation:dsw-pulse 1.6s ease-in-out infinite;}
.dsw-dot-replying{background:#818cf8;}
.dsw-dot-tool{background:#a78bfa;box-shadow:0 0 7px rgba(167,139,250,.9);}
.dsw-dot-approval{background:#fbbf24;box-shadow:0 0 8px rgba(251,191,36,1);animation:dsw-pulse 1s ease-in-out infinite;}
.dsw-session-name{flex:1;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e2e8f0;}
.dsw-phase{font-size:11px;color:#94a3b8;background:rgba(148,163,184,.13);border-radius:8px;padding:2px 7px;flex:none;}
.dsw-empty{font-size:12px;color:#64748b;padding:8px 10px;}
.dsw-feed-title{font-size:11px;color:#94a3b8;font-weight:700;padding:6px 4px;letter-spacing:.04em;}
.dsw-feed{display:flex;flex-direction:column;gap:2px;border-top:1px solid rgba(148,163,184,.14);padding-top:6px;}
.dsw-feed-item{display:flex;align-items:center;gap:7px;padding:3px 4px;font-size:12px;}
.dsw-feed-icon{flex:none;}
.dsw-feed-text{flex:1;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dsw-feed-time{flex:none;font-size:10.5px;color:#64748b;}
`;
      document.head.appendChild(styleEl);
      // 注意：ctx.effect 的返回值才是清理函数（回调本身立即执行），
      // 所以这里返回 () => remove，而不是直接 remove。
      ctx.effect(() => () => {
        try { styleEl.remove(); } catch (e) { /* ignore */ }
      });

      // ---- 迷你 store：每次更新替换为新对象引用，确保 React 重渲染 ----
      let state = { sessions: [], events: [], lastSeq: -1, connected: false, approvalCount: 0 }
      const subs = new Set()
      function getState() { return state }
      function setState(patch) {
        state = Object.assign({}, state, patch)
        for (const fn of subs) { try { fn(state) } catch (e) { /* ignore */ } }
      }
      function subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } }

      // ---- 轮询 Host 的 /whale/pull（HTTP 路由，由本插件 Host 半区提供）----
      let pulling = false
      async function pull() {
        if (pulling) return
        pulling = true
        try {
          const res = await fetch("/whale/pull?since=" + String(state.lastSeq), { cache: "no-store" })
          if (!res.ok) throw new Error("http " + res.status)
          const data = await res.json()
          if (!data || typeof data !== "object") return
          const fresh = Array.isArray(data.events) ? data.events : []
          const merged = fresh.length ? state.events.concat(fresh).slice(-80) : state.events
          const sessions = Array.isArray(data.sessions) ? data.sessions : []
          let approvalCount = 0
          for (const s of sessions) if (s && s.phase === "approval") approvalCount++
          setState({
            sessions,
            events: merged,
            lastSeq: typeof data.seq === "number" ? data.seq : state.lastSeq,
            connected: true,
            approvalCount
          })
        } catch (err) {
          setState({ connected: false })
        } finally { pulling = false }
      }

      const pollTimer = setInterval(() => { pull() }, 900)
      // 注意：ctx.effect 的返回值才是清理函数（回调本身立即执行）
      ctx.effect(() => () => clearInterval(pollTimer))
      pull()

      const sessionsSvc = ctx.get("sessions")

      // ---- 文案/图标 ----
      const ICONS = {
        think: '💭', reply: '💬', tool: '⚒️', approval: '❓', approve: '✅', reject: '🚫',
        done: '🎉', error: '💥', task: '📥', sub: '🐋', 'sub-end': '🐳', workflow: '🔄',
        'workflow-done': '🎊', 'workflow-error': '💥', goal: '🎯', 'goal-done': '🏆',
        'goal-blocked': '⛔', info: 'ℹ️'
      }
      const TEXTS = {
        think: '让我想想…', reply: '正在回复…', tool: (e) => (e.tool ? '正在使用 ' + e.tool : '正在执行动作'),
        approval: '需要审批！', approve: '批准啦！', reject: '被拒绝了…', done: '任务完成！',
        error: '呜哇，出错了…', task: '新任务来啦！', sub: '小助手开工！', 'sub-end': '小助手完成！',
        workflow: '工作流开始！', 'workflow-done': '工作流完成！', 'workflow-error': '工作流出错了…',
        goal: '新目标达成！', 'goal-done': '目标完成！', info: '…'
      }

      function shortId(id) {
        if (typeof id !== 'string') return '?'
        return id.length > 10 ? id.slice(0, 10) + '…' : id
      }
      function fmtTime(t) {
        try { return new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) } catch (e) { return '' }
      }
      function phaseLabel(s) {
        switch (s.phase) {
          case 'approval': return '待审批'
          case 'tool': return '执行 ' + (s.tool || '工具')
          case 'replying': return '回复中'
          case 'thinking': return '思考中'
          default: return s.status === 'running' ? '运行中' : '空闲'
        }
      }
      function deriveBaseMood(sessions) {
        let mood = 'idle'
        for (const s of sessions) {
          if (s.phase === 'approval') return 'approval'
          if (s.phase === 'tool') mood = 'tool'
          else if (s.phase === 'replying' && mood !== 'tool' && mood !== 'thinking') mood = 'replying'
          else if (s.phase === 'thinking' && mood === 'idle') mood = 'thinking'
        }
        return mood
      }
      function pickAction(events, sinceSeq) {
        const fresh = []
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]
          if (e.seq > sinceSeq) fresh.push(e)
          else break
        }
        fresh.reverse()
        if (!fresh.length) return null
        const recent = fresh.slice(-3)
        let hit = null
        for (const e of recent) {
          if (e.mood === 'celebrate' || e.mood === 'sad') { hit = e; break }
        }
        if (!hit) {
          for (const e of recent) {
            if (e.mood === 'approval') { hit = e; break }
          }
        }
        if (!hit) {
          for (const e of recent) {
            if (e.mood === 'attention') { hit = e; break }
          }
        }
        if (hit) {
          const t = TEXTS[hit.type]
          const text = typeof t === 'function' ? t(hit) : (t || hit.text || '…')
          const type = hit.mood === 'attention' ? 'attention' : hit.mood
          return { key: hit.seq, type, text, kind: hit.type }
        }
        const last = fresh[fresh.length - 1]
        const t = TEXTS[last.type]
        const text = typeof t === 'function' ? t(last) : (t || last.text || '…')
        return { key: last.seq, type: 'talk', text, kind: last.type }
      }

      const WHALE_SVG = `<svg viewBox="0 0 240 150" width="216" height="135" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="dswBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#93a7ff"/>
      <stop offset="52%" stop-color="#4d6bfe"/>
      <stop offset="100%" stop-color="#2b3fd1"/>
    </linearGradient>
    <radialGradient id="dswBelly" cx="0.5" cy="0.4" r="0.7">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d9e2ff"/>
    </radialGradient>
  </defs>
  <g class="dsw-tail"><path d="M54 62 C 36 50, 15 46, 6 54 C 18 61, 21 71, 6 78 C 15 86, 36 82, 54 70 Z" fill="#2841d0"/></g>
  <ellipse cx="130" cy="72" rx="80" ry="47" fill="url(#dswBody)"/>
  <ellipse cx="142" cy="89" rx="46" ry="25" fill="url(#dswBelly)" opacity="0.85"/>
  <g class="dsw-fin"><path d="M122 90 C 128 106, 142 114, 154 108 C 148 100, 140 92, 133 88 Z" fill="#3552e8"/></g>
  <ellipse cx="163" cy="28" rx="7" ry="3" fill="#1c2a9e"/>
  <g class="dsw-eye-happy">
    <ellipse cx="176" cy="52" rx="11" ry="13" fill="#ffffff"/>
    <ellipse cx="179" cy="53" rx="5.5" ry="7" fill="#141f78"/>
    <circle cx="181.5" cy="49.5" r="2" fill="#ffffff"/>
  </g>
  <g class="dsw-eye-sad">
    <ellipse cx="176" cy="56" rx="11" ry="9" fill="#ffffff"/>
    <path d="M165 57 L187 57 Q187 64 176 64 Q165 64 165 57 Z" fill="#141f78"/>
    <circle cx="181" cy="54" r="2" fill="#ffffff"/>
  </g>
  <ellipse cx="162" cy="70" rx="8" ry="4.5" fill="#fda4af" opacity="0.4"/>
  <path class="dsw-mouth-happy" d="M172 78 Q 180 87, 192 80" stroke="#dbe4ff" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path class="dsw-mouth-sad" d="M174 84 Q 180 76, 190 82" stroke="#dbe4ff" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g class="dsw-spout">
    <path d="M163 24 C 165 13, 163 5, 161 1 C 166 6, 167 15, 166 24 Z" fill="#bfdbfe" opacity="0.9"/>
    <path d="M156 24 C 151 12, 147 5, 142 0 C 148 7, 153 15, 159 24 Z" fill="#93c5fd" opacity="0.85"/>
    <path d="M170 24 C 175 12, 180 5, 185 0 C 179 7, 174 15, 167 24 Z" fill="#93c5fd" opacity="0.85"/>
    <ellipse class="dsw-drop" cx="141" cy="2" rx="3.2" ry="4.4" fill="#7dd3fc"/>
    <ellipse class="dsw-drop" cx="161" cy="0" rx="3" ry="4" fill="#bae6fd"/>
    <ellipse class="dsw-drop" cx="184" cy="2" rx="3.2" ry="4.4" fill="#7dd3fc"/>
    <ellipse class="dsw-drop" cx="171" cy="-1" rx="2.6" ry="3.6" fill="#e0f2fe"/>
  </g>
</svg>`

      const WAVE_SVG = (opacity) => `<svg viewBox="0 0 1200 24" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 14 Q 50 4 100 14 T 200 14 T 300 14 T 400 14 T 500 14 T 600 14 T 700 14 T 800 14 T 900 14 T 1000 14 T 1100 14 T 1200 14 L 1200 24 L 0 24 Z" fill="#ffffff" opacity="${opacity}"/></svg>`

      const BUBBLES = [
        { left: '6%', size: 7, dur: 5.2, delay: 0 },
        { left: '16%', size: 5, dur: 4.2, delay: 1.4 },
        { left: '27%', size: 9, dur: 6.1, delay: .8 },
        { left: '38%', size: 5, dur: 3.9, delay: 2.3 },
        { left: '51%', size: 8, dur: 5.6, delay: .4 },
        { left: '62%', size: 5, dur: 4.5, delay: 1.9 },
        { left: '74%', size: 7, dur: 5.8, delay: 2.9 },
        { left: '85%', size: 6, dur: 4.8, delay: 1.1 },
        { left: '93%', size: 5, dur: 5.0, delay: 3.3 }
      ]

      // ---- 设置持久化：写入 localStorage，刷新/下次启动自动恢复 ----
      const SETTINGS_KEY = 'dsh-whale-copilot:settings'
      const LEGACY_SETTINGS_KEY = 'dsh-whale:settings'
      const DEFAULT_SETTINGS = { scale: 0.85, sink: 8, bubble: 90 }
      function clampNum(v, min, max, fallback) {
        return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
      }
      function defaultSettings() { return Object.assign({}, DEFAULT_SETTINGS) }
      function loadSettings() {
        try {
          // 优先读新键；旧包名键作为一次性迁移来源
          const raw = window.localStorage.getItem(SETTINGS_KEY) || window.localStorage.getItem(LEGACY_SETTINGS_KEY)
          if (raw) {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') {
              return {
                scale: clampNum(parsed.scale, 0.5, 1.3, DEFAULT_SETTINGS.scale),
                sink: clampNum(parsed.sink, -20, 22, DEFAULT_SETTINGS.sink),
                bubble: clampNum(parsed.bubble, 40, 180, DEFAULT_SETTINGS.bubble)
              }
            }
          }
        } catch (e) { /* ignore */ }
        return defaultSettings()
      }

      function WhaleApp() {
        const [data, setData] = React.useState(getState)
        React.useEffect(() => subscribe(setData), [])
        const [panel, setPanel] = React.useState(false)
        const [showSettings, setShowSettings] = React.useState(false)
        const [settings, setSettings] = React.useState(loadSettings)
        React.useEffect(() => {
          try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch (e) { /* ignore */ }
        }, [settings])
        const [action, setAction] = React.useState(null)
        const lastSeqRef = React.useRef(0)
        const bootedRef = React.useRef(false)
        const actionTimerRef = React.useRef(null)
        const lastCelebrateRef = React.useRef(0)

        function clearActionTimer() {
          if (actionTimerRef.current !== null) {
            try { clearTimeout(actionTimerRef.current) } catch (e) { /* ignore */ }
            actionTimerRef.current = null
          }
        }
        React.useEffect(() => () => { clearActionTimer() }, [])

        React.useEffect(() => {
          if (data.lastSeq < lastSeqRef.current) {
            lastSeqRef.current = 0
            bootedRef.current = false
          }
          if (!bootedRef.current) {
            lastSeqRef.current = data.lastSeq
            bootedRef.current = true
            setAction({ key: 'hello', type: 'talk', text: '我来啦！🐳', kind: 'hello' })
            clearActionTimer()
            actionTimerRef.current = setTimeout(() => { actionTimerRef.current = null; setAction(null) }, 2600)
            return
          }
          const next = pickAction(data.events, lastSeqRef.current)
          lastSeqRef.current = data.lastSeq
          if (!next) return
          let chosen = next
          if (next.type === 'celebrate' && Date.now() - lastCelebrateRef.current < 6000) {
            chosen = { key: next.key + ':t', type: 'talk', text: next.text, kind: next.kind }
          } else if (next.type === 'celebrate') {
            lastCelebrateRef.current = Date.now()
          }
          setAction(chosen)
          clearActionTimer()
          const dur = chosen.type === 'celebrate' ? 3600 : chosen.type === 'sad' ? 3200 : chosen.type === 'attention' ? 3000 : 3400
          actionTimerRef.current = setTimeout(() => { actionTimerRef.current = null; setAction(null) }, dur)
        }, [data])

        const mood = deriveBaseMood(data.sessions)
        const actClass = action && action.type !== 'talk'
          ? ' dsw-act-' + action.type
          : (mood === 'thinking' ? ' dsw-act-thinking' : (mood === 'approval' ? ' dsw-act-approval' : ''))
        const speechText = action ? action.text : (mood === 'approval' ? '需要审批！' : null)
        const speechKey = action ? ('a' + action.key) : 'mood'

        function togglePanel() { setPanel(!panel) }
        function toggleSettings() { setShowSettings(!showSettings) }
        function openSession(id) { if (sessionsSvc && id) { try { sessionsSvc.open(id) } catch (e) { /* ignore */ } } }

        const sessionRows = data.sessions.map((s) =>
          React.createElement('div', { key: s.id, className: 'dsw-session', onClick: () => openSession(s.id) },
            React.createElement('span', { className: 'dsw-dot dsw-dot-' + (s.phase || 'idle') }),
            React.createElement('span', { className: 'dsw-session-name' }, s.title || shortId(s.id)),
            React.createElement('span', { className: 'dsw-phase' }, phaseLabel(s))
          )
        )
        const feedRows = data.events.slice(-8).reverse().map((e) =>
          React.createElement('div', { key: e.seq, className: 'dsw-feed-item' },
            React.createElement('span', { className: 'dsw-feed-icon' }, ICONS[e.type] || '🐳'),
            React.createElement('span', { className: 'dsw-feed-text' }, String(e.text || '')),
            React.createElement('span', { className: 'dsw-feed-time' }, fmtTime(e.time))
          )
        )

        return React.createElement('div', { className: 'dsw-root' + actClass },
          React.createElement('div', { className: 'dsw-tank' },
            React.createElement('div', { className: 'dsw-wave dsw-wave-1', dangerouslySetInnerHTML: { __html: WAVE_SVG(0.5) } }),
            React.createElement('div', { className: 'dsw-wave dsw-wave-2', dangerouslySetInnerHTML: { __html: WAVE_SVG(0.28) } }),
            BUBBLES.map((b, i) =>
              React.createElement('span', { key: i, className: 'dsw-bubble', style: { left: b.left, width: b.size + 'px', height: b.size + 'px', animationDuration: b.dur + 's', animationDelay: b.delay + 's' } })
            ),
            React.createElement('div', { className: 'dsw-whale', style: { bottom: (22 - settings.sink) + 'px' }, onClick: togglePanel, title: 'DSWhale · 点击查看会话状态' },
              data.approvalCount > 0 ? React.createElement('div', { className: 'dsw-badge' }, String(data.approvalCount)) : null,
              React.createElement('div', { className: 'dsw-whale-bounce' },
                React.createElement('div', { className: 'dsw-whale-inner' },
                  speechText ? React.createElement('div', { key: speechKey, className: 'dsw-speech', style: { bottom: settings.bubble + 'px' } }, speechText) : null,
                  React.createElement('div', { className: 'dsw-whale-scale', style: { transform: 'scale(' + settings.scale + ')' } },
                    React.createElement('div', { className: 'dsw-whale-svg', dangerouslySetInnerHTML: { __html: WHALE_SVG } })
                  )
                )
              )
            )
          ),
          panel ? React.createElement('div', { className: 'dsw-panel' },
            React.createElement('div', { className: 'dsw-panel-head' },
              React.createElement('span', null,
                React.createElement('span', { className: 'dsw-online' + (data.connected ? '' : ' dsw-offline') }),
                '🐳 DSWhale · 会话状态'
              ),
              React.createElement('div', { className: 'dsw-panel-actions' },
                React.createElement('button', { className: 'dsw-panel-gear' + (showSettings ? ' dsw-gear-on' : ''), onClick: toggleSettings, title: '鲸鱼设置' }, '⚙'),
                React.createElement('button', { className: 'dsw-panel-close', onClick: () => setPanel(false) }, '✕')
              )
            ),
            React.createElement('div', { className: 'dsw-panel-body' },
              showSettings ? React.createElement('div', { className: 'dsw-settings' },
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '大小'),
                  React.createElement('input', { type: 'range', min: '0.5', max: '1.3', step: '0.05', value: String(settings.scale), onChange: (e) => setSettings(Object.assign({}, settings, { scale: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, Math.round(settings.scale * 100) + '%')
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '上下位置'),
                  React.createElement('input', { type: 'range', min: '-20', max: '22', step: '1', value: String(settings.sink), onChange: (e) => setSettings(Object.assign({}, settings, { sink: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, (settings.sink >= 0 ? '下沉 ' : '上浮 ') + Math.abs(settings.sink) + 'px')
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '气泡距离'),
                  React.createElement('input', { type: 'range', min: '40', max: '180', step: '2', value: String(settings.bubble), onChange: (e) => setSettings(Object.assign({}, settings, { bubble: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, settings.bubble + 'px')
                ),
                React.createElement('button', { className: 'dsw-settings-reset', onClick: () => setSettings(defaultSettings()) }, '恢复默认')
              ) : null,
              data.sessions.length === 0
                ? React.createElement('div', { className: 'dsw-empty' }, '暂无活动会话，让鲸鱼游一会儿吧～')
                : React.createElement('div', { className: 'dsw-session-list' }, sessionRows),
              React.createElement('div', { className: 'dsw-feed' },
                React.createElement('div', { className: 'dsw-feed-title' }, '最近动态'),
                feedRows
              )
            )
          ) : null
        )
      }

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'whale-aquarium', order: 10000 },
        () => React.createElement(WhaleApp, null)
      ))
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
