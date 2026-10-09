/**
 * Probe smoke test — DOM stubs only, no browser.
 *
 * The probe is the tool that diagnoses a real phone; it therefore has to be
 * correct in exactly the situation where it is hardest to debug (an in-app
 * WebView, on someone else's device). So it gets the same treatment as the
 * bundle: it is executed against stubs and its *derived* conclusions are
 * asserted, not just its ability to not throw.
 *
 * The stubs are deliberately shaped like the real thing:
 *   - `getComputedStyle` returns the *specified* token for custom properties
 *     (like a real browser does) and a real length for paddingTop/paddingBottom,
 *     which is the substitution trick the probe depends on;
 *   - the sidebar/center/header geometry is an explicit tree, so "which box owns
 *     the strip" is a real assertion rather than a regex over source text.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'probe-src.js'), 'utf8')

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log('  ok  ' + label)
}

// ---------------------------------------------------------------------------
// DOM stub
// ---------------------------------------------------------------------------

/**
 * @param {object} cfg
 * @param {number} cfg.safeTop        value env(safe-area-inset-top) resolves to
 * @param {number} cfg.frameTop       where the frame's top edge is
 * @param {number} cfg.sidebarPadTop  the sidebar's padding-top
 * @param {number} cfg.headerPadTop   the conversation header's padding-top
 */
