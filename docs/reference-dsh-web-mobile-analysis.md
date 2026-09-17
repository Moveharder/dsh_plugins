# dsh-web-mobile 架构与可复用技术分析报告

> 目标仓库：`https://github.com/mexiaosqwq/dsh-web-mobile`（branch `main`，package version 2.4.1）
> 方法：只读拉取 + 逐文件精读（`curl` raw），未修改目标仓库任何文件。所有行号均指该仓库 `main` 分支源码。
> 本报告为「另起一个新移动端适配插件」的输入，因此每节都标注了**该抄**与**该砍**。

---

## A. 总体架构

### A.1 Host 半区 vs Client 半区：边界在哪

这个插件是**单包双半区**（single package, two halves），不是 monorepo、没有 server 层。边界由 `package.json` 的 `exports` 与 `dsh` 字段机械决定：

```jsonc
// package.json
"exports": {
  ".":        { "default": "./lib/index.js" },   // host 半区（Node ESM）
  "./client": { "default": "./lib/client.js" },  // client 半区（浏览器 bundle）
  "./cordis.patch.yml": "./cordis.patch.yml"
},
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-locale", "...ui-slots", "...ui-primitives", "...ui-conversation", "...ui-layout", "...ui-settings", "...ui-sidebar", "@deepseek-ai/dsh-session-log-export"] }
}
```

- **Host 半区**（`src/index.ts` + `src/compress.ts` + `src/delete-session.ts`）：只做浏览器做不到的两件事。
  1. `ctx.effect(() => installResponseCompression(), 'dsh-web-mobile: response compression')` —— **进程级 prototype patch**，替换 `http.ServerResponse.prototype` 的 `writeHead` / `write` / `end`（`src/compress.ts:177-185`，disposer 完整还原三个方法）。
  2. `ctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: '/api/mobile-nav.session.delete', handler }), label))` —— 宿主 session 菜单只有 rename/fork/archive，没有「删除会话」，所以自己开一个端点。真正的删除逻辑在 `src/delete-session.ts`（DI 纯核，可单测），服务在**请求时**用 `ctx.get('sessionPersistence' | 'sessions' | 'agents' | 'workspaceRegistry')` 读取，缺失降级成结构化 503 而不是崩。
- **Client 半区**（`src/client/**`）：**全部**浏览器行为——样式注入、slot 组件、14 个 effect 模块、手势层、reconciler。它通过 `fetch('/api/mobile-nav.session.delete')` 回调 host 端点。
- 边界的一句话总结：**host 只提供「浏览器不可能有的能力」（响应压缩、文件系统级删除），client 承担一切 UI/DOM/手势**。

两条方向相反的导入纪律（极易踩）：

| 半区 | 源码里相对导入写什么 | 为什么 |
|---|---|---|
| host（`tsconfig.json`, `moduleResolution: "bundler"`） | **必须带 `.js`**：`from './compress.js'` | tsc 把相对说明符**原样发射**，Node ESM 不猜扩展名 → 漏写直接 `ERR_MODULE_NOT_FOUND`，plugin tree 加载失败、`dsh web` 崩 |
| client（`tsconfig.client.json`, `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`） | **必须带 `.ts`/`.tsx`**：`from './styles/index.ts'` | tsc 负责把 `.ts` 重写成 `.js` 供 CommonJS 发射 |

host 半区**故意不 type-import 任何宿主包**（仓库 node_modules 只有 client 侧包），全部用结构化接口声明（`src/index.ts:26-46` 的 `HostContext` / `ScopedContext`）。

### A.2 客户端激活流程：怎么判断「这是移动端」

**唯一判定式**（`src/client/effects/phone-chrome.ts:27`）：

```ts
export const MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'
```

三个查询常量，语义严格分层：

| 常量 | 值 | 用途 |
|---|---|---|
| `MOBILE_QUERY` | `(max-width: 1023px) and (pointer: coarse)` | 权威移动分支（JS + 全部 CSS 顶层 media 块） |
| `DESKTOP_QUERY` | `(min-width: 1024px)` | **仅** debug 徽章的信息读数，不是权威守卫 |
| `TOUCH_QUERY` | `(pointer: coarse)` | 唯一豁免：session-delete 三件套全宽度武装（大平板横屏要桌面布局但仍要「删除会话」） |

关键设计判断：

1. **不用 UA**（除 iOS 引擎检测），**不用 JS 宽度读数**，**不用 `navigator.maxTouchPoints`** 做移动判定——只用媒体查询，因为 CSS 与 JS 必须读同一个真值源。
2. **宽度不够，必须 AND 指针类型**。这是 2026-08-30「PC 泄漏」的直接产物：分屏窗口、未最大化窗口、系统显示缩放 125%/150%/200%（1920 物理 @200% = 960 CSS px）都会把桌面 CSS 视口压到 1024 以下。纯宽度断点会让桌面长出右上 Files 按钮（实测 rect `[864,14]`）、左上 toggle、底部 stats 行整套移动 UI。
3. **`(pointer: coarse)` 而非 `(hover: none)`**：触屏笔电的主指针是 fine → 走桌面 UI（有意为之）。无指针环境（headless）三个 `(pointer)` 查询全 false → **永不激活**，所以探针必须显式 `Emulation.setTouchEmulationEnabled`（见 C.2）。

**唯一的 arm/disarm 脚手架**（`phone-chrome.ts:75-95`）：

```ts
export function installMobileEffect(
  ctx: ClientContext, label: string,
  install: (narrow: MediaQueryList) => (() => void) | undefined,
  query: string = MOBILE_QUERY,
): void {
  ctx.effect(() => {
    const narrow = window.matchMedia(query)
    let cleanup: (() => void) | undefined
    const arm = (): void => { cleanup?.(); cleanup = narrow.matches ? install(narrow) : undefined }
    arm()
    narrow.addEventListener('change', arm)
    return () => { narrow.removeEventListener('change', arm); cleanup?.() }
  }, label)
}
```

`cleanup?.()` 在 `arm` 开头先跑一遍，是宽→窄→宽往返不出错的关键；`query` 第 4 参让 `TOUCH_QUERY` 的豁免不需要自己搭第二套 matchMedia 脚手架。

### A.3 桌面端如何做到完全 no-op（三层，缺一不可）

1. **JS 层**：`installMobileEffect` 在 `matches === false` 时**根本不调用 `install()`** → 不挂监听器、不建 observer、不注入节点。这是「零成本」的来源。
2. **CSS 层**：slot 渲染的控件（`MobileNavToggle` / `MobileDrawerFooter`）**在任意宽度都存在**（slot 是宿主渲染的，插件管不到挂载）。所以必须有一个**精确补集**的隐藏块（`src/client/styles/misc.css.ts:253-264`）：
   ```css
   @media (min-width: 1024px), (pointer: fine), (pointer: none) {
     [data-mobile-nav="toggle"], [data-mobile-nav="files"], [data-mobile-nav="fab"],
     [data-mobile-nav="backdrop"], [data-mobile-nav="session-log"], [data-mobile-nav="explorer"],
     [data-mobile-nav="preview-full-toggle"], [data-mobile-nav="drawer-actions"] {
       display: none !important;
     }
   }
   ```
   注意这是 **`NOT A or NOT B`** 的德摩根展开，不是 `NOT (A and B)`。
3. **约定层（dispose 竞态的最后防线）**：**新增任何 `data-mobile-nav` 注入控件（slot 按钮、task 注入元素）必须同步加进上面这份清单**。这条不是形式主义——2026-08-30 复查实锤 `preview-full-toggle` 漏列（10 个标记值清单只有 7 个）。

豁免项走独立的 pointer-only 块（`misc.css.ts:270-276`），**故意不带宽度项**（带了就会在宽屏触摸上把功能隐藏掉，而那正是它存在的设备类）：

```css
@media (pointer: fine), (pointer: none) {
  [data-mobile-nav="session-delete"],
  [data-mobile-nav="delete-dialog-backdrop"],
  [data-mobile-nav="delete-dialog"] { display: none !important; }
}
```

reconciler 的 task 是**在 apply 时注册**（不是 `installMobileEffect` 里），但只有 `core.activate()` 之后才会 flush，而 `activate()` 在 `installReconciler` 的 `installMobileEffect` 内被调用 → 桌面同样不跑。

### A.4 插件如何注册到宿主

**① patch 行**（`cordis.patch.yml`，全文件 6 行）：

```yaml
- insert:
    - id: dsh-web-mobile
      name: 'dsh-web-mobile'
```

**② host 半区导出形态**（cordis 官方最小插件形状）：`export const name` + `export function apply(ctx: HostContext)`。

**③ client 半区发现**：`package.json` 的 `dsh.client.platform: "web"` + `exports["./client"]` → DSH 从 `src/client/index.tsx` 找到浏览器半区。`src/client/index.tsx:26` 声明 cordis fiber inject 契约：

```ts
export const inject = ['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions', 'workspaces']
```

**④ slot 注册**（`src/client/index.tsx:209-244`），恰好两个：

```ts
ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
  name: 'conversation.session.header.actions',
  id: 'mobile-nav-toggle',
  order: 10,
  locale: NS,
  inject: () => ({ toggleSidebar: () => ctx.layout.toggleSidebar() }),
}, MobileNavToggle))

ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
  name: 'sidebar.footer.action', id: 'mobile-nav-session-log', order: 5, locale: NS,
  inject: () => ({
    downloadSessionLog: (id: string) => ctx.sessionLogDownload.download(id as unknown as DownloadSessionId),
    toggleSidebar: () => ctx.layout.toggleSidebar(),
  }),
}, MobileDrawerFooter))
```

- `inject: () => ({...})` 把 ctx 服务**闭包成 props**，组件完全不碰 ctx（`MobileNavToggle` 只收 `toggleSidebar` + `t`）。
- `order` 是有意义的：footer 的 order 5 让它落在 remote icon 行（默认 0）之下、usage badges（10）之上；**不要和 usage stats 打平**（打平后注册顺序会把 badge 楔进图标和 pill 之间）。
- locale 命名空间用模块增强声明：`declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { mobileNav: MobileNavKey } }`，`MobileNavKey` 由 `zh` 派生（先写 zh 再镜像 en）。
- 文件末尾一串 `import type {} from '@deepseek-ai/dsh-client-ui-layout/client'` 等**纯类型导入**，把各 SlotMap 的 module merge 拉进本程序而不产生运行时代码。

**⑤ 跨宿主版本的品牌类型规避**（值得抄的小技巧）：

```ts
type DownloadSessionId = Parameters<ClientContext['sessionLogDownload']['download']>[0]
```
**派生而不导入**：0.1.1 把参数类型写成 `string`，0.1.2-alpha.1 写成 `Branded<'SessionId'>`，派生写法让**同一份程序对所有代际都能 type-check**。

**⑥ 样式注入**（`index.tsx:45-59`）：一个 `<style data-plugin="dsh-web-mobile" data-plugin-css="dsh-web-mobile/mobile.css">`，并在 `setTimeout(..., 0)` 里把它**重新 append 到 `<head>` 末尾**——对抗「宿主/其他插件在我们之后注入 CSS」。

---

## B. 核心机制

### B.1 reconciler：找节点、跟变化、不和 React 打架

**两个文件的分工是整个设计的核心：**

- `src/client/core/reconciler-core.ts`（173 行，**零 import**）= 纯引擎：任务注册表、dirty-key 路由、rAF 合并 flush、per-task 错误隔离。**它不认识 DOM**（`scopes` 对它是不可解释的字符串）。
- `src/client/effects/phone-chrome.ts` = 薄浏览器适配器：**一个** `MutationObserver` + rAF 注入 + 生命周期。

**它不做的事**：不用 React fiber 遍历做主定位（fiber 只用于「WebKit 吞掉 tap 的 click」这一处兜底，见 D.15），**不用 rAF 轮询**，**不用 per-task observer**。

**变化检测**（`phone-chrome.ts:231-253`）——单一 observer，观察 `document.documentElement`：

