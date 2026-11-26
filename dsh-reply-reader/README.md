# 🔊 DSH Reply Reader — dsh-reply-reader

> 用**浏览器内置的 Web Speech API** 朗读 DSH 的助手回复：左侧栏有「朗读」面板（语音 / 语速 / 自动朗读），
> 每条已完成的回复旁有一个小喇叭按钮。**免费**——使用操作系统自带的语音，不需要账号、API Key，
> 合成过程不发网络请求。

一句话安装（需 pnpm）：

```sh
dsh plugin --profile web add dsh-reply-reader
dsh web          # 重启后生效
```

## 功能

```
左侧栏（Plugins / Schedules 之后）
  🔊 朗读        ← 本插件入口，点击打开设置页
┌ 朗读 ────────────────────────────────────────────────────────────────┐
│ 自动朗读新回复        [●]      一轮结束后自动读最后一条回复（默认开） │
│ 语音               [Ting-Ting ▾]  系统语音列表（按语言排序）          │
│ 语速               ─────●──  1.0×   0.5–2.0 倍                       │
│ [🔊 试听 / ■ 停止]  可用语音 61 个                                    │
│ 版本 当前 v0.2.0 · 最新 v0.2.1 · 有更新          [升级到 v0.2.1]      │
└───────────────────────────────────────────────────────────────────────┘

输入框工具栏（只在朗读进行中出现的暂停/停止）：
  … ⏸ 暂停  ■  …        ← 暂停后按钮变成 ▶ 继续

对话里每条已完成的回复：
  … 拷贝  🔊  👍  👎  …        ← 没在读这条：扬声器 = 开始朗读
  … 拷贝  ⏸  ■  👍  👎  …      ← 正在读这条：换成暂停/停止，原地可操作
```

- **自动朗读**默认开启：一轮对话结束、最后一条回复落定后马上朗读；只读**本次打开页面之后**新产生的回复，
  打开旧会话不会把历史回复全念一遍。切到其他面板时不会自动朗读，回到对话后继续。
- **单条朗读**：回复操作行里的喇叭按钮可随时朗读这一条，不打断对话。
- **暂停 / 继续**：朗读时输入框工具栏出现「暂停」（正在读的那条回复也会把喇叭换成暂停 + 停止）。
  暂停会保留位置：优先用浏览器的原生 `pause()`，继续时从原处接上；
  如果系统语音引擎忽略或卡住 `pause()`，则退化为**从当前这一块的开头重读**（最多重叠一句，不丢内容）。
  暂停期间新来的自动朗读不会自动开始——按「继续」才恢复。
- **离线、免费**：语音来自操作系统（macOS 的系统语音 / Windows 的 SAPI 语音）；插件本身不调用任何在线 TTS。
- **Markdown 清洗**：朗读前去掉代码块、表格、链接语法和强调符号，按句子切块排队，避免长文本被截断。
- 语音、语速、自动朗读开关保存在浏览器 `localStorage`（键 `dsh.read-aloud.settings.v1`），每台机器各自保存。

## 安装

```sh
# npm（发布后）
dsh plugin --profile web add dsh-reply-reader
dsh plugin --profile web add dsh-reply-reader@0.2.0     # 钉版本

# 本地目录 / tarball（开发期）
dsh plugin --profile web add ./dsh-reply-reader
dsh plugin --profile web add ./dsh-reply-reader-0.2.0.tgz
```

也可以直接在 Web UI 的 **插件 → 添加插件 → 安装第三方插件** 里填包名或本地目录路径。

验证：

```sh
node -p "require(process.env.HOME + '/.dsh/profiles/web/node_modules/dsh-reply-reader/package.json').version"
dsh --profile web --dump-config | grep -A2 dsh-reply-reader     # 应出现 read-aloud 层
curl -s http://127.0.0.1:3080/read-aloud/hello                   # {"ok":true,...}
```

> 上面的 `web` 换成你实际使用的 profile（桌面版默认是 `desktop`）。

随时开关 / 卸载：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: read-aloud
  disabled: true     # 关闭；删掉这段即恢复
```

```sh
dsh plugin --profile web remove dsh-reply-reader
```

## 版本与在线更新

Host 半区注册了三条只读路由（前缀 `/read-aloud`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/read-aloud/hello` | 存活与版本（排查 Host 是否加载） |
| GET | `/read-aloud/meta` | 当前版本 / 最新版本 / 安装方式 / 升级状态 |
| POST | `/read-aloud/check-update` | 强制查一次 npm registry（忽略 6h 周期） |
| POST | `/read-aloud/upgrade` | 在线升级 profile（不卸载当前插件） |

