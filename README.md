# 📅 全年活跃记录 — dsh-annual-activity

[![npm version](https://img.shields.io/npm/v/dsh-annual-activity?color=blue)](https://www.npmjs.com/package/dsh-annual-activity) [![GitHub](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/Moveharder/dsh_plugins)

> 一个**纯本地**的 DSH 活跃度统计面板：把你在 DSH 里每一天的「干活量」画成一张年度热力图
> （GitHub 贡献图风格），统计口径是**本机真实会话日志**——不联网、不上报、不估算。

```
        DSH 会话头部右上角 ↓
  … 项目 / 会话名                              ▦  ▢▯   ← ▦ 本插件入口（14 天迷你热力图）
                                                       ▢▯ 是官方「打开右侧边栏」

  ┌──────────────────────────────────────────────────────────────────────────────┐
  │ 全年活跃记录   24 天活跃 · 活跃率 9%                        ‹ 2026 年 ▾ ›   ✕ │
  │ ──────────────────────────────────────────────────────────────────────────── │
  │  24 天      9%        6 周       5 天              未活跃 ▢▢▢▢▢ 活跃        │
  │  活跃       活跃率     连登       最长连续                                   │
  │  1 月   2 月   3 月   4 月   5 月   6 月   7 月   8 月   9 月  10 月 11 月 12 月│
  │  ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢   ← 每周一列、周一对齐  │
  │  ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢🟩▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢                  │
  │  ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢🟩🟩🟩🟩🟩▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢                  │
  │ ──────────────────────────────────────────────────────────────────────────── │
  │ 数据更新于 09-17 10:32 · 本机 Asia/Shanghai 自然日口径        ⟳  ⚙         │
  └──────────────────────────────────────────────────────────────────────────────┘
```

入口在**会话头部右上角**：紧挨「打开右侧边栏」按钮的左边，同高同圆角（28×28）。
图标是**最近 14 天的迷你热力图**（等级越高颜色越深）；按钮带常驻底色与 1px 细边
（用官方 token，深浅主题都跟随），悬停加深一档。鼠标悬浮时说明浮层出现在**按钮下方**
（不会遮挡按钮与会话标题），显示今日 / 今年 / 连登摘要；点击展开上面的年度面板。
有新版本时按钮右上角带一个小圆点。

## 安装

**装完即激活**——一条命令（需 pnpm）：

```sh
dsh plugin --profile web add dsh-annual-activity
dsh web          # 重启后生效（Host 路由与浏览器半区都在启动时装配）
```

从本地目录 / tarball 安装（开发期）：

```sh
dsh plugin --profile web add ./dsh-annual-activity
dsh plugin --profile web add ./dsh-annual-activity-1.0.0.tgz
```

验证：

```sh
node -p "require(process.env.HOME + '/.dsh/profiles/web/node_modules/dsh-annual-activity/package.json').version"
dsh --profile web --dump-config | grep -A2 'dsh-annual-activity'   # 应出现 activity 层
curl -s http://127.0.0.1:3080/activity/hello                       # {"ok":true,...}
```

随时开关 / 卸载：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: activity
  disabled: true     # 关闭；删掉这段即恢复
```

```sh
dsh plugin --profile web remove dsh-annual-activity
```

## 面板怎么用

| 区域 | 说明 |
| --- | --- |
| **头部入口** | 会话右上角、「打开右侧边栏」左侧；14 天迷你热力图字形 + 悬浮摘要；有更新时带圆点 |
| **标题行** | `N 天活跃 · 活跃率 X%`，右侧是**年份切换**（`‹ 2026 年 ▾ ›`，多于一年时可下拉直选）与关闭按钮 |
| **统计行** | 活跃天数 / 活跃率 / **周连登** / 年内最长连续天数 |
| **图例** | 未活跃 → 活跃 的 5 级色块，悬浮可看每级阈值 |
| **热力图** | 一周一列（周一在顶），最多 53 列；今天的格子有独立描边；悬浮任一格看当天明细 |
| **底部** | 数据更新时间、时区口径、跨年累计（轮次 / tokens / 会话数）、手动 ⟳ 重扫、⚙ 设置 |

关闭方式：右上角 `✕` / 点击遮罩空白处 / `Esc`。

## 升级

面板底部 **⚙ 设置** → 显示当前版本 / 最新版本，并可一键**检测更新**与**在线升级**：

- Host 启动时 + 每 6h 查一次 `registry.npmjs.org/<包名>/latest`，发现新版本时入口按钮
  与 ⚙ 都会出现提示；点击后在本插件安装目录执行 `pnpm add <包名>@<新版>`（失败退化 `npm install`），
  **升级只替换安装文件、不卸载当前插件**；完成后按提示**重启 dsh web** 生效
  （`scripts/restart-web.sh` 可一键优雅重启）。
- **本地 link / file / tarball 安装会自动跳过在线升级**并说明原因——否则源码开发态会被换成
  registry 版本，本地改动反而失效。这类安装的正确升级路径就是直接改源码 / 重新打包安装。
- 离线、未发布、registry 不可达时全程静默降级，不影响任何统计功能。

| 环境变量 | 作用 |
| --- | --- |
| `DSH_ACTIVITY_NO_UPDATE_CHECK=1` | 完全关闭版本检查（离线环境 / 不想让面板联网） |
| `DSH_ACTIVITY_REGISTRY=<url>` | 换 registry 基址（内网镜像 / 私有源） |
| `DSH_ACTIVITY_PKG_MANAGER=<bin>` | 换安装用的包管理器可执行文件（默认 `pnpm`，退化 `npm`） |
| `DSH_ACTIVITY_ROOT=<dir>` | 换会话日志根目录（默认 `$DSH_HOME/sessions`；测试用） |

## 活跃等级怎么定的

主口径是**当天产生的「轮次」(turn)**——一次提问到 agent 收尾算一轮，最贴近「今天和 DSH
干了多少活」的直觉。Token / 工具调用 / 会话数只作为悬浮明细展示，**不参与定级**（否则一次
长上下文任务就会把当天色块顶到最深，失去区分度）。

| 等级 | 色块 | 阈值 | 悬浮标签 |
| --- | --- | --- | --- |
| 0 | `#eef0f2` 浅灰 | 0 轮 | 未活跃 |
| 1 | `#c6e8cf` | 1 轮 | 轻 |
| 2 | `#7fce97` | 2–5 轮 | 中 |
| 3 | `#34a853` | 6–15 轮 | 高 |
| 4 | `#0f7a37` | ≥16 轮 | 极高 |

阈值表由 Host 随数据一起下发（`levels` 字段），改口径只需改 `lib/index.js` 里的 `LEVELS`
常量，面板色块与图例会自动跟随，不会出现「颜色和文案对不上」。

> 统计口径说明：一天只要**产生过任何会话事件**就算活跃日——包括「当天创建了会话但还没开始
> 对话」。这类日子轮次为 0，会落在 0 级（浅灰），但仍计入活跃天数，因为它是真实发生过的事。

## 数据从哪来 / 准不准

- **数据源**：`$DSH_HOME/sessions/<项目目录>/<会话目录>/` 下的会话日志
  （`session.v3.jsonl.zstd` / `session.jsonl.zstd` / 明文 `session.jsonl`）。
  Node ≥ 22.15 用原生 `node:zlib` 解 zstd，支持多帧拼接与损坏尾帧容错。
- **分桶**：按**宿主本地时区**的自然日（面板底部显示时区名），与你在 DSH 里看到的日期一致。
- **Token**：只认「一步一条」的权威 usage 记录，并按 `turn:step` 去重——同一会话里
  `assistant/chunk(usage)` 与 `assistant/message.usage` 会同时存在且数值完全相同（实测
  22/22 键一致），去重后**不会双计**；被取消的步骤只有 chunk 记录，也会被计入。
- **增量**：以「全部会话文件的 mtime + size」为失效依据，只重新解析变化的文件；
  后台每 60s 保活重扫一次，所以**今天**的色块会随会话进行自动变深，不需要等到第二天。
  面板打开时每 20s 拉一次，关闭时 3 分钟一次。
- **活跃率分母**：当前年用「已过天数」，历史年份用「全年天数」——避免 1 月的活跃率被 365 稀释。
- **周连登**：以周一为一周起点，从「本周 / 上周」向前数连续有活跃日的周数（上周仍有记录
  就算未断，给跨周末的工作流留余量）。

## Host 半区接口（只读、仅本机回环）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/activity/pull[?year=YYYY]` | 完整快照 + 指定年份的日明细（`days` 有界；跨年汇总在 `yearStats`） |
| `POST` | `/activity/refresh` | 强制重扫（忽略 5s 限流），返回最新 `seq` |
| `GET` | `/activity/hello` | `{ ok, name, version }`，用于存活探测 |
| `GET` | `/activity/meta` | 版本 / 最新版本 / 是否有更新 / 本地安装标记 / 升级状态 |
| `POST` | `/activity/check-update` | 强制查一次 registry（忽略 6h 周期），返回 meta |
| `POST` | `/activity/upgrade` | 在线升级到最新版本（本地 link/file 安装会返回 `upgrade.ok = 'local'` 并拒绝） |

`pull` 响应字段见 `lib/index.d.ts`（`ActivityPayload`）。`seq` 只在内容变化时递增，
可用于判断是否需要重渲染。

## 疑难排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 会话右上角没有入口按钮 | 先看 `curl http://127.0.0.1:3080/activity/hello`：404 说明 Host 层没装配（`--dump-config` 确认 `activity` 行存在、没被 `disabled: true`）；若 Host 正常，浏览器半区需**重启 dsh web**（客户端 bundle 在启动时注入 `__DSH_BOOT__`）。入口注册在 `conversation.session.header.utilities` 槽，只有会话页头部存在时才可见 |
| 面板显示「host 未就绪：…（重试中…）」 | Host 路由未注册或已被禁用；入口仍在，恢复后自动接上 |
| 数字全是 0 / 只有今天有数据 | `$DSH_HOME` 指向了别的目录。插件默认读 `$DSH_HOME/sessions`，其次 `~/.dsh/sessions`；可用 `DSH_ACTIVITY_ROOT` 覆盖 |
| 今天色块没变深 | 面板打开时 20s 轮询一次；点底部 ⟳ 可立即重扫（有 5s 最小间隔限流） |
| 首次打开略慢 | 首次全量扫描要解压全部会话日志（本机 58 个会话约 7s）；之后走 mtime 缓存，通常 <50ms |
| 点升级提示「当前是本地安装」 | 正常行为：`link:` / `file:` / `.tgz` 安装是源码开发态，在线升级会把源码换成发布版。直接改源码，或先 `dsh plugin --profile web add dsh-annual-activity@<新版>` |
| 检测更新一直显示「未发布 / 离线」 | 包尚未发布到 registry，或本机网络/镜像不可达；设了 `DSH_ACTIVITY_NO_UPDATE_CHECK=1` 也会如此 |
| 装到了旧版本 | profile 里若是精确版本 pin（`"1.0.0"`），裸 `add` 不会升级：`dsh plugin --profile web add dsh-annual-activity@<新版>` |
| pnpm 提示发布太新被拒 | 把包加进 profile `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`：`- dsh-annual-activity@1.0.0` |

## 开发

```sh
npm run smoke          # host + client 两套冒烟测试（无需启动 dsh、全程离线）
npm run smoke:host     # 只跑 host：zstd 多帧/明文/损坏尾帧、按日分桶、Token 去重、路由语义、升级链路
npm run smoke:client   # 只跑 client：bundle 契约、槽注册、渲染、热力图几何、年份切换、悬浮明细、升级 UI
pnpm dsh web --patch ./dsh-annual-activity/cordis.patch.yml   # 源码态热加载（需把插件行 name 指向源码绝对路径）
bash scripts/restart-web.sh --status   # 看当前 dsh web 是否在跑、插件路由是否已注册
```

升级链路的测试不需要真实网络：用 `DSH_ACTIVITY_REGISTRY` 指向一个本地 http 端点、
`DSH_ACTIVITY_PKG_MANAGER` 指向一个假包管理器脚本，即可在测试里跑通
「检测到新版 → 调用安装 → 提示重启」与「本地 link 安装被拒绝」两条路径。

## License

MIT © 2026 spartaattack
