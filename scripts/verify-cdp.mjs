/**
 * CDP verification probe.
 *
 * Unit tests can prove the bundle's shape and the stylesheet's scoping, but they
 * structurally cannot prove the things that actually break a mobile adapter:
 * real host DOM nesting, computed geometry after the cascade, stacking order,
 * and hit-testability. This probe drives a real headless Chrome against a real
 * `dsh web` instance and asserts on computed values.
 *
 * Two runs, because "works on mobile" is only half the contract:
 *   - mobile  : 390x844 + touch emulation -> the adapter must engage;
 *   - desktop : 1280x800, no touch        -> the adapter must be a complete
 *                                           no-op, and a *narrow* desktop
 *                                           window must still be a no-op.
 *
 * Usage:
 *   node scripts/verify-cdp.mjs --url 'http://127.0.0.1:3081/?token=…'
 *   node scripts/verify-cdp.mjs --url … --screenshot /tmp/pocket.png
 *
 * Native CDP over the built-in WebSocket — no Playwright/Puppeteer dependency,
 * because those are exactly the packages that fail to install on the platforms
 * this plugin is meant to serve.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const URL_UNDER_TEST = arg('url')
if (!URL_UNDER_TEST) {
  console.error('missing --url (the token URL printed by `dsh web`)')
  process.exit(2)
}
const SCREENSHOT_DIR = arg('screenshot')
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

/** Expected plugin version, read from package.json — never hardcode it. */
const PKG_VERSION = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version

// ---------------------------------------------------------------------------
// minimal CDP client
// ---------------------------------------------------------------------------

function createCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 0
  const pending = new Map()

  ws.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch (err) { return }
    if (msg.id === undefined) return
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    if (msg.error) slot.reject(new Error(msg.error.message))
    else slot.resolve(msg.result)
  })

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true })
  })

  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = ++nextId
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify(payload))
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error('CDP timeout: ' + method))
        }, 30000)
      })
    },
    close() { try { ws.close() } catch (err) { /* already closed */ } },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll an expression until it is truthy or the deadline expires. */
async function waitFor(cdp, session, expression, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    const res = await evaluate(cdp, session, expression)
    last = res
    if (res) return res
    await sleep(250)
  }
  throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')')
}

/** Evaluate an expression and return its JSON value. */
async function evaluate(cdp, session, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression: `(() => { try { return JSON.stringify(${expression}) } catch (e) { return JSON.stringify({ __error: String(e) }) } })()`,
    returnByValue: true,
    awaitPromise: true,
  }, session)
  if (res.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(res.exceptionDetails.text))
  const raw = res.result && res.result.value
  if (typeof raw !== 'string') return undefined
  const parsed = JSON.parse(raw)
  if (parsed && parsed.__error) throw new Error('eval error: ' + parsed.__error)
  return parsed
}

/**
 * Real click inside an element, after asserting the point is hit-testable.
 * `fx`/`fy` are fractions of the element box (default: its centre) — needed for
 * elements like the backdrop, whose centre is legitimately covered by the drawer.
 */