```ts
const observer = new MutationObserver((records) => {
  const keys = new Set<string>()
  for (const record of records) {
    keys.add(record.type === 'attributes' && record.attributeName !== null ? record.attributeName : '*')
  }
  core.note(keys)
})
observer.observe(document.documentElement, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['style', 'class', 'data-phase', 'data-sidebar-collapsed',
    'data-aionui-explorer-open', 'data-aionui-preview-open', 'data-mobile-preview-full'],
})
core.activate()
```

**dirty-key 路由**（`reconciler-core.ts:94-114`）：

```ts
if (forceAll) { for (const task of active) runEnsure(task) }
else if (dirty.size > 0) {
  for (const task of active) {
    const scopes = task.scopes
    if (scopes === undefined || scopes.some((key) => dirty.has(key))) runEnsure(task)
  }
}
```

- `scopes: undefined` = 每次非空 flush 都跑（legacy）；`scopes: ['*']` = 只在有树变化时跑；`scopes: ['data-sidebar-collapsed', 'data-phase']` = 只在这些属性变化时跑。
- `stats-line` **必须**保持 `scopes: ['*']`，因为 TPS 更新是 childList/characterData 文本 mutation（不是属性）。
- `register()` 在已激活状态下会立刻 `runEnsure(task)`；`deactivate()` 取消 pending frame + 逐个 `runDispose`。
- per-task `try/catch` + `onError(taskName, error, 'ensure' | 'dispose')`：**一个 task 抛错不影响其他 task**。

**已注册的 8 个 task**（`phone-chrome.ts:770-779`）：`frame-marker`、`preview-fullscreen-toggle`、`git-chip-reparent`、`settings-toolbar-reparent`、`preview-close-sync`、`sheet-rise-replay`、`stats-line`、`overlay-backdrop-fab`。

**它如何找宿主 DOM 节点**（优先级严格）：

1. **宿主稳定 `data-*` 锚点**：`[data-shell-overlay]`（frame = 它的 parentElement，`findFrame()`）、`[data-slot="conversation.input.dock"]`、`[data-composer-card]`、`[data-composer-input]`、`[data-sidebar-right-expand]` / `[data-sidebar-right-toggle]`、`[data-phase="active"]`、`[data-gitgraph-chip-anchor]`、`[data-dsh-market-root]`。
2. **几何**（空 DOM 也成立）：`beginStroke` 用 `clientX ∈ frameRect` 而不是 `frame.contains(event.target)`——hero/blank 空抽屉没有内容元素，pointerdown 会穿透到 frame 背景，target 树判定会误拒手势。
3. **文本锚点**（最后手段）：`stats-line.ts` 靠 `/^TPS\s+\d/` 正则找 TPS 读数行，因为官方状态行只有哈希类名。
4. **哈希子串**（见 B.2）。

**如何避免和 React 打架（6 条，全部实锤过）**：

| 手段 | 代码位置 | 说明 |
|---|---|---|
| `ensure()` 必须幂等 | `git-chip-reparent.ts:12`：`if (chip.parentElement !== card) card.insertBefore(...)`；`overlay-backdrop-fab.ts:58`：`if (backdrop === null)` | 每次 flush 都写入 = 自己触发自己 |
| **搬运时刷新 origin** | `stats-line.ts:46-48`：`tpsOrigin = { parent: el.parentElement, next: el.nextSibling }` **在实际搬运的那一刻**记录 | React 会重建节点，origin 必须在搬运时现取 |
| `dispose()` 放回原处 | `git-chip-reparent.ts:15-18`（找回元素**限定在 dock 容器内**，不做全局文本搜索）；`stats-line.ts` 用 `tpsOrigin` 还原 | 窄→宽必须回到官方布局 |
| **self-trigger 防护** | `ensureDismissShadow()` 首行 `if (shadow !== null && shadow.parentElement === pane && pane.firstElementChild === shadow) return`；`debug.ts:67-73` 跳过 `record.target === badge \|\| badge.contains(record.target)` | 后者不做会让 `?mobile-nav-debug=1` **硬冻结页面**（卡在 "Loading plugins…"） |
| **快路径** | `stats-line.ts:14-23` 的 `statsAnchorAlive(el)`：O(1) 复验已标记锚点（`isConnected` + `closest('[data-phase]')` + `closest('[class*="_composerStack"]')`），失位才回落全树 hunt | 全树 hunt 随会话增长，而它每个 streaming token 都跑 |
| 模块级 installed flag | `frameControllerInstalled` / `reconcilerInstalled` / `reconcileTasksRegistered`，各自返回的 disposer 复位 | 同环境插件重载能整体拆掉重建（否则 reload 后 reconciler 失效） |

**性能契约**（写进 pitfalls §113）：`installSidebarSwipe` 的 arm-open 在 4× CPU 节流下实测 **308ms longtask / rAF 间隙 225ms**（React 同步挂载 389 节点），所以 arm 帧用 `content-visibility:hidden` 拆挂载、两帧后 reveal；插件 CSS 只能消 layout/paint 份额，治本在宿主。

### B.2 CSS 注入与选择器策略

**注入**：单标签，`MOBILE_CSS = [BASE_CSS, LAYOUT_CSS, COMPAT_CSS, MISC_CSS].join('\n')`（`styles/index.ts`）。**顺序 load-bearing**：base → layout → compat → misc，misc 最后所以能覆盖 compat。

**为什么是 `.css.ts` 而不是 `.css`**：CSS 是 TypeScript 模板字面量 → tsc 直接发射成 JS 模块，自研打包器按普通模块内联，**不需要任何 CSS loader**。代价：注释里不能写反引号（会提前终止模板，tsc `TS1005`），已写成守卫测试。

**四块分工与 `!important` 密度**：

| 文件 | 行数 | `!important` | 分工 |
|---|---|---|---|
| `base.css.ts` | 285 | 9 | **任意宽度都渲染**的控件骨架（toggle/files 几何、drawer footer、backdrop/FAB、settings 入场、preview rise、删除确认卡），靠 misc 的桌面块隐藏 |
| `layout.css.ts` | 1126 | 103 | 移动布局，**自包含**一个 `@media (max-width:1023px) and (pointer:coarse)` 块（L6 开）：phone chrome / 会话文本 / composer 底栏 / header / popover / 设置弹窗 |
| `compat.css.ts` | 930 | **319** | 第三方兼容（dsh-web-ui 家族、dshmarket、usage-stats、dsh-meme、agent-preset、dsh-file-viewer、git-graph、dsh-genui）。两个 mobile 媒体块（L6、L763） |
| `misc.css.ts` | 277 | 34 | hero 输入区 / iOS 16px 下限 / 抽屉树 `content-visibility` / 平板 768-1023 / **桌面隐藏块** |

`!important` 纪律不是「一律加」而是**按域递增**：base 9 个（只压宿主默认），layout 103，compat **319**（对第三方必须赢），misc 34（含两个隐藏块的 `display:none !important`）。整个设计承认「同一张拼接样式表 + 宿主/第三方也在用 `!important`」→ 只能靠**特异性 + 拼接顺序 + `!important`** 三重。

**选择器策略（这是全项目最有复用价值的部分）**：

1. **稳定 `data-*` marker 优先于哈希类**（完整 marker 契约清单见 AGENTS.md「Conventions」）。
2. **哈希类一律子串匹配 `[class*="_frag"]`，禁止 `[class$=…]`** —— 实锤：subagent 世系根渲染 `class="ZKlsPq_root "`（模板字面量带来的**尾随空格**），`[class$="_root"]` 对整个 class 属性串做后缀测试 → **真实 DOM 0 命中**；`wSkVaW_composerStack wSkVaW_composerHero` 多 token 同理。**合成 fixture 复现不出，只有真渲染能暴露**。
3. **前缀重叠必须 `:not` 排除**：
   - `[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"])`（dshmarket 的 `eGUBIq_irowActions` / `irowTrailing` 都含 `irow`）
   - 裸 `[class*="_header"]` 会命中**全部 8 个插件卡头**（官方 `YyYd_a_` + dsh-web-ui-all 五张）→ 必须**结构化锚定**：reparent 后 `> [class*="_nav"] > [class*="_header"]`，reparent 前 `> :last-child > [class*="_header"]`
   - `_scroll` 用 `:has(p)` + `:not(:has([data-composer-input]))` 区分「消息滚动体」与「composer 滚动体」
   - `_row` 复合族用五段 `:not`
4. **`:has()` 圈定**：`header:has([class*="_crumbs"] [class*="_root"])`、`[role="menu"]:has([class*="cubgiG_item"])`、`body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed])) [role="menu"]`。**要求 Chromium 105+**；老 WebView 里 `:has()` 规则会**静默消失**（不是报错）。
5. **反断言元素**：压 tooltip 时必须保留 `[class*="_actions"]` 祖先限定。裸 `[_bubble]` 会把用户消息气泡 / goal 气泡一起 `display:none`——「CDP 实测 10 个 tooltip」其实就是 10 条用户消息，**断言断在 bug 本身**。`compat-contracts.json` 里专门列了 `user-bubble` / `goal-bubble` 作为反断言锚点。
6. **镜像上游条件反制**：dshmarket ≥1.20 在 `@media(max-width:560px)` 注入 `[role="dialog"]:has([data-dsh-market-root]) > nav { display:none }`（注释假设宿主会在 content header 自留关闭按钮，但本宿主唯一叉号就在该 nav 里 → 打开市场后无路可退）。插件**镜像上游同一 media 条件**写 `display:flex !important` 反制。取证手法：活页面遍历 `document.styleSheets`（含 media 规则递归）找命中目标元素且带 `display:none` 的规则 → 定位注入 style 标签。

**断点策略**：

- 顶层移动块：`(max-width: 1023px) and (pointer: coarse)`（3 个文件都有，**必须同步**）
- 平板：`(min-width: 768px) and (max-width: 1023px) and (pointer: coarse)` → 弹窗/底部 sheet 居中 + `width: min(calc(100vw - 32px), 720px)`
- 窄屏微调：`(max-width: 440px)`、`(max-width: 559px)`、`(max-width: 359px)`、`(max-width: 480px)`、`(max-width: 560px)`
- 桌面补集：`(min-width: 1024px), (pointer: fine), (pointer: none)`
- pointer-only 补集：`(pointer: fine), (pointer: none)`
- `prefers-reduced-motion: reduce` 在 4 处保留

### B.3 手势系统实现要点

**事件接线**（`sidebar-swipe.ts:1486-1494`）——全部在 `document`，全部捕获阶段：

```ts
document.addEventListener('pointerdown', onPointerDown, true)
document.addEventListener('pointermove', onPointerMove, true)
document.addEventListener('pointerup', onPointerUp, true)
document.addEventListener('pointercancel', onPointerCancel, true)
document.addEventListener('click', onClick, true)                                  // 吞合成 click
document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false }) // 唯一非 passive
document.addEventListener('visibilitychange', onVisibility)
window.addEventListener('blur', onBlur)
```

无 `touchstart`，不在 drawer/frame/backdrop 上挂监听，**不用 `setPointerCapture`**（有意）。节点每次现取：`getFrame()` / `findDrawer()` = `frame.firstElementChild`。

**状态机与参数**：

| 常量 | 值 | 含义 |
|---|---|---|
| `START_ZONE_RATIO` | `0.45` | 起点识别区 = 0.45 × 视口宽（390px → 176px） |
| `LOCK_PX` | `8` | 轴锁定阈值（`\|dx\| > \|dy\|` 且过此值即锁横向） |
| `OPEN_DISTANCE_RATIO` | `0.16` | 开抽屉位移阈值（≈62px@390） |
| `CLOSE_DISTANCE_RATIO` | `0.13` | 关抽屉位移阈值（≈51px@390，**故意低于开**，防误反向重开） |
| `VELOCITY_WINDOW_MS` | `60` | 速度窗 = 窗内**末两点**斜率 |
| `OPEN_VELOCITY` / `CLOSE_VELOCITY` | `0.45` px/ms | fling 阈值（MUI 同值） |
| `COOLDOWN_MS` | `350` | 覆盖 .28s 过渡，防反向手势双翻 |
| `CONSUME_WINDOW_MS` | `300` | 手势消费标记存活窗 |
| `OPEN_FOLLOW_ARM_PX` | `8` | = 轴锁定本身（不留额外死区） |
| `CLOSED_SLOT_PCT` | `110` | 宿主关闭槽位（10% 溢出藏阴影） |
| `COMMIT_ANIM_MS` | `280` | 自播关抽屉动画（对齐宿主 .28s） |
| `OPEN_FOLLOW_BASE_PCT` | `101` | 开方向跟随基线（-110% 会藏掉前 28px） |
| `FILES_ZONE_RATIO` / `FILES_DISTANCE_RATIO` / `FILES_VELOCITY` | `0.45` / `0.16` / `0.45` | 右缘 files 族（镜像抽屉族） |
| `FLOATING_WIDGET_MAX_PX` | `200` | 悬浮窗让位启发式上限 |

