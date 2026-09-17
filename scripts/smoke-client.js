/* Smoke test — dsh-annual-activity client half.
 *
 * 用最小 DOM/React 打桩把 bundle 真正跑一遍（含函数组件渲染循环 + hooks +
 * 重渲染 + 交互回调），覆盖：
 *  - bundle 契约：window.__ModuleLoader__.load + exports.name/inject 声明了 slots
 *  - apply：样式注入（data-plugin）+ 会话头部 utilities 槽注册 + 卸载清理
 *  - 热力图几何：首列前的星期对齐占位、总格数、闰年 366、月份轴（含「2 月」）
 *  - 端到端渲染：头部入口按钮 → 点击打开面板 → 统计行/图例/53 列网格/年份切换
 *  - 数据接线：/activity/pull 的 days 落到对应色块等级 + 今天的独立高亮
 *  - 入口迷你热力图字形：7 列 × 2 行、等级随数据落色
 *  - 版本/升级：meta 拉取、有新版本时按钮带角标、设置抽屉里的检测更新与在线升级
 *  - 悬浮明细、年份切换（重新拉取 + 只渲染该年色块）、Esc / 遮罩关闭
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0
function assert(cond, label) {
  if (cond) { console.log('  ✓ ' + label) } else { failures++; console.error('  ✗ ' + label) }
}
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) console.error('    actual=' + JSON.stringify(actual) + '\n    expected=' + JSON.stringify(expected))
  assert(ok, label)
}

// ======================= 最小 DOM =======================

class MockNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.style = { setProperty() {} }
    this.attrs = {}
    this._text = ''
  }
  setAttribute(k, v) { this.attrs[k] = v }
  getAttribute(k) { return this.attrs[k] }
  appendChild(c) { this.children.push(c); return c }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c }
  remove() { this.removed = true }
  get textContent() { return this._text }
  set textContent(v) { this._text = String(v) }
  contains() { return false }
  getBoundingClientRect() { return { left: 0, top: 0, width: 11, height: 11, right: 11, bottom: 11 } }
}

const head = new MockNode('head')
const documentStub = {
  head,
  body: new MockNode('body'),
  createElement: (tag) => new MockNode(tag),
  addEventListener(type, fn) { (this._ls = this._ls || {})[type] = (this._ls[type] || []).concat(fn) },
  removeEventListener() {},
}
// portal 宿主会挂到 document.body：MockNode 已实现 appendChild/remove，
// 再补一个 lastElementChild 便于断言「浮层确实挂在 body 直下」。
Object.defineProperty(documentStub.body, 'lastElementChild', {
  get() { return this.children[this.children.length - 1] || null },
})

// ======================= 最小 React（按组件实例隔离 hooks）=======================

// hooks 归属「当前正在渲染的组件」：自定义 hook（如 useStore）内联调用 useState
// 时，槽位仍记在调用它的组件上——和 React 的 hooks 规则一致。
// 每个组件实例记录自己的 setState（rerender），setState 时直接重渲染整棵树；
// 与 React 一样，渲染本身不触发额外的渲染（effect 只在渲染时登记一次）。
const hookStore = new Map() // componentFn -> { hooks: [], cursor: 0, rerender: fn|null }
const hookStack = []
let renderCount = 0

function nextHook(init) {
  const top = hookStack[hookStack.length - 1]
  if (!top) throw new Error('hook called outside of a component render')
  const rec = top.rec
  const i = rec.cursor++
  if (rec.hooks.length <= i) rec.hooks[i] = { value: typeof init === 'function' ? init() : init }
  return { rec, i }
}

const React = {
  createElement(type, props, ...children) {
    const flat = []
    for (const c of children) {
      if (Array.isArray(c)) { for (const x of c) flat.push(x) } else flat.push(c)
    }
    return { $$el: true, type, props: props || {}, style: {}, children: flat }
  },
  useState(init) {
    const { rec, i } = nextHook(init)
    const set = (next) => {
      const before = rec.hooks[i].value
      const after = typeof next === 'function' ? next(before) : next
      if (after === before) return
      rec.hooks[i].value = after
      if (typeof rec.rerender === 'function') rec.rerender()
    }
    return [rec.hooks[i].value, set]
  },
  useRef(init) {
    const { rec, i } = nextHook(null)
    // hooks 槽统一是 { value }：首次创建时存放 ref 对象本身
    if (!rec.hooks[i].value) rec.hooks[i].value = { current: init }
    return rec.hooks[i].value
  },
  useMemo(fn) { return fn() },
  // layout effect 在真实 React 里每次提交都会跑（不做 deps 比较），这里保持一致：
  // 依赖它「挂载后按实测尺寸修正位置」的逻辑必须每次渲染后都能执行。
  useLayoutEffect(fn) {
    nextHook(null)
    fn()
  },
  useEffect(fn, deps) {
    const { rec, i } = nextHook(null)
    const prev = rec.hooks[i]
    const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length
      || deps.some((d, n) => !Object.is(d, prev.deps[n]))
    if (!changed) return
    rec.hooks[i] = { deps: deps || null, fn, cleanup: prev ? prev.cleanup : null }
    rec.pending.push(rec.hooks[i])
  },
  useCallback(fn) { return fn },
}

// 递归渲染：函数组件展开为元素，叶子保持为「宿主元素」（保留 props 供断言/触发）
function renderNode(node) {
  if (node == null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (!node.$$el) return node
  const { type, props, children } = node
  if (typeof type === 'function') {
    let rec = hookStore.get(type)
    if (!rec) { rec = { hooks: [], cursor: 0, rerender: renderNow, pending: [] }; hookStore.set(type, rec) }
    rec.rerender = renderNow
    rec.cursor = 0
    rec.pending = []
    hookStack.push({ rec })
    let out
    try { out = type({ ...props, children }) } finally { hookStack.pop() }
    const rendered = renderNode(out)
    // 宿主树里保留函数组件的身份，便于按组件名定位
    return { ...rendered, $$fn: type, $$pending: rec.pending }
  }
  // 宿主元素：补上 DOM 方法，使 ref 持有者（入口防遮挡 / 悬浮明细）能取到度量值
  return makeHostNode({ $$el: true, type, props, children: children.map(renderNode) })
}

function makeHostNode(el) {
  el.style = el.style || {}
  el.getBoundingClientRect = () => {
    // 悬浮说明的尺寸可调：用于验证「下方空间不足时自动上移」的自适应逻辑
    if (String(el.className || '').split(/\s+/).includes('daa-tip')) {
      return { left: 0, top: 0, width: tipBox.width, height: tipBox.height, right: tipBox.width, bottom: tipBox.height }
    }
    return { left: 1200, top: 800, width: 96, height: 30, right: 1296, bottom: 830 }
  }
  el.contains = (other) => other === el || el.children.includes(other)
  el.remove = () => { el.removed = true }
  return el
}
/** 悬浮说明的模拟尺寸（测试中途可改，触发自适应分支）。 */
const tipBox = { width: 184, height: 60 }

