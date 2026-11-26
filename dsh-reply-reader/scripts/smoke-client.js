/* Smoke test — dsh-reply-reader client half (static analysis, no browser).
 *
 * 覆盖：
 *  - bundle 契约：__ModuleLoader__ id = 包名、factory(require)、只依赖 react
 *  - 激活契约：exports.inject 只声明必需服务（slots + locale）
 *  - 四个挂载点都存在：sidebar.panellist / main / assistant-actions / composer.dock
 *  - 版本块走 hostUrl()（不写死根绝对路径），三条 host 路由都被使用
 *  - 不引用 @deepseek-ai/dsh-client-ui-primitives、不污染 document.body
 *  - 样式注入 head 且卸载时移除；class 统一 dsh-ra- 前缀
 *  - 中英文字典键完全对齐，t() 引用的键都存在
 *  - 朗读偏好键带插件前缀；自动朗读默认开启且只读挂载后新回复
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0
function assert(cond, label) {
  if (cond) console.log('  ✓ ' + label)
  else { failures++; console.error('  ✗ ' + label) }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

console.log('\n[bundle contract]')
const body = SRC.replace(/^\/\*[\s\S]*?\*\/\s*/, '')
assert(body.startsWith('window.__ModuleLoader__.load({'), 'bundle 以 __ModuleLoader__.load 开头')
assert(SRC.includes("id: '" + pkg.name + "'"), 'bundle id = 包名')
assert(/factory\(require\)\s*\{/.test(SRC), 'factory(require) 形式')
const required = [...SRC.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
assert(required.length > 0 && required.every((name) => name === 'react'), '只 require 基线模块 react（实际: ' + required.join(', ') + '）')
assert(SRC.includes("const inject = ['slots', 'locale']"), 'client inject 只声明 slots + locale')
assert(!/require\('@deepseek-ai\//.test(SRC), '不加载任何 Harness Client 包')
assert(!SRC.includes('dsh-client-ui-primitives'), '不引用 ui-primitives')

console.log('\n[surfaces]')
for (const slot of ['sidebar.panellist', 'main', 'conversation.chat.assistant-actions', 'conversation.composer.dock', 'conversation.input.left']) {
  assert(SRC.includes("inject('" + slot + "'"), '挂载点: ' + slot)
}
assert(SRC.includes("id: PANEL_ID") && SRC.includes("key: PANEL_ID"), '侧栏 id 与 main 面板 key 共用 PANEL_ID')
assert(SRC.includes("id: PANEL_ID + '-auto'"), '自动朗读驱动器使用独立 id')
assert(SRC.includes('messageId'), '回复按钮接收 messageId')
assert(SRC.includes('useChat('), '通过 useChat 读取 Chat 快照')

console.log('\n[host bridge]')
assert(SRC.includes('function hostUrl('), '存在 hostUrl() 解析 host 路由')
assert(!/fetch\(\s*['"]\//.test(SRC), '没有写死根绝对路径的 fetch')
assert((SRC.match(/fetch\(hostUrl\(/g) || []).length === 2, '两处 fetch 都经 hostUrl()')
assert(SRC.includes("hostUrl('read-aloud/meta')"), '读取 /read-aloud/meta')
assert(SRC.includes("'read-aloud/check-update'"), '调用 /read-aloud/check-update')
assert(SRC.includes("'read-aloud/upgrade'"), '调用 /read-aloud/upgrade')

console.log('\n[resources]')
assert(SRC.includes('document.head.appendChild(style)'), '样式注入 head')
assert(SRC.includes('return () => style.remove()'), '卸载时移除注入的样式')
assert(!/document\.body\.appendChild/.test(SRC), '不向 document.body 追加节点')
const css = SRC.slice(SRC.indexOf('const CSS = `'), SRC.indexOf('`\n\n    // ---------------------------------------------------------------------\n    // Plugin'))
const classNames = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
assert(classNames.length > 5 && classNames.every((name) => name.startsWith('dsh-ra-')), '样式 class 统一 dsh-ra- 前缀（' + classNames.length + ' 个）')
assert(!css.includes('!important'), '样式不使用 !important')
assert(css.includes('var(--dsw-alias-'), '样式使用宿主主题 token')

console.log('\n[copy]')
const enStart = SRC.indexOf('en: {')
const zhStart = SRC.indexOf('zh: {')
assert(enStart > 0 && zhStart > enStart, '找到 en/zh 字典')
const enBlock = SRC.slice(enStart, zhStart)
const zhEnd = SRC.indexOf('\n      },\n    }', zhStart)
const zhBlock = SRC.slice(zhStart, zhEnd > 0 ? zhEnd : SRC.length)
const keysOf = (block) => [...new Set([...block.matchAll(/'([a-zA-Z0-9_.-]+)':/g)].map((m) => m[1]))].sort()
const enKeys = keysOf(enBlock)
const zhKeys = keysOf(zhBlock)
assert(enKeys.length > 20, '英文字典有 ' + enKeys.length + ' 个键')
assert(JSON.stringify(enKeys) === JSON.stringify(zhKeys), '中英文字典键完全对齐')
const used = [...new Set([...SRC.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]))].filter((key) => key !== 'style')
const missing = used.filter((key) => !enKeys.includes(key))
assert(missing.length === 0, 't() 引用的键都在字典里' + (missing.length ? '（缺: ' + missing.join(', ') + '）' : ''))
assert(enKeys.includes('update.upgrade') && enKeys.includes('update.stale') && enKeys.includes('update.local'), '更新相关文案齐全')

console.log('\n[reading behaviour]')
assert(SRC.includes("localStorage.getItem(STORAGE_KEY)") || SRC.includes('localStorage.getItem(STORAGE_KEY)'), '偏好读取走 STORAGE_KEY')
assert(SRC.includes("const STORAGE_KEY = 'dsh.read-aloud.settings.v1'"), '偏好键带插件前缀')
assert(/autoRead: true/.test(SRC), '自动朗读默认开启')
assert(SRC.includes('const mountedAt = React.useRef(Date.now())'), '自动朗读以挂载时刻为界，只读新回复')
assert(SRC.includes("startsWith('auto:')"), '自动朗读不打断手动朗读')
assert(SRC.includes('SpeechSynthesisUtterance'), '使用 Web Speech API（免费的系统语音）')
assert(SRC.includes('splitChunks(') && SRC.includes('plainText('), '长文本切块 + Markdown 清洗')
assert(SRC.includes("role: 'switch'"), '自动朗读是 aria switch')
assert(SRC.includes("status: 'paused'") && SRC.includes('synth.pause()') && SRC.includes('synth.resume()'), '朗读支持暂停 / 继续')
assert(SRC.includes('const rewind = () =>'), '平台忽略 pause 时回退到重读当前块')
assert(SRC.includes("if (current.status === 'paused') return"), '暂停中的朗读不会被新的自动朗读顶掉')

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
