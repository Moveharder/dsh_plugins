# 🐳 dsh_plugins — DSH 插件合集

个人维护的 **DSH（DeepSeek Harness）插件合集**仓库：每个插件一个子目录，
独立版本号、独立发布到 npm；GitHub 版本标签按 `<包名>-v<版本>` 命名，互不覆盖。

## DSH Web 插件

| 插件 | npm | 说明 |
| --- | --- | --- |
| [dsh-whale-copilot](./dsh-whale-copilot/) | [![npm](https://img.shields.io/npm/v/dsh-whale-copilot?color=blue)](https://www.npmjs.com/package/dsh-whale-copilot) | 🐳 一条由 DSH 事件驱动的 DeepSeek 蓝白小鲸鱼伙伴：随 agent 会话的思考/回复/工具执行/审批/提问/完成游泳、起伏、跳跃、间歇喷水；支持游动与静态（可拖拽摆放）两种模式，海洋背景自适应且可一键隐藏，审批与提问时暂停移动并抖动提醒，带跟随鲸鱼位置的会话状态面板 |
| [dsh-annual-activity](./dsh-annual-activity/) | [![npm](https://img.shields.io/npm/v/dsh-annual-activity?color=blue)](https://www.npmjs.com/package/dsh-annual-activity) | 📅 纯本地的 DSH 活跃度统计面板：扫描 `$DSH_HOME/sessions` 下的历史会话日志，按本地日期聚合成一张年度热力图（统计行 + 5 级色块 + 月份轴 + 年份切换 + 连登统计），数据全部来自本机，不联网、不上报 |
| [oh-my-dshtoken](./oh-my-dshtoken/) | [![npm](https://img.shields.io/npm/v/oh-my-dshtoken?color=blue)](https://www.npmjs.com/package/oh-my-dshtoken) | 🪙 纯本地的 AI Token 消耗统计面板：按 项目 / 会话 / 模型 三个维度聚合输入、输出、缓存读取 Token，图表 + 文本双形式可视化；入口常驻 dsh web 右下角，支持在线检测升级 |
| [dsh-pocket-ui](./dsh-pocket-ui/) | [![npm](https://img.shields.io/npm/v/dsh-pocket-ui?color=blue)](https://www.npmjs.com/package/dsh-pocket-ui) | 📱 DSH Web UI 的移动端适配（轻量核心版）：窄屏下侧栏变抽屉、对话框变底部 sheet、刘海安全区避让、输入区不再打架；**鼠标操作的桌面端任何宽度都是完全 no-op** |

> 版本号用 npm 徽章**实时**显示，不再手写。手写的版本号一定会过期——这张表之前就停在
> whale-copilot 1.1.0 / dsh-bar 1.0.0，而仓库里实际已经有四个包、版本早就往前走了。

### 安装

```sh
dsh plugin --profile web add dsh-whale-copilot   # 换成上表任意包名
```

装完**重启 `dsh web`** 生效。插件分 Host / Client 两个半区：Client 半区的改动会热更新到已打开的
页面，Host 半区（路由、扫描引擎）在启动时一次性装配，只有重启才会换。

## macOS 应用（非 npm 包）

| 应用 | 说明 |
| --- | --- |
| [dsh-bar](./dsh-bar/) | 🐳 顶部菜单栏小鲸鱼（原生 Swift/AppKit，`LSUIElement` 不占程序坞）：启停 DSH Web、看状态与日志、开页面、设置端口/路径、开机自启 |

## 新增 / 更新插件

- 每个插件保持标准的 npm 包结构，放在本仓库同名子目录（`子目录名 = npm 包名`）下。
- 版本发布与更新统一走开发工作区脚本 `scripts/publish-plugin.sh`
  （**npm + GitHub 双渠道**，自动在镜像里 `git subtree` 挂载/合并并打标签）。
- 加新插件后记得回这张表补一行——本仓库的 README 不会被发布脚本自动生成。