**开 = 提前提交（early commit）**：`tryLock` 一旦锁轴就 `armOpenFollow` —— 先写 inline `transition:none !important` + 把 transform 钉到 `followOpenTransform(0.0001, rtl)` = `translateX(min(0px, calc(-101% + 0.0001px)))` + `content-visibility:hidden !important`，**然后**才在同一个 task 里 `ctx.layout.toggleSidebar()`。**钉在翻之前是必需的**，否则宿主的 `transform:none` 开态规则会先画一帧静止。React 把真抽屉（~280px）挂到屏外；每步 pointermove 写 `translateX(min(0px, calc(-101% + Npx)))`（RTL 镜像 `max(0px, calc(101% - Npx))`）。

> **百分比基线是 load-bearing 的**：arm 那一刻元素是 ~206px 的 rail，一帧后变成 ~280px 的真抽屉；缓存 px 值会错位 ~74px。

**关 = 晚提交（late commit）**：`commitWithAnimation` 写 inline `transition: transform 280ms ease-in-out !important` → 强制 style flush `void el.getBoundingClientRect()` → inline transform 到 `±110%` → `fadeOverlayOut()`（遮罩渐隐，`overlay-backdrop-fab.ts:10`）→ `cooldownUntil = now + 350` → `setTimeout(finishPendingCommit, 280 + 40)`。`finishPendingCommit` **只在 marker 仍显示开的时候**才翻宿主状态（`sidebar-swipe.ts:926`）——窗口内的真实 backdrop tap 已经关掉了，盲目 toggle 会重新打开。
**为什么晚**：提前翻会让 React 在动画中途把互斥的 rail/drawer 子树换掉（实测 t≈200ms/280ms 时宽 280→206，tx 往回跳 25.7px）。

**如何不劫持原生滚动（4 层）**：

1. `touch-action: pan-y pinch-zoom !important`（`layout.css.ts:42`，html/body；drawer 列 L172 重复一份，因为 `touch-action` **不继承**且行为交集沿祖先链）。
   **不含 `pan-x`** 是刻意的：左缘横滑否则会被浏览器当 pan 吃掉并发 `pointercancel`，手势层收不到完整事件流。
2. **8px 轴锁定**：垂直主导直接 `reset()`（`sidebar-swipe.ts:1107-1111`）把触摸交还滚动。**没有 `findVerticalScroller` 这类 helper**——垂直方向纯靠轴判定。
3. `findHorizontalScroller(chainFrom(event.target))`（L1037, L493-505）：从 target 起最内层祖先若是 `overflow-x: auto|scroll` **且真的溢出**（`scrollWidth > clientWidth + 1`）就拒绝整笔笔画。`overflow-x: hidden/clip` 永不匹配（裁掉的内容没法 pan）。`chainFrom` 在每次 pointerdown **快照一次**祖先链 + getComputedStyle，不是每帧成本。
4. 兜底：一旦 tracking，捕获态 `touchmove`（`passive:false`）`preventDefault()`，防浏览器事后抢走（iOS Safari）；`touches.length > 1` 改为 abort，**绝不取消 pinch**。

**如何避免触发浏览器边缘返回手势**：

- **几何**：`START_ZONE_RATIO = 0.45`（~176px@390）刻意清出 Chrome Android 的 `EDGE_WIDTH_DP = 48dp` 历史导航带（该带内的笔画会被浏览器抢走并 `pointercancel`）。右缘 files 区是精确镜像（同样 0.45）——窄条带根本不可用。
- **CSS**：`overscroll-behavior-x: none !important` 于 `html, body`（`layout.css.ts:43`）压制根滚动器的边缘历史导航。**只有 html/body 算**（Chromium issue 41483088：内层容器被导航路径忽略）。**iOS Safari 的边缘返回没有 CSS 退出机制**（WebKit bug 240183）——那里唯一缓解就是放宽起点区。
- 没有任何地方 `preventDefault` pointerdown，没有 `touch-action: none`。

**双族路由（`strokeMode: 'drawer' | 'files'`）**：只在 `beginStroke` 写入（L1072/1074/1076），`reset()` 复位成 `'drawer'`。

- **抽屉开**：起点只需落在 frame 的 bounding rect 内（L1065-1069，2026-08-29 用户要求「打开抽屉之后以外的部分可以进行左滑」后全 frame 开放）；`[class*="sessionRow"] button`（kebab）排除；然后右缘区 → `'files'`，否则 `'drawer'`。
- **抽屉关**：左缘区（`hitTestStart`）→ `'drawer'`；否则右缘区（`filesZoneHit`，精确镜像）→ `'files'`；否则拒绝。两个 45% 区之间留 10% 中间缝，关闭态永不重叠。
- files 判定（`classifyFilesSwipe`）：**左滑永不收起任何东西**（用户原话「右缘左滑抽屉要是开的情况下，不会收起！只有右缘右滑才能做到」）；右滑且抽屉开 → 走抽屉族的 `CLOSE_DISTANCE_RATIO` 0.13 / 0.45 门槛（**缺这道门槛时，390px 下 files 区与抽屉列重叠 66px，拇指横漂 8px 就会收抽屉并吞掉这次 click**）。
- `filesPanelOpen()` 必须三重判定（L531）：元素在场 **且** 非 `visibility:hidden`/`display:none` **且** `rect.left < innerWidth`——0.1.5 面板**常驻 DOM**（关闭形态 visibility:hidden + rect 顶到视口宽），只查在场会永远为真。
- **提交顺序**：`'files'` → **先 `filesToggleFn()`，再 `markStrokeConsumed`，最后 cooldown**（L1286-1298）。标记链从起点走到 frame，而 frame 是 header 的祖先，**标记先落会把 openFilesPanel 自己程序化的 opener click 经公共祖先段吞掉（面板永不打开）**。`'none'` files 释放仍要吞合成 click，但必须在提交分支**之后**。

**让位（yield）体系**——`beginStroke` 的有序闸门（L1012-1037），每条都让出**整笔笔画**（不 arm、不锁轴、不 preventDefault）：

| # | 条件 | 读什么 |
|---|---|---|
| 1 | `onCooldown()` | `performance.now() < cooldownUntil`（350ms） |
| 2 | `modalOpen()` | `document.querySelector('[aria-modal="true"]')` |
| 3 | `takeoverActive()` | `data-dsh-taskboard-active` / `data-dsh-ssh-active`，或**任意** `[data-conversation-composer-overlay]`（通用宿主 overlay 属性：轨迹 tab、dsh-file-viewer、未来第三方 view） |
| 4 | `selectionOwnsStroke()` | **两个互斥选区模型**都读 |
| 5 | `dragMarkYields()` | `data-mobile-nav-dragging`（合作标记） |
| 6 | `floatingWidgetYields()` | `findFloatingWidget` 位置启发式 |
| 7 | `findHorizontalScroller()` | 真横滚容器 |

**pointerdown 之后还要复查**（因为锁轴前什么都没承诺）：`onPointerMove` **每一步**都 abort on `modalOpen() || takeoverActive()`（中途升起的 modal 不能继承已画的 transform）；锁轴前复查 `selectionOwnsStroke()`（长按选区可能在 down 与 lock 之间出现）；`tryLock` 复查 `dragMarkYields || floatingWidgetYields`（拖动组件常在自己的 pointerdown 里挂标记，**晚于**我们的 `beginStroke`）。多指：第二根手指 pointerdown 就 abort，且多指 touchmove 也 abort——否则 preventDefault 会取消 pinch（而 pinch 是 iOS 上唯一缩回浏览器自加缩放的手段）。

**语义：让位 ≠ 拦截**。手势层从不阻断事件派发，只是**不认领**这笔笔画。**一旦锁轴即承诺**，锁后出现的标记/形状不回头。

**DOM 写纪律**：所有 inline 写用 `style.setProperty(prop, value, 'important')` / `removeProperty`。**`important` 是必需的，不是风格**——开态由我们自己的 `transform: none !important`（`layout.css.ts:155-157`）样式化，它压过普通 inline 声明：`style.transform = …` 读回来是对的，**computed 却仍是 `none`**。所以探针断言一律看**计算后几何**，绝不读 inline 字符串。

`transform: none` vs `translateX(0)`：开态**必须**是 `none`，因为 identity transform 仍会为 fixed 后代建立包含块（portaled 进 sidebar DOM 的设置浮层曾偏移 102px）。后果：关闭槽位是 `translateX(-110%)` 而开态静止是 `none`，所以跟随是**释放**而不是动画到 0。

**动画：没有 rAF 循环**。跟随在 pointermove 里同步写——每步一次写、**每步零 layout 读**，几何在锁轴时缓存一次（`strokeClosedTx = ±(drawer.getBoundingClientRect().width × 110 / 100)`）；开方向保留百分比基线。终态用 inline CSS transition（280ms）+ `setTimeout(320ms)` 翻状态。

**与其他监听器的协作（`gesture-guard.ts`，139 行，零 import）**——**两个独立信号，因为它们在**不同时刻**回答不同问题**：

- **轴锁标志** `markStrokeLocked()` 在 `tryLock` 置位（pointermove 阶段，**严格早于任何 pointerup**）；`isStrokeLocked()` 被 `phone-chrome.ts` 的 `onDrawerClick` / `onDrawerPointerUp` / `onDrawerPointerDown` / `onDrawerPointerMove` 首行读。**为什么必需**：宿主的 document 捕获监听器注册**更早**（`index.tsx:179` 装 `installOverlayInteractions`，`:191` 才装 `installSidebarSwipe`），同一个 release 事件宿主先跑；而消费标记要等手势层**自己的** pointerup（分类之后）才写。只靠 `consumeIfGestured` 挡不住抢跑/双翻抵消（审计 S0/S1）。
- **消费标记** `markGestureConsumed(target, 300, upTo)`：给 target 及其祖先链（到 `upTo` 为止）盖 `performance.now() + 300` 的戳；`consumeIfGestured(event)` 沿事件 target 链查、惰性清过期项。`upTo` 收敛到 **drawer**（不是 frame）是「点两次才关」的修复：链走到 frame 会把 **backdrop 也标记为 consumed**。
- 手势层自己的捕获 `onClick` 查完标记后 `stopPropagation() + preventDefault()`，**例外**：命中 backdrop/FAB 的 click 无条件放行（除非那个 overlay 就是本笔笔画的起点元素——关笔画现在可以从 frame 任意处起，起点可能是 backdrop 自己）。

### B.4 视口 / safe-area / iOS 缩放 / 键盘

**viewport meta 所有权**（`phone-chrome.ts:313`）：

```ts
const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover'
```

武装期由插件**独占所有权**，三个观察者汇入一个幂等 `assertViewport`：

- `metaObserver`：`observe(viewport, { attributes: true, attributeFilter: ['content'] })`，`attachMetaObserver()` 在节点被替换时**重新绑定**；
- `headObserver`：`observe(document.head, { childList: true })` → 重新 attach + assert（覆盖「meta 在我们之后才注入」）；
- `assertViewport` 幂等：`applying` 重入护栏 + `viewport.content === VIEWPORT_CONTENT` 相等短路（**我们自己的写会重新触发观察者**，相等检查把那一趟变成 no-op）。

dispose 时**只在 `viewport.content === VIEWPORT_CONTENT`** 才还原 `originalViewport`——宿主在我们武装期写的值赢。

