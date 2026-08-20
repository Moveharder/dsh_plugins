# dsh-bar — 顶部菜单栏小鲸鱼

独立于 `dsh-dock`（程序坞版）的新应用：**只在系统顶部状态栏放一个黑鲸鱼小图标**，
点击弹出菜单，可启停 DSH Web、看状态、开页面、看日志、设置端口/路径、开机自启。

- 形态：菜单栏应用（LSUIElement，不占程序坞）
- 实现：原生 Swift/AppKit（`NSStatusItem + NSMenu`），swiftc 编译
- 图标：DeepSeek Harness 官方黑鲸鱼（菜单栏模板图，深色/浅色自动适配）

## 菜单功能

| 菜单项 | 作用 |
|---|---|
| 状态行 | `DSH 服务：运行中（PID …）` / `已停止` / `端口被占用` |
| 启动 / 停止 DSH 服务 | 直接交给子进程 `dsh web --no-open [--port N]`；停止时发 SIGINT（=Ctrl+C 优雅关服），2 秒后 SIGTERM、再 2 秒后 SIGKILL 兜底 |
| 强制停止 N 端口服务 | 仅当端口被外部进程占用时出现：按 lsof 找出占用进程并 SIGINT→SIGTERM→SIGKILL 强杀（服务异常的兜底操作） |
| 打开 Web 页面 | 用默认浏览器打开 `http://127.0.0.1:<端口>/` |
| 查看日志 | 用默认编辑器打开日志文件 |
| 开机自启 | 勾选后写入 LaunchAgent（登录时自动运行 dsh-bar；若勾了“登录后自动启动服务”则顺带拉起 DSH） |
| 设置… | 端口 / dsh 路径 / node 路径 / 日志路径；启动后自动开浏览器、退出时停止服务、登录后自动启动服务 |
| 退出 | 先优雅停掉 DSH（除非关闭“退出时停止服务”），再退出 |

## 行为约定

- **退出 dsh-bar = 停掉 DSH**（与之前 dsh-dock 的体验一致）；想改了可在设置里关掉。
- 端口默认 3080，改端口时启动会传 `--port N`（`dsh web` 原生支持）。
- 若端口已被其它进程占用（如你正用终端跑着 dsh，或异常遗留的服务），点“启动”会提示并**不重复启动**，此时菜单会多出“强制停止 N 端口服务”用于兜底清理。
- 浏览器由 dsh-bar 控制打开（启动时传 `--no-open`，避开 dsh 自带的开网页），受“启动后自动打开浏览器”设置约束。
- node 自动探测（nvm 最新版本 → homebrew → /usr/local → /usr/bin），也可在设置里手动填。
- 配置兼容旧版本（自动迁移旧的 `keepServiceOnQuit` 字段，设置不会被清空）。

## 安装

```bash
# 在包含 dsh-bar.app 的文件夹内执行（或直接双击后拖入 /Applications）
cp -R dsh-bar.app ~/Applications/
open ~/Applications/dsh-bar.app            # 首次运行
```

顶部菜单栏应出现黑鲸鱼。点它即可操作。想“登录自动开机”，用菜单里的“开机自启”。

## 修改 / 重新构建

源码包**自包含**：图标已内置在 `assets/`，构建只需 macOS 自带工具（需装 Xcode Command Line Tools），无需 rsvg-convert、无任何外部路径。

```bash
cd <源码目录>          # 即包含 main.swift 与 build-bar.sh 的文件夹
./build-bar.sh      # 使用内置图标直接构建（swiftc 编译 + bundle + 签名）
cp -R dsh-bar.app ~/Applications/
```

可选：想换/重做图标时，`REGEN=1 ./build-bar.sh` 会用 `assets/whale.svg` 重新生成（该模式才需要 `rsvg-convert`（brew install librsvg）或 macOS 自带 `qlmanage`）。

## 文件

- `main.swift` — 全部逻辑（状态栏、菜单、进程管理、LaunchAgent、设置窗口）
- `build-bar.sh` — 一键构建（自包含）
- `assets/` — 内置图标：官方黑鲸鱼 `applet.icns` / 菜单栏 `whale-36.png` / 源 SVG
- `gen/` — 构建输出（构建缓存 `gen/mcache` 构建后自动清理；其余可随时删除）
- 运行配置存于 `~/Library/Application Support/dsh-bar/config.json`（首次保存后生成）
- 日志默认 `/tmp/dsh-web.log`（可在设置里改）

## 调试

```bash
./dsh-bar.app/Contents/MacOS/dsh-bar --debug-settings   # 短暂打开设置窗口、打印布局尺寸、导出快照到 /tmp/dsh-bar-settings.png
```
