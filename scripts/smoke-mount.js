/**
 * Mount smoke test — the client half, actually mounted against a DOM stub.
 *
 * The other suites check the bundle's *shape* (loader contract, stylesheet
 * invariants) and the probe's *derived conclusions*. Neither of them runs
 * `apply()`, which is where the interesting failures live: the plugin writes
 * `data-pocket`, tags landmarks, publishes safe-area tokens and installs a
 * MutationObserver, and a mistake in any of that yields a half-working page
 * rather than an exception.
 *
 * A note on the harness, because it cost real time to learn: an effect body that
 * throws inside this stub produces no output at all — the run just continues and
 * assertions fail somewhere unrelated. `ctx.effect` therefore reports the error
 * with the label attached. A silent harness is worse than no harness, and this
 * file already depends on that fact.
 *
 * Deliberately not a browser: no layout is computed here. Geometry claims belong
 * to scripts/verify-cdp.mjs (real Chrome) and to the in-page probe.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log('  ok  ' + label)
}

// ---------------------------------------------------------------------------
// stub DOM
// ---------------------------------------------------------------------------

/** A node with the handful of DOM members the client half actually touches. */
function makeNode(tag, attrs = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attributes: { ...attrs },
    children: [],
    parentElement: null,
    style: {
      cssText: '',
      props: {},
      setProperty(k, v) { this.props[k] = v },
      removeProperty(k) { delete this.props[k] },
      getPropertyValue(k) { return this.props[k] || '' },
    },
    getAttribute: (k) => (k in node.attributes ? node.attributes[k] : null),
    setAttribute(k, v) { node.attributes[k] = String(v) },
    removeAttribute(k) { delete node.attributes[k] },
    hasAttribute: (k) => k in node.attributes,
    appendChild(child) { child.parentElement = node; node.children.push(child); return child },
    remove() {
      if (node.parentElement) {
        const list = node.parentElement.children
        const i = list.indexOf(node)
        if (i !== -1) list.splice(i, 1)
      }
    },
    get firstElementChild() { return node.children[0] || null },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 390, height: 844 } },
    querySelectorAll(selector) { return findAllDeep(node, selector) },
    querySelector(selector) { return findAllDeep(node, selector)[0] || null },
  }
  return node
}

/** Same walk, rooted at an arbitrary node (element-level querySelectorAll). */
function findAllDeep(root, selector) {
  const parts = selector.split(',').map((one) => one.trim()).filter(Boolean)
  const found = []
  const walk = (n) => {
    for (const child of n.children) {
      if (parts.some((one) => /^\[([a-z-]+)\]$/.test(one) && one.slice(1, -1) in child.attributes)) {
        found.push(child)
      }
      walk(child)
    }
  }
  walk(root)
  return found
}

/**
 * A DOM shaped like the real shell, with the landmark the plugin must find at
 * each level. `querySelector` is scripted per selector instead of implemented as
 * a CSS engine — a stub that only has to answer the three questions the plugin
 * asks is a stub that cannot quietly disagree with it about selector syntax.
 */
