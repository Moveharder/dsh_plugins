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
#    "dependencies": { "dsh-whale-copilot": "^1.0.1" },
#    "dsh": { "profile": { "bundles": [..., "dsh-whale-copilot"] } }

# 3) 重启
dsh web
```

> Windows 本机开发也可运行 `install-local.ps1`（等价的手动安装，直接 insert 行方式）。

## 疑难排查

### `add` 装到了旧版本（如 1.0.0 而非 1.0.1）

npm 上 `latest` 已是新版本，但 `dsh plugin add` 仍装旧版——通常是 profile 目录里
已有的 `pnpm-lock.yaml` / `dependencies` 锁定了旧版本所致（此前装过旧版）。

解决：显式指定版本重装。

```powershell
dsh plugin --profile web add dsh-whale-copilot@<版本>
# 例如：dsh plugin --profile web add dsh-whale-copilot@1.0.1
```

若仍报 `No matching version`（pnpm 元数据缓存未刷新），加 `--prefer-online`，或先
`remove` 再 `add`：

```powershell
dsh plugin --profile web add dsh-whale-copilot@1.0.1 --prefer-online
# 或
dsh plugin --profile web remove dsh-whale-copilot
dsh plugin --profile web add dsh-whale-copilot@1.0.1
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