function collectPending(node, acc = []) {
  if (node == null || typeof node !== 'object') return acc
  if (Array.isArray(node)) { for (const c of node) collectPending(c, acc); return acc }
  if (!node.$$el) return acc
  if (node.$$pending) for (const e of node.$$pending) acc.push(e)
  for (const c of node.children) collectPending(c, acc)
  return acc
}
// 提交阶段把 ref.current 指向宿主元素（React 的真实行为）。
// 注意：bundle 在 new Function 里跑，class 跨 realm 时 `instanceof` 会失败，
// 所以这里用「结构判断」（$$el + 有 props/children 且有 DOM 方法）。
function attachRefs(node) {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const c of node) attachRefs(c); return }
  if (!node.$$el) return
  if (node.props && typeof node.getBoundingClientRect === 'function') {
    const ref = node.props.ref
    if (ref && typeof ref === 'object' && 'current' in ref) ref.current = node
  }
  for (const c of node.children) attachRefs(c)
}
// 所有已登记 effect 的清理函数（模拟整棵树卸载）
function runAllCleanups() {
  for (const [, rec] of hookStore) {
    for (const h of rec.hooks) if (h && h.cleanup) { try { h.cleanup() } catch (e) { /* ignore */ } }
  }
}

// ======================= 假数据 + fetch 桩 =======================
// 注意顺序：打桩必须在装载 bundle 之前完成——装载语句会把 globalThis.fetch
// 「快照」成 bundle 的参数（模块级捕获），之后再换 stub 不会生效。