> **写入永不带 `maximum-scale` / `user-scalable`**：iOS 10+ 对用户捏合直接忽略它们，而安卓/桌面引擎会**认真执行**——写了只会把安卓的缩放能力一并拿掉。宿主各版（0.0.1-rc.5 / 0.1.1-rc.2 / 0.1.2-rc.1）实测也都不带。

**theme-color**：跟随 `body[data-ds-dark-theme]` mutation → `getComputedStyle(document.body).backgroundColor`，让 Android 用页面底色画状态栏/URL 栏。

**safe-area 两条铁律**：

1. `env(safe-area-inset-top)` 靠 `viewport-fit=cover` 才有非 0 值。
2. **safe-area padding 与 `box-sizing: border-box` 必须成对**（`layout.css.ts`）。官方 frame 是 `height:100%` + 默认 `content-box`，安全区 padding 会**加在**满视口高度之外 → frame 高 = 视口 + inset（实测 **844→891**），外层 document 出现恰好 inset 高的滚动量，粘在 scrollBody 底部的 composer seat 整体落到可视视口**之下 47px**。症状是「输入框被抬起、底部露空白、最后一条消息被压住、跟随失效」——**「跟随失效」是假象，错位的是外层 document**。桌面 inset=0 复现不出，必须 CDP 注入 `padding-top:47px` 模拟。断言：`documentElement.scrollHeight - clientHeight === 0` 且 `seat.getBoundingClientRect().bottom === innerHeight`。
3. **fixed 元素的包含块是视口**，frame 的 padding 够不到它。宿主 Files 面板是 `position:fixed; inset:0; z-index:40` 且宿主 CSS 全程无 safe-area 处理 → 顶行（tab 标签 / `+` / Split / 退出全屏）y=0…38 正好在状态栏下。修复是给**面板本体**吃 inset：
   ```css
   [data-sidebar-right-panel="fullscreen"] { padding-top: env(safe-area-inset-top, 0px) !important }
   ```
   **必须带 `="fullscreen"` 形态限定**：宿主另一种形态是停靠面板（实测 `form=push`、`position:absolute`），它的包含块是 frame 的 padding box，本来就在状态栏下方，再吃一次 inset 会顶两次。成立前提是面板自绘背景（状态栏那条不露底）且为 border-box。

**iOS 聚焦放大（#45）三件套**——这是**双因素**问题，缺一不可：

1. **`html[data-mobile-nav-ios]` marker**。引擎判定是纯函数 `detectIosWebKit(nav, supports)`：
   ```ts
   if (supports !== null) { try { if (supports('(font: -apple-system-body) and (-webkit-touch-callout: none)')) return true } catch {} }
   const ua = nav.userAgent
   if (/iP(hone|ad|od)/.test(ua)) return true
   return /Macintosh/.test(ua) && nav.maxTouchPoints > 1   // iPadOS 13+ 发桌面 UA
   ```
   **特征探针优先于 UA**（Chromium 实测为 false，无误报）；UA 兜底要处理 iPadOS 13+ 的 `Macintosh` + `maxTouchPoints > 1`。这个 marker 只给 iOS 用，因为其他引擎不因字号放大——安卓拿到 16px 下限只会得到更大的搜索框。
2. **16px 下限**（`misc.css.ts`，`html[data-mobile-nav-ios]` 门控）：盖 `textarea` / `[contenteditable]:not([contenteditable="false"])` / 文本类 `input`（排除 button/checkbox/color/file/hidden/image/radio/range/reset/submit），composer 三件套（input/mirror/backdrop）**必须同字号**否则光标与文本错位；**故意不改 `select`**（会撑破 28px composer 控件，且原生 picker 自己遮盖屏幕）。
3. **`touch-action: pan-y pinch-zoom`**（含 `pinch-zoom` 是必需的）+ **删掉 `gesturestart` 的 preventDefault**。旧代码拦 `gesturestart` 是错的——**那是双指捏合，不是双击缩放**，拦它等于取消用户手动缩回的唯一手段；而 `touch-action` 不含 `pinch-zoom` 会把浏览器自加的放大变成**不可撤销**（只能关 App 重开或旋转一次）。

**键盘**（`composer-keyboard-guard.ts`，iOS-only）：上游 `keepFocus` 在 `mousedown` 里 `editor.focus({preventScroll:true})`——桌面靠它保持光标，iOS 上这段在 tap 的**合成 mousedown** 里重开已收起的键盘（用户点「发送」→ 键盘弹回来盖住半个屏幕）。修法是**屏蔽方法而不是拦截事件**：

```ts
Object.defineProperty(editor, 'focus', {
  configurable: true, writable: true,
  value: function swallowedFocus(): void { /* keep the dismissed keyboard dismissed */ },
})
setTimeout(restore, 0)   // 下一个 macrotask 删掉
```
时机：capture `mousedown` → shadow focus →（冒泡）keepFocus → click → macrotask restore。**为什么不用 capture `stopPropagation`**：`keepFocus` 自己的 `preventDefault()` 必须继续跑（它阻止 tap 把编辑器 blur 掉），而编辑器的 tap-to-type 路径也绝不能碰。

**已评估但未采用**：`visualViewport` 驱动 frame 重置、`interactive-widget=resizes-content`——两者都有 jank 风险且 headless 无法验证。

---

## C. 工程化

### C.1 构建链路：为什么需要自研 `build-client.mjs`

```
pnpm build = tsc -p tsconfig.json && tsc -p tsconfig.client.json && node scripts/build-client.mjs
```

| 步骤 | 产物 | 配置要点 |
|---|---|---|
| `tsc -p tsconfig.json` | `lib/index.js` + `lib/types/`（host，ESM） | `moduleResolution: "bundler"`；相对导入**原样发射** → 源码必须写 `.js` |
| `tsc -p tsconfig.client.json` | `.client-build/**/*.js`（CommonJS）+ `lib/types/client/**`（d.ts + map） | `module: commonjs`、`rootDir: src/client`、`declaration: true`、`allowImportingTsExtensions: true` + `rewriteRelativeImportExtensions: true` |
| `node scripts/build-client.mjs` | `lib/client.js`（单文件内联 bundle） | 97 行，**零依赖**（只用 `node:fs/promises` + `node:path`） |

**为什么必须自研**：DSH 浏览器侧的模块加载契约是 `window.__ModuleLoader__.load({ id, factory: (require) => ... })`，**不是** CommonJS 文件、也不是 ESM。需要一个东西把 tsc 的 CJS 输出包成这个形状。它做的事：

1. 递归 walk `.client-build`，按 forward-slash 相对路径建 map（`index.js`、`styles/index.js`…）；
2. `const REQUIRE_RE = /require\("(\.[^"]+\.js)"\)/g` 找相对 require；
3. 从 `index.js` 出发做**依赖优先拓扑排序**，找不到模块就 `throw new Error(\`client module not found for require: ${file}\`)`；
4. 把每个相对 require 重写成 canonical 路径 `require("./styles/base.css.js")`；
5. 生成内联 `__modules` + `__localRequire`：`if (id.charCodeAt(0) !== 46) return require(id)` —— **非 `.` 开头的交给宿主 `require`**，所以 `react` / `@deepseek-ai/*` 平台模块留在宿主的浏览器模块表里解析；
6. 删除 `lib/client.js.map` 与 `.client-build`。

**为什么不用 esbuild/rollup**：规模是一个插件一个 bundle（26 个模块），97 行零依赖比引入构建工具链更贴合；而且**必须**产出 `__ModuleLoader__` 这个非标准形状，通用打包器反而要写插件去适配。

**`lib/` 提交进仓库**：因为消费者 `npm install` 后不构建就要能跑。代价是 CI 加了新鲜度门：

```yaml
# .github/workflows/ci.yml
- run: pnpm verify        # tsc --noEmit 双半区
- run: pnpm test:core     # node --test tests/*.test.ts
- run: pnpm build
- name: lib is fresh (rebuild must not diff)
  run: git diff --exit-code lib
```

**已知的「曾经以为是坑」**：`effects/` 里 `../` 导入曾被记为「自研打包器不支持」——**2026-09-14 A/B 实测证伪**（`phone-chrome.ts` 一直有 `import { createReconcilerCore } from '../core/reconciler-core.ts'`，正常落成 `require("./core/reconciler-core.js")` + `__modules["core/reconciler-core.js"]`）。但 **`reconciler-core.ts` 保持零 import 仍是有意为之**：node:test 直接 type-strip 加载它，不需要 DOM、不需要 DSH 运行时。

**CSS 是 `.css.ts` 而非 `.css`** → 不需要任何 CSS loader，tsc 直接发射；代价是注释里禁止反引号（tsc `TS1005`），已写成守卫测试。

**引擎底线**：`engines.node >= 24.0.0`（tests 依赖 Node 原生 TS type-stripping）。

### C.2 测试与回归探针策略

**① 单测：`node --test tests/*.test.ts`（17 个文件，无 jest/vitest/jsdom）**

能单测的前提是**把纯决策从 DOM 里抽出来**，全部靠依赖注入：

| 纯函数 | 注入什么 | 测试文件 |
|---|---|---|
| `classifySwipe` / `classifyFilesSwipe` / `slidingVelocity` / `hitTestStart` / `filesZoneHit` / `followTranslate` / `followOpenTransform` | 无（纯数学） | `sidebar-swipe.test.ts`（30KB，决策表） |
| `createReconcilerCore({ requestFrame, onError })` | 手动帧队列 + 错误收集 | `reconciler-core.test.ts` |
| `findSessionIdInFiber(fiber, isKnownId, limit)` | `isKnownId` 谓词 | `session-row-fiber.test.ts` |
| `detectIosWebKit(nav, supports)` | `nav` 对象 + `supports` 函数 | `ios-zoom-guard.test.ts` |
| `findRuleBlocks` / `matchesSelectorText` / `fontSizeFor` | 样式表字符串 | `css-rules.test.ts` |
| `createRafScheduler(raf, caf)` | 帧函数 | `raf-scheduler.test.ts` |

**② 源码级不变量守卫**（无头环境验不了的行为，至少被文本级不变量钉住）：

- `tests/css-rules.test.ts` 用**自研的「非 CSS 引擎」读自己的样式表字符串**，断言「消息文本族不再钉死 px 字号」。`src/client/core/css-rules.ts` 明确列出 6 条能力边界（不评估 at-rule 条件、丢掉 `@keyframes`、只读 `font-size` **longhand**（`font:` 简写里的 px 看不见）、`{` 出现在声明值里则该规则不可读…）——**它不假装能级联**。
- `tests/ios-zoom-guard.test.ts`（21 断言）：断言 CSS 里 `touch-action` 含 `pinch-zoom` 且不含 `pan-x`、16px 下限只作用于 iOS marker 且只作用于文本输入域、viewport 内容恰好是三个 token（**出现 `maximum-scale`/`user-scalable` 即回归**）。
- `tests/docs-consistency.test.ts`：AGENTS.md 引用的路径**都存在**（死引用类）、AGENTS.md **≤ 65536 字节**（session instruction budget）、`compat-contracts.json` 格式合法、`pitfalls.md` 镜像 AGENTS.md 的指针（用 **CJK 2/3 字滑窗**做模糊匹配，因为中文没有词边界）、CSS 模板里没有游离反引号。
- `tests/host-parity.test.ts`：`src/index.ts` 用**文本读取**而非 import（`moduleResolution: bundler` 保留 `.js` 拼写，Node ESM 解析不回 `src/index.ts`），断言 `export const name` 与 `package.json` 的 name 一致。

**③ 为什么需要 CDP 探针而不是单测**

单测验不了的东西恰好是最容易坏的东西：**宿主真实 DOM 层级 + CSS module 哈希 + 真实 pointer/touch 事件流 + 计算后几何 + 层叠（谁盖住谁）+ safe-area inset + 宿主版本差异**。这些是**运行时集成事实**，只有真浏览器 + 真 DSH Web 能给出。

`scripts/cdp-probe.mjs`（33KB，主探针，32 断言）的设计决策：