- 启动时查一次 npm，之后每 6 小时一次；**离线 / 未发布静默降级**，面板显示「未发布 / 离线」，不影响朗读。
- **本地 `link:` / `file:` / tarball 安装会被拒绝在线升级**（否则会把源码开发态换成 registry 版本），
  面板会显示「本地安装：直接改源码即可」。发布请走 `scripts/publish-plugin.sh`。
- 升级只替换安装文件，不 `remove` + `add`；成功后提示**重启 `dsh web`**。
- 如果磁盘版本已经比进程内版本新（升级完还没重启），面板显示 `stale` 文案并拒绝再次升级——只让重启。
- 可用环境变量（离线环境 / 内网镜像 / 冒烟测试）：

```sh
DSH_REPLY_READER_NO_UPDATE_CHECK=1        # 完全关闭 registry 检查
DSH_REPLY_READER_REGISTRY=https://registry.npmmirror.com
DSH_REPLY_READER_PKG_MANAGER=/path/to/fake-pnpm
```

## 疑难排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 左侧栏没有喇叭图标 | Host 半区在服务端日志里应有 `[dsh-reply-reader] host half active`；没有就是没装进层栈或没重启。浏览器半区改动刷新页面即可，Host 改动必须重启 `dsh web`。 |
| 有图标但回复旁没有喇叭按钮 | 该 DSH 版本的 Chat 快照结构不同（本插件在 0.2.2-rc.1 上验证）。把版本号发我适配。 |
| 点「试听」没声音 | 浏览器对语音合成要求一次用户手势才能启动；先点一次「试听」。仍未出声，检查系统语音包（见下）。 |
| 暂停后继续，有一句重复 | 该平台的语音引擎忽略或卡住了 `pause()`，插件改为从当前块开头重读。块上限 180 字，所以最多重一句；内容不会丢。 |
| 中文读成英文 / 没有中文音色 | macOS：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音，安装中文（如 Ting-Ting）。Windows：设置 → 时间和语言 → 语音 → 添加语音（中文（简体））。装完刷新页面，在「语音」下拉里选中。 |
| 升级后 UI 变了但功能没变 | Host 进程仍是旧代码：重启 `dsh web`。面板的 `stale` 文案就是提示这个。 |
| `pnpm add` 装到旧版本 | pnpm 11 的 `minimumReleaseAge`（默认 24h）会挑"够老"的版本：把 `dsh-reply-reader` 加进 profile `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。 |
| 本地安装收不到自动升级 | 设计如此：本地安装由源码驱动，面板会说明「本地安装」，在线升级被拒绝。 |

## 开发

```
dsh-reply-reader/
├── package.json          # bundle manifest（dsh.bundle / dsh.client / files / exports）
├── cordis.patch.yml      # 插入 read-aloud 行
├── lib/
│   ├── index.js          # Host 半区：版本 + /read-aloud 路由 + 在线升级
│   ├── index.d.ts        # Host 类型声明（types 指向它，冒烟测试会校验）
│   └── client.js         # Client 半区：侧栏入口、朗读面板、回复按钮、自动朗读
├── locale/{en,zh}.json   # 插件管理页标题/描述
├── icon.svg
├── scripts/
│   ├── smoke-host.js     # 离线冒烟：manifest 自洽 + 升级链路
│   ├── smoke-client.js   # 离线冒烟：client 静态断言（挂载点/文案/样式）
│   └── smoke-speech.js   # 朗读状态机：伪造 speechSynthesis + 虚拟时钟跑暂停/继续
└── README.md · LICENSE
```

- **改 `lib/client.js`**：DSH 模块系统按文件 mtime 轮询，**刷新页面即生效**（不用重启）。
- **改 `lib/index.js`**：Node 已加载的模块不会热更，**必须重启 `dsh web`**。
- 冒烟：

```sh
npm run smoke          # = smoke:host + smoke:client + smoke:speech，全程离线
```

- 源码 overlay 开发（不安装，直接加载本地插件）：

```sh
pnpm dsh web --patch ./dsh-reply-reader/cordis.patch.yml
```

## 发布

本仓库统一用双渠道脚本（npm + GitHub 合集 + gitee）：

```sh
PLUGIN_DIR=dsh-reply-reader scripts/publish-plugin.sh 0.2.0 --dry-run   # 预演
PLUGIN_DIR=dsh-reply-reader scripts/publish-plugin.sh 0.2.0            # 发布 0.2.0
PLUGIN_DIR=dsh-reply-reader scripts/publish-plugin.sh patch            # 之后按需递增
```

> 包名说明：`dsh-read-aloud` 已被他人占用（一个功能相近的插件），因此本项目使用 `dsh-reply-reader`。
> 发布前先确认 `npm view dsh-reply-reader version` 为空；发布后再装一次即可。

## 许可

MIT © 2026 Moveharder