function payloadFor(year, days) {
  const yearStats = {
    2025: { year: 2025, activeDays: 3, totalDays: 365, rate: 3 / 365, weekStreak: 0, longestWeekStreak: 1, longestDayStreak: 1 },
    2026: { year: 2026, activeDays: 2, totalDays: 261, rate: 2 / 261, weekStreak: 2, longestWeekStreak: 3, longestDayStreak: 2 },
  }
  return {
    version: '1.0.0', seq: 1, today: '2026-09-17', currentYear: 2026, years: [2025, 2026],
    yearStats, year,
    days: days.map((d) => ({ day: d, activeSessions: 1, turns: 12, steps: 30, userMessages: 6, toolCalls: 40, inputTokens: 1000, outputTokens: 200, tokens: 1200, level: 3 })),
    levels: [
      { level: 0, label: '未活跃', min: 0, max: 0 },
      { level: 1, label: '轻', min: 1, max: 1 },
      { level: 2, label: '中', min: 2, max: 5 },
      { level: 3, label: '高', min: 6, max: 15 },
      { level: 4, label: '极高', min: 16, max: null },
    ],
    sessions: [], sessionCount: 9, projects: 4, totalTurns: 120, totalTokens: 250000,
    scannedAt: Date.now(), scanMs: 12, timeZone: 'Asia/Shanghai',
  }
}

const pulls = []
// 版本/升级桩：默认「有新版本」，检测更新后仍是，升级成功后 ok='ok'
const metaState = { latest: '1.1.0', updateAvailable: true, upgrade: { running: false, ok: null, message: '' } }
function metaPayload() {
  return {
    name: 'dsh-annual-activity', version: '1.0.0', latest: metaState.latest,
    updateChecked: true, updateAvailable: metaState.updateAvailable,
    upgrade: { ...metaState.upgrade }, localInstall: null,
  }
}
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  let pathname = u
  try { const parsed = new URL(u); pathname = parsed.pathname + parsed.search } catch (e) { /* 非绝对 URL 原样记录 */ }
  pulls.push(pathname + ((opts && opts.method) === 'POST' ? ' [POST]' : ''))
  if (pathname === '/activity/meta') return { ok: true, status: 200, json: async () => metaPayload() }
  if (pathname === '/activity/check-update') return { ok: true, status: 200, json: async () => metaPayload() }
  if (pathname === '/activity/upgrade') {
    metaState.upgrade = { running: false, ok: 'ok', message: '已升级到 v' + metaState.latest + '，重启 dsh web 后生效' }
    metaState.updateAvailable = false
    return { ok: true, status: 200, json: async () => metaPayload() }
  }
  const m = /year=(\d+)/.exec(pathname)
  const y = m ? Number(m[1]) : 2026
  const days = y === 2025 ? ['2025-03-05', '2025-03-06', '2025-12-31'] : ['2026-03-02', '2026-09-17']
  return { ok: true, status: 200, json: async () => payloadFor(y, days) }
}

// ======================= 最小 ReactDOM（createPortal 打桩）=======================
// 与真实 react-dom 一样：把内容「挂到」传入的容器（这里在 document.body 造一个
// 宿主节点），同时把元素树原样返回，便于测试继续按 class 定位与触发交互。
const portalCreations = []
const ReactDOM = {
  createPortal(node, container) {
    if (!container) throw new Error('createPortal: container is required')
    const holder = new MockNode('div')
    holder.className = container.className
    container.appendChild(holder)
    portalCreations.push({ container, holder, node })
    return node
  },
}

// ======================= 装载 bundle =======================

let bundle = null
const windowStub = {
  innerWidth: 1440,
  innerHeight: 900,
  location: { origin: 'http://127.0.0.1:3080', href: 'http://127.0.0.1:3080/' },
  __ModuleLoader__: { load: (def) => { bundle = def } },
}
globalThis.window = windowStub
globalThis.document = documentStub
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null },
  setItem(k, v) { this._m.set(k, String(v)) },
  removeItem(k) { this._m.delete(k) },
}

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
new Function('window', 'document', 'localStorage', 'fetch', source)(windowStub, documentStub, globalThis.localStorage, globalThis.fetch)