- **原生 CDP，零依赖**（自己的 `createCdpClient`），不引 Playwright/Puppeteer——`playwright-core` 在 android/Termux 抛 `Unsupported platform`。
- `mkdtemp` 独立 user-data-dir（**每次全新**）；`Page.addScriptToEvaluateOnNewDocument` 在首次导航前注入 `localStorage['dsh.sessions.current']`（**必须先 `JSON.stringify`**，不能拼进 JS 源码——否则特殊字符破坏表达式 + 「先加载空态再 reload」竞态）。
- 开 `Runtime` + `Log` 域收集未处理异常 / `console.error` / error 级日志。
- **所有点击坐标来自运行时元素 `getBoundingClientRect()`，无写死屏幕坐标**；所有等待有统一 deadline（`waitFor`），**无长固定 sleep**。
- `main()` **不 `process.exit()`**，只设 `process.exitCode`；`finally` 统一 teardown（关 WebSocket → reject 残留 request → 终止并等待 Chromium → 删临时 profile）。`SIGINT`/`SIGTERM` 走同一 abort 路径。
- **机读基线 `EXPECTED_FAILURES`**（这是让「已知不绿」的探针仍能当门禁的关键设计）：3 项预存失败（一个 404 资源、`integration.gitgraph.reparented`、下游的 `integration.gitgraph.pressed`）在**探针源码内**显式列出；命中基线的 FAIL 记 `BASE` **不计退出码**，SUMMARY 打 `base=N new=M`，只有 `new > 0` 才 exit 1。判定「修好了」必须从基线移除。`page.errors` 那条还要求 detail 含 `404`，防掩盖新的页面错误。
- **PASS / SKIP / FAIL 三分**：可选第三方集成缺失记 `SKIP`（**不把未执行伪装成 PASS**），`DSH_PROBE_REQUIRE_CHIP=1` 时才升级为 FAIL。
- **A/B 实验手法**：`git show <commit>:lib/client.js > lib/client.js` 换文件（服务端 no-cache 读当前文件，运行中的页面实时切换）；A/B 窗口要短并及时还原。**不要用 Playwright route 拦截 `client.js` 并 fulfill 空 body**——空响应被缓存后 boot 会报「loaded without registering」并挂起。

**④ 探针环境坑（写进 runbook，全是实锤）**

- headless chromium **没有 pointer 设备**，`(pointer)` 三个查询全 false → 必须 `Emulation.setTouchEmulationEnabled({ enabled: !!mobile, maxTouchPoints: 5 })`；**`setEmulatedMedia` 对 pointer 特征无效**（实测静默忽略）。桌面场景**必须关掉**触摸模拟。
- 断言 slot 按钮前必须等会话进入 active phase（`[data-phase="active"]`）；hero phase 下那个 slot 容器不渲染按钮（hero 自己的 `qDHVXG_headerActions` 不是同一容器）。**`document.body.dataset.dshPhase` 不存在**（照抄它会一直超时）。
- Termux 上必须给可写 `TMPDIR`/`XDG_RUNTIME_DIR`，`DSH_PROBE_CHROME` 要直指真实 ELF（`chromium-browser` 包装脚本 spawn 拿 EACCES）。
- 连续跑会**泄漏 headless chromium 进程**（实测 31 个残留把 load 顶到 7.0）→ 排查前先 `pgrep -c chrom`。
- 隔离 profile 首次启动会弹宿主 "Internal Testing Notice" 模态 → **必须移除整个 root**（只删 `[aria-modal=true]` 会留 mask 拦触摸）。
- cookie TTL 24h，需重新 mint；`DSH_PROBE_URL` 不要指向带 `?token=` 的 URL（303 会剥掉 query，探针在 `href.startsWith` 上超时）。

**⑤ 取证技术清单（这套方法比结论更可复用）**

| 技术 | 怎么做 | 用它破了什么案 |
|---|---|---|
| **Bundle A/B 换文件** | `git show <commit>:lib/client.js > lib/client.js`——服务端 no-cache 读当前文件，运行中的页面**实时切换**；A/B 窗口要短并及时还原 | 证明多点触控修复（改前 6/6 多指 touchmove 被 preventDefault，改后 0/10，单指对照仍 9/9）；证明 header `position` 两半都必需（只 static → 菜单落到 x=8 **y=849**，在 844 视口之外） |
| **活样式表遍历** | 枚举 `document.styleSheets` 的规则，用 `element.matches(selectorText)` 筛出命中目标元素的规则；限定 `ownerNode.dataset.plugin === '<本插件>'` 就能定位责任方 | hero 输入框被裁：只找到 2 条本插件规则碰到 `_scroll`/`_grow`/`[data-composer-input]`，因果链闭合。**递归机制**：`CSSKeyframesRule` 没有 `selectorText`/`style` 但有 `cssRules`，`CSSKeyframeRule` 有 `style` 但只有 `keyText` → **必须先判 `selectorText` 再递归 `cssRules`**；对容器调 `rule.style.cssText` 会抛 `TypeError` |
| **`elementFromPoint` 命中测试** | 断言必须包含「元素中心/两端点命中的是谁」 | 菜单中心命中不可见的 view-tabs 行；菜单中心**与两端**都命中抽屉内部；删除卡左侧 272px（x<280）命中抽屉按钮。**DOM-only 断言在「渲染了但被盖住」时全绿** |
| **伪造 safe-area inset** | headless 的 `env(safe-area-inset-top)` **恒 0** → inline 注入 `padding-top:47px !important` 再断言几何 | 破 frame content-box 案（844→891）、Files 面板案（inset 0→47：strip y 0→47、tab 标签 15→62、右缘不动 348/384）。Playwright MCP 的 Chromium **没有** `Emulation.setSafeAreaInsets`（返回 "was not found"），只能模拟 |
| **触摸模拟** | `Emulation.setTouchEmulationEnabled({ enabled: !!mobile, maxTouchPoints: 5 })` | headless 无 pointer 设备，`(pointer)` 三查询全 false；`setEmulatedMedia` 对 pointer 特征**静默忽略** |
| **反事实先于改源码** | 在活页面 append 一条同特异度的 `height:auto!important` 并测量（`_scroll` 52 == scrollHeight 52、`overflow:false`、`scrollTop:0`），**先确认几何因果**再动源码 | hero 输入框下限案 |
| **爆炸半径枚举代替 fixture** | 枚举活页面所有 `position ∈ {fixed, absolute} ∧ 0 < size ≤ 200 ∧ ∉ frame`（390px 下只有 dsh-pet 的 body + 气泡命中），再去第三方 `lib/client.js` 里 `rg` 确认 | 给悬浮窗让位启发式定参（`FLOATING_WIDGET_MAX_PX = 200`） |
| **事件 trace** | CDP 记录事件序列 | `pointerdown@open > pointerup@closed`（**此后无 click**）；可信 tap 后 **13ms** 一个 **UNTRUSTED** `.click()` 打向 `hHd-Xa_toggle`；长按后 `menus: 0` / `actionsDisplay: none` |
| **性能取证** | 4× CPU 节流；注意这个 Chromium trace **没有 RunTask 事件** → 用最大的 FunctionCall 锚点做函数族归因，**只读 `biggestJs`**（窗口求和会把后台线程 GC 拉进来） | 抽屉 arm-open = 308ms longtask / 225ms rAF 间隙 |
| **bundle 身份校验** | `sha1sum lib/client.js` 前 12 位 == served 的 `?rev=`；用完整 URL `/plugins/<pkg>/client.js?rev=<12>` 对账 | **路径猜错拿到 404 空 body，其 sha1 恒为 `da39a3ee5e6b`**——别误判成版本不一致。设备出现旧 UI 先换全新 browser context（复用旧 context 会进「fence-only」假象） |
| **异步锚点先轮询** | git 芯片在 `/git/branches` 之后才渲染，断言前必须轮询等锚点 | 避免把「还没渲染」判成回归 |
| **两步注入 localStorage** | 等 ~6s boot 稳定后再 `setItem` + 重新导航——**宿主会在 boot 后 ~4s 覆写 `dsh.sessions.current`** | 避免「先加载空态再 reload」竞态 |
| **负形状注入** | 探针必须注入「纯属性、无 `.dsfv-panel` 类」的形态，断言 marker **不**置位 | 证明 `data-conversation-composer-overlay`（通用）与 file-viewer marker（专属）两个信号确实解耦 |

**⑥ 真机读数通道（对「看不到设备屏幕」的调试是决定性的）**

`?mobile-nav-debug=1` 除了渲染页面徽章，把同一份读数 POST 到本机监听器（默认 `http://127.0.0.1:3199/diag`，`?beacon=<url>` 覆盖）：

```ts
void fetch(beacon, { method: 'POST', mode: 'no-cors', body: payload() }).catch(() => {})
```

`no-cors` + 文本 body 是**简单请求**（无预检），没有监听器时静默失败。payload 含：`build` 标记、`framePad`（= 解析后的 `env(safe-area-inset-top)`）、`rightPanel` 形态/padding/rect、`toggle`/`files`/`header`/`titleCluster` 的 rect、UA、`visualViewport`。本机起一个把 body 追加到 `~/tmp/mobile-nav-diag.jsonl` 的小服务即可——页面侧无需人工念数字/截图。

### C.3 宿主升级对账：`compat-contracts.json` 想解决什么问题

**问题**：CSS module 哈希是**包版本的函数**。插件大量选择器锚在 `eGUBIq_`（dshmarket）、`ZKlsPq_` / `h8S2Va_`（subagent 两代）、`JObwrW_`（ContextMeter）、`pI_x6G_`（frame）、`qDHVXG_`（hero headerActions）、`VOzbGW_`（设置叉号）、`wSkVaW_`（hero composer stack）、`YyYd_a_` / `Kwoi6G_` / `bpnj3G_` / `Jh0q7G_` / `jmhvDG_` / `rUBhvW_`（8 个插件卡头）这类前缀上。宿主或第三方插件升一个 minor，哈希全变，选择器**静默失配** → 表现是「布局坏了」而不是「报错」。而且 profile 的 `^caret` 版本范围会**静默升 minor**，所以「我没升级」不成立。

**做法**：把每个契约抽成机读清单（`docs/upstream/compat-contracts.json`，22 条），每条：

```jsonc
{ "id": "dshmarket-installed-row", "kind": "hash", "needle": "eGUBIq_",
  "owner": "dshmarket", "lazy": true,
  "state": "打开设置→插件市场后复扫",
  "note": "outer-row :not 排除 irowActions/irowTrailing + 标题行 wrap + Tasks 弹卡" }
```

- `kind`: `hash` | `marker`
- `lazy: true` = 状态门控/懒加载资源（必须打开某个 UI 后 DOM 里才有）→ **miss 记 SKIP 并提示手动步骤，不计退出码**
- `lazy: false` 的 MISS **计退出码**
- `owner` 说明是哪个包，升级时能直接定位责任方

`scripts/cdp-compat-contracts.mjs` 在真实页面扫描 **DOM class** 与**全部 `CSSRule` 文本**（**递归进 media 规则**）判 HIT/MISS/SKIP。首跑 **19 HIT / 3 SKIP / 0 MISS**。效果：升级后跑一次就知道漂了哪几个，**不用等布局坏了再排雷**。

配套的 `docs/upstream/upgrade-runbook.md` 是它的文字版 + 升级后验证电池：

```sh
pnpm verify && pnpm test:core && pnpm build && git diff --exit-code lib
node scripts/cdp-compat-contracts.mjs     # miss=0 才算过
DSH_PROBE_SESSION_ID=<id> pnpm smoke:cdp  # SUMMARY new=0 才算过
node scripts/cdp-swipe-failures.mjs       # 16 场景手势门
node scripts/cdp-zoom-probe.mjs           # 21 断言 iOS/viewport 守卫
for f in scripts/probes/*.mjs; do node "$f" || echo "FAIL $f"; done   # 17 个回归锚点
```

**「双代并存」的处理哲学**（比版本号判断可靠）：`ZKlsPq_`（hover 代）与 `h8S2Va_`（onClick 代）互斥；`HOVER_SUBTREE_SELECTOR` **同时列两代哈希**，两条吞噬防护并存、在另一代上各自 no-op = **两代通吃**。判定**看 served bundle 的行为（有无 onClick / hover 定时器），别看版本号**（npm dist-tag 不可信）。

---

