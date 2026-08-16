# 🐳 DSWhale Copilot — dsh-whale-copilot

一条由 DSH 事件驱动的 DeepSeek 蓝白小鲸鱼宠物，运行在 DSH Web 界面底部。
它会随 agent 会话状态游泳、起伏、跳跃、间歇喷水：思考（reasoning-delta）时间歇喷水、
回复时摇尾、执行工具时冒泡、**需要审批时暂停移动并喷水抖动（头顶亮灯 + 红色角标）**、
任务完成时跃出水面。
点击鲸鱼可打开会话状态面板（实时会话列表 + 最近动态 + 大小/上下位置/气泡距离设置）。

## 这是什么

一个**正式安装的 DSH 插件包**（npm 包，双面插件）：

- **Host 半区**（`lib/index.js`）：监听 `session/event`、`agent/*`、`approval/request`、
  `subagent/*`、`workflow/*`、`goal/changed` 等事件，聚合会话状态与有界事件日志，
  并通过 `webServer` 注册 `/whale/pull`、`/whale/hello` HTTP 路由供浏览器轮询。
- **Client 半区**（`lib/client.js`）：浏览器 bundle（`window.__ModuleLoader__.load`
  格式，与官方 `dsh-client-*` 包一致），通过 `dsh.client: { platform: 'web' }` 声明，
  由 `@deepseek-ai/dsh-client-modules` 自动注入 `window.__DSH_BOOT__` 并服务
  `/plugins/<包名>/client.js`。

## 本地安装（本机 dsh）

```powershell
# 1) 把包放入 profile 的 node_modules（hoisted 存储）
Copy-Item -Recurse dsh-whale-copilot "$env:USERPROFILE\.dsh\profiles\node_modules\@spartaattack\"

# 2) 在 ~/.dsh/profiles/web/package.json 的 dependencies 里加一行（声明式，pnpm 等价物）
#    "dependencies": { "@spartaattack/dsh-whale-copilot": "^0.2.0" }

# 3) 把下面 insert 追加到 ~/.dsh/profiles/web/cordis.patch.yml 的数组里：
#    - insert:
#        - id: whale
#          name: '@spartaattack/dsh-whale-copilot'

# 4) 重启 dsh web
dsh web
```

也可以直接运行本包附带的 `install-local.ps1`（自动完成 1–3 步）。

> 注：`dsh plugin --profile web add <包>` 需要 pnpm；本机未装 pnpm 时按上面手动安装即可。

## 随时开关

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，重启 dsh：

```yaml
- id: whale
  disabled: true        # 关闭
# disabled: false       # 重新开启（或删除该条目）
```

彻底卸载：删除 insert 条目 + 删除 `@spartaattack/dsh-whale-copilot` 依赖与 node_modules 目录。

## 面板设置

点击鲸鱼打开面板 → 右上角 ⚙ 进入设置：

| 设置 | 范围 | 默认 | 说明 |
| --- | --- | --- | --- |
| 大小 | 50% – 130% | 85% | 鲸鱼整体缩放 |
| 上下位置 | 上浮 20px – 下沉 22px | 下沉 8px | 距底部距离 |
| 气泡距离 | 40 – 180px | 90px | 文字气泡距鲸鱼的高度（默认已贴近鲸鱼头顶） |

设置保存在浏览器 `localStorage`（键 `dsh-whale-copilot:settings`，兼容旧键 `dsh-whale:settings`），刷新页面 / 下次启动自动按上次的值初始化；点「恢复默认」可回到默认值。

## 审批提示

Host 半区通过 `approval/request` 瀑布事件观察权限审批：先记录状态、把事件投递给浏览器，
再 `await next()` 继续真实审批链（**观察式，不劫持审批**）。

当收到审批请求时，鲸鱼会：**暂停左右游动 → 持续喷水 + 左右抖动 → 头顶红色角标显示待审批数量**，
气泡显示「需要审批！」；批准后跃起庆祝，拒绝后垂眼懊恼。审批期间，会话状态面板中该会话显示「待审批」。

## 发布到插件市场 / npm

当前 DSH rc.6 没有独立的市场 UI——官方分发通道是 npm 包，通过
`dsh plugin --profile web add <包名>` 安装（需 pnpm）。包已按官方
`dsh.client` / `dsh.bundle` 约定打包，未来若有市场，可直接被市场目录消费。

包名采用 `@spartaattack/` 作用域：`@spartaattack` 即你的 npmjs 用户名，作用域包天然避开了
全局命名冲突，且无需创建 org 即可在你的账号下发布（公开）。想用裸包名 `dsh-whale-copilot`
也可以，但需该裸名在 npm 上未被占用。

```powershell
cd dsh-whale-copilot
npm login                 # 用你的 npmjs 账号（spartaattack）登录
npm publish --access public   # 作用域包公开可见（publishConfig 已默认 access: public）
```

发布后任何装有 pnpm 的机器都能：

```powershell
dsh plugin --profile web add @spartaattack/dsh-whale-copilot
# 然后照上文把 insert 追加进 cordis.patch.yml 并重启
```

## 技术要点

- 客户端 bundle 是手写的官方 `__ModuleLoader__.load` CJS 格式（无需完整仓库构建）；
  `React` 通过 `require("react")` 获取（浏览器 shell 的 seed 模块）。
- Host 半区不依赖 `harness` 动态运行器——事件监听、`webServer` 路由都是标准 Cordis 能力，
  因此重启后依然存在，任何会话共享同一实例。
- `/whale/*` 是只读状态接口，仅回环/本机 Web 面可见，不参与审批等敏感流程。

## 许可证

MIT