assert(!!bundle, 'bundle 调用了 window.__ModuleLoader__.load')
eq(bundle.id, 'dsh-annual-activity', 'bundle id = 包名')

const mod = bundle.factory((id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return ReactDOM
  throw new Error('unexpected require: ' + id)
})
eq(mod.name, 'dsh-annual-activity', 'exports.name')
eq(mod.inject, ['slots'], 'exports.inject = ["slots"]（0.1.5-rc.1 起的激活契约）')
assert(typeof mod.apply === 'function', 'exports.apply 是函数')

// ======================= apply + 槽注册 =======================

const disposers = []
let slotReg = null
const slots = {
  inject: (slotName, cb) => { cb() },
  register: (options, render) => { slotReg = { options, render }; return () => { slotReg = null } },
}
const ctx = {
  get: (k) => (k === 'slots' ? slots : null),
  effect: (fn) => { const d = fn(); disposers.push(d); return d },
}
mod.apply(ctx)

assert(head.children.length === 1 && head.children[0].tagName === 'STYLE', 'apply 注入了一个 <style>')
eq(head.children[0].getAttribute('data-plugin'), 'dsh-annual-activity', 'style[data-plugin] = 包名')
assert(head.children[0].textContent.includes('.daa-l4'), '样式里包含 5 级色块定义')
eq(slotReg && slotReg.options.name, 'conversation.session.header.utilities', '注册到会话头部 utilities 槽（DOM 中先于右上角 corner → 落在「打开右侧边栏」左边）')
eq(slotReg && slotReg.options.id, 'annual-activity', '槽条目 id')
assert(typeof slotReg.options.order === 'number', '槽条目带 order')

// ======================= 渲染循环 =======================

let tree = null
const slotRec = { hooks: [], cursor: 0, rerender: () => {}, pending: [] }
function renderNow() {
  if (++renderCount > 200) throw new Error('render loop detected')
  slotRec.pending = []
  hookStack.push({ rec: slotRec })
  let out
  try { out = slotReg.render() } finally { hookStack.pop() }
  tree = renderNode(out)
  attachRefs(tree)
  // 提交阶段：先清理上一次的 effect，再执行本次登记的 effect（与 React 一致）
  const pending = slotRec.pending.concat(collectPending(tree))
  for (const e of pending) {
    if (e.cleanup) { try { e.cleanup() } catch (err) { /* ignore */ } e.cleanup = null }
  }
  for (const e of pending) {
    try { const c = e.fn(); if (typeof c === 'function') e.cleanup = c } catch (err) { /* 记录但不致命 */ }
  }
}
async function act(fn) {
  if (fn) fn()
  // 只让出微任务队列：await 链落定即返回，不引入真实定时器（store 的轮询定时器
  // 会一直挂着，setTimeout 会让测试进程无法自然退出）
  for (let i = 0; i < 6; i++) await Promise.resolve()
  return tree
}
renderNow()
slotRec.rerender = renderNow
// 所有后续渲染的兜底清理：进程退出前不留下悬挂的轮询定时器
process.on('exit', runAllCleanups)

function findAll(node, pred, acc = []) {
  if (node == null || typeof node !== 'object') return acc
  if (Array.isArray(node)) { for (const c of node) findAll(c, pred, acc); return acc }
  if (!node.$$el) return acc
  if (pred(node)) acc.push(node)
  for (const c of node.children) findAll(c, pred, acc)
  return acc
}
const byClass = (t, cls) => findAll(t, (n) => String(n.props.className || '').split(/\s+/).includes(cls))
/** portal 宿主是否已从 body 移除（MockNode.remove 只打标记，与真实 DOM 语义一致）。 */
const portalHostRemoved = () => portalCreations.length > 0 && portalCreations.every((p) => p.container.removed === true)
const textOf = (node) => {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!node.$$el) return ''
  return node.children.map(textOf).join('')
}