## D. 关键坑（Pitfalls）清单

> 每条按 **症状 → 根因 → 对策** 三段式。完整推导与取证在 `docs/maintenance/pitfalls.md`（414 行 / ~95KB，31 个 `##` 小节 + 23 个 `###` 子节），AGENTS.md 的 Pitfalls 节是它的压缩索引（§ 名 1:1 对应、同序）。
>
> 下面 20 条按「复用价值 × 非显然度」排序。**D.2 是项目自己写下的禁止清单**，可直接当 review checklist 用。

**1. 桌面窄窗口长出整套移动 UI**（右上 Files 按钮实测 `[864,14]`、左上 toggle、底部 stats 行；点 Files 因桌面双击习惯触发开→关快速翻转，感知为「抽搐、打不开」）
→ 断点原本只有 `(max-width:1023px)`，而分屏窗口 / 未最大化窗口 / 系统显示缩放 125%/150%/200%（1920 物理 @200% = 960 CSS px）都会把 PC 的 CSS 视口压到 1024 以下
→ `MOBILE_QUERY` 加 `(pointer: coarse)`；misc.css 桌面隐藏块改成**精确补集** `@media (min-width:1024px), (pointer:fine), (pointer:none)`；**维护约定：新增任何 `data-mobile-nav` 注入控件必须同步进该清单**（曾实锤 `preview-full-toggle` 漏列）

**2. 点 backdrop 要「点两次」才关抽屉**
→ `markGestureConsumed` 链式标记起点祖先链，起点不含 drawer 时（headless 命中穿透到 body、或空壳 drawer 无内容元素）会一路标到 document，把 **backdrop / FAB 也标记为 consumed**；300ms 窗口内 backdrop 的 click 被 `stopPropagation` 吞掉，元素级监听收不到
→ `onClick` 对命中 `[data-mobile-nav="backdrop"], [data-mobile-nav="fab"]` 的 click **无条件放行**（backdrop/FAB 绝不可能是手势合成 click 的目标——手势起点只在左缘 start zone / drawer 内容区）；同时 `markGestureConsumed` 的 `upTo` 从 frame 收敛到 **drawer**

**3. 点抽屉里的「新会话」只收回抽屉，什么都没打开**
→ 原来在 document 捕获 `pointerup` 里 `toggleSidebar()`；pointerup 收抽屉后触摸点已不属于按钮，Chrome **不派发 click**（CDP trace `pointerdown@open > pointerup@closed`，此后无 click；鼠标是 `... > click@closed`），宿主 `onClick`（`startSession()`）从不执行
→ 删掉该分支，交给既有的 document 捕获 **click** 收抽屉（click 已派发给按钮，事件路径在派发时已固定，React 委托照收）。**铁律：任何在 pointerup 里收起容器/改布局的写法，先问「这次手势的 click 还没派发吧」**

**4. 手势 release 后抽屉被 toggle 两次、净效果为零（审计 S0 抢跑）**
→ 宿主 capture handler 注册**更早**、同一 release 事件先跑；而消费标记要等手势层**自己的** pointerup（分类之后）才写入
→ 引入第二个更早的信号 `markStrokeLocked()`（在 `tryLock` 的 **pointermove** 阶段置位，严格早于任何 pointerup）；宿主两个 handler 首行 `if (isStrokeLocked() || consumeIfGestured(event)) return`

**5. 抽屉里的内容横滑被浏览器吃成 pan、手势全失效**
→ `touch-action` 的真正落点是 **html/body** 而不是 drawer（左缘触摸穿透到 body 背景，`elementFromPoint` 命中 body）
→ html/body 改 `pan-y pinch-zoom`（**不含 `pan-x`**，禁横向 pan 保纵向），drawer 上保留一份双保险（`touch-action` 不继承且沿祖先链取交集）

**6. iOS 一输入就放大，且放大后无法缩回，只能关 App 重开或旋转一次**
→ **双因素**：字号 <16px 招聚焦放大（composer 常驻聚焦，没有 blur 时机）+ 插件同时堵死两条退路（`gesturestart` 一律 preventDefault——**那是双指捏合不是双击缩放**；根 `touch-action: pan-y` 不含 `pinch-zoom`）
→ ① 根/抽屉 `touch-action: pan-y pinch-zoom`；② 删掉 `gesturestart` preventDefault；③ `html[data-mobile-nav-ios]` 门控的 16px 下限。**不要改回 `maximum-scale=1`**（iOS 10+ 对用户捏合忽略它，安卓/桌面会认真执行）

**7. 刘海机上输入框被抬起、底部露空白、最后一条消息被压住、「跟随失效」**
→ frame 是 `height:100%` + 默认 `content-box`，安全区 padding **加在**满视口高度之外 → frame 高 = 视口 + inset（实测 **844→891**），外层 document 出现恰好 inset 高的滚动量，粘在 scrollBody 底部的 composer seat 落到可视视口下 **47px**；宿主 at-bottom 跟随只操作它自己的 scrollBody（`floorGap` 恒 0，逻辑无错）
→ frame 规则必须成对写 `box-sizing: border-box !important`；断言 `documentElement.scrollHeight - clientHeight === 0` 且 `seat.getBoundingClientRect().bottom === innerHeight`；桌面 inset=0 复现不出，须 CDP 注入 `padding-top:47px` 模拟

**8. Files 面板（宿主全屏 fixed sheet）顶行压在手机状态栏下（y=0…38）**
→ **fixed 元素的包含块是视口**，插件给 frame 加的 padding 够不到它；宿主 CSS 全程无 safe-area 处理
→ `[data-sidebar-right-panel="fullscreen"] { padding-top: env(safe-area-inset-top, 0px) !important }`。**必须带 `="fullscreen"` 形态限定**：停靠形态（实测 `form=push`、`position:absolute`）的包含块是 frame 的 padding box，本来就在状态栏下方，再吃一次会**顶两次**

**9. 会话 header 拥挤保护规则真实 DOM 0 命中（「修了但还是被截断」）**
→ subagent 世系根渲染 `class="ZKlsPq_root "` —— 模板字面量带来的**尾随空格**；`[class$="_root"]` 对整个 class 属性串做后缀测试 → 0 命中。**合成 fixture 复现不出，只有真渲染能暴露**
→ 一律子串匹配 `[class*="_root"]`，并用 `:has(> button[class*="_trigger"])` 只钉计数/jobs root、排除 `switcherRoot` 让 title 省略号收缩。
**同一次 `$=`→`*=` 大迁移的过匹配代价（都实测到了）**：会话内容列左右各被多塞 20px padding（**390→350**）、Models 卡片 **372px vs 兄弟 342px** 溢出 390 视口、设置分类顶部出现灰椭圆。所以子串匹配**必须配 `:not` 守卫族**（`_action(s)`、`_headerActions`/`_headerStatic`、`_scroll:has(p):not(:has([data-composer-input]))`、`_row*` 五段 `:not`）

**10. 设置工具栏规则把全部 8 个插件卡头一起打中**
→ 裸 `[class*="_header"]` 的匹配面是整个页面
→ **结构化锚定**：reparent 后 `> [class*="_nav"] > [class*="_header"]`，reparent 前 `> :last-child > [class*="_header"]`；同族「前缀重叠必须 `:not` 排除」（`irow` ⊃ `irowActions`/`irowTrailing`）

**11. 手机端 tooltip 压制把用户消息气泡全 `display:none`（「CDP 实测 10 个 tooltip」其实就是 10 条用户消息，断言断在 bug 本身）**
→ 从 fork 移植时丢掉了 `[class*="_actions"]` 祖先限定，裸 `:is([class*="_bubble"], [role="tooltip"])` 命中用户气泡（其 `_actions` 是**兄弟**不是祖先）与 goal 气泡
→ 恢复 `[data-phase] [class*="_actions"] [class*="_bubble"]`；**移植类 CDP 验证必须同时断言非目标元素可见**（反断言元素）

**12. hero 空态输入框出现滚动条 + 首行被裁**
→ 宿主（0.1.2-rc.1 Lexical 代）给 hero 输入框钉了 `min-height: 52px`，而 **min-height 永远赢过外层的 `height`**；插件从 fork 摘来的 `height: 28px !important` 只把滚动窗口压小了（`_scroll` clientHeight 28 / scrollHeight 52，autofocus 把 `scrollTop` 推到 24）
→ 删掉该规则（hero 输入框回两行高，卡 84px→108px）；**任何「压小宿主元素」的规则先查该元素有没有自己的 `min-height`/size 下限**；合成 fixture 里没有下限，**这正是它当年 11 断言全绿却漏网的原因**

**13. 触摸永远看不到会话行的 ⋯ 三点；长按也没反应；菜单弹出后压在抽屉底下**
→ ① 宿主 `_rowActions` 只在 `:hover` / `menuOpen` 显示，触摸到不了 `:hover`；② 第三方 `installMobileSidebarDismiss` 缺少 `_rowActions` 豁免，点行内 ⋯ 被当「点了会话行」→ 它去 `.click()` 宿主 logo 开关收抽屉（trace：可信 tap 后 **13ms** 一个 **UNTRUSTED** click 打向 `hHd-Xa_toggle`）；③ 宿主菜单 portal 到 body 且 `z-index:1100`，而抽屉列 1300、插件遮罩 1250 → 菜单 rect 中心与两端 `elementFromPoint` 全落抽屉内
→ ① 注入惰性影子 `<span data-mobile-nav="dismiss-shadow" data-dsh-responsive-part="sidebar-toggle">`（inline `display:none !important`、作 sidebar pane **首子节点**、别放 logo 行）让它的 `querySelector` 先命中 → 两条分支 no-op；② 插件自实现长按 500ms（抬手吞 800ms 合成 click + 1200ms `pointerleave` 守卫，因宿主菜单 `closeOnPointerLeave`）；③ `body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed])) [role="menu"] { z-index: 1400 !important }`

**14. 「渲染了 ≠ 可点到」：删除确认卡在抽屉带内所有按钮全死（真触摸点「取消」无效）**
→ 第三方 shim 在 frame 捕获阶段对「frame 内、抽屉外」的一切点击 `preventDefault + stopPropagation` 后才去点那个已 no-op 的开关
→ 插件自己的确认卡必须挂 **`document.body`**（脱离它的捕获链）+ 层带 `delete-dialog-backdrop` 1400 / `delete-dialog` 1401。**同类回归断言必须带 `elementFromPoint` 命中测试**（菜单中心/两端、卡片在抽屉带内的点）——DOM-only 断言会在元素「渲染了但被盖住」时**全绿**

**15. `?mobile-nav-debug=1` 一开页面就硬冻结（卡在 "Loading plugins…"）**
→ badge 位于 `document.body` 内，`paint()` 写 `badge.textContent` 会产生 childList mutation；MutationObserver 直接以 `paint` 为回调 → 把自己的输出再喂回 `paint()`，无限循环
→ 回调必须跳过 `record.target === badge || badge.contains(record.target)`。**同族**：reconciler task 的 `ensure()` 若每次 flush 都写入会自己触发自己（`ensureDismissShadow` 首行「已在位就 return」）

**16. 手势层把第三方桌宠/悬浮球的拖动劫持了（56px 悬浮球在 45% 区内右滑 → 抽屉在拖动中途打开）**
→ 拖动组件没有标准 DOM「draggable」信号
→ ① **合作标记** `data-mobile-nav-dragging`（拖动期间挂在被按住元素/祖先，或 body/documentElement 作全局标记；`beginStroke` 前置 + **`tryLock` 每次锁轴前复查**，因为拖动组件的 pointerdown handler 可能在我们之后跑）；② 不配合的第三方走**位置启发式** `findFloatingWidget`（起点祖先链上第一个 `fixed|absolute` 且 `≤200px`（`FLOATING_WIDGET_MAX_PX`）的自由定位浮层，**frame 子树除外**——FAB/backdrop/抽屉不误伤）。**让位 ≠ 拦截**：悬浮窗拖动照常执行；**一旦锁轴即承诺**，锁后出现的标记/形状不回头