function makeDom({ frameTop = 0, frameHeight = 800, insets = {}, mode = 'browser' } = {}) {
  const html = makeNode('html')
  const head = makeNode('head')
  const body = makeNode('body')
  html.appendChild(head)
  html.appendChild(body)

  const frame = makeNode('div', { 'data-pocket-frame': '' })
  html.appendChild(frame)

  // [data-shell-overlay] is the overlay child the host renders inside the frame,
  // and it is the hook findFrame() prefers. Omitting it from the fixture (as the
  // first version of this stub did) makes the reconciler silently find no frame
  // and skip every landmark — a stub bug that looks exactly like a plugin bug.
  const overlay = makeNode('div', { 'data-shell-overlay': '' })
  frame.appendChild(overlay)

  // Mirrors the real nesting: slot outlets are display:contents, so the element
  // the plugin tags is the outlet's PARENT (the column), never the outlet.
  const sidebarColumn = makeNode('div')
  frame.appendChild(sidebarColumn)
  const sidebarAnchor = makeNode('div', { 'data-slot': 'sidebar' })
  sidebarColumn.appendChild(sidebarAnchor)
  sidebarColumn.getBoundingClientRect = () => ({ top: frameTop, left: 0, width: 320, height: frameHeight })

  const mainColumn = makeNode('div')
  frame.appendChild(mainColumn)
  const mainAnchor = makeNode('div', { 'data-slot': 'main' })
  mainColumn.appendChild(mainAnchor)

  frame.getBoundingClientRect = () => ({ top: frameTop, left: 0, width: 390, height: frameHeight })

  /**
   * Walk the stub tree for the selector shapes the client half actually uses:
   * `[data-attr]` and `[data-attr="value"]`. A real CSS engine here would be a
   * second implementation of the thing under test; answering only the questions
   * the plugin asks keeps the stub honest and keeps a stub/DOM disagreement from
   * masquerading as a plugin bug (which it did: a scripted `querySelector` that
   * hard-coded one selector made `findFrame()` return null and the reconciler
   * silently skip tagging).
   */
  function selectorMatches(node, selector) {
    const eq = /^\[([a-z-]+)="([^"]*)"\]$/.exec(selector)
    if (eq) return node.attributes[eq[1]] === eq[2]
    const bare = /^\[([a-z-]+)\]$/.exec(selector)
    if (bare) return bare[1] in node.attributes
    if (selector === 'meta[name="viewport"]') return node.attributes.name === 'viewport'
    return false
  }

  /**
   * Walk the stub tree for the selector shapes the client half actually uses:
   * `[data-attr]`, `[data-attr="value"]`, and comma-separated lists of those.
   * A real CSS engine here would be a second implementation of the thing under
   * test; answering only the questions the plugin asks keeps the stub honest.
   *
   * The comma list is not optional and was missing at first: untagLandmarks()
   * queries four attributes at once, so a stub that only understood one selector
   * reported "nothing to clean up" while the attributes were plainly still there.
   */
  function findAll(selector) {
    const parts = selector.split(',').map((one) => one.trim()).filter(Boolean)
    const found = []
    const walk = (n) => {
      for (const child of n.children) {
        if (parts.some((one) => selectorMatches(child, one))) found.push(child)
        walk(child)
      }
    }
    walk(html)
    return found
  }

  const timers = []
  const document = {
    documentElement: html,
    head,
    body,
    createElement: (tag) => makeNode(tag),
    querySelector: (sel) => {
      if (sel === 'meta[name="viewport"]') return viewportMeta
      return findAll(sel)[0] || null
    },
    querySelectorAll: (sel) => findAll(sel),
    addEventListener() {},
    removeEventListener() {},
  }

  const viewportMeta = makeNode('meta', { name: 'viewport' })

  const window = {
    location: { search: '' },
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: (q) => ({ matches: q === '(display-mode: ' + mode + ')', addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => { fn(); return 1 },
    cancelAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout() {},
    setInterval: (fn) => { timers.push(fn); return timers.length },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    visualViewport: null,
    getComputedStyle: () => ({
      paddingTop: (insets.top || 0) + 'px',
      paddingBottom: (insets.bottom || 0) + 'px',
      paddingLeft: (insets.left || 0) + 'px',
      paddingRight: (insets.right || 0) + 'px',
    }),
  }

  return { html, head, body, frame, sidebarColumn, mainColumn, document, window, timers, viewportMeta, setViewportMeta: () => viewportMeta }
}

/** Mount the bundle's client half against a stub DOM. */
function mount({ media = true, search = '', frameTop = 0, frameHeight = 800, insets = {}, mode = 'browser' } = {}) {
  const dom = makeDom({ frameTop, frameHeight, insets, mode })
  dom.window.location.search = search
  const pluginQuery = dom.window.matchMedia
  dom.window.matchMedia = (q) => (q === '(max-width: 1023px) and (pointer: coarse)'
    ? { matches: media, addEventListener() {}, removeEventListener() {} }
    : pluginQuery(q))

  const registrations = []
  dom.window.__ModuleLoader__ = { load: (e) => registrations.push(e) }
  // eslint-disable-next-line no-new-func
  new Function('window', source)(dom.window)

  const prevDocument = globalThis.document
  const prevObserver = globalThis.MutationObserver
  globalThis.document = dom.document
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }

  const errors = []
  const disposers = []
  const slots = []
  try {
    const mod = registrations[0].factory((id) => {
      if (id === 'react') {
        return {
          createElement: (...args) => ({ args }),
          Fragment: Symbol('Fragment'),
          useState: (v) => [v, () => {}],
          useEffect: () => {},
          useRef: (v) => ({ current: v }),
        }
      }
      throw new Error('unexpected require: ' + id)
    })
    const ctx = {
      get: () => ({ inject: (slot) => slots.push(slot), register: () => () => {} }),
      effect: (fn, label) => {
        try {
          const dispose = fn()
          if (typeof dispose === 'function') disposers.push(dispose)
          return dispose
        } catch (err) {
          // Surfaced with the label, because a throwing effect body is otherwise
          // indistinguishable from an effect that simply had nothing to do.
          errors.push(label + ': ' + err.message)
          return undefined
        }
      },
      logger: { info() {} },
    }
    mod.apply(ctx)
    return {
      dom, mod, ctx, disposers, slots, errors,
      /**
       * Run teardown with the stub DOM still bound. The effects capture `document`
       * from the global scope exactly as they do in a browser, so restoring the
       * real globals first makes teardown throw a TypeError that has nothing to do
       * with the plugin.
       */
      teardown() {
        globalThis.document = dom.document
        try {
          for (const dispose of disposers) dispose()
        } finally {
          globalThis.document = prevDocument
        }
      },
    }
  } finally {
    globalThis.document = prevDocument
    globalThis.MutationObserver = prevObserver
  }
}