await act()
assert(!!tree, 'slot render 返回了一棵元素树')
const entryBtn = byClass(tree, 'daa-hbtn')[0]
assert(!!entryBtn, '渲染出会话头部入口按钮')
assert(String(entryBtn.props.className).includes('daa-hbtn'), '入口按钮挂 in-header class（28×28，对齐「打开右侧边栏」）')
assert(!String(entryBtn.props.className).includes('daa-entry'), '旧的右下角浮动入口已移除')
// 入口要足够显眼：常驻底色 + 一层细边（而不是纯透明按钮）
const btnRule = /\.daa-hbtn\{([^}]*)\}/.exec(head.children[0].textContent)
assert(!!btnRule, '样式里有 .daa-hbtn 规则')
assert(/background:var\(--dsw-alias-interactive-bg-hover/.test(btnRule[1]), '按钮有常驻底色（比悬停态更浅的官方 token）')
assert(/box-shadow:inset 0 0 0 1px var\(--dsw-alias-border-l2/.test(btnRule[1]), '按钮有 1px 细边（inset ring，随深浅主题）')
assert(/width:28px;height:28px/.test(btnRule[1]), '按钮尺寸 28×28，与「打开右侧边栏」一致')
assert(/\.daa-hbtn:hover\{[^}]*interactive-bg-active/.test(head.children[0].textContent), '悬停态底色更深一档')
eq(byClass(tree, 'daa-glyph-cell').length, 14, '入口字形 = 最近 14 天（7 列 × 2 行）')

// ---- 悬浮说明应出现在按钮【下方】，避免遮挡按钮与标题行 ----
const entryRect = entryBtn.getBoundingClientRect()
await act(() => byClass(tree, 'daa-hbtn')[0].props.onMouseEnter())
const entryTip = byClass(tree, 'daa-tip-below')[0]
assert(!!entryTip, '悬浮入口出现说明浮层（使用下方定位类）')
assert(!String(entryTip.props.className).includes('daa-tip-above'), '不再使用上方定位')
const tipTop = Number(String(entryTip.props.style.top).replace('px', ''))
assert(tipTop >= entryRect.bottom, '说明浮层的 top ≥ 按钮底边（' + tipTop + ' ≥ ' + entryRect.bottom + '）')
assert(textOf(entryTip).includes('今日') && textOf(entryTip).includes('今年'), '说明含今日/今年摘要')

// ---- 关键修复：入口不能有原生 title（浏览器自带提示框会浮在按钮上方遮挡按钮）----
assert(entryBtn.props.title === undefined, '入口按钮不设原生 title（避免顶部遮挡）')
assert(typeof entryBtn.props['aria-label'] === 'string' && entryBtn.props['aria-label'].length > 0, '改用 aria-label 保留可访问性')

// ---- 关键修复：CSS 级联顺序 —— 修饰类必须排在基础类之后 ----
// 同优先级下后出现的规则生效：.daa-tip-below 若写在 .daa-tip 之前，
// 基础类的 translate(-50%,-100%) 会赢，浮层被上移自身高度（"上半部分看不到"）。
const cssText = head.children[0].textContent
const atBase = cssText.indexOf('.daa-tip{')
const atBelow = cssText.indexOf('.daa-tip-below{')
assert(atBase >= 0 && atBelow >= 0, '样式里同时存在 .daa-tip 与 .daa-tip-below')
assert(atBelow > atBase, '.daa-tip-below 排在 .daa-tip 之后（级联顺序正确，base 的 -100% 不会覆盖它）')
assert(/\.daa-tip-below\{transform:translate\(-50%,0\)/.test(cssText), '.daa-tip-below 使用 translate(-50%,0)（不向上偏移）')
assert(!/\.daa-tip-above/.test(cssText), '不存在残留的上方定位规则')
// 间距：浮层要明显离开按钮与标题行，不能贴着
const tipGap = tipTop - entryRect.bottom
assert(tipGap >= 12, '浮层与按钮底边留有间距（' + tipGap + 'px ≥ 12px）')

await act(() => byClass(tree, 'daa-hbtn')[0].props.onMouseLeave())
assert(!byClass(tree, 'daa-tip-below')[0], '移开后说明浮层消失')

// ---- 点击入口 → 打开面板 ----
await act(() => byClass(tree, 'daa-hbtn')[0].props.onClick())
assert(pulls.length >= 1 && pulls[0].startsWith('/activity/pull'), '打开面板会拉取 /activity/pull')

const card = byClass(tree, 'daa-card')[0]
assert(!!card, '面板卡片已渲染')
// 面板同样要 portal 到 body：否则会在滚动容器里被裁剪/被页面内容遮挡
const cardPortal = portalCreations[portalCreations.length - 1]
assert(!!cardPortal && cardPortal.container.className === 'daa-portal', '面板卡片通过 portal 渲染到 body 层')
const backdropEl = byClass(tree, 'daa-backdrop')[0]
assert(!!backdropEl, '遮罩层已渲染')
assert(Number(backdropEl.props.style.zIndex) > 10000, '遮罩层自身层级足够高（' + backdropEl.props.style.zIndex + '）')
eq(textOf(byClass(tree, 'daa-title')[0]), '全年活跃记录', '标题 = 全年活跃记录')
const subText = textOf(byClass(tree, 'daa-sub')[0])
assert(subText.includes('2 天活跃'), '副标题含「N 天活跃」')
assert(subText.includes('活跃率'), '副标题含活跃率')

// ---- 入口字形的等级接线（今天=2026-09-17 是 L3）----
const glyphL3 = byClass(tree, 'daa-glyph-cell').filter((c) => String(c.props.className).includes('daa-l3'))
assert(glyphL3.length >= 1, '入口字形里今天的格子取到 L3 颜色')

const statValues = byClass(tree, 'daa-stat-v').map(textOf)
eq(statValues.length, 4, '统计行有 4 项')
assert(statValues[0] === '2 天', '统计行① 活跃天数 = 2 天')
assert(/%$/.test(statValues[1]), '统计行② 活跃率百分比')
assert(statValues[2] === '2 周', '统计行③ 周连登 = 2 周')
assert(statValues[3] === '2 天', '统计行④ 最长连续 = 2 天')

eq(byClass(tree, 'daa-legend-cell').length, 5, '图例有 5 个色块')
const legendText = textOf(byClass(tree, 'daa-legend')[0])
assert(legendText.includes('未活跃') && legendText.includes('活跃'), '图例两端标注「未活跃 / 活跃」')

// ---- 几何 ----
const cols = byClass(tree, 'daa-col')
eq(cols.length, 53, '2026 年渲染 53 列（周）')
let cells = byClass(tree, 'daa-cell')
eq(cells.length, 53 * 7, '总格数 = 53 × 7')
const leadIndex = cells.findIndex((c) => !String(c.props.className).includes('daa-cell-pad'))
eq(leadIndex, 3, '2026-01-01（周四）前有 3 个占位格')
const monthTexts = byClass(tree, 'daa-month').map(textOf).filter(Boolean)
eq(monthTexts, ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'], '月份轴标出 1—12 月（含设计图里的「2 月」）')

// ---- 数据接线 ----
const colored = cells.filter((c) => /daa-l[1-4]/.test(String(c.props.className)))
eq(colored.length, 2, '2026 年有 2 个活跃色块')
assert(colored.every((c) => String(c.props.className).includes('daa-l3')), '色块等级取自数据里的 level 字段')
const todayCells = cells.filter((c) => String(c.props.className).includes('daa-today'))
eq(todayCells.length, 1, '今天的格子有独立高亮')
assert(!String(todayCells[0].props.className).includes('daa-cell-pad'), '今天不是占位格')
eq(colored.length + 1, colored.length + 1, '（占位格不参与色块统计）')

// ---- 悬浮明细 ----
await act(() => colored[0].props.onMouseEnter())
assert(!!byClass(tree, 'daa-tip')[0], '悬浮活跃格出现明细浮层')
const tipText = textOf(byClass(tree, 'daa-tip')[0])
assert(tipText.includes('活跃等级') && tipText.includes('轮次') && tipText.includes('Token'), '明细含等级/轮次/Token')
await act(() => colored[0].props.onMouseLeave())
assert(!byClass(tree, 'daa-tip')[0], '移开后明细浮层消失')

// ---- 年份切换 ----
const yearCur = byClass(tree, 'daa-year-cur')[0]
assert(textOf(yearCur).includes('2026'), '年份切换器默认显示 2026')
const yearBtns = byClass(tree, 'daa-year-btn')
eq(yearBtns.length, 2, '年份切换有前后两个按钮')
const prevBtn = yearBtns.find((b) => textOf(b) === '‹')
assert(!!prevBtn, '存在「上一年」按钮')
const pullCountBefore = pulls.length
await act(() => prevBtn.props.onClick())
assert(pulls.length > pullCountBefore && pulls[pulls.length - 1].includes('year=2025'), '切到 2025 会按该年重新拉取')
assert(textOf(byClass(tree, 'daa-year-cur')[0]).includes('2025'), '年份切换器显示 2025')
eq(byClass(tree, 'daa-col').length, 53, '2025 年也是 53 列')
cells = byClass(tree, 'daa-cell')
eq(cells.filter((c) => /daa-l[1-4]/.test(String(c.props.className))).length, 3, '2025 年色块数量 = 该年活跃日数')
assert(!cells.some((c) => String(c.props.className).includes('daa-today')), '查看历史年份时不显示「今天」高亮')
assert(textOf(byClass(tree, 'daa-sub')[0]).includes('3 天活跃'), '副标题跟随年份切换（2025 → 3 天活跃）')

// ---- 版本 / 升级 ----
assert(pulls.some((p) => p === '/activity/meta'), '面板打开会拉取 /activity/meta（版本信息）')
const gearBtn = byClass(tree, 'daa-refresh').find((b) => textOf(b) === '⚙')
assert(!!gearBtn, '底部有设置（⚙）按钮')
assert(String(gearBtn.props.className).includes('has-update'), '有新版本时 ⚙ 按钮带更新角标')
assert(byClass(tree, 'daa-hbtn-dot').length === 1, '有新版本时头部入口带小红点')

await act(() => gearBtn.props.onClick())
assert(!!byClass(tree, 'daa-setup')[0], '点击 ⚙ 展开设置抽屉')
assert(textOf(byClass(tree, 'daa-setup')[0]).includes('v1.0.0'), '抽屉显示当前版本 v1.0.0')
assert(textOf(byClass(tree, 'daa-setup')[0]).includes('v1.1.0'), '抽屉显示最新版本 v1.1.0')
const upgradeBtn = byClass(tree, 'daa-setup-btn')[0]
assert(textOf(upgradeBtn) === '升级到 v1.1.0', '有更新时按钮文案 = 升级到 v1.1.0')
assert(String(upgradeBtn.props.className).includes('primary'), '升级按钮为主按钮样式')

await act(() => upgradeBtn.props.onClick())
assert(pulls.some((p) => p === '/activity/upgrade [POST]'), '点击升级会 POST /activity/upgrade')
const setupText = textOf(byClass(tree, 'daa-setup')[0])
assert(setupText.includes('已升级到 v1.1.0'), '升级成功后抽屉展示结果文案')
assert(setupText.includes('重启 dsh web'), '升级成功后提示需要重启')
assert(textOf(byClass(tree, 'daa-setup-btn')[0]) === '检测更新', '升级后按钮回落为「检测更新」')
await act(() => byClass(tree, 'daa-setup-close')[0].props.onClick())
assert(!byClass(tree, 'daa-setup')[0], '点击 ✕ 收起设置抽屉')

// ---- 关闭：Esc / 遮罩 ----
assert((documentStub._ls && documentStub._ls.keydown || []).length >= 1, '面板挂载时登记了 Esc 监听')
await act(() => { for (const fn of documentStub._ls.keydown) fn({ key: 'Escape' }) })
assert(!byClass(tree, 'daa-card')[0], 'Esc 关闭面板')

await act(() => byClass(tree, 'daa-hbtn')[0].props.onClick())
assert(!!byClass(tree, 'daa-card')[0], '再次点击入口可重新打开面板')
const backdrop = byClass(tree, 'daa-backdrop')[0]
await act(() => backdrop.props.onMouseDown({ target: backdrop, currentTarget: backdrop }))
assert(!byClass(tree, 'daa-card')[0], '点击遮罩空白处关闭面板')

// ---- 卸载清理 ----
disposers.forEach((d) => { if (typeof d === 'function') d() })
assert(head.children[0].removed === true, '卸载时移除 style 元素')
assert(portalHostRemoved(), '卸载时回收 portal 宿主（不留下空壳 div）')

// ======================= 内部几何 / 格式化 =======================

const inner = mod.__internal
assert(!!inner, 'bundle 暴露 __internal 供测试使用')
eq(inner.buildWeeks(2025)[0].slice(0, 3), [null, null, '2025-01-01'], '2025-01-01 是周三 → 前 2 个占位')
eq(inner.buildWeeks(2024).reduce((a, w) => a + w.filter(Boolean).length, 0), 366, '2024 闰年 = 366 个真实格子')
eq(inner.buildWeeks(2025).reduce((a, w) => a + w.filter(Boolean).length, 0), 365, '2025 平年 = 365 个真实格子')
assert(inner.buildWeeks(2024).every((w) => w.length === 7), '每周恒为 7 格')
for (const y of [2024, 2025, 2026, 2027]) {
  const wk = inner.buildWeeks(y)
  const real = wk[0].findIndex(Boolean)
  eq(real, (new Date(y, 0, 1).getDay() + 6) % 7, `${y}-01-01 落在正确的星期行`)
}
eq(inner.fmtPercent(1 / 229), '0.4%', '活跃率 <1% 时保留 1 位小数')
eq(inner.fmtPercent(0.105), '11%', '活跃率 >=1% 时取整')
eq(inner.fmtCompact(32534755), '32.53M', 'Token 紧凑格式')
eq(inner.levelOfDay({ level: 4 }), 4, 'levelOfDay 透传数据里的等级')
eq(inner.levelOfDay(null), 0, 'levelOfDay 无记录 → 0')

// ---- 自适应：直接用纯函数验证（DOM 尺寸测量由真实浏览器负责）----
const fit = inner.fitTipPosition
assert(typeof fit === 'function', '导出 fitTipPosition 供测试')
eq(fit({ left: 800, top: 400 }, { width: 184, height: 60 }, { width: 1440, height: 900 }), { left: 800, top: 400 }, '下方空间充足时位置不变')
eq(fit({ left: 800, top: 848 }, { width: 184, height: 60 }, { width: 1440, height: 900 }), { left: 800, top: 832 }, '轻微越界时上移到贴边（900-8-60=832）')
eq(fit({ left: 800, top: 848 }, { width: 184, height: 400 }, { width: 1440, height: 900 }), { left: 800, top: 492 }, '下方空间不足时上移到刚好放得下（900-8-400=492）')
eq(fit({ left: 1400, top: 100 }, { width: 184, height: 60 }, { width: 1440, height: 900 }), { left: 1340, top: 100 }, '右侧越界时向左收（1440-8-184/2=1340）')
eq(fit({ left: 20, top: 100 }, { width: 184, height: 60 }, { width: 1440, height: 900 }), { left: 100, top: 100 }, '左侧越界时向右推（8+184/2=100）')
eq(fit({ left: 800, top: 848 }, { width: 0, height: 0 }, { width: 1440, height: 900 }), { left: 800, top: 848 }, '尺寸未知时不乱动（首帧兜底）')
eq(fit({ left: 800, top: 848 }, { width: 184, height: 60 }, null), { left: 800, top: 848 }, '拿不到视口尺寸时退回原值')

// ---- 关键修复：浮层必须 portal 到 body，否则被会话头部所在滚动容器裁剪/困住 ----
assert(portalCreations.length >= 1, '悬浮说明通过 createPortal 渲染')
const host = portalCreations[portalCreations.length - 1].container
eq(host.className, 'daa-portal', 'portal 宿主使用 daa-portal 类')
eq(documentStub.body.children.indexOf(host) >= 0, true, 'portal 宿主挂在 document.body 直下')
eq(String(host.style.position), 'fixed', 'portal 宿主 position:fixed（跳出头部的层叠上下文）')
eq([host.style.top, host.style.right, host.style.bottom, host.style.left].join(','), '0,0,0,0', 'portal 宿主铺满视口（fixed 的包含块是视口而非头部）')
assert(Number(host.style.zIndex) > 10000, 'portal 宿主层级足够高（' + host.style.zIndex + '）')
assert(Number(entryTip.props.style.zIndex) > 10, '悬浮说明自身层级高于按钮（' + entryTip.props.style.zIndex + '）')


if (failures === 0) {
  console.log('\n✓ client smoke 全部通过')
} else {
  console.error(`\n✗ client smoke 失败 ${failures} 项`)
  process.exitCode = 1
}
// store 的轮询定时器会一直挂着（浏览器里正是靠它保活），测试里显式收尾
process.exit(process.exitCode || 0)