**17. iPad 上拖选文字被当成抽屉手势（划词选区被折叠）**
→ 选区拖拽是横向主导、与抽屉滑动手势**几何上不可区分**
→ `selectionOwnsStroke()` 必须读**两个互斥的选区模型**：`window.getSelection()`（文档选区，覆盖消息流与 contenteditable）+ `document.activeElement` 上的 `selectionStart/selectionEnd`（textarea/input 内的选区对 `window.getSelection` **不可见**，实测 `taStart=0 taEnd=20` 而文档选区 `isCollapsed`）；**塌缩光标不算拥有**；两个时间窗都要查（pointerdown 前置 + axis-lock 前）

**18. 「打开文件列表」按钮永远够不到右上角（实测 `[300,16,28,28]`，右缘 328，离 390 视口差 62px）**
→ 宿主把 actions slot 挂在 title cluster 里，而 cluster 自带 `padding-right: 44px` 给一个**手机端恒空的 utilities 座位**（实测 `[374,8,0,44]`，宽 0），且容器是 `justify-content: flex-end` → **流式布局的按钮永远够不到右边缘**
→ 移动分支改成绝对定位 `position:absolute; right:8px; top:12px; z-index:2`（与左侧 `[data-mobile-nav="toggle"]` 的 `left:8px; top:12px` 同一条座位线）→ `[354,12,28,28]`。**两个别踩**：① 必须是 `position` 覆盖而**不是加负 margin**（负 margin 会被 cluster 的 padding 吃掉一部分，且标题道宽度不会回收）；② 竖向上它随 frame 的 safe-area padding 一起下移（实测 inset 47 时 top 12→59）——**这是必须的**，否则按钮会被状态栏压住

**19. 「后台任务」芯片 `aria-expanded=true` 却什么都不画（菜单 rect `[-16,49,336,40]`，`elementFromPoint` 在菜单中心命中不可见的 view-tabs 行）**
→ **三重困住**：宿主菜单是 `position:absolute; top:calc(100%+5px)` 挂在 `.QsffPG_root{position:relative}`（28px 流式盒）上，被 ① 我们 chip root 的 `overflow:hidden` 与 ② 宿主 `session-title-cluster{overflow:hidden}` 双重裁掉，且 ③ 我们的 `right:8px` 相对 156px 的 chip root 解析到 x=-16
→ **header `position:relative` + headerActions 内 chip root `position:static`——两半都必需**（A/B 实测：只 static 会让包含块外移到 frame，菜单落到 x=8 **y=849** 屏外，在 844 视口之外）。修后 `[46,77,336,73]`，各行可命中。
**同区第二个坑（行高/座位线）**：宿主手机版 `grid-template-rows: minmax(32px,auto) minmax(44px,auto)` 被空的 utilities 座位（44px）与 `[role=tab]{min-height:44px}` 顶成 44/44 → 97px 里只有 36px 是内容；压到 rows 36/32 + tab 32 + 座位 30px ⇒ 77px，但**宿主 `padding-top:8px` 不许再收**（收到 4px 会让标题行中心 22 而两角按钮中心 26，用户报「文字行在上边不协调」；8px 下两者同在 12..40、中心 26）。规则必须用 `:has(> *)` 门控——hero 那个空且被宿主隐藏的 header 仍占 85px，不许被压缩

**20. 打开抽屉整屏全黑，点哪都关（「有 box、computed 正常，却不绘制不命中」）**
→ 早期插件规则用 `z-index: 40 !important` 去压官方抽屉的原生 1100 → 抽屉保留了 layout box 与正常的 computed style，但**既不绘制也不参与命中测试**（删掉插件 CSS 立刻画出红框；inline 改 z=999 仍不绘制；只有原生值有效），于是插件的 backdrop 成了唯一可见层，外部点击判定落到 frame 上
→ 把抽屉列钉在 `z-index: 1300 !important`（与 base.css 的 1250 遮罩构成契约），**而不是让位**。**若将来真要检测官方抽屉形态，必须用结构类名（col 类含 `sidebarCol`）+ computed `position`，绝不能用 computed `z-index`**——检测跑在我们 CSS 在场时，读 z 会读到自压值

**附加：诊断本身成为事故源的两个变体**（值得单列，因为都花了真金白银）
- **空转的守卫**：`doesNotMatch(value, /px$/)` 恒真——因为声明以 `px !important` 结尾。**守卫必须先喂给它本该抓的字符串、确认它变红**，再信任它。同族第二例：遍历 DOM 级联时不先判 `selectorText`，在 `@keyframes` 容器上抛 `TypeError`。
- **没有读者的「机制」**：`data-mobile-nav-gen` marker 有写入方、**零读取方**，而它的自证式 docstring 骗过了一轮审计。**绝不要凭记忆/文档复述机制，先 grep 谁读它**。

### D.2 项目自己写下的「禁止」清单（invariants，直接可用作 review checklist）

**选择器**
- 永不 `[class$=…]`，一律 `[class*=…]`，前缀重叠片段加 `:not`。
- 不用裸 `[class*="_header"]`，锚定到两个合法工具栏位置之一。
- 不用裸 `[class*="_bubble"]`，保留 `[class*="_actions"]` 祖先限定。
- **永不用 computed `z-index` 检测宿主代际**（检测跑在我们 CSS 在场时，读到的会是我们自己压下去的值）——只用结构类名 + computed `position`。
- 干脆不写「宿主代际检测」钩子：插件不放权就是决定（`data-mobile-nav-gen` 的死代码已整体删除）。

**事件**
- 永不在 `pointerup` 里收起容器/改布局，除非先回答「这次手势的 click 已经派发了吗」。
- 永不依赖 iOS WebKit 壳的合成 click 时序，也不用「同步关闭 / 延迟关闭 / 重新派发 click」去"修"它。
- `gesture-guard.ts` 保持零 import；**永不拉长 300ms 消费窗口**。
- `isTapWithinSlop` 是**逐轴 max-norm**，不许改成 `hypot`（抽屉列表纵向滚动，60px 纵向漂移不能导航，而对角抖动仍应算 tap）。
- 不为了手感擅自缩小起点识别区；让位启发式必须靠**全页枚举**论证，不能靠注入的 fixture。

**布局 / CSS**
- 任何「压小宿主元素」的规则，先查该元素有没有自己的 `min-height`/size 下限。
- safe-area padding 与 `border-box` **成对**。
- `[data-sidebar-right-panel="fullscreen"]` 必须带形态限定（裸属性选择器会给停靠形态双 padding）。
- 通用收缩规则必须 `:not` 排除 `_add` / `_primary` / `_root`。
- trailing 域用**后代组合器**——`>` 会静默穿过 `display:contents` 包装层而失效。
- 不给 `p`/`li` 逐元素重钉字号（会把字号轴切两次）；**永不用 `--dsw-font-markdown-base` 当 `font-size`**（它是 `font:` 简写：`size / line-height family`，当 `font-size` 用是非法声明、被静默丢弃）。
- 不把「压小」规则镜像到新代宿主而不对真宿主复验——合成 fixture 缺宿主的下限（这正是 11 断言全绿却漏网的原因）。

**验证**
- 每个新增的 `data-mobile-nav` 注入控件**必须**进桌面隐藏块清单。
- 移植/迁移必须断言非目标元素仍然可见。
- 注入形状必须包含**反断言形态**。
- 守卫找不到东西时必须**大声失败**（`assert.ok(hit !== null)`）；信任任何断言前，先把「它本该抓的字符串」喂进去、确认它变红。
- 遍历 DOM 级联前先判 `selectorText`。

**流程**
- 重命名属性/锚点前，先 grep **谁写、谁读**。
- 不手改 `lib/`，重建。
- 不用 Playwright route 拦截 + 空 body fulfill 做 A/B（boot 会挂在 "loaded without registering"）。
- 不把 `DSH_PROBE_URL` 指向带 `?token=` 的 URL（303 剥掉 query，探针在 `href.startsWith` 上超时）。
- 不复用长活 browser context。
- **不靠静态 bundle grep 推断宿主行为**（曾据此得出的 `data-side` / `data-sidebar-collapsed` 两个结论都是错的）。

---

## E. 可复用性评估

### E.1 通用思路（任何移动端适配插件都该抄）

**激活与隔离（4 条）**

1. **设备判定 = 宽度 AND 指针类型**，且桌面隐藏块是它的**精确补集**（德摩根展开，不是 `NOT (A and B)`）。同时建立「**注入控件清单 ↔ 隐藏块**」的同步约定——这是 dispose 竞态的最后防线。
2. **单一 arm/disarm 脚手架** `installMobileEffect(ctx, label, install, query?)`。所有移动 effect 从这一处挂/摘，`matchMedia` 的 `change` 驱动，`cleanup?.()` 在 arm 开头与 disposer 都跑 → 宽窄往返免费正确。**绝不让各 effect 自己搭 matchMedia**。
3. **`ctx.effect(() => {...; return disposer}, label)` 无例外**：任何长生命周期资源（style 标签、listener、timer、observer、注入节点）都必须在里面，disposer 完整逆操作。
4. **桌面 no-op 的三层**：JS 层不 install → CSS 层补集隐藏 → 约定层清单同步。**只做前两层会漏**（slot 渲染的控件在任意宽度都存在）。

**DOM 协调（4 条）**

5. **DOM-free 纯核 + 薄浏览器适配器**：决策表（`classifySwipe` / `followTranslate` / `hitTestStart` / `detectIosWebKit`）与副作用分离 → 无 DOM 也能跑 `node --test`。**零 import 是让纯核既能被自研打包器内联、又能被 Node type-strip 直跑的最省事办法**。
6. **一个全树 MutationObserver + dirty-key 路由 + rAF 合并**，而不是每功能一个 observer。`scopes` 声明自己关心的属性名（或 `'*'`），只在交集的 flush 里跑；per-task `try/catch` 保证一个 task 抛错不影响其他。
7. **`ensure()` 幂等 + 搬运时刷新 origin + dispose 放回原处**（对 React 拥有的 DOM 做最小、可逆的改动）；**快路径 O(1) 复验已标记锚点**，失位才回落全树 hunt（流式期每个 token 都跑）。
8. **self-trigger 防护是硬要求**：诊断徽章 / task 的 `ensure()` 若观察或写入自己所在的子树，必须显式跳过自己的输出，否则页面硬冻结。

**选择器与样式（4 条）**

9. **哈希类一律 `[class*=]`，禁 `[class$=]`；前缀重叠必须 `:not` 排除；结构锚定优先于裸哈希；稳定 `data-*` 优先于一切**。
10. **反断言元素**：任何「压制/隐藏某类元素」的规则，回归断言必须同时确认**非目标元素仍然可见**——否则断言会断在 bug 本身。
11. **inline `setProperty(..., 'important')` + 断言看计算后几何**：inline `!important` 赢过任何外部规则，是对抗「第三方 CSS 注入在我们之后」的最后手段；而 `transform: none !important` 会让普通 inline 声明读回来对、computed 却是 `none`。
12. **`transform: none` 而非 `translateX(0)`** 用于「打开/静止」态，否则 identity transform 仍为 fixed 后代建立包含块。

**手势（4 条）**

13. **不劫持原生滚动的三件套**：8px 轴锁定（`|dx| > |dy|` 且过阈值）→ 垂直主导直接 reset 交还滚动；`touch-action: pan-y pinch-zoom`（**不含 `pan-x`**）；`touchmove` 的 `preventDefault({passive:false})` 只在「起点在识别区内且单指」时开。
14. **多指整体让位**：第二根手指落下即 abort，并保证不 preventDefault 多指 touchmove——否则 pinch 被取消，而 pinch 是 iOS 上唯一缩回浏览器自加缩放的手段。
15. **让位体系化**：把「谁拥有这笔笔画」写成一个**有序闸门函数**（cooldown / modal / takeover / 选区 / 拖动标记 / 悬浮窗 / 横滚容器），并明确「让位 ≠ 拦截」「一旦锁轴即承诺」。给第三方留**两个**接口：合作标记（`data-*-dragging`）+ 位置启发式（`fixed|absolute` 且 ≤N px，自己的子树除外）。
16. **两个独立的手势信号**（轴锁标志用于**同一事件内更早注册的** handler；消费标记用于**释放之后**的事件），因为它们在**不同时刻**回答不同问题。消费窗口要**短**（300ms）——iOS 壳会整体吞掉合成 click，长窗口会吃掉用户下一次真实 tap。