async function clickElement(cdp, session, selector, fx = 0.5, fy = 0.5) {
  const box = await evaluate(cdp, session, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy}, w: r.width, h: r.height }
  })()`)
  if (!box) throw new Error('cannot click ' + selector + ': not found or zero-sized')

  // Hit-test first: "rendered" is not "clickable". An element can be present
  // with perfectly normal computed style and still be covered by a sibling.
  const hit = await evaluate(cdp, session, `(() => {
    const el = document.elementFromPoint(${box.x}, ${box.y})
    const target = document.querySelector(${JSON.stringify(selector)})
    return !!(el && target && (el === target || target.contains(el)))
  })()`)
  if (!hit) throw new Error(selector + ' is not hit-testable at its centre (covered by something)')

  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    }, session)
  }
  await sleep(400)
  return box
}

/**
 * Dispatch a real click at viewport coordinates, after asserting that something
 * matching `expect` is what would receive it. Used where the target is best
 * identified by position (an indexed row) rather than by a selector.
 */
async function clickPoint(cdp, session, x, y, expect) {
  const hit = await evaluate(cdp, session, `(() => {
    const el = document.elementFromPoint(${x}, ${y})
    return !!(el && el.closest(${JSON.stringify(expect)}))
  })()`)
  if (!hit) throw new Error('nothing matching ' + expect + ' is hit-testable at ' + x + ',' + y)

  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1,
    }, session)
  }
  await sleep(400)
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

const results = []
function record(ok, label, detail) {
  results.push({ ok, label, detail })
  console.log((ok ? '  ok  ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '\n        ' + detail))
}
function expect(ok, label, detail) { record(!!ok, label, detail) }
function expectEqual(actual, expected, label) {
  record(actual === expected, label, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

// ---------------------------------------------------------------------------
// chrome lifecycle
// ---------------------------------------------------------------------------

async function launchChrome() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pocket-cdp-'))
  const child = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    '--user-data-dir=' + userDataDir,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })

  // Chrome writes the chosen port here once the endpoint is live.
  const portFile = path.join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const text = await fs.readFile(portFile, 'utf8')
      const port = text.split('\n')[0].trim()
      if (port) return { child, userDataDir, port }
    } catch (err) { /* not up yet */ }
    await sleep(200)
  }
  child.kill('SIGKILL')
  throw new Error('chrome did not expose a debugging port\n' + stderr.slice(-800))
}

async function openSession(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`)
  const { webSocketDebuggerUrl } = await res.json()
  const cdp = createCdp(webSocketDebuggerUrl)
  await cdp.ready

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  return { cdp, sessionId, targetId }
}

/** Install emulation, navigate, and wait for the shell to actually render. */
async function loadPage(cdp, session, { mobile }) {
  if (mobile) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    }, session)
    // Headless Chrome has no pointer device at all, and every `(pointer: …)`
    // query evaluates false without this — `setEmulatedMedia` is silently
    // ignored for pointer features, so touch emulation is the only way to make
    // `(pointer: coarse)` match.
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, session)
  } else {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 2, mobile: false,
    }, session)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)
  }

  await cdp.send('Page.navigate', { url: URL_UNDER_TEST }, session)

  // The shell renders the frame only after plugins activate, so this doubles as
  // "did our plugin activate without breaking boot".
  await waitFor(cdp, session, `!!document.querySelector('[data-shell-overlay]')`, 'AppFrame to render', 40000)

  // A brand-new browser profile gets the host's Internal Testing Notice. It is
  // an aria-modal overlay that would swallow every click, so clear the whole
  // root rather than just the dialog (removing only the dialog leaves the mask).
  const dismissed = await evaluate(cdp, session, `(() => {
    const dialog = document.querySelector('[aria-modal="true"]')
    if (!dialog) return false
    let root = dialog
    while (root.parentElement && root.parentElement !== document.body) root = root.parentElement
    root.remove()
    return true
  })()`)
  if (dismissed) console.log('  ..  dismissed a host modal (fresh profile notice)')

  await sleep(1200)
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