function makeDom(cfg) {
  const nodes = []

  /**
   * A style object that remembers padding assignments. The real probe works by
   * writing `style.paddingTop = 'var(--x)'` and reading the computed value back,
   * so both halves of that round trip have to exist in the stub.
   */
  function makeStyle(initial) {
    const store = Object.assign({ cssText: '' }, initial)
    const vars = {}
    store.setProperty = (k, v) => { vars[k] = v }
    store.removeProperty = (k) => { delete vars[k] }
    store.getPropertyValue = (k) => vars[k] || ''
    return new Proxy(store, {
      set(target, key, value) {
        target[key] = value
        const m = /^padding(Top|Right|Bottom|Left)$/.exec(String(key))
        if (m) target['_probeToken' + m[1]] = value
        return true
      },
      get(target, key) { return target[key] },
    })
  }

  function el(tag, opts = {}) {
    const node = {
      tagName: tag.toUpperCase(),
      id: opts.id || '',
      className: opts.className || '',
      children: [],
      parentElement: null,
      attributes: Object.assign({}, opts.attributes),
      textContent: opts.text || '',
      style: makeStyle(),
      rect: opts.rect || { left: 0, top: 0, width: 0, height: 0 },
      scrollHeight: opts.scrollHeight !== undefined ? opts.scrollHeight : 0,
      clientHeight: opts.clientHeight !== undefined ? opts.clientHeight : 0,
      scrollTop: 0,
      computed: opts.computed || {},
      getBoundingClientRect() {
        return Object.assign({ right: 0, bottom: 0 }, this.rect)
      },
      getAttribute: (k) => (k in node.attributes ? node.attributes[k] : null),
      setAttribute(k, v) { node.attributes[k] = String(v) },
      removeAttribute(k) { delete node.attributes[k] },
      hasAttribute: (k) => k in node.attributes,
      appendChild(c) { c.parentElement = node; node.children.push(c); return c },
      remove() {
        if (node.parentElement) {
          const list = node.parentElement.children
          const i = list.indexOf(node)
          if (i !== -1) list.splice(i, 1)
        }
      },
      addEventListener() {},
      querySelector(sel) { return node._query(sel)[0] || null },
      querySelectorAll(sel) { return node._query(sel) },
      _query(sel) {
        const found = []
        const walk = (n) => {
          for (const c of n.children) {
            if (matches(c, sel)) found.push(c)
            walk(c)
          }
        }
        walk(node)
        return found
      },
      get firstElementChild() { return node.children[0] || null },
    }
    node.computed = Object.assign({
      display: 'block', position: 'static', overflow: 'visible', backgroundColor: 'rgba(0, 0, 0, 0)',
      pointerEvents: 'auto', padding: '0px', margin: '0px', minHeight: 'auto', height: 'auto',
      fontSize: '14px', lineHeight: '20px', borderTopWidth: '0px',
      paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
      marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
    }, opts.computed)
    nodes.push(node)
    return node
  }

  function matches(node, sel) {
    if (sel.startsWith('[data-slot="')) {
      const key = sel.slice(11, -2)
      return node.attributes['data-slot'] === key
    }
    if (sel.startsWith('[data-')) return node.hasAttribute(sel.slice(1, -1))
    if (sel === 'header') return node.tagName === 'HEADER'
    if (sel === '*') return true
    return false
  }

  const body = el('body')
  const html = el('html', {
    attributes: cfg.htmlAttributes || { 'data-pocket': 'on' },
    // The shell is viewport-locked: html's scroll box must equal its client box,
    // which is what makes "phantomScroll" a real signal rather than noise.
    scrollHeight: cfg.htmlScrollHeight !== undefined ? cfg.htmlScrollHeight : (cfg.documentHeight || 844),
    clientHeight: cfg.documentHeight || 844,
    id: '',
  })
  // Stands in for syncSafeArea()'s inline publish: the probe reads inline
  // properties first, because that is how the plugin states its decision.
  if (cfg.inlineTokens) {
    for (const [k, v] of Object.entries(cfg.inlineTokens)) html.style.setProperty(k, v)
  }
  const head = el('head')
  const root = el('div', { id: 'root' })

  const frame = el('div', {
    attributes: { 'data-pocket-frame': '', 'data-shell-overlay': '' },
    className: 'pI_x6G_frame',
    rect: { left: 0, top: cfg.frameTop, width: 390, height: 844 },
    computed: { display: 'grid', position: 'relative', overflow: 'hidden', paddingTop: '0px' },
  })
  const sidebarCol = el('div', { rect: { left: -320, top: 0, width: 320, height: 844 } })
  const slotAnchor = el('div', { attributes: { 'data-slot': 'sidebar' } })
  const sidebar = el('aside', {
    attributes: { 'data-pocket-sidebar': '' },
    rect: { left: -320, top: 0, width: 320, height: 844 },
    computed: { paddingTop: (cfg.sidebarPadTop || 0) + 'px', display: 'flex' },
  })
  const sidebarFirst = el('div', {
    rect: { left: -320, top: cfg.sidebarPadTop || 0, width: 320, height: 40 },
    computed: { fontSize: '14px', lineHeight: '20px' },
  })

  const headerPadTop = cfg.headerPadTop || 0
  const centerTop = cfg.centerTop || 0
  const centerCol = el('div', { rect: { left: 0, top: 0, width: 390, height: 844 } })
  const mainAnchor = el('div', { attributes: { 'data-slot': 'main' } })
  const center = el('div', {
    attributes: { 'data-pocket-center': '' },
    rect: { left: 0, top: centerTop, width: 390, height: 844 },
  })
  // The header's top edge IS the strip: the plugin's padding-top moves the box
  // itself down inside the center column, which is exactly what the probe has to
  // attribute. Keeping that relationship explicit in the stub is what makes the
  // attribution assertion meaningful rather than circular.
  const header = el('header', {
    rect: { left: 0, top: centerTop + headerPadTop, width: 390, height: 56 },
    computed: { paddingTop: headerPadTop + 'px', padding: headerPadTop + 'px 12px 0px' },
  })
  const title = el('div', {
    text: '给录制记录中的回收站列表增',
    rect: { left: 12, top: centerTop + headerPadTop, width: 300, height: 22 },
  })

  // html > body > root > frame > {sidebarCol > slot > sidebar, centerCol > main > center > header > title}
  html.appendChild(body)
  body.appendChild(root)
  root.appendChild(frame)
  frame.appendChild(sidebarCol)
  sidebarCol.appendChild(slotAnchor)
  slotAnchor.appendChild(sidebar)
  sidebar.appendChild(sidebarFirst)
  frame.appendChild(centerCol)
  centerCol.appendChild(mainAnchor)
  mainAnchor.appendChild(center)
  center.appendChild(header)
  header.appendChild(title)

  const styles = new Map()
  if (cfg.stylesheet !== false) {
    const style = el('style', { attributes: { 'data-plugin': 'dsh-pocket-ui' } })
    style.sheet = { cssRules: new Array(40).fill({ cssText: 'x' }) }
    head.appendChild(style)
  }

  // ---- globals ----
  const window = {
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2.75,
    location: { href: 'http://192.168.1.210:3080/?token=SECRET#/c/1' },
    navigator: { userAgent: cfg.userAgent || 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', clipboard: null },
    matchMedia: (q) => ({ matches: resolveMedia(q, cfg) }),
    visualViewport: { height: cfg.visualViewportHeight || 844, offsetTop: 0 },
    getComputedStyle,
    setTimeout,
  }
  window.__pocket = { boot: cfg.boot || { version: '0.1.4', mobileQuery: '(max-width: 1023px) and (pointer: coarse)', active: true } }

  /**
   * Which side's padding the token probe is currently asking about. The probe
   * assigns `style.paddingTop = 'var(--x)'` and reads `computed.paddingTop`
   * back, so the stub records the assignment on `_probeToken` and resolves it
   * on read. This is the browser's substitution step, emulated.
   */
  function resolveProbeToken(value) {
    const v = String(value || '')
    const m = /^var\((--[a-z-]+)/.exec(v)
    if (m) {
      if (m[1] === '--pocket-safe-t') return (cfg.safeTop || 0) + 'px'
      if (m[1] === '--pocket-safe-b') return (cfg.safeBottom || 0) + 'px'
      if (m[1] === '--pocket-drawer-w') return '320px'
      if (m[1] === '--pocket-fab') return '28px'
      if (m[1] === '--dsh-frame-top-clearance') return (parseFloat(cfg.frameTopClearance) || 48) + 'px'
      if (m[1] === '--dsh-frame-chrome-top') return (parseFloat(cfg.frameChromeTop) || 0) + 'px'
      if (m[1] === '--dsh-frame-overlay-top') return (parseFloat(cfg.frameOverlayTop) || 20) + 'px'
      if (m[1] === '--dsh-content-font-size') return '14px'
      if (m[1] === '--ds-transition-duration-slow') return '250ms'
      return '0px'
    }
    const e = /^env\(safe-area-inset-(top|right|bottom|left)/.exec(v)
    if (e) {
      const key = 'safe' + e[1][0].toUpperCase() + e[1].slice(1)
      return (cfg[key] || 0) + 'px'
    }
    return v || '0px'
  }

  function getComputedStyle(node) {
    const cs = Object.assign({}, node.computed)
    cs.getPropertyValue = (name) => {
      if (name === '--pocket-safe-t') return String(cfg.pocketSafeTopRaw !== undefined ? cfg.pocketSafeTopRaw : 'env(safe-area-inset-top, 0px)')
      if (name === '--pocket-safe-b') return 'env(safe-area-inset-bottom, 0px)'
      if (name === '--pocket-safe-l') return 'env(safe-area-inset-left, 0px)'
      if (name === '--pocket-safe-r') return 'env(safe-area-inset-right, 0px)'
      if (name === '--pocket-drawer-w') return 'min(84vw, 320px)'
      if (name === '--pocket-fab') return '28px'
      if (name === '--dsh-frame-top-clearance') return cfg.frameTopClearance || '48px'
      if (name === '--dsh-frame-chrome-top') return cfg.frameChromeTop || '0px'
      if (name === '--dsh-frame-overlay-top') return cfg.frameOverlayTop || '20px'
      if (name === '--dsh-frame-leading-clearance') return cfg.frameLeadingClearance || ''
      if (name === '--dsh-windows-titlebar-height') return cfg.windowsTitlebarHeight || ''
      if (name === '--dsh-content-font-size') return '14px'
      if (name === '--ds-transition-duration-slow') return '250ms'
      return ''
    }
    // The substitution trick: an element asked to use a token reports a length.
    // The write lands on the node's *style* object; reading it off the node is
    // the mistake this stub made first, and it looked exactly like the real bug
    // (a token that silently resolves to 0).
    if (node.attributes && 'data-pocket-token-probe' in node.attributes) {
      var st = node.style || {}
      cs.paddingTop = resolveProbeToken(st._probeTokenTop)
      cs.paddingBottom = resolveProbeToken(st._probeTokenBottom)
      cs.paddingLeft = resolveProbeToken(st._probeTokenLeft)
      cs.paddingRight = resolveProbeToken(st._probeTokenRight)
      cs.fontSize = '16px'
      return cs
    }
    cs.paddingTop = cs.paddingTop || '0px'
    cs.paddingBottom = cs.paddingBottom || '0px'
    return cs
  }

  function resolveMedia(q, c) {
    if (q.includes('max-width: 1023px') && q.includes('pointer: coarse')) return c.pluginQuery !== false
    if (q === '(max-width: 1023px)') return true
    if (q === '(pointer: coarse)') return c.pointerCoarse !== false
    if (q === '(pointer: fine)') return false
    if (q === '(pointer: none)') return false
    if (q === '(any-pointer: coarse)') return c.pointerCoarse !== false
    if (q === '(hover: none)') return true
    if (q === '(display-mode: browser)') return c.displayBrowser !== false
    if (q === '(display-mode: standalone)') return !!c.displayStandalone
    if (q === '(display-mode: fullscreen)') return !!c.displayFullscreen
    if (q === '(orientation: portrait)') return true
    return false
  }

  const document = {
    documentElement: html,
    head,
    body,
    /**
     * The probe resolves the host routes document-relative, so a stub without a
     * base URI is not a faithful browser: every `/pocket/*` URL would come out
     * relative and hide the very resolution rule these tests exist to pin down.
     */
    baseURI: cfg.baseURI !== undefined ? cfg.baseURI : 'http://192.168.1.210:3080/',
    createElement: (tag) => el(tag),
    querySelector(sel) {
      if (sel === 'meta[name="viewport"]') return { getAttribute: () => cfg.viewportMeta || 'width=device-width, initial-scale=1, viewport-fit=cover' }
      if (sel === '[data-plugin="dsh-web-mobile"]') return null
      if (sel === '[data-plugin="dsh-pocket-ui"]') return head.children.find((c) => c.attributes['data-plugin'] === 'dsh-pocket-ui') || null
      return html.querySelector(sel)
    },
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    elementFromPoint: () => (cfg.hitElement ? cfg.hitElement : sidebar),
    addEventListener() {},
  }


  return {
    window, document, nodes, html, frame, sidebar, center, header, title,
    run(boot) {
      // eslint-disable-next-line no-new-func
      const fn = new Function('window', 'document', 'getComputedStyle', 'navigator', 'screen', 'location', 'console', source)
      // The shell publishes its transport on `globalThis`, which in a browser page
      // IS `window`; the harness runs the probe with `window` as a *parameter*, so
      // the global has to be staged around the call to stay faithful.
      const prevTransport = globalThis.__DSH_TRANSPORT__
      if (cfg.transport) globalThis.__DSH_TRANSPORT__ = cfg.transport
      else delete globalThis.__DSH_TRANSPORT__
      try {
        fn(window, document, window.getComputedStyle, window.navigator,
          { width: 1080, height: 2243, availHeight: 2243 }, window.location, console)
      } finally {
        if (prevTransport === undefined) delete globalThis.__DSH_TRANSPORT__
        else globalThis.__DSH_TRANSPORT__ = prevTransport
      }
      return window.__pocket
    },
  }
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

check('the probe is syntactically valid and self-executing', () => {
  // eslint-disable-next-line no-new-func
  new Function(source)
  assert.ok(source.includes('(function ()'), 'probe is an IIFE')
  assert.ok(!/\bimport\b|\brequire\(/.test(source), 'probe must be dependency-free')
})

check('it runs and exposes collect/show/lines without throwing', () => {
  const dom = makeDom({ safeTop: 0 })
  const api = dom.run()
  assert.equal(typeof api.collect, 'function')
  assert.equal(typeof api.lines, 'function')
  const o = api.collect()
  assert.equal(o.verdict.active, true)
})

check('the overlay is rendered on load, with a copy button', () => {
  const dom = makeDom({ safeTop: 40 })
  dom.run()
  const overlay = dom.document.body.children.find((c) => c.attributes['data-pocket-probe-ui'] !== undefined)
  assert.ok(overlay, 'probe overlay must mount on body')
  const texts = []
  const walk = (n) => { texts.push(n.textContent); n.children.forEach(walk) }
  walk(overlay)
  assert.ok(texts.some((t) => String(t).includes('复制全部 JSON')), 'copy button present')
  assert.ok(texts.some((t) => String(t).includes('重新检测')), 'rerun button present')
  assert.ok(texts.some((t) => String(t).includes('关闭')), 'close button present')
})

check('env(safe-area-inset-top) is read by substitution, not by token text', () => {
  const dom = makeDom({ safeTop: 40, pocketSafeTopRaw: 'env(safe-area-inset-top, 0px)' })
  const o = dom.run().collect()
  assert.equal(o.safeAreaInsets['env(safe-area-inset-top)'], '40px',
    'the raw token text must never be reported as the value')
  assert.equal(o.tokens['--pocket-safe-t'].raw, 'env(safe-area-inset-top, 0px)',
    'raw text is kept for diagnostics')
  assert.equal(o.tokens['--pocket-safe-t'].px, 40, 'and the resolved px is what is compared')
})

check('a phantom strip on a real device is attributed to the header padding', () => {
  // The reported bug: 40px of safe-area padding plus the plugin's own 8px.
  const dom = makeDom({ safeTop: 40, headerPadTop: 48, sidebarPadTop: 40 })
  const o = dom.run().collect()
  assert.equal(o.verdict.safeAreaTopPx, 40)
  assert.equal(o.verdict.topStripPx, 48, 'the strip is the header padding, measured off the center box')
  assert.equal(o.verdict.headerPaddingFromSafeArea, 40,
    'the part of the header padding that comes from the safe area')
  assert.equal(o.verdict.topStripOwner && o.verdict.topStripOwner.includes('+48px'), true,
    'the owner must name the pushed-down box: ' + o.verdict.topStripOwner)
})

check('it reports the plugin\'s own inset decision, not a re-derivation of it', () => {
  // The probe would otherwise be able to disagree with the code it describes,
  // which is the one thing a diagnostic must never do.
  const dom = makeDom({
    safeTop: 45, headerPadTop: 8,
    inlineTokens: { '--pocket-safe-t': '0px', '--pocket-inset-raw-t': '45px' },
    boot: {
      version: '0.1.5', mobileQuery: '(max-width: 1023px) and (pointer: coarse)', active: true,
      insets: { insetTop: 45, top: 0, topPolicy: 'not-an-immersive-display', displayMode: 'browser' },
    },
  })
  const o = dom.run().collect()
  assert.equal(o.verdict.insetPolicy, 'not-an-immersive-display')
  assert.equal(o.verdict.pluginDisplayMode, 'browser')
  assert.equal(o.verdict.pocketSafeTopPx, 0)
  assert.equal(o.verdict.safeAreaTopPx, 45, 'the device value is still reported')
  assert.ok(o.verdict.warnings.some((w) => w.includes('policy')),
    'a suppressed inset must be explained, not left as a silent zero')
})

check('a plugin that IS padding warns that the padding may be the strip', () => {
  const dom = makeDom({
    safeTop: 45, headerPadTop: 53,
    inlineTokens: { '--pocket-safe-t': '45px', '--pocket-inset-raw-t': '45px' },
    boot: {
      version: '0.1.5', active: true,
      insets: { insetTop: 45, top: 45, topPolicy: 'applied', displayMode: 'standalone' },
    },
  })
  const o = dom.run().collect()
  assert.equal(o.verdict.safeAreaTopLooksTrustworthy, true)
  assert.ok(o.verdict.warnings.some((w) => w.includes('this is the strip')))
})

check('a host half older than the probe is called out rather than assumed', () => {
  // `insets` is absent when the running host half predates the probe.
  const dom = makeDom({ safeTop: 45, headerPadTop: 53, boot: { version: '0.1.4', active: true } })
  const o = dom.run().collect()
  assert.equal(o.verdict.insetPolicy, null)
  assert.ok(o.verdict.warnings.some((w) => w.includes('did not report why')))
})

check('an inactive plugin says why the gate is closed', () => {
  const dom = makeDom({ safeTop: 0, pluginQuery: false, pointerCoarse: false, boot: { version: '0.1.4', active: false } })
  const o = dom.run().collect()
  assert.equal(o.verdict.active, false)
  assert.ok(o.verdict.gateOpenBecause.includes('plugin inactive'), o.verdict.gateOpenBecause)
  assert.ok(o.verdict.gateOpenBecause.includes('pointerCoarse=false'), 'the pointer result must be reported')
})

check('a token is never leaked in the report', () => {
  const dom = makeDom({ safeTop: 0 })
  const o = dom.run().collect()
  assert.ok(!o.url.includes('SECRET'), 'token must be redacted: ' + o.url)
  assert.ok(o.url.includes('<redacted>'))
})

check('the report includes the host frame class (selector-drift tripwire)', () => {
  const dom = makeDom({ safeTop: 0 })
  const o = dom.run().collect()
  assert.deepEqual(o.hostClasses, ['pI_x6G_frame'])
})

check('a rival adapter is reported rather than silently winning', () => {
  const dom = makeDom({ safeTop: 0 })
  const api = dom.run()
  const o = api.collect()
  assert.equal(o.plugin.rivalPresent, false)
})

check('the text report is human-scannable and mentions the verdict', () => {
  const dom = makeDom({ safeTop: 40, headerPadTop: 48 })
  const api = dom.run()
  const text = api.lines(api.collect()).join('\n')
  assert.ok(text.includes('== verdict =='))
  assert.ok(text.includes('top strip owner'))
  assert.ok(text.includes('--pocket-safe-t'))
  assert.ok(text.includes('== safe-area env() =='))
})

check('a phantom outer scroll is reported', () => {
  const dom = makeDom({ safeTop: 40, headerPadTop: 48, visualViewportHeight: 800 })
  const api = dom.run()
  const o = api.collect()
  assert.equal(typeof o.scroll.phantomScroll, 'number')
  assert.equal(o.scroll.phantomScroll, 0, 'a viewport-locked shell reports no outer scroll')

  const grown = makeDom({ safeTop: 0, documentHeight: 844, htmlScrollHeight: 900 })
  const o2 = grown.run().collect()
  assert.equal(o2.scroll.phantomScroll, 56, 'a document taller than the viewport is reported')
  assert.ok(o2.verdict.warnings.some((w) => w.includes('beyond the viewport')),
    'and it warns, because that is the bottom-inset bug')
})

check('the probe resolves /pocket/hello the same way the bundle does', () => {
  // The probe carries its own resolver (it is a separate file and cannot import
  // the bundle's), so the two can drift — and "/pocket/hello did not answer" is
  // exactly the conclusion the probe exists to hand the user. The probe publishes
  // the URL it resolved, which is what this asserts on.
  const plain = makeDom({ safeTop: 0 }).run()
  assert.equal(plain.hostUrl, 'http://192.168.1.210:3080/pocket/hello',
    'a plain page resolves against its own document base')

  const prefixed = makeDom({ safeTop: 0, baseURI: 'http://nas.local:3080/dsh/' }).run()
  assert.equal(prefixed.hostUrl, 'http://nas.local:3080/dsh/pocket/hello',
    'a reverse-proxy mount point is part of the route')

  // The desktop shell serves the page from `dsh-app://app/` and forwards every
  // non-static path on that origin to the Host with its cookie, so that base must
  // win over the published transport — which is the Host's own origin, usable for
  // the platform's WebSocket mux and not for a cross-origin HTTP request.
  const shell = makeDom({
    safeTop: 0,
    baseURI: 'dsh-app://app/',
    transport: { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:55531/' },
  }).run()
  assert.equal(shell.hostUrl, 'dsh-app://app/pocket/hello',
    'the forwarded document base must win over the transport')

  // Only a page with no base of its own falls back to the transport.
  const baseless = makeDom({
    safeTop: 0,
    baseURI: '',
    transport: { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:55531/' },
  }).run()
  assert.equal(baseless.hostUrl, 'http://127.0.0.1:55531/pocket/hello',
    'with no document base the transport is the only remaining base')

  // Scoped to the function, not the file: a doc comment naming the transport must
  // not be able to satisfy or break an assertion about resolution order.
  const fnStart = source.indexOf('var hostUrl = function')
  assert.ok(fnStart !== -1, 'the probe must define its own hostUrl')
  const fnBody = source.slice(fnStart, source.indexOf('};', fnStart) + 2)
  assert.ok(fnBody.indexOf('document.baseURI') < fnBody.indexOf('__DSH_TRANSPORT__'),
    'the source must try the document base before the transport')
})

console.log('\nprobe smoke: ' + passed + ' checks passed')
