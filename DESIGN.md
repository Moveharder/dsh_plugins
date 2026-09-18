# dsh-pocket-ui 设计文档

> DSH Web UI 移动端适配插件 · 轻量核心版
>
> 参考项目：[mexiaosqwq/dsh-web-mobile](https://github.com/mexiaosqwq/dsh-web-mobile)（v2.4.1，已在其思路上重新设计实现）
>
> 目标宿主：`dsh 0.1.5-rc.1`（`@deepseek-ai/dsh-web-frontend`）

---

## 0. 一句话思路

**不重写 UI，只"驯化"宿主已有的 DOM。**

宿主是桌面优先的 React SPA：**它的外壳 CSS 完全没有响应式**（`dsh-web-frontend/dist` 的 shell 样式表里只有 3 条 `prefers-reduced-motion`，宽度断点 0 条，`safe-area-inset` 0 处，viewport meta 没有 `viewport-fit=cover`）。唯一的响应式能力是 JS 里的一个常量：

```js
const SIDEBAR_AUTO_COLLAPSE = 1024   // dsh-client-ui-layout
```

> 精确起见：少数**功能包**确实带窄屏规则（`ui-chat` 的 `(width<=480px)`、`ui-settings-models` 的 `(width<=560px)`、`ui-trajectory` 的 `(width<=760px)`、`ui-attachment` / `ui-deliverables` 的 `(pointer:coarse)`）。但外壳骨架（AppFrame / 侧栏 / 会话 / 输入区 / 设置弹窗）一条都没有——而那正是本插件要补的部分。

所以移动端适配只能由插件补全。而插件**不能**替换宿主的 React 组件树（`root` 槽位是单例，注册它会顶掉 `AppFrame`），只能：

1. 往宿主提供的**插槽**里塞自己的 React 组件（浮层、按钮）；
2. 用**注入的 CSS** 改写宿主元素的外观与布局；
3. 用**DOM 协调层**给宿主节点打标记、后处理，弥补纯 CSS 做不到的事。

这三件事构成了本插件的全部。

---

## 1. 宿主的真实契约（实测，非推测）

### 1.1 浏览器模块表只有 9 个模块

`factory(require)` 只能 require 这些，**其它 `@deepseek-ai/*` 一律抛错**：

```
react  react/jsx-runtime  react-dom  react-dom/client
@deepseek-ai/cordis  @deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots  @deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
```

→ **跨插件协作只能走 cordis 服务**（`ctx.get('slots')`），不能 value-import。
→ 因此本插件**不引入任何构建步骤**，`lib/client.js` 是手写纯 JS（与用户既有的 `dsh-whale-copilot` / `dsh-annual-activity` / `oh-my-dshtoken` 一致）。

### 1.2 稳定钩子排序

| 稳定性 | 钩子 | 说明 |
| --- | --- | --- |
| ★★★ | `[data-slot="<slotKey>"]` | renderer 给**每个** slot outlet 包一层 `<div data-slot=... style="display:contents">`。注意锚点是 `display:contents`，**不能给锚点本身设样式**，只能选它的子元素 |
| ★★★ | `[data-shell-overlay]` | `AppFrame` 的浮层容器，`position:absolute; inset:0; z-index:20; pointer-events:none`，子元素自动 `pointer-events:auto` |
| ★★★ | ARIA（`[role="dialog"][aria-modal="true"]`） | 语义稳定，跨构建不变 |
| ★★☆ | `data-sidebar-collapsed` / `data-rightbar-*` / `data-dragging` | AppFrame 上的状态属性 |
| ★☆☆ | class 名 | CSS-module 哈希，**每次宿主构建都会变**，禁止直接写 |

**结论：选择器策略 = 语义优先，哈希兜底。**
需要哈希时用**子串匹配**（`[class*="sidebarCol"]`）而不是全名，并且每个哈希选择器都必须有语义兜底或 `:has()` 守卫，否则宿主升级后会静默失效（dsh-web-mobile 的 94KB 踩坑文档里有一大半是这类）。

### 1.3 AppFrame 的真实结构

```jsx
<div ref={frameRef}
     class="pI_x6G_frame"                                  // display:grid; height:100%; position:relative; overflow:hidden
     style={{gridTemplateColumns: `${s}px minmax(0,1fr) ${r}px`}}   // ← 内联样式！覆盖必须 !important
     data-sidebar-collapsed data-rightbar-collapsed
     data-rightbar-fullscreen data-rightbar-instant data-dragging>
  <div class="pI_x6G_sidebarCol">{renderSlot('sidebar')}</div>       // grid 轨道 1
  <div class="pI_x6G_centerCol">…</div>                              // grid 轨道 2
  <div class="pI_x6G_rightbarCol">{renderSlot('rightbar')}</div>     // grid 轨道 3
  <div class="pI_x6G_overlayLayer" data-shell-overlay>{renderSlot('shell.overlay')}</div>  // z-index:20
</div>
```

三个关键事实：
- **`grid-template-columns` 是 React 内联样式** → 任何覆盖都要 `!important`。
- **侧栏就是第一个网格轨道** → 做抽屉 = 把轨道压成 0 + 把 `sidebarCol` 改成绝对定位滑出。
- **浮层容器 `z-index:20`** → 抽屉给它 `z-index:30` 就能盖在遮罩之上。

### 1.4 已有的设计令牌（覆写令牌 > 逐条打架）

```
--dsh-composer-side-clearance: 16px
--dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px)
--dsh-composer-text-max-height: 336px
--dsh-chat-content-width / --dsh-conversation-column-width
```

输入区的窄屏适配**优先覆写这些令牌**，而不是逐条改 `padding`/`max-width`。

### 1.5 设置面板结构（底部 sheet 的目标）

```jsx
<div class="VOzbGW_overlay" role="presentation">      // position:fixed; inset:0; flex; center; z-index:1000
  <div class="VOzbGW_mask" aria-hidden="true" onClick={onClose}/>
  <div class="VOzbGW_panel" role="dialog" aria-modal="true" aria-labelledby={id}>
    <nav class="VOzbGW_nav">…</nav>                    // width:188px; column
    <div class="VOzbGW_content">…</div>
  </div>
</div>
```

`role="presentation"` + `role="dialog" aria-modal` 是**语义钩子**，比 `VOzbGW_` 哈希稳定得多：

```css
[role="presentation"]:has(> [role="dialog"][aria-modal="true"])
```

---

## 2. 本插件架构

```
dsh-pocket-ui/
├── package.json          # bundle manifest（dsh.bundle + dsh.client）
├── cordis.patch.yml      # 插入一行插件
├── lib/
│   ├── index.js          # Host 半区：版本自读 + 在线更新三路由
│   └── client.js         # Client 半区：手写纯 JS，无构建
├── README.md
├── DESIGN.md             # 本文
└── LICENSE
```

### 2.1 为什么 Host 半区几乎为空

移动端适配是**纯客户端**的事。Host 半区只承担分发闭环必需的**在线更新**（用户手册 §4bis 的硬性约定）：版本自读 `package.json` + `/<前缀>/meta`、`check-update`、`upgrade` 三路由。这样插件装出去以后有修复通道。

### 2.2 Client 半区的模块划分（单文件内的分区）

`lib/client.js` 是单文件（bundle 必须自包含），但内部严格分区：

| 区 | 职责 |
| --- | --- |
| `CSS` | 全部样式字符串，按 `gate / frame / drawer / sheet / safe-area / composer / misc` 分段 |
| `core/gate` | 移动端判定 + `html[data-pocket]` 标记 + matchMedia 监听 |
| `core/reconciler` | rAF 节流的 MutationObserver，幂等地给宿主节点打标记 |
| `core/dom` | 宿主节点定位（`findFrame()` 等），全部集中在这里，宿主升级只改这一处 |
| `effects/*` | 每个适配点一个 `install*()` 函数，各自返回 disposer |
| `components/*` | 注册进 slot 的 React 组件（FAB、backdrop、设置行） |
| `settings` | localStorage 持久化 + `settings.general.item` 入口 |

---

## 3. 六个核心机制

### 3.1 门控：桌面端必须完全 no-op

```js
const MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'
```

- **`pointer: coarse` 是必须的**：只按宽度判定会让桌面窄窗口 / 系统显示缩放误启移动 UI（参考项目专门修过这个 bug）。
- 断点 `1023px` 与宿主 `SIDEBAR_AUTO_COLLAPSE = 1024` 对齐，避免两者打架。
- **JS 是门控的唯一事实源**：判定结果写到 `<html data-pocket="on|off">`，CSS 全部挂在 `html[data-pocket="on"]` 之下，不再写 `@media`。
  - 好处：调试覆盖（`?pocket=mobile` / `?pocket=off`）天然可用，不必把规则块复制两份。
  - matchMedia `change` + `resize` 都要监听：手机横竖屏切换、外接鼠标都要即时生效。

### 3.2 抽屉：把网格轨道变成滑出面板

```css
html[data-pocket="on"] [data-pocket-frame] {
  grid-template-columns: minmax(0, 1fr) 0 0 !important;   /* 压掉侧栏与右栏轨道 */
}
html[data-pocket="on"] [data-pocket-sidebar] {
  position: absolute;
  top: 0; bottom: 0;
  left: calc(-1 * var(--pocket-drawer-w));                 /* 不是 transform，见 §8.1 */
  width: var(--pocket-drawer-w);
  transition: left .25s var(--ds-ease-in-out);
  z-index: 30;                                            /* > overlay layer 的 20 */
}
html[data-pocket="on"][data-pocket-drawer="open"] [data-pocket-sidebar] { left: 0; }
```

**为什么用 `position:absolute` 而不是 `fixed`**：`fixed` 的包含块是视口，一旦祖先出现 `transform`/`filter`/`contain` 就会被改写并遭 `overflow:hidden` 裁剪；`absolute` 相对 `position:relative` 的 frame 定位，frame 就是整屏，行为确定。这也是用户手册踩坑 #10 的正确解法（该处结论"用 portal"对**浮层**成立，对**需要复用宿主内容的抽屉**不适用——抽屉必须就地改造宿主节点）。

配套三件事：
- **遮罩 + 悬浮按钮**注册进 `shell.overlay`（React 组件，`pointer-events` 由宿主的 `.overlayLayer>*` 规则自动开启），遮罩 `z-index:20` 天然位于抽屉之下。
- **收起只有一个权威入口**：宿主自带的 `aria-label="收起侧边栏"` 按钮。我们不拦截面板内的任何点击，只通过 `syncDrawerWithHost()` 采纳宿主自己折叠侧栏的结果（§8.9）。遮罩点击关闭仍然保留——它在面板**外面**，是移动端通用的"点外部关闭"手势。
- **`prefers-reduced-motion` 时禁用过渡**。

### 3.3 底部 sheet：靠 ARIA 语义而不是哈希

```css
html[data-pocket="on"] [role="presentation"]:has(> [role="dialog"][aria-modal="true"]) {
  align-items: flex-end !important;                      /* 从居中改为贴底 */
}
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] {
  width: 100% !important; max-width: 100% !important;
  height: auto !important; max-height: 88vh !important;
  border-radius: 20px 20px 0 0 !important;
  flex-direction: column !important;
}
/* 左侧竖排导航 → 顶部横向滚动 */
html[data-pocket="on"] [role="dialog"][aria-modal="true"] > nav {
  width: 100% !important; flex-direction: row !important;
  overflow-x: auto; gap: 4px; padding: 8px 12px 0 !important;
}
```

宿主升级时 `VOzbGW_` 哈希会变，但 `role`/`aria-modal` 不会。

### 3.4 安全区

- 插件负责把 viewport meta 补成 `viewport-fit=cover`（宿主只有 `width=device-width, initial-scale=1`）。
- **必须守住**：宿主在运行时会改写 viewport meta（参考项目专门修过"宿主改写后刘海适配失效"），用 MutationObserver 监听 `<head>` 并在被改写后重新补上，同时**保留宿主设置的 `maximum-scale`**，不改变官方缩放行为。
- 暴露 `--pocket-safe-top/bottom/left/right` 变量，应用到侧栏顶部、抽屉底部、composer 底部、sheet 底部。

### 3.5 输入区适配

- 覆写令牌：`--dsh-composer-side-clearance: 12px`。
- 窄屏下模型选择器 `.uV2eYG_select{max-width:220px}` 收窄，避免与发送键重叠。
- 会话头 `padding:10px 28px 0 20px` 收紧；标签页 `gap:36px` 改为可横向滚动。
- 输入框字号 ≥16px，避免 iOS 聚焦时强制放大且无法恢复（参考项目 #45 / #35 的教训）。

### 3.6 协调层（reconciler）

纯 CSS 做不到的三件事交给它：
1. 给 frame 打 `data-pocket-frame`、给 sidebarCol 打 `data-pocket-sidebar`（CSS 需要稳定的自定义属性，而宿主不提供）；
2. 补 viewport meta、守 head 变更；
3. 抽屉状态与 DOM 同步。

实现纪律：
- **rAF 节流**：流式输出会洪水般触发 MutationObserver，必须合并到每帧一次；
- **幂等**：只处理未打标记的节点，重复扫描零成本；
- **卸载干净**：disposer 里移除所有自己打的标记与属性，绝不留下痕迹（否则插件卸载后宿主 DOM 带残留标记）。

---

## 4. 与 dsh-web-mobile 的关系

本插件**内置互斥检测**：启动时若发现 `dsh-web-mobile` 的样式表（`style[data-plugin="dsh-web-mobile"]`）或它的 frame 标记存在，则**整体让位**——不注入样式、不注册组件，只在控制台打印一条说明。

理由：两套移动端规则会抢同一批 DOM，产生的问题极难归因。让位是廉价的防御，避免"两个都装"这种最难查的状态。

> 部署上按用户决定：**移除 `dsh-web-mobile`，由 `dsh-pocket-ui` 全量接管**。互斥检测只作为防止未来误装的安全网。

---

## 5. 明确不做的（轻量核心版的边界）

参考项目为兼容 N 个第三方插件付出了绝大部分复杂度，这些**第一版全部砍掉**：

| 不做 | 原因 |
| --- | --- |
| 侧栏滑动手势（72KB 源码） | 需要处理让位规则、原生滚动冲突、Chrome 边缘返回手势、选词劫持……投入产出比低，先靠按钮 |
| 大 JSON 响应 gzip/brotli 压缩 | 属于 Host 半区优化，与"移动端 UI 适配"不是一件事，可后续独立加 |
| 会话删除 / 会话行菜单 | 依赖宿主会话列表的具体渲染方式，是功能增强不是适配 |
| dshmarket / dsh-file-viewer / dsh-genui 等第三方插件兼容 | 每兼容一个都要跟着对方版本走，属于长期维护负担 |
| CDP 回归探针矩阵（17 个脚本） | 第一版用少量冒烟断言 + 人工截图验证，稳定后再补 |

**第一版交付的适配点**：门控、侧栏抽屉、底部 sheet、安全区、输入区、桌面 no-op、设置入口、调试开关。

---

## 6. 验证策略

宿主是 SPA，无法用静态 HTML 断言；且 `pointer: coarse` 门控在桌面浏览器上不会命中。因此验证走 **CDP 设备模拟**：

1. 起一个**临时第二实例**（不同端口），不影响用户当前会话；
2. 用 CDP `Emulation.setDeviceMetricsOverride`（390×844、`mobile:true`）+ `Emulation.setTouchEmulationEnabled` 让 `pointer: coarse` 命中；
3. 断言：`html[data-pocket]` 为 `on`、样式表已注入、frame 已打标记、抽屉开合后 `transform` 生效、设置面板贴底；
4. 切回桌面视口断言**完全 no-op**（无样式表、无标记、无自定义属性残留）；
5. 截图人工确认。

---

## 7. 宿主升级时的对账清单

宿主每次升级只需要检查这几处（全部集中在 `core/dom` 与 CSS 选择器）：

- [ ] `[data-shell-overlay]` 是否仍存在，且仍是 frame 的直接子元素
- [ ] frame 的 `grid-template-columns` 是否仍是内联样式
- [ ] `sidebarCol` 是否仍是 frame 的第一个 `div` 子元素
- [ ] 设置面板是否仍是 `[role="presentation"] > [role="dialog"][aria-modal="true"]`
- [ ] `--dsh-composer-side-clearance` 等令牌是否仍存在
- [ ] `SIDEBAR_AUTO_COLLAPSE` 是否仍是 1024（决定我们的断点）

---

## 8. 实现阶段被真实验证推翻的判断

设计时的推断有三处被 CDP 探针证伪。记录下来，因为它们都属于「静态读代码推不出来」的那一类。

### 8.1 抽屉不能用 `transform` 滑入（最严重）

设计初稿用 `transform: translateX(-100%) → translateX(0)` 做抽屉动画，这是最自然的写法。探针实测：**设置 sheet 宽度 319px，而视口是 390px**。

根因：设置对话框**不是 portal**——`dsh-client-ui-settings-general` 里 `createPortal` 出现 0 次，对话框内联渲染在**侧栏子树**里，而它的 overlay 是 `position: fixed; inset: 0`。给抽屉加 `transform`（**以及 `will-change: transform`**）会让抽屉成为 fixed 后代的包含块，于是整个对话框被困在 320px 的抽屉盒里，而不是铺满视口。

对策：改用 `left: calc(-1 * var(--pocket-drawer-w)) → left: 0` 动画。代价是每帧一次布局（没有手势跟随，250ms 动画可接受），收益是包含块留在视口，宿主所有 fixed 浮层的假设继续成立。

> 这条已固化成冒烟断言 `the drawer never becomes a containing block for fixed descendants`，
> 断言抽屉规则里既无 `transform:` 也无 `will-change`。

### 8.2 `data-pocket-drawer` 属性曾整个漏写

重写时把抽屉状态搬进 store，却忘了写 `html[data-pocket-drawer]`。CSS 的门控信号断了，于是：**React 状态正确、遮罩正确渲染、抽屉纹丝不动**。

探针抓到了它，而且抓得很准——它同时暴露了另一个测试设计问题：紧接着的「点遮罩关闭抽屉」断言**空过**了（属性本来就是 null）。对策是加一条前置断言「点击前抽屉确实是开着的」，专门防这种空过。

### 8.3 设置面板的导航有两层，只改一层不够

`nav` 是对话框的直接子元素，但它自己有两个孩子：标题和列表。把 `nav` 改成 `flex-direction: row` 之后，标题跑到左边、**列表仍然是竖排**，把整个 sheet 撑满。

对策：`nav` 与 `nav > *` 都要转成 row。列表没有语义钩子、类名是内容哈希，所以用结构选择器（子组合器 + 通配）定位——这是全项目唯一一处结构性而非语义性的选择器，已在注释里说明理由。

### 8.4 一个自己踩了两次的坑：CSS 注释里的反引号

样式表是模板字符串。在注释里写 `` `left` `` 这样的反引号会**终止字符串**，整个 bundle 变成语法错误，表现为「页面完全没有 UI」而不是任何有用的报错。参考项目的 94KB 踩坑文档里明确警告过，我仍然踩了两次（累计三次）。已固化成冒烟断言。

### 8.5 路由没有随插件卸载回收（v0.1.0 线上缺陷）

**症状**：在插件市场里关掉再启用，报
`failed to apply loader entry mkt-pocket-ui (dsh-pocket-ui): webserver: duplicate prefix route "/pocket"`。

**根因**：`webServer.register()` 是**服务方法**，不是 `ctx` 方法。它返回 disposer，但**框架不会替你跟踪**——只有 `ctx.on` / `ctx.tools.register` / `ctx.effect` 这些 `ctx` 方法才进 fiber 的清理表。我直接调用并丢弃了返回值，于是：

1. 首次挂载注册路由 ✓
2. 停用 → fiber 销毁 → **路由仍在表里** ✗
3. 重新启用 → `register` 撞上重复路径直接抛错 ✗

**对策**：`ctx.effect(() => ctx.webServer.register({...}), label)`。参考项目正是这么写的。

**顺带查出的同类问题**：`ctx.setInterval` 同样不该用。它由 timer 服务 `ctx.mixin` 混入，而 mixin 的 proxy 让 service 自身的属性优先——`this.ctx` 解析到的是**定时器服务自己的 context**，不是调用方的，所以定时器会活过插件卸载。核心包的房规是**裸 `setInterval` 包在 `ctx.effect` 里并返回 `clearInterval`**（见 `dsh-client-hmr`）。两处都已按此改，并从 `inject` 移除了不再需要的 `timer`。

> 这两条对**任何** DSH 插件都成立，不只是本插件。

### 8.6 底部 sheet 无法滚动（v0.1.0 线上缺陷）

**症状**：设置弹框能打开、位置也对，但**内容滚不动**，下半截设置项永远看不到。

**根因**：把面板从宿主的 `flex-direction: row` 改成 `column` 时，**自动最小尺寸的适用轴也跟着换了**。宿主的内容列带 `flex:1; min-width:0`——在 row 布局下这是对的；但变成 column 后起约束作用的是 `min-height`，而它的默认值 `auto` **拒绝收缩到内容高度以下**。于是内容列长到完整高度、撑破面板的 `max-height`，被面板的 `overflow:hidden` 裁掉，内层滚动容器永远拿不到受限高度，也就永远不滚动。

A/B 实测（把修复退回 `min-height: auto`）的诊断输出直接指向根因：

```
VOzbGW_content  scrollHeight: 860, clientHeight: 860
```

两者相等 = 内容列没被约束。修复后 `scrollHeight > clientHeight` 且实际滚动生效。

**对策**：给内容列（`nav + *`）及其子元素补 `min-height: 0`。同时把 `max-height: 88vh` 升级为 `88vh` + `88dvh` 双写——`vh` 按最大视口计算，移动端地址栏出现时 sheet 会伸到可视区之外。

**教训（通用）**：**翻转 flex 方向时，`min-width` 与 `min-height` 必须成对考虑**。宿主的样式只保证了原方向那一半。

### 8.7 一条"永远不会触发"的守卫

`smoke-client.js` 里那条"CSS 注释禁止反引号"的断言，最初排在 `new Function(source)` **之后**。而反引号导致的正是语法错误——`new Function` 先抛，断言永远没机会跑。它看起来像防护，实际是死代码。

已移到文件最前面（`0. source-level guards`），并写明理由。**守卫必须放在它要保护的操作之前，否则等于没有。**

### 8.8 作用域规则一刀切，把设置行变成了裸 HTML（v0.1.1 线上缺陷）

**症状**：设置页里本插件的状态行**移动端很好看，桌面端很丑**——标题、说明、按钮各占一行，没有内边距、没有分隔线，说明文字 14px 而邻行 12px。

**根因**：我在"加固"阶段把**所有**规则都锁进了 `html[data-pocket="on"]`，包括 `.pocket-row*`。这对"改写宿主"的规则是对的，但 `settings.general.item` 是**宿主在任何宽度都会渲染**的槽位——门控关掉后，我的行就退化成无样式的裸 HTML。桌面端不是"没有副作用"，而是"该有的样式也没了"。

CDP 实测对比：

| | 官方行 | 我的行（未修复） |
| --- | --- | --- |
| `padding` | `16px 0` | `0px` |
| `border-bottom` | `.5px solid var(--dsw-alias-border-l2)` | `0px none` |
| 说明文字 | `12px / 18px` | `14px / normal` |

**对策**：区分两类规则，并把这条区分写成不变量：

> **改写宿主的规则要门控；渲染在两种模式下的自有组件不要门控。**

`.pocket-fab` / `.pocket-backdrop` 只在移动模式渲染（组件本身 `return null`），门控是双保险；`.pocket-row*` 必须不门控。

顺带把行的度量**照抄宿主**（`.5px solid var(--dsw-alias-border-l2)`、`16px 0`、文本列 `padding-right: 48px`、标题 14/22、说明 12/18），而不是沿用我原先自拟的 `10px 0` / `12px` gap。分隔线由宿主的 `GeneralSection` 统一处理（它用 `> :last-child { border-bottom: none }` 去掉最后一行），所以我的行不用自己加。

**断言写法**：CDP 探针**不硬编码数值，而是拿我的行和邻行比**——`padding`、`gap`、说明字号、标题行高必须一致。这样断言的是"看起来属于这个列表"这个真实需求，宿主将来改自己的行距也不会误报。

---

### 8.9 点面板里任何地方都会收起抽屉（v0.1.2 线上缺陷）

**症状**：移动端展开工作区面板后，**点面板里几乎任何位置都会把面板收起来**，面板实际上是只读的，完全没法操作。

**根因**：我在 sidebar 上挂了一个**捕获阶段**的点击监听器，用一张宽泛的"可交互元素"选择器猜"用户点完了该收起来了"：

```js
const ACTIVATE_SELECTOR = 'a[href], button, [role="button"], [role="option"], [role="treeitem"], [role="menuitem"]'
if (target.closest(ACTIVATE_SELECTOR)) setDrawerOpen(false)
```

而工作区面板**本身就是一棵 `[role="treeitem"]` 的行树**（会话行、工作区分组、文件夹行全是），所以用户的每一次点击都命中——"点哪儿都关"不是夸张，是字面事实。

**那个排除列表才是真正的信号**。我当时已经发现"展开/折叠按钮和 kebab 菜单不该关抽屉"，于是又加了一张 `KEEP_OPEN_SELECTOR` 例外表。**一条需要不断追加例外的规则，就是错的规则**——例外表在增长，说明抽象选错了，而不是选得不够细。

CDP 实测（修复前）：

| 点击位置 | `data-pocket-drawer` |
| --- | --- |
| 面板内的一行会话（`[role=treeitem]`） | `null`（被关掉） |
| 面板内 8px 的非交互空隙 | `open`（保持） |

也就是说：**凡是用户真会碰到的像素，都会关**。

**顺带暴露的第二个缺陷**：捕获监听器比宿主按钮自己的 `onClick` 先跑，那一刻宿主**还没折叠**，于是 `hostSidebarCollapsed()` 为 false → 我们调 `layout.toggleSidebar()` 折叠 → 宿主按钮自己的处理器紧接着又 toggle 一次 → **折叠被撤销**。实测 `collapsed attr after = false`：抽屉滑走了，宿主却仍是展开态，那个按钮看起来像坏了。

**对策**：整条启发式删掉，不猜。收起的权威入口就是宿主自带的 `aria-label="收起侧边栏"` 按钮——宿主折叠侧栏，我们通过 `syncDrawerWithHost()` **采纳**这个结果：

```js
function syncDrawerWithHost() {
    if (!drawerStore.get()) { awaitingExpand = false; return }
    if (!hostSidebarCollapsed()) { awaitingExpand = false; return }
    if (awaitingExpand) return          // 是我们自己请求的展开还没落地
    setDrawerOpen(false)
}
```

`awaitingExpand` 是必需的：打开抽屉时我们**请求**宿主展开侧栏，在这个请求落地前宿主本来就还是折叠态——若不区分，这次"折叠"会被误判成用户收起，抽屉会在打开后立刻自己弹回去。

关闭路径只有一条守卫，覆盖所有调用方（遮罩 / Esc / 采纳宿主）：

```js
if (!hostSidebarCollapsed()) toggleHostSidebar()
```

宿主已经折叠了就不再 toggle，所以不需要给 `setDrawerOpen` 加一个"这是采纳"的模式参数。我一度加了 `adopt` 标志，实测证明**它不可能改变任何行为**（走到采纳分支时 `hostSidebarCollapsed()` 必然为真），于是删掉——**看起来承重、实际不承重的机关，比没有机关更糟**。

**A/B 证据**（两条断言都确认能红）：

| 退回的改动 | 断言 | 结果 |
| --- | --- | --- |
| 重新装上捕获监听器 | `tapping a session row inside the drawer leaves it open` | `expected "open", got null` |
| 注释掉 `syncDrawerWithHost()` | `the host 收起侧边栏 button closes the drawer` | `expected null, got "open"` |

**没被推翻但值得记一笔的误判**：用户最初怀疑是遮罩盖住了面板。探针在面板内取三点做 `elementFromPoint`，全部命中面板自身内容（`isBackdrop: false`），遮罩在 `z-index:20`、抽屉 `30`，层叠本来就是对的。**先量再改**——如果照着这个猜测去调遮罩的 `z-index`，真正的监听器会原封不动地留着。

---

## 9. 验证结果

| 层 | 工具 | 结果 |
| --- | --- | --- |
| Client bundle 契约 + 样式表不变量 | `scripts/smoke-client.js` | **22/22** |
| Host 路由 + 在线升级全链路（离线） | `scripts/smoke-host.js` | **14/14** |
| 真实 DOM / 几何 / 层叠 / 命中测试 / 滚动 / 行度量 | `scripts/verify-cdp.mjs` | **60/60** |

§8.5、§8.6、§8.8、§8.9 四个线上缺陷都补了**能失败的**回归断言，不是事后描述：

- `unload releases the route so a hot remount works` —— 让 fake `webServer` 像真的一样在重复注册时抛错，然后模拟卸载再挂载。修复前必红。
- `settings content is scrollable` —— 在真实浏览器里**执行一次滚动**并断言 `scrollTop` 变化；找不到可滚动后代时打印最高后代的 `scrollHeight/clientHeight` 供定位。已用 A/B 确认退回修复必红（见 §8.6）。
- `settings row padding matches its neighbours`（桌面端）—— 与邻行比对而非硬编码，见 §8.8。
- `tapping a session row inside the drawer leaves it open` + `the host 收起侧边栏 button closes the drawer` —— 一条断言"面板内点击不得关闭"，一条断言"宿主按钮必须关闭"。两条都已用 A/B 确认退回修复必红（见 §8.9）。源码级守卫 `nothing closes the drawer on a click inside the panel` 直接禁止再出现 `addEventListener('click', …)`，同样验证过会红。

CDP 探针覆盖三种视口：移动端 390×844（触摸模拟）、窄桌面 900×800、桌面 1280×800。桌面两种宽度都断言了零地标残留、零注入控件、宿主网格未被改动。

> headless Chrome 没有任何指针设备，三个 `(pointer: …)` 查询全为 false；必须用
> `Emulation.setTouchEmulationEnabled` 才能让 `(pointer: coarse)` 命中，
> `Emulation.setEmulatedMedia` 对指针特征静默无效。
