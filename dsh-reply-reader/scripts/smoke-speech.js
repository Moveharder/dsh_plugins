/* Smoke test — dsh-reply-reader reading state machine (no browser).
 *
 * The speech engine is the only part of this plugin that cannot be checked by
 * reading the source: pause / resume / stop interact with a stateful platform
 * API and with timers. This harness loads lib/client.js against a fake
 * `speechSynthesis` + virtual clock and exercises both pause paths:
 *
 *   1. the engine honours `pause()`  → the queue holds, resume continues;
 *   2. the engine ignores `pause()`  → resume replays the chunk in flight.
 *
 * Console copy comes from the real dictionaries (the locale service is faked),
 * so a missing key surfaces here as well.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let failures = 0
function assert(cond, label) {
  if (cond) console.log('  ✓ ' + label)
  else { failures++; console.error('  ✗ ' + label) }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Virtual clock (the engine schedules its pause watchdog on window.setTimeout)
// ---------------------------------------------------------------------------

let now = 0
let timerId = 0
const timers = []
const clock = {
  setTimeout(fn, ms) {
    const id = ++timerId
    timers.push({ id, at: now + (Number(ms) || 0), fn })
    return id
  },
  clearTimeout(id) {
    const index = timers.findIndex((timer) => timer.id === id)
    if (index >= 0) timers.splice(index, 1)
  },
  advance(ms) {
    const target = now + ms
    for (;;) {
      timers.sort((left, right) => left.at - right.at)
      const next = timers[0]
      if (!next || next.at > target) break
      timers.shift()
      now = next.at
      next.fn()
    }
    now = target
  },
  reset() {
    timers.length = 0
    now = 0
  },
}

/** Let queued microtasks (fake cancel errors) run before asserting. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

// ---------------------------------------------------------------------------
// Fake Web Speech API
// ---------------------------------------------------------------------------

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.lang = ''
    this.rate = 1
    this.voice = null
    this.onend = null
    this.onerror = null
  }
}

/**
 * @param options.ignorePause - mimic Chromium platforms where `pause()` leaves
 *   the engine speaking, so the plugin has to rewind on resume.
 */
function makeSynth(options = {}) {
  return {
    spoken: [],
    cancelCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    speaking: false,
    paused: false,
    current: null,
    ignorePause: options.ignorePause === true,
    ignoreResume: options.ignoreResume === true,
    speak(utterance) {
      this.spoken.push(utterance.text)
      this.current = utterance
      this.speaking = true
      this.paused = false
    },
    cancel() {
      this.cancelCalls += 1
      const utterance = this.current
      this.current = null
      this.speaking = false
      this.paused = false
      if (utterance && typeof utterance.onerror === 'function') {
        queueMicrotask(() => utterance.onerror({ error: 'canceled' }))
      }
    },
    pause() {
      this.pauseCalls += 1
      if (this.ignorePause) return
      if (this.speaking) this.paused = true
    },
    resume() {
      this.resumeCalls += 1
      if (this.ignorePause || this.ignoreResume) return
      if (this.paused) {
        this.paused = false
        this.speaking = true
      }
    },
    getVoices() {
      return [{ name: 'Fake Voice', lang: 'en-US', voiceURI: 'fake' }]
    },
    addEventListener() {},
    removeEventListener() {},
    /** Test helper: the current utterance reached its end. */
    finish() {
      const utterance = this.current
      this.current = null
      this.speaking = false
      if (utterance && typeof utterance.onend === 'function') utterance.onend()
    },
  }
}

function installGlobals(synth) {
  const window = {
    speechSynthesis: synth,
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  }
  globalThis.window = window
  globalThis.document = {
    baseURI: 'http://127.0.0.1:3080/',
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  }
  globalThis.SpeechSynthesisUtterance = FakeUtterance
  return window
}

const React = {
  Fragment: Symbol.for('react.fragment'),
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
}

// ---------------------------------------------------------------------------
// Load the browser bundle
// ---------------------------------------------------------------------------

let bundle = null
installGlobals(makeSynth())
globalThis.window.__ModuleLoader__ = { load: (entry) => { bundle = entry } }
await import(pathToFileURL(path.join(ROOT, 'lib', 'client.js')).href)
if (bundle === null) {
  console.error('bundle 没有调用 __ModuleLoader__.load')
  process.exit(1)
}
const plugin = bundle.factory((id) => {
  if (id === 'react') return React
  throw new Error('未预期的 require: ' + id)
})

