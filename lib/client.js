/**
 * Browser half of DSH Reply Reader (dsh-reply-reader).
 *
 * It owns the whole reading feature:
 * - a left sidebar panel entry plus its settings page (`sidebar.panellist`
 *   and the `main` panel with the same id),
 * - a speaker action on every settled assistant reply
 *   (`conversation.chat.assistant-actions`),
 * - an ambient driver that reads new replies when auto-read is on
 *   (`conversation.composer.dock`),
 * - a version / online-update block on the panel fed by the host half's
 *   `/read-aloud/meta` route.
 *
 * Speech comes from the Web Speech API (`window.speechSynthesis`), which plays
 * the operating system voices: no network, account, or API key is involved.
 */
window.__ModuleLoader__.load({
  id: 'dsh-reply-reader',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Client locale namespace owned by this plugin. */
    const NS = 'readAloud'
    /** Sidebar entry id; the same id addresses the matching main panel. */
    const PANEL_ID = 'read-aloud'
    /** Browser-local preference key. */
    const STORAGE_KEY = 'dsh.read-aloud.settings.v1'
    /** Longest utterance chunk; short chunks keep Chromium from stalling. */
    const CHUNK_LIMIT = 180

    /** Client copy, keyed the same way in both baseline locales. */
    const DICTS = {
      en: {
        'panel.label': 'Read aloud',
        'page.title': 'Read aloud',
        'page.subtitle': 'Listen to assistant replies with the browser speech synthesis that uses your system voices. Free, no account, and no network call.',
        'page.hint': 'Every settled reply also carries a speaker button beside its copy action. While something is being read, the composer tool row shows pause / resume and stop, and the reply being read swaps its speaker for the same pair.',
        'auto.title': 'Read new replies automatically',
        'auto.desc': 'Speak the final reply of a turn as soon as it settles in the conversation you are viewing.',
        'voice.title': 'Voice',
        'voice.desc': 'Voices are installed by the operating system. Messages in another language fall back to the matching system voice.',
        'voice.default': 'System default',
        'voice.none': 'No system voices were reported yet. Install a voice in your system settings, then reload the page.',
        'voice.count': '{count} voices available',
        'rate.title': 'Speed',
        'rate.desc': 'Applies to every reading, including replies you start from the conversation.',
        'action.sample': 'Play sample',
        'action.stop': 'Stop',
        'action.pause': 'Pause',
        'action.resume': 'Resume',
        'action.speak': 'Read this reply',
        'transport.title': 'Reading controls',
        'status.idle': 'Ready',
        'status.speaking': 'Reading…',
        'status.paused': 'Paused',
        'status.error': 'Speech synthesis failed ({code}). Try another voice or reload the page.',
        'unsupported.title': 'Speech synthesis is unavailable',
        'unsupported.desc': 'This browser does not expose the Web Speech API, so replies cannot be read aloud here. The setting stays saved for a browser that supports it.',
        'sample': 'Hello, this is DSH Reply Reader. This is a short sample to check that reading replies aloud works.',
        'footer': 'Powered by the built-in Web Speech API (speechSynthesis). Everything stays on this device.',
        'update.title': 'Version',
        'update.current': 'Current v{version}',
        'update.latest': 'Latest v{version}',
        'update.latestNone': 'No published version / offline',
        'update.unchecked': 'Not checked yet',
        'update.loading': 'Reading…',
        'update.check': 'Check for updates',
        'update.checking': 'Checking…',
        'update.upgrade': 'Update to v{version}',
        'update.upgrading': 'Updating…',
        'update.available': 'update available',
        'update.upToDate': 'up to date',
        'update.disabled': 'update checks are disabled',
        'update.local': 'Local install ({spec}): edit the source directly; online updates are skipped.',
        'update.stale': 'Installed v{installed} but this process still runs v{version}. Restart dsh web to load it.',
        'update.hostError': 'Host half unreachable: {error}',
      },
      zh: {
        'panel.label': '朗读',
        'page.title': '朗读',
        'page.subtitle': '用浏览器内置的语音合成朗读助手回复，直接使用系统语音：免费、无需账号，也不会发起网络请求。',
        'page.hint': '对话中每条已完成的回复旁边都有一个扬声器按钮；朗读时，输入框工具栏会出现「暂停 / 继续」和「停止」，正在朗读的那条回复也会把扬声器换成同一组按钮。',
        'auto.title': '自动朗读新回复',
        'auto.desc': '当前对话的一轮结束后，自动朗读这一轮的最后一条回复。',
        'voice.title': '语音',
        'voice.desc': '语音由操作系统提供。遇到其他语言的消息时，会自动改用对应的系统语音。',
        'voice.default': '系统默认',
        'voice.none': '还没有读取到系统语音。请先在系统设置中安装语音，然后刷新页面。',
        'voice.count': '可用语音 {count} 个',
        'rate.title': '语速',
        'rate.desc': '对所有朗读生效，包括在对话中手动开始的朗读。',
        'action.sample': '试听',
        'action.stop': '停止',
        'action.pause': '暂停',
        'action.resume': '继续',
        'action.speak': '朗读这条回复',
        'transport.title': '朗读控制',
        'status.idle': '就绪',
        'status.speaking': '正在朗读…',
        'status.paused': '已暂停',
        'status.error': '语音合成失败（{code}）。请换一个语音或刷新页面。',
        'unsupported.title': '当前环境不支持语音合成',
        'unsupported.desc': '这个浏览器没有提供 Web Speech API，因此无法朗读。设置会保留下来，在支持该接口的浏览器中继续生效。',
        'sample': '你好，这里是 DSH Reply Reader。这是一段试听，用来确认朗读回复的功能正常工作。',
        'footer': '由浏览器内置的 Web Speech API（speechSynthesis）提供支持，全部在本机完成。',
        'update.title': '版本',
        'update.current': '当前 v{version}',
        'update.latest': '最新 v{version}',
        'update.latestNone': '未发布 / 离线',
        'update.unchecked': '未检测',
        'update.loading': '读取中…',
        'update.check': '检测更新',
        'update.checking': '检测中…',
        'update.upgrade': '升级到 v{version}',
        'update.upgrading': '升级中…',
        'update.available': '有更新',
        'update.upToDate': '已是最新',
        'update.disabled': '更新检查已关闭',
        'update.local': '本地安装（{spec}）：直接改源码即可，在线升级已自动跳过。',
        'update.stale': '安装包已是 v{installed}，当前进程仍是 v{version}。请重启 dsh web 生效。',
        'update.hostError': 'Host 半区未就绪：{error}',
      },
    }

    // ---------------------------------------------------------------------
    // Text preparation
    // ---------------------------------------------------------------------

    /**
     * Collect the prose of one assistant message from its content blocks.
     * @param blocks - assistant content blocks carrying `kind` and `text`.
     * @returns the visible text, or an empty string.
     */
    function replyTextFromBlocks(blocks) {
      if (!Array.isArray(blocks)) return ''
      const parts = []
      for (const block of blocks) {
        if (block && block.kind === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
      return parts.join('\n').trim()
    }

    /**
     * Turn Markdown into text that is pleasant to listen to: code, tables, and
     * markup punctuation are dropped instead of read out symbol by symbol.
     * @param markdown - raw assistant Markdown.
     * @returns plain text.
     */
    function plainText(markdown) {
      if (typeof markdown !== 'string') return ''
      let text = markdown
      text = text.replace(/```[\s\S]*?```/g, ' ')
      text = text.replace(/`([^`]*)`/g, '$1')
      text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      text = text.replace(/<[^>]+>/g, ' ')
      text = text.replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      text = text.replace(/^\s*[-:]{3,}\s*$/gm, ' ')
      text = text.replace(/[*_~]{1,3}/g, '')
      text = text.replace(/\|/g, ' ')
      text = text.replace(/[ \t]+/g, ' ')
      text = text.replace(/\n{2,}/g, '\n')
      return text.trim()
    }

    /**
     * Split long text at sentence boundaries so each utterance stays short.
     * @param text - plain text.
     * @returns utterance-sized pieces.
     */
    function splitChunks(text) {
      const pieces = []
      let buffer = ''
      for (const char of text) {
        buffer += char
        const boundary = /[。！？!?；;.\n]/.test(char)
        if ((buffer.length >= CHUNK_LIMIT && boundary) || buffer.length >= CHUNK_LIMIT * 1.6) {
          const piece = buffer.trim()
          if (piece) pieces.push(piece)
          buffer = ''
        }
      }
      const tail = buffer.trim()
      if (tail) pieces.push(tail)
      return pieces
    }

    /**
     * Normalize an event time that may be an epoch number, a Date, or a string.
     * @param value - raw time.
     * @returns epoch milliseconds, or 0.
     */
    function timeValue(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (value instanceof Date) return value.getTime()
      if (typeof value === 'string') {
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : 0
      }
      return 0
    }

    // ---------------------------------------------------------------------
    // Chat snapshot readers
    // ---------------------------------------------------------------------

    /**
     * Visible assistant node that finalized the given message.
     * @param snapshot - Chat target snapshot supplied by `useChat`.
     * @param messageId - durable message identity of the reply.
     * @returns the reply text, or an empty string.
     */
    function textForMessage(snapshot, messageId) {
      try {
        const nodes = snapshot && snapshot.nodes
        if (!nodes || typeof nodes.values !== 'function') return ''
        let found = ''
        for (const node of nodes.values()) {
          if (!node || node.kind !== 'assistant-step' || !node.data) continue
          const final = node.data.finalNode
          if (!final || final.messageId !== messageId) continue
          const text = replyTextFromBlocks(node.data.blocks) || replyTextFromBlocks(final.blocks)
          if (text) found = text
        }
        return found
      } catch {
        return ''
      }
    }

    /**
     * Newest settled assistant reply in the loaded conversation.
     * @param snapshot - Chat target snapshot supplied by `useChat`.
     * @returns the node, its text, coordinates, and settlement time.
     */
    function latestReply(snapshot) {
      try {
        const nodes = snapshot && snapshot.nodes
        if (!nodes || typeof nodes.values !== 'function') return null
        let best = null
        for (const node of nodes.values()) {
          if (!node || node.kind !== 'assistant-step' || !node.data) continue
          if (node.visibility === 'hidden') continue
          const data = node.data
          const final = data.finalNode
          if (!final) continue
          const text = replyTextFromBlocks(data.blocks) || replyTextFromBlocks(final.blocks)
          if (!text) continue
          const turn = Number(data.turn) || 0
          const step = Number(data.step) || 0
          if (best !== null && (turn < best.turn || (turn === best.turn && step <= best.step))) continue
          best = { node, text, turn, step, time: timeValue(final.time) || timeValue(data.time) }
        }
        return best
      } catch {
        return null
      }
    }

    /** Selector: identity of the newest settled reply. */
    function latestReplyKey(snapshot) {
      const best = latestReply(snapshot)
      return best === null ? '' : String(best.node.key || best.turn + ':' + best.step)
    }

    /** Selector: text of the newest settled reply. */
    function latestReplyText(snapshot) {
      const best = latestReply(snapshot)
      return best === null ? '' : best.text
    }

    /** Selector: settlement time of the newest settled reply. */
    function latestReplyTime(snapshot) {
      const best = latestReply(snapshot)
      return best === null ? 0 : best.time
    }

    // ---------------------------------------------------------------------
    // Preference store
    // ---------------------------------------------------------------------

    /**
     * Browser-local preferences with a tiny observable interface.
     * @returns the settings store.
     */
    function createSettings() {
      const listeners = new Set()
      const defaults = { autoRead: true, voiceURI: '', rate: 1 }

      const load = () => {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY)
          if (!raw) return { ...defaults }
          const saved = JSON.parse(raw)
          const rate = typeof saved.rate === 'number' && saved.rate >= 0.5 && saved.rate <= 2 ? saved.rate : defaults.rate
          return {
            autoRead: typeof saved.autoRead === 'boolean' ? saved.autoRead : defaults.autoRead,
            voiceURI: typeof saved.voiceURI === 'string' ? saved.voiceURI : '',
            rate,
          }
        } catch {
          return { ...defaults }
        }
      }

      let state = load()
      return {
        getState: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        update(patch) {
          state = { ...state, ...patch }
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
          } catch {
            /* Preferences stay in memory when storage is unavailable. */
          }
          for (const listener of listeners) listener()
        },
      }
    }

    // ---------------------------------------------------------------------
    // Host bridge: version and the online-update channel
    // ---------------------------------------------------------------------

    /**
     * Resolve one host route against the document base instead of hardcoding a
     * root-absolute path (the Web UI may be mounted below a path prefix).
     * @param path - route below the plugin prefix, without a leading slash.
     * @returns absolute URL string for fetch().
     */
    function hostUrl(path) {
      try {
        return new URL(path, document.baseURI).href
      } catch {
        return path
      }
    }

    /**
     * Version / upgrade store backed by the host half's read-only routes.
     * Loaded lazily: the panel asks on mount, the icon only reads its snapshot.
     * A failed host call never affects reading — it only fills an error line.
     * @returns the meta store.
     */
    function createMetaStore() {
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      let state = { meta: null, loading: false, checking: false, upgrading: false, error: '', notice: '' }
      let inFlight = null

      const load = () => {
        if (inFlight) return inFlight
        state = { ...state, loading: true }
        emit()
        inFlight = (async () => {
          try {
            const res = await fetch(hostUrl('read-aloud/meta'), { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const meta = await res.json()
            state = { ...state, meta, loading: false, error: '' }
          } catch (err) {
            state = { ...state, loading: false, error: String((err && err.message) || err) }
          } finally {
            inFlight = null
            emit()
          }
          return state
        })()
        return inFlight
      }

      const post = async (route, patch) => {
        state = { ...state, ...patch, notice: '' }
        emit()
        try {
          const res = await fetch(hostUrl(route), { method: 'POST', headers: { accept: 'application/json' } })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const meta = await res.json()
          state = { ...state, meta, error: '', notice: (meta && meta.upgrade && meta.upgrade.message) || '' }
        } catch (err) {
          state = { ...state, error: String((err && err.message) || err) }
        } finally {
          state = { ...state, loading: false, checking: false, upgrading: false }
          emit()
        }
        return state
      }

      return {
        getState: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        load,
        /** Force one registry check (ignores the host's 6h cadence). */
        check: () => post('read-aloud/check-update', { checking: true }),
        /** Ask the host to upgrade the profile; local installs are refused with a reason. */
        upgrade: () => post('read-aloud/upgrade', { upgrading: true }),
      }
    }

    // ---------------------------------------------------------------------
    // Speech engine
    // ---------------------------------------------------------------------

    /**
     * Speech synthesis over the free Web Speech API.
     *
     * One reading is a chunk queue driven by `onend`: exactly one utterance is
     * in the engine at a time, so `stop()` is a single cancel and `pause()` has
     * a reading to hold instead of a whole queued script.
     *
     * @param settings - preference store read at utterance time.
     * @returns the speech service.
     */
    function createSpeech(settings) {
      const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined
      const supported = Boolean(synth) && typeof SpeechSynthesisUtterance !== 'undefined'
      const listeners = new Set()
      let voices = []
      /** The reading in flight, or null when idle. */
      let active = null
      let state = { key: null, status: 'idle', error: null, voiceVersion: 0 }

      const publish = (next) => {
        state = { ...next, voiceVersion: state.voiceVersion }
        for (const listener of listeners) listener()
      }

      const refreshVoices = () => {
        if (!supported) return
        const list = synth.getVoices()
        voices = Array.isArray(list) ? Array.from(list) : []
        state = { ...state, voiceVersion: state.voiceVersion + 1 }
        for (const listener of listeners) listener()
      }

      /**
       * Register the platform voice feed and its async population.
       * @returns disposer.
       */
      const start = () => {
        if (!supported) return () => {}
        refreshVoices()
        const onVoicesChanged = () => refreshVoices()
        if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', onVoicesChanged)
        else synth.onvoiceschanged = onVoicesChanged
        // Chromium fills the catalog one tick after the first read.
        const timer = window.setTimeout(refreshVoices, 400)
        return () => {
          window.clearTimeout(timer)
          if (typeof synth.removeEventListener === 'function') synth.removeEventListener('voiceschanged', onVoicesChanged)
          else if (synth.onvoiceschanged === onVoicesChanged) synth.onvoiceschanged = null
        }
      }

      /** Ask the engine to drop whatever it is speaking, without publishing. */
      const silence = () => {
        try { synth.cancel() } catch { /* engine already gone */ }
      }

      const stop = () => {
        const reading = active
        active = null
        if (reading !== null) reading.abort()
        else if (supported) silence()
        if (state.status !== 'idle' || state.key !== null) publish({ key: null, status: 'idle', error: null })
      }

      const pause = () => {
        if (active !== null) active.pause()
      }

      const resume = () => {
        if (active !== null) active.resume()
      }

      const chooseVoice = () => {
        const { voiceURI } = settings.getState()
        const matched = voiceURI ? voices.find((voice) => voice.voiceURI === voiceURI || voice.name === voiceURI) : undefined
        if (matched !== undefined) return matched
        return undefined
      }

      const languageOf = (text) => (/\p{Script=Han}|[\u3040-\u30ff]/u.test(text) ? 'zh-CN' : 'en-US')

      /**
       * Read one text aloud, replacing any current reading.
       * @param key - identity used by the surfaces to show the reading state.
       * @param raw - reply text or sample copy.
       */
      const play = (key, raw) => {
        const text = plainText(raw)
        if (!supported || text === '') return
        const chunks = splitChunks(text)
        if (chunks.length === 0) return
        // Chromium may ignore `speak` issued in the same task as `cancel`, so a
        // replacement reading starts one short tick later.
        const replacing = active !== null
        stop()
        const voice = chooseVoice()
        const rate = settings.getState().rate
        const lang = voice !== undefined ? voice.lang : languageOf(text)
        let index = 0
        // Bumped whenever an utterance is orphaned (cancel by us); late events
        // from the orphan still fire, and must not steer the new queue.
        let token = 0
        let alive = true
        let paused = false
        /** Utterance handed to the engine and not finished yet. */
        let current = null

        const finish = () => {
          if (!alive) return
          alive = false
          if (active === reading) active = null
          publish({ key: null, status: 'idle', error: null })
        }

        const fail = (code) => {
          if (!alive) return
          alive = false
          if (active === reading) active = null
          publish({ key: null, status: 'error', error: code })
        }

        /** Drop the utterance in flight and replay its chunk on resume. */
        const rewind = () => {
          token += 1
          if (index > 0) index -= 1
          current = null
          silence()
        }

        const readNext = () => {
          if (!alive || paused) return
          if (index >= chunks.length) {
            finish()
            return
          }
          const utterance = new SpeechSynthesisUtterance(chunks[index])
          const myToken = token
          index += 1
          current = utterance
          if (voice !== undefined) utterance.voice = voice
          utterance.lang = lang
          utterance.rate = rate
          utterance.onend = () => {
            if (!alive || myToken !== token) return
            current = null
            // A paused queue holds here until `resume()` reads on.
            if (paused) return
            readNext()
          }
          utterance.onerror = (event) => {
            if (!alive || myToken !== token) return
            current = null
            if (paused) return
            const code = event && typeof event.error === 'string' ? event.error : 'unknown'
            // A canceled reading is the normal result of `stop()`.
            if (code === 'canceled' || code === 'interrupted') {
              finish()
              return
            }
            fail(code)
          }
          try {
            synth.speak(utterance)
          } catch {
            fail('unknown')
          }
        }

        /**
         * Hold the queue where it is. The platform pause is tried first because
         * it keeps the played audio; Chromium has long-standing bugs where
         * `pause()` is ignored or freezes the queue, so one watchdog check
         * decides whether resume has to replay the chunk instead.
         */
        const pauseReading = () => {
          if (!alive || paused) return
          paused = true
          publish({ key, status: 'paused', error: null })
          try { synth.pause() } catch { /* engine refused; watchdog decides */ }
          window.setTimeout(() => {
            if (!alive || !paused) return
            if (current === null) return
            if (synth.paused) return
            if (!synth.speaking) {
              current = null
              return
            }
            rewind()
          }, 250)
        }

        const resumeReading = () => {
          if (!alive || !paused) return
          paused = false
          publish({ key, status: 'speaking', error: null })
          if (synth.paused) {
            try { synth.resume() } catch { /* restart below */ }
          }
          // The engine may claim to be paused and never continue; the chunk is
          // replayed from its start then (a sentence of overlap, never a gap).
          if (current === null) {
            readNext()
            return
          }
          window.setTimeout(() => {
            if (!alive || paused) return
            if (current === null) return
            // Still paused (resume refused) or no longer speaking (dropped):
            // either way the chunk has to be replayed.
            if (synth.speaking && !synth.paused) return
            rewind()
            window.setTimeout(() => { if (alive && !paused) readNext() }, 80)
          }, 200)
        }

        const abort = () => {
          if (!alive) return
          alive = false
          token += 1
          current = null
          silence()
        }

        const reading = { pause: pauseReading, resume: resumeReading, abort }
        active = reading
        publish({ key, status: 'speaking', error: null })
        if (replacing) window.setTimeout(readNext, 80)
        else readNext()
      }

      return {
        supported,
        start,
        stop,
        pause,
        resume,
        play,
        getVoices: () => voices,
        getState: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    // ---------------------------------------------------------------------
    // Hooks
    // ---------------------------------------------------------------------

    /**
     * Subscribe a component to one observable store.
     * @param store - object with `getState` and `subscribe`.
     * @returns the current snapshot.
     */
    function useStore(store) {
      const [snapshot, setSnapshot] = React.useState(() => store.getState())
      React.useEffect(() => {
        setSnapshot(store.getState())
        return store.subscribe(() => setSnapshot(store.getState()))
      }, [store])
      return snapshot
    }

    // ---------------------------------------------------------------------
    // Icons
    // ---------------------------------------------------------------------

    /**
     * Speaker glyph shared by the panel icon and the reply action.
     * @param dot - draw the small "update available" dot inside the glyph.
     */
    function SpeakerGlyph({ size, dot }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
        },
        h('path', { d: 'M4.2 9.4v5.2h3.3l4.4 3.6V5.8L7.5 9.4H4.2Z', fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M15.4 8.6a5 5 0 0 1 0 6.8M18.6 6a8.6 8.6 0 0 1 0 12' }),
        dot ? h('circle', { cx: 20.4, cy: 4.2, r: 2.6, fill: 'var(--dsw-alias-state-error-primary,#e5484d)', stroke: 'none' }) : null,
      )
    }

    /** Square stop glyph for a reading that is in progress. */
    function StopGlyph({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2.2, fill: 'currentColor' }),
      )
    }

    /** Two bars: hold the reading where it is. */
    function PauseGlyph({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('rect', { x: 7.4, y: 5.6, width: 3.4, height: 12.8, rx: 1.4, fill: 'currentColor' }),
        h('rect', { x: 13.2, y: 5.6, width: 3.4, height: 12.8, rx: 1.4, fill: 'currentColor' }),
      )
    }

    /** Triangle: continue a paused reading. */
    function PlayGlyph({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M8.2 5.4v13.2L18.9 12 8.2 5.4Z', fill: 'currentColor' }),
      )
    }

    // ---------------------------------------------------------------------
    // Surfaces
    // ---------------------------------------------------------------------

    /**
     * Sidebar entry: the speaker glyph plus a hint dot when a newer version is
     * published. The sidebar owns the accessible row label.
     */
    function ReadAloudIcon({ size, metaStore }) {
      const metaState = useStore(metaStore)
      React.useEffect(() => { void metaStore.load() }, [metaStore])
      return h(SpeakerGlyph, { size: size || 18, dot: !!(metaState.meta && metaState.meta.updateAvailable) })
    }

    /** Settings page of the read-aloud panel. */
    function ReadAloudPage({ t, readAloud, metaStore }) {
      const settings = useStore(readAloud.settings)
      const speech = useStore(readAloud.speech)
      const metaState = useStore(metaStore)
      const voices = readAloud.speech.getVoices()
      // The sample button follows the sample reading only; an automatic reading
      // of a reply must not turn it into "stop".
      const sampleActive = speech.key === 'sample'
      const samplePaused = sampleActive && speech.status === 'paused'

      React.useEffect(() => { void metaStore.load() }, [metaStore])

      // Version / upgrade block: every string follows the host payload, never a
      // hand-written version constant.
      const meta = metaState.meta
      const upgrade = (meta && meta.upgrade) || {}
      const busy = metaState.upgrading || upgrade.running === true
      const canUpgrade = !!(meta && meta.updateAvailable && !meta.stale && !meta.localInstall)
      let versionLine
      if (!meta) {
        versionLine = metaState.error ? t('update.hostError', { error: metaState.error }) : t('update.loading')
      } else if (meta.stale) {
        versionLine = t('update.stale', { version: meta.version, installed: meta.installedVersion })
      } else {
        const current = t('update.current', { version: meta.version })
        const latest = meta.latest
          ? t('update.latest', { version: meta.latest }) + ' · ' + t(meta.updateAvailable ? 'update.available' : 'update.upToDate')
          : (meta.updateChecked ? t('update.latestNone') : t('update.unchecked'))
        versionLine = current + ' · ' + latest + (meta.updateDisabled ? ' · ' + t('update.disabled') : '')
      }
      const updateLabel = busy
        ? t('update.upgrading')
        : metaState.checking
          ? t('update.checking')
          : canUpgrade
            ? t('update.upgrade', { version: meta.latest })
            : t('update.check')
      const updateNotice = upgrade.message || metaState.notice
      const updateError = meta && metaState.error ? t('update.hostError', { error: metaState.error }) : ''

      const options = React.useMemo(() => {
        const sorted = voices.slice().sort((left, right) => {
          const byLanguage = String(left.lang).localeCompare(String(right.lang))
          return byLanguage !== 0 ? byLanguage : String(left.name).localeCompare(String(right.name))
        })
        return sorted.map((voice) => ({ value: voice.voiceURI, label: voice.name + ' · ' + voice.lang }))
      }, [voices])

      const selectedVoice = options.some((option) => option.value === settings.voiceURI) ? settings.voiceURI : ''
      let statusText = t('status.idle')
      if (speech.status === 'error') statusText = t('status.error', { code: speech.error || 'unknown' })
      else if (speech.status === 'paused') statusText = t('status.paused')
      else if (speech.status === 'speaking') statusText = t('status.speaking')
      else if (voices.length === 0) statusText = t('voice.none')
      else statusText = t('voice.count', { count: voices.length })

      return h(
        'div',
        { className: 'dsh-ra-page' },
        h(
          'div',
          { className: 'dsh-ra-scroll' },
          h(
            'div',
            { className: 'dsh-ra-content' },
            h(
              'header',
              { className: 'dsh-ra-heading' },
              h('h1', null, t('page.title')),
              h('p', { className: 'dsh-ra-intro' }, t('page.subtitle')),
            ),
            readAloud.supported
              ? null
              : h(
                  'div',
                  { className: 'dsh-ra-notice', role: 'alert' },
                  h('strong', { className: 'dsh-ra-noticeTitle' }, t('unsupported.title')),
                  h('span', null, t('unsupported.desc')),
                ),
            h(
              'section',
              { className: 'dsh-ra-card' },
              h(
                'div',
                { className: 'dsh-ra-row' },
                h(
                  'div',
                  { className: 'dsh-ra-rowText' },
                  h('span', { className: 'dsh-ra-rowTitle' }, t('auto.title')),
                  h('span', { className: 'dsh-ra-rowDesc' }, t('auto.desc')),
                ),
                h(
                  'div',
                  { className: 'dsh-ra-control' },
                  h('button', {
                    type: 'button',
                    role: 'switch',
                    'aria-checked': settings.autoRead,
                    'aria-label': t('auto.title'),
                    className: 'dsh-ra-switch',
                    onClick: () => readAloud.settings.update({ autoRead: !settings.autoRead }),
                  }),
                ),
              ),
              h(
                'div',
                { className: 'dsh-ra-row' },
                h(
                  'div',
                  { className: 'dsh-ra-rowText' },
                  h('span', { className: 'dsh-ra-rowTitle' }, t('voice.title')),
                  h('span', { className: 'dsh-ra-rowDesc' }, t('voice.desc')),
                ),
                h(
                  'div',
                  { className: 'dsh-ra-control' },
                  h(
                    'select',
                    {
                      className: 'dsh-ra-select',
                      'aria-label': t('voice.title'),
                      value: selectedVoice,
                      disabled: options.length === 0,
                      onChange: (event) => readAloud.settings.update({ voiceURI: event.target.value }),
                    },
                    h('option', { value: '' }, t('voice.default')),
                    options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dsh-ra-row' },
                h(
                  'div',
                  { className: 'dsh-ra-rowText' },
                  h('span', { className: 'dsh-ra-rowTitle' }, t('rate.title')),
                  h('span', { className: 'dsh-ra-rowDesc' }, t('rate.desc')),
                ),
                h(
                  'div',
                  { className: 'dsh-ra-control' },
                  h('input', {
                    type: 'range',
                    className: 'dsh-ra-range',
                    'aria-label': t('rate.title'),
                    min: 0.5,
                    max: 2,
                    step: 0.1,
                    value: settings.rate,
                    onChange: (event) => readAloud.settings.update({ rate: Number(event.target.value) }),
                  }),
                  h('span', { className: 'dsh-ra-value' }, settings.rate.toFixed(1) + '×'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsh-ra-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-ra-button',
                  'data-primary': true,
                  disabled: !readAloud.supported,
                  onClick: () => {
                    if (samplePaused) readAloud.resume()
                    else if (sampleActive) readAloud.pause()
                    else readAloud.play('sample', t('sample'))
                  },
                },
                samplePaused
                  ? h(PlayGlyph, { size: 14 })
                  : sampleActive
                    ? h(PauseGlyph, { size: 14 })
                    : h(SpeakerGlyph, { size: 14 }),
                samplePaused ? t('action.resume') : sampleActive ? t('action.pause') : t('action.sample'),
              ),
              sampleActive
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-ra-button',
                      onClick: () => readAloud.stop(),
                    },
                    h(StopGlyph, { size: 14 }),
                    t('action.stop'),
                  )
                : null,
              h('span', { className: 'dsh-ra-status', role: 'status' }, statusText),
            ),
            h('p', { className: 'dsh-ra-note' }, t('page.hint')),
            h('p', { className: 'dsh-ra-note' }, t('footer')),
            h(
              'section',
              { className: 'dsh-ra-card dsh-ra-version' },
              h(
                'div',
                { className: 'dsh-ra-row' },
                h(
                  'div',
                  { className: 'dsh-ra-rowText' },
                  h('span', { className: 'dsh-ra-rowTitle' }, t('update.title')),
                  h('span', { className: 'dsh-ra-rowDesc' }, versionLine),
                ),
                h(
                  'div',
                  { className: 'dsh-ra-control' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-ra-button',
                      'data-primary': canUpgrade || undefined,
                      disabled: busy || metaState.checking,
                      onClick: () => {
                        if (busy || metaState.checking) return
                        if (canUpgrade) void metaStore.upgrade()
                        else void metaStore.check()
                      },
                    },
                    updateLabel,
                  ),
                ),
              ),
              meta && meta.localInstall
                ? h('p', { className: 'dsh-ra-note dsh-ra-versionNote' }, t('update.local', { spec: meta.localInstall }))
                : null,
              updateNotice ? h('p', { className: 'dsh-ra-note dsh-ra-versionNote' }, updateNotice) : null,
              updateError ? h('p', { className: 'dsh-ra-note dsh-ra-versionError' }, updateError) : null,
            ),
          ),
        ),
      )
    }

    /** Speaker action shown beside copy on every settled assistant reply. */
    function SpeakReplyAction({ messageId, useChat, readAloud, t }) {
      const text = useChat((snapshot) => textForMessage(snapshot, messageId))
      const speech = useStore(readAloud.speech)
      if (!readAloud.supported || text === '') return null
      const key = 'reply:' + messageId
      const active = speech.key === key
      if (!active) {
        const label = t('action.speak')
        return h(
          'button',
          {
            type: 'button',
            className: 'dsh-ra-action',
            'aria-label': label,
            title: label,
            onClick: () => readAloud.play(key, text),
          },
          h(SpeakerGlyph, { size: 15 }),
        )
      }
      const paused = speech.status === 'paused'
      const label = paused ? t('action.resume') : t('action.pause')
      // Reading this reply: the speaker becomes pause/resume, with stop beside
      // it so a paused reading can still be dropped without leaving the row.
      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-ra-action',
            'aria-label': label,
            title: label,
            'aria-pressed': paused,
            'data-active': true,
            onClick: () => {
              if (paused) readAloud.resume()
              else readAloud.pause()
            },
          },
          paused ? h(PlayGlyph, { size: 15 }) : h(PauseGlyph, { size: 15 }),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-ra-action',
            'aria-label': t('action.stop'),
            title: t('action.stop'),
            onClick: () => readAloud.stop(),
          },
          h(StopGlyph, { size: 15 }),
        ),
      )
    }

    /**
     * Compact pause / resume and stop control inside the composer tool row.
     * It exists only while something is being read, so it stays out of the way
     * of the resident chrome and needs no layout room when idle.
     */
    function ReadingControls({ readAloud, t }) {
      const speech = useStore(readAloud.speech)
      if (!readAloud.supported) return null
      if (speech.status !== 'speaking' && speech.status !== 'paused') return null
      const paused = speech.status === 'paused'
      const label = paused ? t('action.resume') : t('action.pause')
      return h(
        'div',
        { className: 'dsh-ra-transport', role: 'group', 'aria-label': t('transport.title') },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-ra-transportButton',
            'aria-label': label,
            title: label,
            'aria-pressed': paused,
            onClick: () => {
              if (paused) readAloud.resume()
              else readAloud.pause()
            },
          },
          paused ? h(PlayGlyph, { size: 13 }) : h(PauseGlyph, { size: 13 }),
          h('span', null, label),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-ra-transportButton',
            'data-icon': true,
            'aria-label': t('action.stop'),
            title: t('action.stop'),
            onClick: () => readAloud.stop(),
          },
          h(StopGlyph, { size: 12 }),
        ),
      )
    }

    /** Invisible driver that reads a reply as soon as its turn settles. */
    function AutoReadDriver({ sessionId, useChat, readAloud }) {
      const key = useChat((snapshot) => latestReplyKey(snapshot))
      const text = useChat((snapshot) => latestReplyText(snapshot))
      const time = useChat((snapshot) => latestReplyTime(snapshot))
      const settings = useStore(readAloud.settings)
      const mountedAt = React.useRef(Date.now())
      const handled = React.useRef('')

      React.useEffect(() => {
        if (key === '' || text === '' || handled.current === key) return
        handled.current = key
        if (!settings.autoRead) return
        // Replies that settled before this panel mounted are history, not news.
        if (time <= mountedAt.current) return
        const current = readAloud.speech.getState()
        // A paused reading is a deliberate hold: a new reply must not resume audio.
        if (current.status === 'paused') return
        // Never interrupt a manual reading with an automatic one.
        if (current.key !== null && !String(current.key).startsWith('auto:')) return
        readAloud.play('auto:' + sessionId + ':' + key, text)
      }, [key, text, time, settings.autoRead, readAloud, sessionId])

      return null
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = `
.dsh-ra-page{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}
.dsh-ra-scroll{scrollbar-gutter:stable;flex:1;min-height:0;overflow:auto}
.dsh-ra-content{max-width:720px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.dsh-ra-heading{padding-top:28px;margin-bottom:24px}
[data-platform=darwin] .dsh-ra-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dsh-ra-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dsh-ra-intro{color:var(--dsw-alias-label-secondary);margin:6px 0 0;font-size:13px;line-height:20px;max-width:56em}
.dsh-ra-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);margin:0 0 20px;padding:0 16px}
.dsh-ra-row{display:flex;justify-content:space-between;align-items:center;gap:24px;min-height:64px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-ra-row:last-child{border-bottom:0}
.dsh-ra-rowText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-ra-rowTitle{font-size:14px;font-weight:500;line-height:22px}
.dsh-ra-rowDesc{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:18px;max-width:34em}
.dsh-ra-control{flex:none;display:flex;align-items:center;gap:10px}
.dsh-ra-switch{position:relative;width:40px;height:24px;padding:0;border:0;border-radius:12px;cursor:pointer;background:var(--dsw-alias-state-idle-primary);transition:background-color .16s ease}
.dsh-ra-switch:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.24);transition:transform .16s ease}
.dsh-ra-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.dsh-ra-switch[aria-checked=true]:after{transform:translateX(16px)}
.dsh-ra-switch:focus-visible,.dsh-ra-select:focus-visible,.dsh-ra-range:focus-visible,.dsh-ra-button:focus-visible,.dsh-ra-action:focus-visible,.dsh-ra-transportButton:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dsh-ra-select{height:32px;max-width:260px;padding:0 30px 0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 16px) 14px,calc(100% - 11px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.dsh-ra-select:disabled{opacity:.5;cursor:default}
.dsh-ra-range{width:150px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsh-ra-value{width:42px;color:var(--dsw-alias-label-secondary);font-size:13px;font-variant-numeric:tabular-nums;text-align:right}
.dsh-ra-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0 0 20px}
.dsh-ra-button{height:32px;padding:0 14px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dsh-ra-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-ra-button:disabled{opacity:.5;cursor:default}
.dsh-ra-button[data-primary]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.dsh-ra-button svg{flex:none}
.dsh-ra-status{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px}
.dsh-ra-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0 0 6px}
.dsh-ra-notice{display:flex;flex-direction:column;gap:4px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0 0 20px;padding:12px 14px;font-size:12.5px;line-height:18px}
.dsh-ra-noticeTitle{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-ra-action{width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;justify-content:center;align-items:center}
.dsh-ra-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-ra-action[data-active]{color:var(--dsw-alias-brand-primary)}
.dsh-ra-action svg{flex:none}
.dsh-ra-transport{display:flex;align-items:center;gap:2px;min-width:0}
.dsh-ra-transportButton{height:24px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.dsh-ra-transportButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ra-transportButton[data-icon]{padding:0 5px}
.dsh-ra-transportButton svg{flex:none}
.dsh-ra-version{margin-top:20px}
.dsh-ra-version .dsh-ra-row{border-bottom:0;padding-bottom:4px}
.dsh-ra-versionNote{margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-ra-versionError{color:var(--dsw-alias-state-error-primary);margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
@media (prefers-reduced-motion:reduce){.dsh-ra-switch,.dsh-ra-switch:after{transition:none}}
`

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    /** Services the browser half needs. */
    const inject = ['slots', 'locale']

    /**
     * Register the sidebar entry, its page, the reply action, and the
     * auto-read driver on the live Client context.
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      const settings = createSettings()
      const speech = createSpeech(settings)
      const metaStore = createMetaStore()
      const readAloud = {
        settings,
        speech,
        supported: speech.supported,
        play: (key, text) => speech.play(key, text),
        pause: () => speech.pause(),
        resume: () => speech.resume(),
        stop: () => speech.stop(),
      }
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-reply-reader'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'read-aloud: styles')

      ctx.effect(() => ctx.locale.register(NS, 'en', DICTS.en), 'read-aloud: English copy')
      ctx.effect(() => ctx.locale.register(NS, 'zh', DICTS.zh), 'read-aloud: Chinese copy')
      ctx.effect(() => speech.start(), 'read-aloud: system voices')
      // Dispose a reading with the plugin so a reload never leaves audio behind.
      ctx.effect(() => () => speech.stop(), 'read-aloud: stop on unload')

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            locale: NS,
            label: () => t('panel.label'),
            inject: () => ({ metaStore }),
          },
          ReadAloudIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ readAloud, metaStore }),
          },
          ReadAloudPage,
        ),
      )

      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: PANEL_ID,
            order: 20,
            locale: NS,
            inject: () => ({ readAloud }),
          },
          SpeakReplyAction,
        ),
      )

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: PANEL_ID + '-auto',
            order: 20,
            locale: NS,
            inject: () => ({ readAloud }),
          },
          AutoReadDriver,
        ),
      )

      // Pause / resume + stop, inside the composer tool row: the seat the slot
      // contract reserves for a small control the user reaches while typing.
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: PANEL_ID + '-transport',
            order: 20,
            locale: NS,
            inject: () => ({ readAloud }),
          },
          ReadingControls,
        ),
      )
    }

    return { inject, apply }
  },
})
