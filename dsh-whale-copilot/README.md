# 🐳 DSWhale Copilot — dsh-whale-copilot

[![npm version](https://img.shields.io/npm/v/dsh-whale-copilot?color=blue)](https://www.npmjs.com/package/dsh-whale-copilot) [![GitHub](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/Moveharder/dsh_plugins)

一条由 DSH 事件驱动的 DeepSeek 蓝白小鲸鱼宠物，运行在 DSH Web 界面底部。
它会随 agent 会话状态游泳、起伏、跳跃、间歇喷水：思考（reasoning-delta）时间歇喷水、
回复时摇尾、执行工具时冒泡，**游动模式下还会时不时探出水面，露出的背部连喷几次水再潜回去**、
**需要审批时暂停移动并喷水抖动（头顶亮灯 + 红色角标，且回到最左侧，不遮挡审批按钮）**、
**agent 向你提问（ask_user_question 工具）时同样暂停移动并抖动提醒（琥珀色喷水 + 橙色角标）**，
任务完成时跃出水面。
点击鲸鱼本体可展开/收起会话状态面板（**面板出现位置跟随鲸鱼当前位置，自动考虑左右与上下安全区**；
实时会话列表 + 最近动态 + 大小/上下位置/**气泡距鲸鱼顶部距离**/透明度/**主题（深/浅色）**/
**游动 / 静态（拖拽摆放）模式**/**海洋背景开关**/**提醒方式**设置；
海洋背景高度随鲸鱼大小与气泡位置自适应；面板头部带 **⟳ 检测更新**按钮，可随时手动检查新版本）。
审批、提问、任务完成发生时，可开启**全浏览器醒目提醒**：页缘闪屏 + 系统级原生通知 + 浏览器标签栏闪烁。

## 这是什么

一个**正式安装的 DSH 插件包**（npm 包，双面插件）：

- **Host 半区**（`lib/index.js`）：监听 `session/event`（含**提问事件**：`ask_user_question`
  工具调用即视为提问，等待用户回答）、`agent/*`、`approval/request`、
  `subagent/*`、`workflow/*`、`goal/changed` 等事件，聚合会话状态与有界事件日志，
  并**监听 `session/title` 事件实时刷新会话标题**（标题是异步生成的），
  通过 `webServer` 注册 `/whale/pull`、`/whale/hello` HTTP 路由供浏览器轮询。
- **Client 半区**（`lib/client.js`）：浏览器 bundle（`window.__ModuleLoader__.load`
  格式，与官方 `dsh-client-*` 包一致），通过 `dsh.client: { platform: 'web' }` 声明，
  由 `@deepseek-ai/dsh-client-modules` 自动注入 `window.__DSH_BOOT__` 并服务
  `/plugins/<包名>/client.js`。

## 安装

**装完即激活**——一条命令（需 pnpm）：

```powershell
dsh plugin --profile web add dsh-whale-copilot
dsh web
```

`dsh plugin add` 把包装进 `~/.dsh/profiles/web/`，并因包声明了 `dsh.bundle.patch`
而自动写入 `dsh.profile.bundles`；`dsh web` 启动时自动挂载 host 半区并注入浏览器半区，
无需手动改任何文件。

### 无 pnpm 的手动安装（本机开发）

```powershell
# 1) 把包放入 web profile 的 node_modules（hoisted 存储）
Copy-Item -Recurse dsh-whale-copilot "$env:USERPROFILE\.dsh\profiles\web\node_modules\"

# 2) 在 ~/.dsh/profiles/web/package.json 里声明依赖 + bundle 层：
#    "dependencies": { "dsh-whale-copilot": "^1.1.0" },
#    "dsh": { "profile": { "bundles": [..., "dsh-whale-copilot"] } }

# 3) 重启
dsh web
```

> Windows 本机开发也可运行 `install-local.ps1`（等价的手动安装，直接 insert 行方式）。

## 疑难排查

### `add` 装到了旧版本（如 1.0.1 而非 1.1.0）

npm 上 `latest` 已是新版本，但 `dsh plugin add` 仍装旧版——通常是 profile 目录里
已有的 `pnpm-lock.yaml` / `dependencies` 锁定了旧版本所致（此前装过旧版）。

解决：显式指定版本重装。

```powershell
dsh plugin --profile web add dsh-whale-copilot@<版本>
# 例如：dsh plugin --profile web add dsh-whale-copilot@1.1.0
```

若仍报 `No matching version`（pnpm 元数据缓存未刷新），加 `--prefer-online`，或先
`remove` 再 `add`：

```powershell
dsh plugin --profile web add dsh-whale-copilot@1.1.0 --prefer-online
# 或
dsh plugin --profile web remove dsh-whale-copilot
dsh plugin --profile web add dsh-whale-copilot@1.1.0
```

验证实际装到的版本：

```powershell
node -p "require(process.env.HOME + '/.dsh/profiles/web/node_modules/dsh-whale-copilot/package.json').version"
```

并确认 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 已包含
`dsh-whale-copilot`（装完即激活的关键）。

## 随时开关

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，重启 dsh：

```yaml
- id: whale
  disabled: true        # 关闭
# disabled: false       # 重新开启（或删除该条目）
```

彻底卸载：`dsh plugin --profile web remove dsh-whale-copilot`（或手动删除 `dsh-whale-copilot` 依赖、`dsh.profile.bundles` 里的条目与 node_modules 目录）。

## 面板设置

点击鲸鱼打开面板 → 右上角 ⚙ 进入设置：

| 设置 | 范围 | 默认 | 说明 |
| --- | --- | --- | --- |
| 主题 | 深色 / 浅色 | 深色 | 状态面板配色（浅色模式下文字/边框自动切换为深色系） |
| 模式 | 游动 / 静态 | 游动 | 游动：底部左右循环巡游；静态：停在原地，鼠标拖拽摆放到页面任意位置（位置自动记忆） |
| 大小 | 50% – 130% | 85% | 鲸鱼整体缩放（气泡与海洋高度随之自适应） |
| 上下位置 | 上浮 20px – 下沉 22px | 下沉 8px | 距底部距离（仅游动模式显示；静态模式下位置由拖拽决定） |
| 气泡距离 | 顶部+0 – 160px | 顶部+18px | **气泡距鲸鱼顶部（背部最高点）的相对间距**——调整鲸鱼大小时气泡始终贴着头顶走，不会脱节 |
| 透明度 | 0% – 100% | 100% | 鲸鱼本体透明度（气泡与审批角标不受影响，角标始终醒目） |
| 海洋背景 | 显示 / 隐藏 | 显示 | 是否渲染底部海洋背景（水面波浪 + 气泡）；隐藏后鲸鱼悬浮在页面上 |
| 提醒 | 闪屏 / 系统通知 / 标签闪烁 | 全开 | 审批、提问、任务完成时的全浏览器醒目提醒开关 |

> **海洋背景高度是动态的**：按「鲸鱼可视高度 + 气泡相对间距 + 气泡盒体与水面波浪带的安全余量」
> 实时计算，放大鲸鱼或调高气泡后海洋会跟着变高，保证气泡始终完整呈现在水面之内。
>
> 点击区域：只响应鲸鱼本体轮廓（SVG 实际绘制的部分），周围的透明区域不会触发点击；
> 点击鲸鱼本体即可在「展开面板 / 收起面板」之间切换。静态模式下轻微拖动（<5px）仍视为点击，
> 拖过阈值才判定为摆放。
>
> **面板位置跟随鲸鱼**：面板在展开瞬间位于鲸鱼当前位置附近并水平居中，靠近屏幕左右边缘时自动夹紧，
> 不会超出视口；窗口尺寸变化时也会重新夹紧。静态模式下按鲸鱼所在高度自动选择展开方向：
> 鲸鱼在上半屏（或上方空间不足）时面板改到鲸鱼下方，否则放在鲸鱼上方；
> 展开时为视口上下各留安全边距、并按剩余空间动态限制面板最大高度——
> 贴近顶部/底部时面板依然完整可见（放不下会自动换边，仍放不下则压缩高度靠内部滚动），不会遮挡鲸鱼。
>
> **静态模式拖拽边界**：按鲸鱼「可视轮廓」计算——左右各留约一半于旧版的安全距离（小尺寸也能贴边摆放），
> 下方留 20px 安全区，保证起伏/庆祝动画时鲸鱼始终完整显示。

设置保存在浏览器 `localStorage`（键 `dsh-whale-copilot:settings`，兼容旧键 `dsh-whale:settings`），
带 schema 版本标记（`v: 2`）：旧版本的「气泡距离」（距容器底部的固定像素）与新语义不可换算，
升级后该项一次性重置为新默认值，其余设置全部保留。刷新页面 / 下次启动自动按上次的值初始化；
点「恢复默认」可回到默认值。

## 游动 / 静态模式

- **游动模式（默认）**：鲸鱼沿底部左右循环巡游，并保留全部动态行为（起伏、跳跃、间歇喷水、探出水面等）。
- **静态模式**：鲸鱼不再自动移动，用鼠标按住鲸鱼本体即可拖到页面任意位置松手放置；
  位置持久化保存，刷新后原地出现。审批/提问的抖动与喷水提醒照常播放（只是不再回到最左侧——
  你摆哪儿它就在哪儿提醒）。切回游动模式时，鲸鱼从当前停留处继续巡游。

### 探出水面喷水（游动模式专属彩蛋）

游动时每隔 24–50 秒随机触发一次：鲸鱼缓缓上浮、把背部露出水面（眼睛和喷水口在水线之上，
尾巴仍在水下），连喷 3 次水后再潜回去，整个过程约 8.6 秒。调度上做了全局避让：
正在思考/回复的常规动作、审批/提问冻结期间都不会触发；喷水过程中收到审批/提问会立即取消上浮，
优先保证提醒动画正确，不会出现姿态叠加异常。静态模式下不触发（都离开水面了还探什么）。

## 版本与在线升级

面板头部提供 **⟳ 检测更新**按钮（检查期间旋转、防重复点击），点击即向 Host 手动发起一次版本检查，
结果通过鲸鱼气泡即时反馈（「已是最新～」/「发现新版本 vX.Y.Z！可在设置里升级」），
同时刷新设置页顶部的版本状态徽标。

设置面板顶部第一行显示**当前版本号**与更新状态：

- 除手动检测外，Host 半区也会自动向 npm 官方仓库（`registry.npmjs.org`）检查最新版本
  （启动时 + 每 6 小时各一次；离线/未发布时静默降级，不影响任何功能；手动与自动检查共享并发去重）；
- 发现新版本时显示 `发现新版本 vX.Y.Z` + 「立即升级」按钮，点击后 Host 在**插件的安装目录**（web profile，自动定位）内执行 `pnpm add dsh-whale-copilot@<最新版>`（pnpm 不可用时退化为 npm）原地升级；
- 升级完成后提示「重启 dsh web 后生效」——重启后新版本自动生效，无需手动改任何文件；
- 自动升级失败时给出原因；此时可手动执行：

```powershell
dsh plugin --profile web add dsh-whale-copilot@latest
```

> 说明：升级只是替换已安装的 npm 包内容，不会卸载本插件，因此升级过程中当前运行的宿主不会中断；版本检查与升级接口都只挂在本地回环 Web 面（`/whale/*`），不参与审批等敏感流程。

## 审批提示

Host 半区通过 `approval/request` 瀑布事件观察权限审批：先记录状态、把事件投递给浏览器，
再 `await next()` 继续真实审批链（**观察式，不劫持审批**）。

当收到审批请求时，鲸鱼会：**回到最左侧停住（避免遮挡页面中部/右侧的审批操作按钮）→ 持续喷水 + 左右抖动 → 头顶红色角标显示待审批数量**，
气泡显示「需要审批！」；批准后跃起庆祝，拒绝后垂眼懊恼。审批期间，会话状态面板中该会话显示「待审批」。

> 游动与朝向由同一状态驱动（JS 统一控制位移 + 头部朝向，不再使用两条独立 CSS 动画）。
> 审批时位移与朝向一并完全冻结，审批结束后从左侧重新开始巡航，
> 不会再出现「身体掉头了、头部方向没跟上」的失步问题。

## 提问提示

Host 半区通过 `session/event` 监听 **`ask_user_question` 工具调用**即视为提问事件
（按 `callId` 与 `tool/result` 配对，等待用户回答期间保持提问状态；回合结束也会兜底解除）。
与审批同理，提问时鲸鱼**回到最左侧停住 → 持续喷水（琥珀色）+ 左右抖动 → 头顶橙色角标显示待提问数量**，
气泡显示问题文本（来自工具参数的第一条问题）；用户回答后恢复游动。
会话状态面板中该会话显示「提问中」。

## 全浏览器醒目提醒（审批 / 提问 / 任务完成）

设置面板 →「提醒」勾选三种方式，任一打开时，**审批/提问/任务完成事件到达**即触发：
（默认全开；「系统通知」需浏览器授权，首次点击鲸鱼时会以用户手势自动请求权限，拒绝后静默降级）

1. **页缘闪屏**：整个页面四边红色（审批）/ 琥珀色（提问）/**绿色（任务完成）**脉冲闪烁 + 顶部居中 toast（无需权限，最可靠）；
2. **系统通知**：`Notification API` 发出系统级弹窗（带鲸鱼 logo，标签去重）；
3. **标签闪烁**：临时把浏览器标签标题改为 `⚠️ 需要审批！` / `❓ 有提问待回答！` / `🎉 任务完成！`，几秒后自动还原。

## 会话标题

面板会话列表的标题来自 DSH 的 `sessionTitle` 服务（`session/title` 事件）。标题是**异步生成**的
（首个用户消息后先出 fallback 标题，随后可能由 LLM provider 优化），因此刚建立的会话往往先显示
`session-xxxx…`。本插件 Host 半区监听 `session/title` 事件，**标题一旦生成就自动刷新**，
不再像旧版那样只在会话创建时读一次、之后永远显示 session id。

## 插件 Logo

面板头部与系统通知图标使用随包携带的鲸鱼剪影（`assets/whale.svg`，源自 dsh-dock），
以 base64 内嵌于客户端 bundle，无需额外请求。

## 发布到插件市场 / npm

当前 DSH rc.6 没有独立的市场 UI——官方分发通道是 npm 包，通过
`dsh plugin --profile web add <包名>` 安装（需 pnpm）。包已按官方
`dsh.client` / `dsh.bundle` 约定打包，未来若有市场，可直接被市场目录消费。

包名采用裸名 `dsh-whale-copilot`（无作用域）。发布前请先确认该裸名在 npm 上未被占用：
`npm view dsh-whale-copilot`。裸名包默认公开可见，无需 `--access public`。

```powershell
cd dsh-whale-copilot
npm login                 # 用你的 npmjs 账号（spartaattack）登录
npm publish   # 裸名包默认公开，无需 --access public
```

发布后任何装有 pnpm 的机器都能：

```powershell
dsh plugin --profile web add dsh-whale-copilot
dsh web   # 装完即激活，无需手动改任何文件
```

## 技术要点

- 客户端 bundle 是手写的官方 `__ModuleLoader__.load` CJS 格式（无需完整仓库构建）；
  `React` 通过 `require("react")` 获取（浏览器 shell 的 seed 模块）。
- Host 半区不依赖 `harness` 动态运行器——事件监听、`webServer` 路由都是标准 Cordis 能力，
  因此重启后依然存在，任何会话共享同一实例。
- `/whale/*` 是只读状态接口，仅回环/本机 Web 面可见，不参与审批等敏感流程。

## 许可证

MIT