async function runMobile(cdp, session) {
  console.log('\n[mobile 390x844, pointer:coarse]')

  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket')`), 'on',
    'gate is on')

  expect(await evaluate(cdp, session, `!!document.querySelector('style[data-plugin="dsh-pocket-ui"]')`),
    'stylesheet injected with the data-plugin contract')

  expect(await evaluate(cdp, session, `!!document.querySelector('[data-pocket-frame]')`),
    'AppFrame tagged')
  expect(await evaluate(cdp, session, `!!document.querySelector('[data-pocket-sidebar]')`),
    'sidebar column tagged')
  expect(await evaluate(cdp, session, `!!document.querySelector('[data-pocket-center]')`),
    'center column tagged')

  const viewport = await evaluate(cdp, session, `document.querySelector('meta[name="viewport"]').getAttribute('content')`)
  expect(/viewport-fit\s*=\s*cover/.test(viewport || ''), 'viewport meta carries viewport-fit=cover', viewport)
  expect(!/maximum-scale|user-scalable/.test(viewport || ''),
    'viewport meta does not disable user scaling', viewport)

  // The host writes grid-template-columns inline; only !important beats it.
  const tracks = await evaluate(cdp, session,
    `getComputedStyle(document.querySelector('[data-pocket-frame]')).gridTemplateColumns`)
  expect(/^390px 0px 0px$/.test(tracks || ''), 'grid collapsed to a single full-width column', tracks)

  const closed = await evaluate(cdp, session, `(() => {
    const el = document.querySelector('[data-pocket-sidebar]')
    const r = el.getBoundingClientRect()
    return { right: Math.round(r.right), width: Math.round(r.width), transform: getComputedStyle(el).transform }
  })()`)
  expect(closed.right <= 1, 'drawer starts off-screen', JSON.stringify(closed))
  expect(closed.width > 200 && closed.width <= 320, 'drawer has a usable width', JSON.stringify(closed))

  // No phantom outer scroll: safe-area padding must not push the frame past the
  // viewport (the content-box trap — invisible on desktop, where the inset is 0).
  const scroll = await evaluate(cdp, session, `(() => {
    const d = document.documentElement
    return { over: d.scrollHeight - d.clientHeight, inner: window.innerHeight }
  })()`)
  expect(scroll.over === 0, 'no phantom outer scroll', JSON.stringify(scroll))

  expect(await evaluate(cdp, session, `!!document.querySelector('.pocket-fab')`), 'toggle button present')

  if (SCREENSHOT_DIR) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
    await fs.writeFile(path.join(SCREENSHOT_DIR, 'pocket-mobile.png'), Buffer.from(shot.data, 'base64'))
    console.log('  ..  wrote ' + path.join(SCREENSHOT_DIR, 'pocket-mobile.png'))
  }

  // -- open the drawer ------------------------------------------------------
  await clickElement(cdp, session, '.pocket-fab')
  await sleep(500)

  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), 'open',
    'clicking the toggle opens the drawer')

  const opened = await evaluate(cdp, session, `(() => {
    const el = document.querySelector('[data-pocket-sidebar]')
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth }
  })()`)
  expect(opened.left >= -1 && opened.right > 100, 'drawer slid into view', JSON.stringify(opened))

  // The host renders the sidebar as a 56px rail below 1024px; the drawer is only
  // useful if we asked it to expand first.
  expect(!(await evaluate(cdp, session, `document.querySelector('[data-pocket-frame]').hasAttribute('data-sidebar-collapsed')`)),
    'host sidebar was expanded so the drawer holds the real session list')

  expect(await evaluate(cdp, session, `!!document.querySelector('.pocket-backdrop')`), 'backdrop present')

  // The drawer must be above the backdrop, and the backdrop must be reachable.
  const stacking = await evaluate(cdp, session, `(() => {
    const drawer = document.querySelector('[data-pocket-sidebar]')
    const back = document.querySelector('.pocket-backdrop')
    const r = back.getBoundingClientRect()
    const hit = document.elementFromPoint(r.right - 8, r.top + 40)
    return { drawerZ: +getComputedStyle(drawer).zIndex, backZ: +getComputedStyle(back).zIndex,
             backHits: !!(hit && hit.closest('.pocket-backdrop')) }
  })()`)
  expect(stacking.drawerZ > stacking.backZ, 'drawer stacks above the backdrop', JSON.stringify(stacking))
  expect(stacking.backHits, 'backdrop is hit-testable outside the drawer', JSON.stringify(stacking))

  // -- tapping inside the panel must not close it ---------------------------
  // The workspace panel is a tree of [role="treeitem"] rows. An earlier cut
  // closed the drawer from a capture-phase click listener keyed on a broad
  // "interactive" selector (a[href], button, [role=treeitem], …), so *every*
  // tap in the panel dismissed it — the panel was effectively read-only.
  //
  // Pick a *collapsed* row so the tap has an observable host-side effect: the
  // host flips its aria-expanded to true. Asserting only "the drawer stayed
  // open" would also pass on a panel that had gone inert, which is the other
  // way this can break.
  const ROW = '[data-pocket-sidebar] [role="treeitem"]'
  const row = await evaluate(cdp, session, `(() => {
    const rows = [...document.querySelectorAll(${JSON.stringify(ROW)})]
    const i = rows.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return el.getAttribute('aria-expanded') === 'false' && r.width >= 2 && r.height >= 2
    })
    if (i === -1) return null
    const r = rows[i].getBoundingClientRect()
    return { i, text: (rows[i].textContent || '').trim().slice(0, 24),
             x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!row) {
    record(false, 'a collapsed workspace row is reachable inside the drawer',
      'no visible [role="treeitem"][aria-expanded="false"] found')
  } else {
    await clickPoint(cdp, session, row.x, row.y, ROW)
    await sleep(500)
    expectEqual(await evaluate(cdp, session, `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(ROW)})][${row.i}]
      return el ? el.getAttribute('aria-expanded') : null
    })()`), 'true', 'the tap reached the host: the workspace row expanded (row: ' + row.text + ')')
    expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), 'open',
      'tapping a workspace row inside the drawer leaves it open (row: ' + row.text + ')')
  }

  // -- the host's own 收起侧边栏 button is the drawer's close control --------
  // We do not intercept clicks in the panel; the host collapses its sidebar and
  // the reconciler adopts that state. The label is the host's, so accept either
  // locale and fail loudly (with the labels actually present) rather than skip.
  const COLLAPSE = '[data-pocket-sidebar] [aria-label="收起侧边栏"], [data-pocket-sidebar] [aria-label="Collapse sidebar"]'
  const collapse = await evaluate(cdp, session, `(() => {
    const el = document.querySelector(${JSON.stringify(COLLAPSE)})
    if (!el) {
      return { missing: true, labels: [...document.querySelectorAll('[data-pocket-sidebar] [aria-label]')]
        .map((e) => e.getAttribute('aria-label')).slice(0, 12) }
    }
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })()`)
  if (collapse.missing || collapse.w < 2) {
    record(false, 'the host sidebar-collapse control is reachable in the drawer',
      collapse.missing ? 'not found; labels present: ' + JSON.stringify(collapse.labels)
        : 'found but zero-sized: ' + JSON.stringify(collapse))
  } else {
    // Guard against a vacuous pass: the assertions below are only meaningful if
    // the drawer was open going in.
    expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), 'open',
      'drawer is open before the collapse-button click (guards a vacuous pass)')

    await clickElement(cdp, session, COLLAPSE)
    await sleep(700)
    expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), null,
      'the host 收起侧边栏 button closes the drawer')

    // The host collapsed the sidebar itself. If our close path also called
    // layout.toggleSidebar() the two toggles would cancel out, leaving the host
    // expanded behind a drawer that had already slid away.
    expectEqual(await evaluate(cdp, session,
      `document.querySelector('[data-pocket-frame]').hasAttribute('data-sidebar-collapsed')`), true,
      'the host sidebar stays collapsed after its own button was used')

    const afterCollapse = await evaluate(cdp, session,
      `Math.round(document.querySelector('[data-pocket-sidebar]').getBoundingClientRect().right)`)
    expect(afterCollapse <= 1, 'drawer returned off-screen after the collapse button', String(afterCollapse))
  }

  // -- and it must still open again afterwards ------------------------------
  // Adopting the host's collapse must not wedge the drawer shut.
  await clickElement(cdp, session, '.pocket-fab')
  await sleep(700)
  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), 'open',
    'the drawer reopens after being closed with the host button')
  expect(!(await evaluate(cdp, session,
    `document.querySelector('[data-pocket-frame]').hasAttribute('data-sidebar-collapsed')`)),
    'reopening asks the host to expand the sidebar again')

  // -- close via backdrop ---------------------------------------------------
  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), 'open',
    'drawer is open before the backdrop click (guards a vacuous pass)')

  // Click near the right edge: the backdrop's centre is legitimately covered by
  // the drawer, which is exactly the part of the screen a user can tap to close.
  await clickElement(cdp, session, '.pocket-backdrop', 0.95, 0.5)
  await sleep(500)
  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), null,
    'clicking the backdrop closes the drawer')

  const reclosed = await evaluate(cdp, session, `Math.round(document.querySelector('[data-pocket-sidebar]').getBoundingClientRect().right)`)
  expect(reclosed <= 1, 'drawer returned off-screen', String(reclosed))

  // -- settings dialog becomes a bottom sheet -------------------------------
  // Reopen the drawer first: that is the real path (you tap the settings entry
  // inside the drawer), and it is also the state in which a transform on the
  // drawer would trap the sheet. Keeps the regression honest.
  await clickElement(cdp, session, '.pocket-fab')
  await sleep(500)
  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), 'open',
    'the toggle works repeatedly (drawer reopened)')

  const sheet = await evaluate(cdp, session, `(() => {
    const trigger = document.querySelector('[data-slot="settings.trigger"] button, [data-slot="settings.trigger"]')
    if (!trigger) return { skipped: 'no settings trigger' }
    trigger.click()
    return { clicked: true }
  })()`)

  if (sheet.skipped) {
    record(false, 'settings dialog reachable', sheet.skipped)
  } else {
    await sleep(900)
    const panel = await evaluate(cdp, session, `(() => {
      const dialog = document.querySelector('[role="presentation"] > [role="dialog"][aria-modal="true"]')
      if (!dialog) return null
      const r = dialog.getBoundingClientRect()
      return { bottom: Math.round(r.bottom), top: Math.round(r.top), width: Math.round(r.width),
               vh: window.innerHeight, vw: window.innerWidth,
               hostAlign: getComputedStyle(dialog.parentElement).alignItems }
    })()`)
    if (!panel) {
      record(false, 'settings dialog becomes a bottom sheet', 'dialog not found')
    } else {
      expect(Math.abs(panel.bottom - panel.vh) <= 2, 'sheet is anchored to the bottom edge', JSON.stringify(panel))
      expect(Math.abs(panel.width - panel.vw) <= 2,
        'sheet spans the full viewport width (not trapped in the drawer)', JSON.stringify(panel))
      expect(panel.top > panel.vh * 0.05, 'sheet is a sheet, not a full-screen page', JSON.stringify(panel))
      expectEqual(panel.hostAlign, 'flex-end', 'dialog wrapper aligns to the bottom')

      // Correct geometry does not mean a usable sheet: the point of a bottom
      // sheet is that its content scrolls. Measure a real scroll rather than
      // just asserting an overflow rule exists.
      const scroller = await evaluate(cdp, session, `(() => {
        const dialog = document.querySelector('[role="presentation"] > [role="dialog"][aria-modal="true"]')
        if (!dialog) return null
        const overflowing = [...dialog.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el)
          return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4
        })
        const el = overflowing[overflowing.length - 1]
        if (!el) {
          let tallest = null
          for (const node of dialog.querySelectorAll('*')) {
            if (!tallest || node.scrollHeight > tallest.scrollHeight) tallest = node
          }
          return { found: false, tallest: tallest ? {
            tag: tallest.tagName, cls: String(tallest.className).slice(0, 40),
            scrollHeight: tallest.scrollHeight, clientHeight: tallest.clientHeight } : null }
        }
        const before = el.scrollTop
        el.scrollTop = el.scrollHeight
        return { found: true, before, after: el.scrollTop,
                 scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      })()`)

      if (!scroller || !scroller.found) {
        record(false, 'settings content is scrollable',
          'no scrollable descendant — content below the fold is unreachable: ' + JSON.stringify(scroller))
      } else {
        expect(scroller.after > scroller.before, 'settings content actually scrolls',
          JSON.stringify(scroller))
      }

      const sheetHeight = await evaluate(cdp, session, `(() => {
        const dialog = document.querySelector('[role="presentation"] > [role="dialog"][aria-modal="true"]')
        return { h: Math.round(dialog.getBoundingClientRect().height), vh: window.innerHeight }
      })()`)
      expect(sheetHeight.h <= sheetHeight.vh * 0.9, 'sheet respects its height cap', JSON.stringify(sheetHeight))

      if (SCREENSHOT_DIR) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
        await fs.writeFile(path.join(SCREENSHOT_DIR, 'pocket-mobile-sheet.png'), Buffer.from(shot.data, 'base64'))
        console.log('  ..  wrote ' + path.join(SCREENSHOT_DIR, 'pocket-mobile-sheet.png'))
      }

      // The status/update row is how the user sees the plugin and repairs it.
      const row = await evaluate(cdp, session, `(() => {
        const el = document.querySelector('.pocket-row')
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { text: el.textContent, w: Math.round(r.width), vw: window.innerWidth }
      })()`)
      if (!row) {
        record(false, 'status row contributed to settings.general.item', 'not found')
      } else {
        expect(/Pocket UI/.test(row.text), 'status row rendered in General settings', row.text)
        // Read the expected version from package.json: a hardcoded literal turns
        // every release into a false failure.
        expect(row.text.includes('v' + PKG_VERSION),
          'status row shows the host half version', 'expected v' + PKG_VERSION + ' in: ' + row.text)
        expect(row.w <= row.vw, 'status row fits the sheet width', JSON.stringify(row))

        if (SCREENSHOT_DIR) {
          await sleep(400)
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
          await fs.writeFile(path.join(SCREENSHOT_DIR, 'pocket-mobile-settings-row.png'), Buffer.from(shot.data, 'base64'))
          console.log('  ..  wrote ' + path.join(SCREENSHOT_DIR, 'pocket-mobile-settings-row.png'))
        }
      }
    }
  }

  if (SCREENSHOT_DIR) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
    await fs.writeFile(path.join(SCREENSHOT_DIR, 'pocket-mobile-drawer.png'), Buffer.from(shot.data, 'base64'))
    console.log('  ..  wrote ' + path.join(SCREENSHOT_DIR, 'pocket-mobile-drawer.png'))
  }
}

async function runDesktop(cdp, session, { label, width, height }) {
  console.log(`\n[${label} ${width}x${height}, pointer:fine]`)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  }, session)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)
  await cdp.send('Page.navigate', { url: URL_UNDER_TEST }, session)
  await waitFor(cdp, session, `!!document.querySelector('[data-shell-overlay]')`, 'AppFrame to render', 40000)
  await sleep(1200)

  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket')`), null,
    'gate is off')
  expectEqual(await evaluate(cdp, session, `document.documentElement.getAttribute('data-pocket-drawer')`), null,
    'no drawer state attribute')
  expectEqual(await evaluate(cdp, session, `document.querySelectorAll('[data-pocket-frame]').length`), 0,
    'no landmark tags left behind')
  expectEqual(await evaluate(cdp, session, `document.querySelectorAll('.pocket-fab, .pocket-backdrop').length`), 0,
    'no injected chrome rendered')

  // The host writes grid-template-columns inline; only !important beats it. On
  // desktop we must not touch it at all, so the sidebar keeps a non-zero track
  // (56px rail when narrow, its saved width when wide). On mobile the same track
  // is forced to 0 because the sidebar has become an overlay.
  const tracks = await evaluate(cdp, session,
    `getComputedStyle(document.querySelector('[data-shell-overlay]').parentElement).gridTemplateColumns`)
  const sidebarTrack = parseFloat((tracks || '').split(' ')[0])
  expect(sidebarTrack > 0, 'host grid untouched (sidebar still occupies a track)', tracks)

  const sidebar = await evaluate(cdp, session, `(() => {
    const el = document.querySelector('[data-slot="sidebar"]')
    if (!el || !el.parentElement) return null
    const cs = getComputedStyle(el.parentElement)
    return { position: cs.position, transform: cs.transform }
  })()`)
  expect(sidebar && sidebar.position === 'static', 'sidebar is not turned into a drawer', JSON.stringify(sidebar))

  // The settings row is host chrome rendered at every width, so it must look
  // native here too. Compare it against its own neighbours rather than against
  // hardcoded numbers: consistency with the surrounding rows is the requirement,
  // and this stays honest if the host restyles its list.
  await evaluate(cdp, session, `(() => {
    const t = document.querySelector('[data-slot="settings.trigger"] button, [data-slot="settings.trigger"]')
    if (t) t.click()
    return !!t
  })()`)
  await sleep(900)

  const rows = await evaluate(cdp, session, `(() => {
    const anchors = [...document.querySelectorAll('[data-slot="settings.general.item"]')]
    const all = anchors.flatMap((a) => [...a.children])
    const mine = all.find((el) => el.classList.contains('pocket-row'))
    const hosts = all.filter((el) => el !== mine && !el.classList.contains('pocket-row'))
    const measure = (el) => {
      const cs = getComputedStyle(el)
      const leaf = (sel) => {
        const n = el.querySelector(sel)
        if (!n) return null
        const s = getComputedStyle(n)
        return { fontSize: s.fontSize, lineHeight: s.lineHeight }
      }
      return { display: cs.display, padding: cs.padding, gap: cs.gap,
               title: leaf('.pocket-row-title'), hint: leaf('.pocket-row-hint') }
    }
    return {
      found: !!mine,
      mine: mine ? measure(mine) : null,
      neighbour: hosts.length > 0 ? measure(hosts[hosts.length - 1]) : null,
    }
  })()`)

  if (!rows.found) {
    record(false, 'settings row present on desktop', 'no .pocket-row found in the settings list')
  } else {
    expect(rows.mine.display === 'flex',
      'settings row is laid out as a row on desktop', JSON.stringify(rows.mine))
    expect(rows.neighbour !== null && rows.mine.padding === rows.neighbour.padding,
      'settings row padding matches its neighbours',
      'mine=' + JSON.stringify(rows.mine) + ' neighbour=' + JSON.stringify(rows.neighbour))
    expect(rows.neighbour !== null && rows.mine.gap === rows.neighbour.gap,
      'settings row gap matches its neighbours',
      'mine=' + rows.mine.gap + ' neighbour=' + (rows.neighbour && rows.neighbour.gap))
    // The hint is the tell: unscoped it inherits the host's 14px row font.
    expect(rows.mine.hint && rows.mine.hint.fontSize === '12px',
      'settings row hint uses the host secondary size on desktop', JSON.stringify(rows.mine.hint))
    expect(rows.mine.title && rows.mine.title.lineHeight === '22px',
      'settings row title uses the host line height on desktop', JSON.stringify(rows.mine.title))
  }

  if (SCREENSHOT_DIR && label === 'desktop') {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
    await fs.writeFile(path.join(SCREENSHOT_DIR, 'pocket-desktop-settings.png'), Buffer.from(shot.data, 'base64'))
    console.log('  ..  wrote ' + path.join(SCREENSHOT_DIR, 'pocket-desktop-settings.png'))
  }

  await evaluate(cdp, session, `(() => {
    const d = document.querySelector('[role="presentation"] [aria-hidden="true"]')
    if (d) d.click()
    return true
  })()`)
  await sleep(400)

  if (SCREENSHOT_DIR && label === 'desktop') {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
    await fs.writeFile(path.join(SCREENSHOT_DIR, 'pocket-desktop.png'), Buffer.from(shot.data, 'base64'))
    console.log('  ..  wrote ' + path.join(SCREENSHOT_DIR, 'pocket-desktop.png'))
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

let chrome = null
try {
  const launched = await launchChrome()
  chrome = launched.child
  const { cdp, sessionId } = await openSession(launched.port)

  try {
    await loadPage(cdp, sessionId, { mobile: true })
    await runMobile(cdp, sessionId)

    // A narrow *desktop* window is the classic false positive: split-screen and
    // OS display scaling both push a desktop viewport under 1024px.
    await runDesktop(cdp, sessionId, { label: 'narrow desktop', width: 900, height: 800 })
    await runDesktop(cdp, sessionId, { label: 'desktop', width: 1280, height: 800 })
  } finally {
    cdp.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' assertions passed')
  if (failed.length > 0) {
    console.log('\nfailures:')
    for (const f of failed) console.log('  - ' + f.label + (f.detail ? '\n      ' + f.detail : ''))
    process.exitCode = 1
  }
} catch (err) {
  console.error('\nprobe error: ' + (err && err.stack ? err.stack : err))
  process.exitCode = 1
} finally {
  if (chrome) {
    chrome.kill('SIGKILL')
    // Chrome spawns helpers; make sure none survive the run.
    await sleep(500)
  }
}
