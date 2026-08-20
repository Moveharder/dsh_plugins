# 🐳 dsh_plugins — DSH 插件合集

个人维护的 **DSH（DeepSeek Harness）插件合集**仓库：每个插件一个子目录，
独立版本号、独立发布到 npm；GitHub 版本标签按 `<包名>-v<版本>` 命名，互不覆盖。

## 插件列表

| 插件 | npm 包 | 版本 | 说明 |
|---|---|---|---|
| [dsh-whale-copilot](./dsh-whale-copilot/) | [npm](https://www.npmjs.com/package/dsh-whale-copilot) | 1.1.0 | 🐳 一条由 DSH 事件驱动的 DeepSeek 蓝白小鲸鱼伙伴：随 agent 会话游泳/起伏/跳跃/喷水，审批时回到最左侧暂停并抖动，点击鲸鱼可展开会话状态面板 |

## 新增 / 更新插件

- 每个插件保持标准的 npm 包结构，放在本仓库同名子目录（`子目录名 = npm 包名`）下。
- 版本发布与更新统一走开发工作区脚本 `scripts/publish-plugin.sh`
  （**npm + GitHub 双渠道**，自动在镜像里 `git subtree` 挂载/合并并打标签）。| [dsh-bar](./dsh-bar/) | — | 1.0.0 | 顶部菜单栏小鲸鱼：启停 DSH Web、看状态/日志、开页面、设置端口/路径、开机自启 |