// ---------------------------------------------------------------------------

check('every effect the plugin registers runs without throwing', () => {
  const { errors } = mount({ media: true })
  assert.deepEqual(errors, [], 'effect bodies must not throw: ' + errors.join(' | '))
})

check('the settings row gains a fetchable meta route, not a hard-coded version', () => {
  // The regression this guards: `host 半区未就绪` was rendered when one
  // un-retried fetch failed during host startup, and stayed on screen forever.
  const body = source.slice(source.indexOf('function PocketSettingsRow'))
  assert.match(body, /META_RETRY_MS/, 'the meta fetch must retry')
  assert.match(body, /setLink\('down'\)/, 'and must distinguish giving up from still trying')
  assert.ok(!/version = 'host 半区未就绪'/.test(source),
    'the message must not be the fallback for every non-answer')
  assert.ok(!/latestText = '未检测更新'/.test(source),
    '"未检测更新" claimed the check had run and found nothing when it may never have run')
})

check('mobile mode activates, tags landmarks, and publishes safe-area tokens', () => {
  const { dom, errors } = mount({ media: true, mode: 'standalone', insets: { top: 48, bottom: 24 } })
  assert.deepEqual(errors, [])
  assert.equal(dom.html.getAttribute('data-pocket'), 'on', 'the gate attribute must be set')
  assert.ok(dom.sidebarColumn.hasAttribute('data-pocket-sidebar'),
    'the slot outlet parent becomes the drawer')
  assert.ok(dom.mainColumn.hasAttribute('data-pocket-center'))
  assert.equal(dom.html.style.getPropertyValue('--pocket-safe-t'), '48px',
    'an immersive display keeps the inset it asked for')
  assert.equal(dom.html.style.getPropertyValue('--pocket-safe-b'), '24px',
    'the frame is 800px in an 844px viewport, so 24px of bottom inset fits')
})

check('the phantom-title-bar fix reaches the published tokens end to end', () => {
  // The bug, mounted: the shell already starts below the status bar and the device
  // still reports the inset. Before the fix this published 45px and every rule
  // padded the layout by it a second time.
  // display-mode: browser AND a pushed-down frame: either gate alone is enough.
  const { dom } = mount({ media: true, frameTop: 45, mode: 'browser', insets: { top: 45 } })
  assert.equal(dom.html.style.getPropertyValue('--pocket-safe-t'), '0px')
  assert.equal(dom.html.style.getPropertyValue('--pocket-inset-raw-t'), '45px',
    'the device value stays visible for diagnostics')
})