**视口与 iOS（3 条）**

17. **viewport meta 所有权 + 幂等重申**：`width=device-width, initial-scale=1, viewport-fit=cover`，多观察者（meta 属性 + head childList + 初值）汇入一个幂等 assert，重入护栏 + 相等短路；dispose 只在「还是我们的值」时还原。**写入永不带 `maximum-scale`/`user-scalable`**。
18. **safe-area 与 `box-sizing: border-box` 成对**；**fixed 元素（包含块是视口）必须自己吃 inset，且要按形态限定**（全屏 vs 停靠，否则双 padding）。
19. **iOS 缩放的正确修法是 16px 下限 + 保留 `pinch-zoom`**，不是 `maximum-scale=1`；引擎判定用**特征探针优先于 UA**（`CSS.supports('(font: -apple-system-body) and (-webkit-touch-callout: none)')`），UA 兜底要处理 iPadOS 13+ 的桌面 UA（`Macintosh` + `maxTouchPoints > 1`）。

**调试与验证（5 条）**

20. **「拦截事件」优先改成「屏蔽方法」**：`Object.defineProperty(el, 'focus', {...})` 影子方法 + 下一个 macrotask 还原，而不是 capture `stopPropagation`——后者会连带干掉宿主 handler 里**必须继续跑的** `preventDefault`。
21. **回归锚点探针 + 机读基线 `EXPECTED_FAILURES`**：让「已知不绿」也能当门禁；断言分 PASS/SKIP/FAIL，可选集成缺失记 SKIP；点击坐标全部来自 `getBoundingClientRect()`；统一 deadline 无长 sleep；`process.exitCode` 而非 `process.exit()`；`finally` 统一 teardown。
22. **命中测试断言**（`elementFromPoint`）而不是 DOM-only 断言——否则「渲染了但被盖住」全绿。
23. **debug 开关 + 设备信标**：`?xxx-debug=1` 徽章 + POST 到本机监听器（`no-cors` + 文本 body 是简单请求，无需预检）。对「看不到设备屏幕」的调试是决定性的。
24. **升级对账清单机读化**（`hash|marker` → `needle` → `owner` → `lazy`/`state`）+ 一个扫真实页面 DOM 与 `CSSRule` 的对账脚本。**先有清单，再谈兼容**。

### E.2 项目特有、可砍的复杂度

| # | 复杂度 | 为什么这个项目需要 | 自己的插件怎么办 |
|---|---|---|---|
| 1 | **`compat.css.ts` 930 行 / 319 个 `!important`** | 要同时兼容 dshmarket、dsh-web-ui-all、usage-stats、dsh-meme、agent-preset、dsh-file-viewer、git-graph、dsh-genui 共 8 个第三方包的 DOM | **整块砍掉**。没有这些第三方要兼容，这一块（约 1/3 的样式体量）不存在 |
| 2 | **`compat-contracts.json` 22 条哈希契约 + 对账探针 + runbook** | 只有当「宿主 + 多个第三方包的 CSS module 哈希都是你的选择器锚点」时才需要 | 若能用稳定 `data-*` 锚点活着，**砍掉机读层**，保留一份人读的 runbook 即可 |
| 3 | **双代/多代宿主并存兼容**：`ZKlsPq_` vs `h8S2Va_`（两代互斥开关）、`_itemIcon/_itemLabel` vs `_item_1nxmc_92`（两代菜单形状）、`textarea` 代 vs Lexical 代 composer、`[data-input-mirror]` 已删仍留兜底 | 插件要同时跑在多个宿主版本上（DSHA 还 vendored 了 2.1.x 代） | **只认当前宿主一代**，省掉双代读取 / 双代吞噬 / 「未知形状不猜文本」这些防御 |
| 4 | **第三方 shim 的对抗层**：`dismiss-shadow` 惰性影子元素、`body:has(...) [role="menu"] { z-index:1400 }` 抬层、确认卡必须挂 `body` 而非 frame | 为了绕开 `@linxin666/dsh-web-all` 的 `installMobileSidebarDismiss`（frame 捕获 click、无 `_rowActions` 豁免） | 若不与这个 shim 共存，**全部可删** |
| 5 | **`session-menu.ts` 的「按标题反查 session id + 组内位置消歧」** | 宿主会话行 DOM 不带 id，且菜单是 React 私有、无扩展 slot → 只能靠 `displayTitle` 匹配 + `_groupSection` 内同标题行序号 1:1 映射 + `workspaces.items` 的 `sessionIds` 归属 | 若能用 slot / 服务拿到 id（或走 `session-row-fiber.ts` 的 fiber 走查），**这套不需要** |
| 6 | **`src/compress.ts` 的进程级 `http.ServerResponse.prototype` patch** | 手机上长会话 `session.history` 是 MB 级 JSON（17MB → ~1MB） | **不要抄**。它作用于 DSH Web 进程内**所有**响应而不只是本插件路由，风险面远大于收益面 |
| 7 | **`session-row-fiber.ts` 的 fiber 走查**（60 hop 上限、`__reactFiber$` 前缀扫描、`node/session/summary/result` + `sessionId/id` 六键尝试、`isKnownId` 过滤而非形状启发） | 「WebKit 吞掉 tap 的 click」+「DOM 里没有 id」两个条件同时成立时的兜底 | **最后手段，能不用就不用**——它依赖 React 内部结构（`memoizedProps`/`return`），且必须靠「调用方认得这个 id」过滤（实测 hop 32 有个 `props.scope === 'session-maybe'` 的假阳性） |
| 8 | **三层 CSS 组织 + 逐字节 diff 验证的重构纪律**（`docs/specs/2026-08-16-css-code-organization-design.md`：「零行为变化、逐字节 diff 必须为空、分两步提交、独立可回退」） | 项目规模到 2333 行 CSS 时才划算 | 起步阶段单文件足够；**但 `base→layout→compat→misc` 的「顺序 load-bearing」意识要保留**（同特异度跨块踩踏是真实存在的坑） |
| 9 | **`installMobileEffect` 第 4 参 query 覆盖 + `TOUCH_QUERY` 全宽度豁免** | 为「大平板横屏要桌面布局但仍要删除会话」这一个产品决策付出的双套武装 + 双套隐藏块 | 若不需要这种豁免，**一套 query 就够** |
| 10 | **`lib/` 提交进仓库 + `git diff --exit-code lib` 新鲜度门** | 消费者 `npm install` 后不构建就要能跑 | 若走正常 npm 构建流程（`prepublishOnly`/`prepare`），可以 gitignore 掉 `lib` |
| 11 | **`docs-consistency.test.ts` 那类文档守卫**（65536 字节 session instruction budget、CJK 2/3 字滑窗模糊匹配、引用路径存在性） | 只在「AGENTS.md 是给 AI 会话的指令文件、且必须严格控制在 session budget 内」这个特定约束下必要 | 除非你也在维护一份 AI 指令文件，否则不需要 |
| 12 | **`data-mobile-nav-dismiss-shadow` / 长按开行菜单 / `open-files-panel.ts` 的「宿主 surface 优先、第三方 explorer 兜底」** | 都是「宿主缺少对应能力或触摸语义」的补丁 | 先确认自己的宿主是否有官方 slot / 服务；有就不用 |

### E.3 建议的最小可用骨架

如果目标是「写一个自己的移动端适配插件」，按这个顺序搭，每一步都对应上面的一条通用思路：

```
src/client/
  core/reconciler-core.ts        # 零 import 纯核：registry + scopes + rAF 合并 + per-task try/catch
  core/raf-scheduler.ts          # 20 行（可选，若已有 core 的 requestFrame 就不需要）
  effects/chrome.ts              # MOBILE_QUERY + DESKTOP_QUERY + installMobileEffect + findFrame/getFrame
                                 #   + 一个 MutationObserver 适配器（attributeFilter 显式列出）
  effects/<feature>.ts           # 每个 = 一个 ReconcilerTask 或一个 installMobileEffect
  styles/index.ts                # base → layout → misc 三段拼接（有第三方再加 compat，放 misc 前）
  styles/{base,layout,misc}.css.ts
  index.tsx                      # 只做编排：locale + style 注入 + install* 调用 + slot 注册
```

必须一开始就定下来的四件事（后面改成本极高）：

1. **`MOBILE_QUERY` 常量 + 桌面补集隐藏块 + 「注入控件清单 ↔ 隐藏块」同步约定**。
2. **marker 契约清单**（`data-<plugin>="frame" | "backdrop" | "fab" | ...`），写进 README 并当作跨模块状态契约——CSS 与 JS 读同一套标记，不互相 import。
3. **选择器纪律**：哈希一律 `[class*=]`；前缀重叠 `:not` 排除；结构锚定优先；反断言元素。
4. **纯决策函数单独导出**（无 DOM、无 import），配 `node --test`；再配一个 CDP 探针 + `EXPECTED_FAILURES` 基线 + `elementFromPoint` 命中断言。

**不该抄的三样**：`compress.ts` 的进程级 prototype patch、多代宿主并存的双套防御、第三方 shim 的对抗层。这三样占了仓库相当比例的体量，而它们解决的问题**只在这个项目的历史与生态里成立**。

---

## 附：本次分析的覆盖范围与未验证项

**已逐字精读**：`AGENTS.md`(全 221 行)、`cordis.patch.yml`、`package.json`、`tsconfig.client.json`、`.github/workflows/ci.yml`、`src/index.ts`、`src/compress.ts`、`scripts/build-client.mjs`、`src/client/index.tsx`、`core/reconciler-core.ts`、`core/raf-scheduler.ts`、`core/css-rules.ts`、`effects/phone-chrome.ts`、`effects/gesture-guard.ts`、`effects/overlay-backdrop-fab.ts`、`effects/composer-keyboard-guard.ts`、`effects/session-row-fiber.ts`、`effects/git-chip-reparent.ts`、`effects/stats-line.ts`(部分)、`effects/session-menu.ts`(前 180 行)、`effects/sidebar-swipe.ts`(常量/让位/锁轴/接线，约 700 行)、`components/MobileNavToggle.tsx`、`components/open-files-panel.ts`、`debug.ts`、`styles/index.ts`、`styles/misc.css.ts`(桌面块)、`styles/layout.css.ts`(头部)、`styles/base.css.ts`(头部)、4 个 `.css.ts` 的结构统计、`docs/upstream/compat-contracts.json`、`docs/upstream/upgrade-runbook.md`、`docs/specs/2026-08-16-css-code-organization-design.md`、`docs/specs/2026-08-18-cdp-regression-gate-design.md`、`docs/audits/2026-09-15-css-surface-audit.md`(前 80 行)、`docs/maintenance/pitfalls.md`(31 个 § 清单 + 若干全文)、`tests/host-parity.test.ts`、`tests/ios-zoom-guard.test.ts`(头部)、`tests/docs-consistency.test.ts`(前 70 行)。

**未逐行读完**：`effects/sidebar-swipe.ts` 的 endStroke 主体与 commit 细节（由子代理覆盖并交叉核对）、`effects/session-menu.ts` 后半（对话框实现）、`effects/aionui-compat.ts`、`effects/subagent-chip-touch.ts`、`effects/preview-fullscreen.ts`、`effects/settings-toolbar-reparent.ts`、`effects/file-viewer-compat.ts`、`src/delete-session.ts`、`src/client/i18n/locales.ts`、`compat.css.ts`/`layout.css.ts` 的逐条规则、`scripts/*.mjs` 探针源码（只读了设计文档与 AGENTS 描述）。

**两处与文档不一致的实测发现**（子代理核对源码得出，值得注意）：
- `findVerticalScroller` 这类 helper **不存在**——垂直方向让位纯靠 `tryLock` 的轴判定（`sidebar-swipe.ts:1107`）。
- 2026-09-13 spec 里提到的 `filesZonePxFor` **从未实现**，只有 `filesZoneHit`。

**本报告未修改目标仓库任何文件**；所有拉取内容位于 `research/dsh-web-mobile/`（只读镜像）。
