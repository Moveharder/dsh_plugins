# oh-my-dshtoken

**AI Token 消耗统计面板** —— 纯本地的 DSH 插件：扫描本机 `~/.dsh/sessions` 下全部历史会话日志，按 **项目 / 会话 / 模型** 三个维度聚合 Token 消耗（输入 / 输出 / 总计 / 缓存读取），图表 + 文本双形式可视化。入口常驻 dsh web 页面右下角，点击弹出独立统计面板；内置在线检测升级。

> 数据 100% 来自本机会话日志，纯本地解析，不经任何网络上传（唯一的网络请求是可选的 npm 版本检查）。

## 功能

- **历史总消耗**：自动合计所有项目会话的 输入 / 输出 / 总计（总计 = 输入 + 输出）/ 缓存读取，与 DSH 官方 `tokenUsage` 投影口径一致
- **三维度查看**：
  - 项目：条形图排名 + 展开查看项目内会话明细
  - 会话：搜索过滤 + 完整明细表（标题 / 所属项目 / 模型 / 四列数值 / 最近活跃）
  - 模型：环形占比图 + 图例明细表
- **每日趋势**：近 21 天输入/输出堆叠柱状图
- **准实时**：面板打开时每 4 秒增量重扫（只重新解析 mtime 变化的文件），运行中的会话消耗即时可见
- **在线升级**：启动时 + 每 6 小时检查 npm 最新版本；发现新版可在设置区一键升级（模式同 dsh-whale-copilot）
- **主题自适应**：跟随 dsh web 深/浅色主题

## 安装

```sh
# 从 npm 安装最新版
dsh plugin --profile web add oh-my-dshtoken
```

安装后**重启 `dsh web` 生效**。页面右下角出现 📊 入口按钮即安装成功。

其他安装方式：

```sh
# 本地目录 / tarball
dsh plugin --profile web add ./oh-my-dshtoken
dsh plugin --profile web add ./oh-my-dshtoken-1.1.0.tgz
# 指定版本（profile 内被精确 pin 时必须显式指定才能升级）
dsh plugin --profile web add oh-my-dshtoken@1.1.0 --prefer-online
```

## 使用说明

| 区域 | 说明 |
| --- | --- |
| 右下角入口按钮 | 点击开合统计面板；被遮挡时自动上移避让；有新版本时显示红色 `!` 徽标 |
| 汇总卡片区 | 总消耗 / 输入 / 输出 / 缓存读取 / 缓存命中率 / 会话数 / 项目数（悬浮显示精确数值） |
| 每日趋势图 | 近 21 天 输入/输出 堆叠柱状图（悬浮显示当日精确值） |
| 项目 Tab | 条形图列表，点击行展开该项目最近会话明细 |
| 会话 Tab | 支持按 标题 / 会话 ID / 项目 / 模型 关键字搜索 |
| 模型 Tab | 环形占比图支持「总消耗 / 缓存读取」两种口径切换 + 图例明细表 |
| ⚙ 设置区 | 强制重扫、自动刷新开关、版本信息、检测更新 / 一键升级 |

快捷操作：`Esc` 或点击面板外部关闭面板；⟳ 按钮强制全量重扫。

## 统计口径

DSH 的用量记录里 `inputTokens` 为**未含缓存命中**的提示词输入，缓存命中单独记为 `cacheReadTokens`：

```
总计 = 输入(inputTokens) + 输出(outputTokens)
缓存读取(cacheReadTokens) 单列展示，不计入总计
缓存命中率 = 缓存读取 ÷ (缓存读取 + 输入)
```

由于每一步都会把整段历史重发一遍（命中部分以约 1/10 价格计费），长会话累积后「缓存读取」远大于输入+输出属正常现象；命中率越高说明重复上下文的重复计算越少。

该口径与 DSH 内部 `tokenUsage` 投影完全对账。子代理 / 视觉工具等在同一会话内产生的多模型消耗，按其真实模型分别归属。

## 开关 / 卸载

临时禁用（保留安装）——在 profile 的 `cordis.patch.yml`（或全局 `~/.dsh/cordis.patch.yml`）中覆写：

```yaml
- id: dshtoken
  disabled: true
```

彻底卸载：

```sh
dsh plugin --profile web remove oh-my-dshtoken
```

## 在线升级

- Host 启动时与每 6 小时向 `registry.npmjs.org` 查询一次最新版本；**离线或包未发布时静默降级**，不影响任何功能
- 面板 ⚙ 设置区可手动「检测更新」，发现新版本后「一键升级」在插件安装目录执行 `pnpm add oh-my-dshtoken@<新版>`（失败自动退化为 npm）
- 升级只替换磁盘安装文件，完成后提示**重启 `dsh web` 生效**

疑难排查：

1. **升级后版本没变**：运行中进程仍用旧代码，重启 `dsh web` 即可；
2. **pnpm 因 minimumReleaseAge 拒绝安装新发布的版本**：把包加入 profile 的 `pnpm-workspace.yaml`：
   ```yaml
   minimumReleaseAgeExclude:
     - oh-my-dshtoken@<具体版本>
   ```
3. **裸 `add` 提示 Already up to date**：profile 里被精确 pin 了版本，改用 `add oh-my-dshtoken@<新版>`。

## 技术实现速览

- **Host 半区**（Node）：遍历 `$DSH_HOME/sessions/*/*/session.jsonl.zstd`（兼容明文 `.jsonl`），用 Node ≥22.15 原生 `node:zlib` zstd 解压（多帧兼容、损坏尾部帧容错）；以文件 `mtime+size` 为失效键做增量解析缓存；会话标题尽力从 `storages/session_projcache.json` 富化。经 `/dshtoken/pull?since=<seq>` 提供快照（内容不变时返回 `unchanged` 省 payload）
- **Client 半区**（浏览器）：注册到官方 `shell.overlay` 浮层插槽；纯手写 SVG 图表（零图表依赖）；localStorage 键 `oh-my-dshtoken:settings`
- Token 计数只取 `assistant/chunk(type=usage)`（每步一条的权威记录），`assistant/message` 自带的重复 usage 仅用于提取模型归属，绝不双计

## 开发与验证

```sh
# 源码环境快速迭代（patch 直连本地源码）
pnpm dsh web --patch ./oh-my-dshtoken/cordis.patch.yml

# Host 半区冒烟测试（fixture 注入，26 项断言）
node scripts/smoke-dshtoken-host.js
```

## License

MIT