/** Mount the plugin on a fake Client context and hand back its speech facade. */
function applyPlugin(synth) {
  installGlobals(synth)
  const entries = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
    },
    slots: {
      inject(name, register) { register() },
      register(config, component) {
        entries.push({ config, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  const main = entries.find((entry) => entry.config.name === 'main')
  if (!main) throw new Error('main 面板没有注册')
  return { readAloud: main.config.inject().readAloud, entries }
}

const sentence = 'This sentence is long enough on its own to make the reader accumulate a sizeable buffer before it splits. '
const longText = sentence.repeat(6)

console.log('\n[native pause]')
{
  clock.reset()
  const synth = makeSynth()
  const { readAloud } = applyPlugin(synth)
  clock.advance(500) // let the initial voice refresh land

  readAloud.play('reply:1', longText)
  assert(synth.spoken.length === 1, 'play() 只把第一个块交给引擎')
  assert(readAloud.speech.getState().status === 'speaking', '状态为 speaking')
  // `play()` clears any stray engine queue first; count from that baseline.
  const cancelBase = synth.cancelCalls

  synth.finish()
  assert(synth.spoken.length === 2, '块结束后自动续读下一块')

  readAloud.pause()
  assert(readAloud.speech.getState().status === 'paused', 'pause() 后状态为 paused')
  assert(readAloud.speech.getState().key === 'reply:1', '暂停保留 key（界面仍知道在读哪条）')
  assert(synth.pauseCalls === 1 && synth.paused === true, '调用平台 pause()，引擎确认已暂停')

  clock.advance(400)
  assert(synth.cancelCalls === cancelBase, '引擎支持暂停时不做 rewind（不丢当前句）')

  readAloud.resume()
  assert(readAloud.speech.getState().status === 'speaking', 'resume() 后状态回到 speaking')
  assert(synth.resumeCalls === 1, '调用平台 resume()')
  assert(synth.spoken.length === 2, '恢复不重读当前块')

  readAloud.stop()
  assert(readAloud.speech.getState().status === 'idle', 'stop() 回到 idle')
  assert(synth.cancelCalls === cancelBase + 1, 'stop() 取消引擎队列')
  await settle()
  assert(readAloud.speech.getState().status === 'idle', '被取消的 utterance 不会把状态改成 error')
}

console.log('\n[paused engine drops the utterance]')
{
  clock.reset()
  const synth = makeSynth()
  const { readAloud } = applyPlugin(synth)
  clock.advance(500)

  readAloud.play('reply:2', longText)
  synth.finish()
  readAloud.pause()
  const spokenBefore = synth.spoken.length
  // Some engines end the utterance instead of holding it; the queue must stay
  // paused rather than either finishing or reading the next chunk.
  synth.finish()
  assert(readAloud.speech.getState().status === 'paused', '迟到的 onend 不会结束暂停状态')
  assert(synth.spoken.length === spokenBefore, '迟到的 onend 不会偷偷续读')

  readAloud.resume()
  assert(readAloud.speech.getState().status === 'speaking', 'resume() 后回到 speaking')
  assert(synth.spoken.length === spokenBefore + 1, 'resume() 从下一块继续')
  readAloud.stop()
}

console.log('\n[engine ignores pause → rewind]')
{
  clock.reset()
  const synth = makeSynth({ ignorePause: true })
  const { readAloud } = applyPlugin(synth)
  clock.advance(500)

  readAloud.play('reply:3', longText)
  const cancelBase = synth.cancelCalls
  synth.finish()
  const chunkInFlight = synth.spoken[synth.spoken.length - 1]

  readAloud.pause()
  assert(readAloud.speech.getState().status === 'paused', 'pause() 后状态为 paused')
  clock.advance(400)
  assert(synth.cancelCalls === cancelBase + 1, '看门狗发现引擎仍在朗读，取消当前块')

  readAloud.resume()
  const replayed = synth.spoken[synth.spoken.length - 1]
  assert(replayed === chunkInFlight, 'resume() 从当前块开头重读（有重叠，不丢内容）')
  assert(readAloud.speech.getState().status === 'speaking', '重读后状态为 speaking')
  clock.advance(400)
  assert(readAloud.speech.getState().status === 'speaking', '重读不会被取消')

  readAloud.stop()
  await settle()
  assert(readAloud.speech.getState().status === 'idle', 'stop() 之后回到 idle')
}

console.log('\n[engine refuses resume → rewind]')
{
  clock.reset()
  const synth = makeSynth({ ignoreResume: true })
  const { readAloud } = applyPlugin(synth)
  clock.advance(500)

  readAloud.play('reply:4', longText)
  const cancelBase = synth.cancelCalls
  synth.finish()
  const chunkInFlight = synth.spoken[synth.spoken.length - 1]

  readAloud.pause()
  clock.advance(400)
  assert(synth.cancelCalls === cancelBase, 'pause 生效时不做 rewind')
  readAloud.resume()
  assert(synth.spoken[synth.spoken.length - 1] === chunkInFlight, 'resume 先是原样恢复当前块')
  clock.advance(400)
  assert(synth.cancelCalls === cancelBase + 1, '引擎拒绝 resume 后取消并重读')
  assert(synth.spoken[synth.spoken.length - 1] === chunkInFlight, '重读的是同一块，不跳内容')
  assert(readAloud.speech.getState().status === 'speaking', '重读后仍在朗读')
  readAloud.stop()
}

console.log('\n[idle guards]')
{
  clock.reset()
  const synth = makeSynth()
  const { readAloud } = applyPlugin(synth)
  readAloud.pause()
  readAloud.resume()
  assert(readAloud.speech.getState().status === 'idle', '空闲时 pause/resume 无副作用')
  assert(synth.pauseCalls === 0 && synth.resumeCalls === 0, '空闲时不触碰平台 API')
}

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