check('desktop is a complete no-op', () => {
  const { dom } = mount({ media: false })
  assert.equal(dom.html.getAttribute('data-pocket'), null, 'no gate attribute')
  assert.equal(dom.sidebarColumn.hasAttribute('data-pocket-sidebar'), false, 'no landmark tags')
  assert.equal(dom.html.style.getPropertyValue('--pocket-safe-t'), '', 'no inline tokens')
})

check('?pocket=off overrides a coarse pointer, ?pocket=mobile overrides a mouse', () => {
  const off = mount({ search: '?pocket=off', media: true, insets: { top: 44 } })
  assert.equal(off.dom.html.getAttribute('data-pocket'), null)
  assert.equal(off.dom.html.style.getPropertyValue('--pocket-safe-t'), '')

  const on = mount({ search: '?pocket=mobile', media: false, insets: { top: 44 } })
  assert.equal(on.dom.html.getAttribute('data-pocket'), 'on')
})

check('teardown gives every piece of host DOM back', () => {
  const { dom, disposers, teardown } = mount({ media: true, insets: { top: 44 } })
  assert.equal(dom.html.getAttribute('data-pocket'), 'on')
  assert.ok(disposers.length >= 4, 'each effect must register a disposer')
  teardown()
  assert.equal(dom.html.getAttribute('data-pocket'), null, 'the gate attribute must be gone')
  assert.equal(dom.html.getAttribute('data-pocket-drawer'), null)
  assert.equal(dom.html.style.getPropertyValue('--pocket-safe-t'), '', 'inline tokens must be gone')
  assert.equal(dom.html.style.getPropertyValue('--pocket-inset-raw-t'), '')
  assert.equal(dom.sidebarColumn.hasAttribute('data-pocket-sidebar'), false, 'landmark tags must be gone')
  assert.equal(dom.mainColumn.hasAttribute('data-pocket-center'), false)
})

check('?pocket=probe turns the layout on so the measurement describes it', async () => {
  // Probe mode forces the mobile layout on regardless of the media query. That is
  // deliberate: a probe run on a phone must measure the layout the phone actually
  // renders, and a probe run anywhere else should still produce a usable report
  // rather than eleven lines of "plugin inactive".
  const on = mount({ search: '?pocket=probe', media: false, insets: { top: 44 } })
  assert.equal(on.dom.html.getAttribute('data-pocket'), 'on')

  // Explicitly off wins: the user asked for desktop and gets desktop, diagnostics
  // or not.
  const off = mount({ search: '?pocket=off', media: true, insets: { top: 44 } })
  assert.equal(off.dom.html.getAttribute('data-pocket'), null)
})

check('the stylesheet is injected under the plugin tag', () => {
  const { dom } = mount({ media: true })
  const styles = dom.head.children.filter((c) => c.tagName === 'STYLE')
  assert.equal(styles.length, 1)
  assert.equal(styles[0].getAttribute('data-plugin'), 'dsh-pocket-ui')
  assert.equal(styles[0].getAttribute('data-plugin-css'), 'dsh-pocket-ui/pocket.css')
})

check('both slot contributions are registered', () => {
  const { slots } = mount({ media: true })
  assert.ok(slots.includes('shell.overlay'), 'the drawer chrome needs a slot')
  assert.ok(slots.includes('settings.general.item'), 'so does the status row')
})

check('the inset probe element never survives a pass', () => {
  // It is appended to <html> to force env() substitution, so a leak would be a
  // permanent invisible child of the root element.
  const { dom } = mount({ media: true, insets: { top: 44 } })
  assert.equal(dom.html.children.filter((c) => c.hasAttribute('data-pocket-inset-probe')).length, 0)
})

console.log('\nmount smoke: ' + passed + ' checks passed')
