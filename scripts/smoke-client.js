/**
 * Client-half smoke test — no browser, no network.
 *
 * The bundle is lazy CJS: executing the file only *registers* a factory, so the
 * module body (and therefore React) is not touched until we call it. That makes
 * the whole client half testable with a handful of stubs.
 *
 * What this actually guards:
 *   - the bundle format contract (single load(), id === package name);
 *   - the activation contract (exports.inject must declare `slots`);
 *   - the desktop no-op invariant, asserted structurally over the stylesheet;
 *   - CSS ordering traps that are invisible to the eye (base before modifier).
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

// --------------------------------------------------------------------------
// 0. source-level guards — these MUST run before the bundle is evaluated
// --------------------------------------------------------------------------
//
// A guard that runs after `new Function(source)` can never fire: a syntax error
// throws first, so the check is dead code that only looks like protection. The
// stylesheet lives in a template literal, and a backtick inside a CSS comment
// (easy to type when naming properties in prose) terminates the string and turns
// the whole bundle into a syntax error — which surfaces in the browser as "no UI
// at all" rather than as anything diagnostic. Keep this first.

check('the stylesheet contains no stray backticks', () => {
  const marker = 'const CSS = `'
  const at = source.indexOf(marker)
  assert.ok(at !== -1, 'CSS template literal is present')
  const body = source.slice(at + marker.length)
  const end = body.indexOf('\n`')
  assert.ok(end !== -1, 'CSS template literal is terminated')
  assert.ok(!body.slice(0, end).includes('`'),
    'no backtick may appear inside the CSS template literal')
})

// --------------------------------------------------------------------------
// 1. register the bundle exactly once
// --------------------------------------------------------------------------

const registrations = []
const windowStub = {
  __ModuleLoader__: {
    load(entry) {
      if (registrations.length > 0) {
        throw new Error('duplicate factory registration — bundle executed twice')
      }
      registrations.push(entry)
    },
  },
}

// eslint-disable-next-line no-new-func
new Function('window', source)(windowStub)

check('bundle registers exactly one factory', () => {
  assert.equal(registrations.length, 1)
})

const entry = registrations[0]

check('bundle id is the package name', () => {
  assert.equal(entry.id, 'dsh-pocket-ui')
  assert.equal(typeof entry.factory, 'function')
})

// --------------------------------------------------------------------------
// 2. materialise the module body
// --------------------------------------------------------------------------

const ReactStub = {
  createElement: (...args) => ({ __element: true, args }),
  Fragment: Symbol('Fragment'),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
}

const mod = entry.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('unexpected require: ' + id)
})

check('exports the activation contract', () => {
  assert.equal(mod.name, 'dsh-pocket-ui')
  assert.equal(typeof mod.apply, 'function')
})

check('inject declares the services apply() actually consumes', () => {
  assert.ok(Array.isArray(mod.inject), 'inject must be an array')
  // Declaring `slots` is mandatory: without it apply() can run before the slots
  // service exists and the plugin dies silently with no console error.
  assert.ok(mod.inject.includes('slots'), 'inject must include slots')
  assert.ok(mod.inject.includes('layout'), 'inject must include layout (drawer needs it)')
})

check('the mobile query requires a coarse pointer', () => {
  const q = mod.__internal.MOBILE_QUERY
  assert.match(q, /pointer:\s*coarse/, 'width alone would falsely enable mobile UI on desktop')
  assert.match(q, /max-width:\s*1023px/, 'breakpoint must stay under the host 1024px LG breakpoint')
})

// --------------------------------------------------------------------------
// 3. desktop no-op invariant, asserted over the stylesheet
// --------------------------------------------------------------------------

const css = mod.__internal.CSS

/** Strip /* … *​/ comments so selector extraction sees only real selectors. */
function stripComments(sheet) {
  return sheet.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Split a stylesheet into top-level rule blocks, ignoring at-rule bodies. */
function topLevelRules(sheet) {
  const rules = []
  let depth = 0
  let buffer = ''
  for (const ch of stripComments(sheet)) {
    if (ch === '{') {
      depth += 1
      if (depth === 1) {
        rules.push(buffer.trim())
        buffer = ''
      }
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) { buffer = ''; continue }
    }
    if (depth === 0) buffer += ch
  }
  return rules.filter((r) => r.length > 0 && !r.startsWith('@'))
}

/** Every selector in a comma-separated list. */
function selectorsOf(ruleHead) {
  return ruleHead.split(',').map((s) => s.trim()).filter(Boolean)
}

check('every rule either gates on the pocket attribute or styles our own chrome', () => {
  // The desktop no-op invariant, asserted structurally. A rule may be:
  //   (a) scoped under html[data-pocket="on"] — it rewrites the host, or renders
  //       only in mobile mode; or
  //   (b) a `.pocket-*` rule — it styles chrome that is ours.
  // Nothing else is allowed, so an inactive plugin contributes zero host
  // overrides and there is nothing to undo on a wide screen.
  const offenders = []
  for (const head of topLevelRules(css)) {
    for (const selector of selectorsOf(head)) {
      const scoped = selector.startsWith('html[data-pocket="on"]')
      const ownChrome = selector.startsWith('.pocket-')
      if (!scoped && !ownChrome) offenders.push(selector)
    }
  }
  assert.deepEqual(offenders, [],
    'unscoped host selectors would leak into desktop:\n    ' + offenders.join('\n    '))
})

check('the settings row is styled at every width, not just on mobile', () => {
  // Regression guard for a real bug: `settings.general.item` is rendered by the
  // host at EVERY width, so scoping its rules under html[data-pocket="on"] left
  // the row as bare unstyled HTML on desktop — no padding, no separator, and a
  // 14px hint where the host uses 12px. Mobile looked right, desktop looked
  // broken, which is exactly the confusing half-styled state this forbids.
  const scoped = /html\[data-pocket="on"\]\s+\.pocket-row\b/
  assert.ok(!scoped.test(css),
    'the settings row must not be gated on the mobile attribute')
  assert.ok(css.includes('.pocket-row {'), 'unscoped .pocket-row rule present')
})

check('the settings row matches the host row metrics', () => {
  // Copied from the host's own general-settings rows so the plugin does not look
  // like a foreign body in the list.
  const row = css.match(/\.pocket-row \{[^}]*\}/)
  assert.ok(row, '.pocket-row rule present')
  assert.match(row[0], /padding:\s*16px 0/, 'host rows use 16px 0')
  assert.match(row[0], /border-bottom:\s*\.5px solid var\(--dsw-alias-border-l2/,
    'host rows use a .5px --dsw-alias-border-l2 separator')
  const text = css.match(/\.pocket-row-text \{[^}]*\}/)
  assert.ok(text, '.pocket-row-text rule present')
  assert.match(text[0], /padding-right:\s*48px/, 'host text columns reserve 48px')
  assert.match(css.match(/\.pocket-row-title \{[^}]*\}/)[0], /line-height:\s*22px/)
  assert.match(css.match(/\.pocket-row-hint \{[^}]*\}/)[0], /font-size:\s*12px/,
    'the hint must be 12px, matching every host row')
})

check('the drawer chrome is scoped and bails out while inactive', () => {
  assert.ok(css.includes('html[data-pocket="on"] .pocket-fab'), 'fab styles present and scoped')
  assert.ok(css.includes('html[data-pocket="on"] .pocket-backdrop'), 'backdrop styles present and scoped')
  // The components must additionally bail out when inactive, because a slot
  // entry is rendered by the host at any width.
  const chrome = source.slice(source.indexOf('function PocketChrome'))
  assert.match(chrome.slice(0, 900), /if \(!active\) return null/,
    'PocketChrome must return null while inactive')
})

check('the toggle button is bottom-left, hairline, and one accent colour', () => {
  const rule = css.match(/html\[data-pocket="on"\] \.pocket-fab \{[^}]*\}/)
  assert.ok(rule, '.pocket-fab rule present')
  // Bottom-left, not top-left: the drawer header already carries the host's own
  // sidebar toggle up there. Anchoring is asserted as an invariant, not a value,
  // so changing the offset does not have to touch this test.
  assert.match(rule[0], /bottom:\s*calc\(var\(--pocket-safe-b\)/, 'must be anchored to the bottom')
  assert.match(rule[0], /left:\s*calc\(var\(--pocket-safe-l\)/, 'must be anchored to the left')
  assert.ok(!/(^|\s)top:/.test(rule[0]), 'must not also be pinned to the top')

  // One token drives both the border and the glyph. Two independent hex literals
  // would drift the moment someone tweaks one of them.
  assert.match(css, /--pocket-accent:\s*#4176e6/, 'the accent token must be the requested colour')
  assert.match(rule[0], /border:\s*\.5px solid var\(--pocket-accent\)/, 'border uses the accent token')
  assert.match(rule[0], /color:\s*var\(--pocket-accent\)/, 'glyph colour uses the accent token')
  assert.equal((css.match(/#4176e6/g) || []).length, 1,
    'the hex must appear exactly once — everywhere else goes through the token')
})

check('the toggle glyph is drawn thin, on its own grid', () => {
  // The old icon was a 20-unit grid rendered at 20px with a 1.6 stroke; at a 28px
  // button that reads as a solid block. Shrinking the render size alone would
  // have scaled the stroke implicitly, so the geometry is restated explicitly.
  const body = source.slice(source.indexOf('function MenuIcon')).slice(0, 700)
  assert.match(body, /width: 16, height: 16/, 'glyph renders at 16px inside a 28px button')
  assert.match(body, /viewBox: '0 0 16 16'/, 'glyph has its own 16-unit grid')
  const stroke = body.match(/strokeWidth: ([\d.]+)/)
  assert.ok(stroke, 'strokeWidth present')
  assert.ok(Number(stroke[1]) <= 1.3, 'stroke must be thin (<= 1.3), got ' + stroke[1])
  assert.match(body, /stroke: 'currentColor'/, 'glyph must inherit the accent via currentColor')
})

check('nothing closes the drawer on a click inside the panel', () => {
  // Regression guard, and the most expensive bug this plugin has shipped.
  //
  // The first cut closed the drawer from a capture-phase click listener on the
  // sidebar whenever the target matched a broad "interactive" selector
  // (a[href], button, [role=treeitem], …). The workspace panel is a tree of
  // [role="treeitem"] rows, so in practice *every* tap inside the panel closed
  // it: selecting a session, opening a folder, scrolling. Probe measured
  // `drawer attr after tapping the row = null` on a plain session row.
  //
  // The exclusion list bolted onto that heuristic was the tell: a rule that
  // needs an ever-growing list of exceptions is the wrong rule. Tapping a
  // session row must select the session, and the drawer's close control is the
  // host's own 收起侧边栏 button — which we follow (syncDrawerWithHost) rather
  // than race.
  assert.ok(!/addEventListener\(\s*['"]click['"]/.test(source),
    'no click listener may be installed to infer "the user is done" from a tap')
  assert.ok(source.includes('function syncDrawerWithHost'),
    'the host sidebar state must be adopted as the drawer close signal')
  assert.match(extractFunction(source, 'reconcile'), /syncDrawerWithHost\(\)/,
    'syncDrawerWithHost must run on every reconcile pass')
})

/**
 * Extract a whole function body by brace matching.
 *
 * Slicing a fixed number of characters after the declaration is what the first
 * version of this check did, and it silently stopped seeing the code it was
 * asserting on the moment a comment was added above the call — the assertion
 * failed while the behaviour was correct. Brace matching is barely more code and
 * cannot drift.
 */
function extractFunction(text, name) {
  const start = text.indexOf('function ' + name + '(')
  assert.ok(start !== -1, 'function ' + name + ' must exist')
  let depth = 0
  for (let i = text.indexOf('{', start); i >= 0 && i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces in ' + name)
}

check('closing the drawer never toggles a sidebar the host already collapsed', () => {
  // The host's 收起侧边栏 button collapses the sidebar itself and the reconciler
  // adopts that as "the drawer is closed". If the close path also called
  // layout.toggleSidebar(), the two toggles would cancel out and the host would
  // end up expanded behind a drawer that had already slid away.
  //
  // The guard is what makes that safe, and it is deliberately unconditional —
  // it covers the backdrop and Escape paths too, so no caller has to declare
  // which kind of close it is.
  const setter = source.slice(source.indexOf('function setDrawerOpen'))
  const closePath = setter.slice(setter.indexOf("removeAttribute('data-pocket-drawer')"), setter.indexOf('\n        }'))
  assert.match(closePath, /if \(!hostSidebarCollapsed\(\)\) toggleHostSidebar\(\)/,
    'the close path must only toggle the host when the host is still expanded')
  assert.ok(!/options/.test(setter.slice(0, 120)),
    'setDrawerOpen must not grow a mode flag: the state guard already covers every caller')

  const adopt = source.slice(source.indexOf('function syncDrawerWithHost'))
  assert.match(adopt.slice(0, 700), /setDrawerOpen\(false\)/,
    'syncDrawerWithHost must close through the ordinary path')
})

check('host class names are never used as selectors', () => {
  // The host emits content-hashed class names (pI_x6G_frame, wSkVaW_header) that
  // change on every build. We must select on data-slot / ARIA / our own tags.
  const hashed = /\[class[*^$|~]?=/
  assert.ok(!hashed.test(css), 'stylesheet must not select host class names')
})

check('drawer base rule precedes its modifier', () => {
  // Same specificity means source order decides. If the modifier came first the
  // drawer would never open.
  const base = css.indexOf('html[data-pocket="on"] [data-pocket-sidebar] {')
  const modifier = css.indexOf('html[data-pocket="on"][data-pocket-drawer="open"] [data-pocket-sidebar] {')
  assert.ok(base !== -1, 'drawer base rule present')
  assert.ok(modifier !== -1, 'drawer open modifier present')
  assert.ok(base < modifier, 'base rule must come before the modifier')
})

check('the grid override is !important (host sets it inline)', () => {
  const rule = css.match(/html\[data-pocket="on"\] \[data-pocket-frame\] \{[^}]*\}/)
  assert.ok(rule, 'frame rule present')
  assert.match(rule[0], /grid-template-columns:[^;]*!important/,
    'the host writes grid-template-columns as a React inline style')
})

check('the drawer never becomes a containing block for fixed descendants', () => {
  // The host renders the settings dialog inline inside the sidebar subtree with
  // `position: fixed; inset: 0`. Any transform on the drawer — including
  // `will-change: transform` — makes the drawer that dialog's containing block,
  // trapping a full-viewport sheet inside a 320px panel. Caught by probe once
  // (sheet measured 319px instead of 390px); guarded here so it cannot come back.
  const rule = css.match(/html\[data-pocket="on"\] \[data-pocket-sidebar\] \{[^}]*\}/)
  assert.ok(rule, 'drawer rule present')
  assert.ok(!/transform\s*:/.test(rule[0]),
    'transform on the drawer traps the host settings dialog inside it')
  assert.ok(!/will-change/.test(rule[0]),
    'will-change: transform creates a containing block too')
  assert.match(rule[0], /left:/, 'the drawer must slide via `left` instead')
})

check('the bottom sheet keeps its content column shrinkable', () => {
  // Flipping the panel from row to column swaps which automatic minimum applies:
  // `min-width:0` (which the host ships) stops mattering and `min-height:auto`
  // takes over, refusing to shrink below content. The column then overflows the
  // panel's max-height, the panel clips it (`overflow:hidden`), and the inner
  // scroller never gets a bounded height — the settings page cannot scroll.
  const rule = css.match(/html\[data-pocket="on"\] \[role="presentation"\] > \[role="dialog"\]\[aria-modal="true"\] > nav \+ \*[^{]*\{[^}]*\}/)
  assert.ok(rule, 'the sheet content column must be addressed explicitly')
  assert.match(rule[0], /min-height:\s*0\s*!important/,
    'the content column needs min-height:0 or the sheet cannot scroll')
})

check('the sheet height cap prefers dvh over vh', () => {
  // vh measures the largest viewport, so on mobile the sheet can extend below
  // the visible area once the URL bar is showing.
  assert.match(css, /max-height:\s*88vh\s*!important/, 'vh fallback present')
  assert.match(css, /max-height:\s*88dvh\s*!important/, 'dvh override present')
  assert.ok(css.indexOf('max-height: 88vh !important') < css.indexOf('max-height: 88dvh !important'),
    'dvh must follow the fallback so it wins where supported')
})

check('the stylesheet never declares the safe-area tokens itself', () => {
  // This is the shape of the phantom-title-bar bug, asserted rather than
  // described. If the sheet declared `--pocket-safe-t: env(safe-area-inset-top)`,
  // every rule would pad by an inset the plugin has not verified the page needs —
  // and a var() fallback cannot express the alternative, because
  // `var(--x, env(safe-area-inset-top))` is invalid CSS.
  assert.ok(!/--pocket-safe-[tblr]\s*:/.test(css),
    'the inset tokens must be written by syncSafeArea(), not declared in CSS')
  assert.ok(/var\(--pocket-safe-t\)/.test(css), 'consumers still read the token')
  assert.ok(/var\(--pocket-safe-b\)/.test(css), 'consumers still read the token')
})

check('the insets are measured through a real element, not read as token text', () => {
  // `getPropertyValue('--pocket-safe-t')` returns the *specified* stream, i.e.
  // the literal string "env(safe-area-inset-top, 0px)". Only inheriting the
  // token into an element and reading a resolved length property substitutes it.
  const fn = extractFunction(source, 'probeInset')
  assert.match(fn, /env\(safe-area-inset-/, 'the probe must ask for the env()')
  assert.match(fn, /getComputedStyle\(el\)\[prop\]/,
    'and must read the resolved length back off a real element')
  assert.match(fn, /position:absolute;left:-9999px/,
    'the probe element must be out of flow: it exists during a layout pass')
})

check('the inset policy is explicit, gated on both geometry and environment', () => {
  // Either gate alone is wrong. Geometry misses an in-app WebView whose frame is
  // flush to its own viewport while the device chrome sits above it; display mode
  // alone misses a browser tab whose frame is pushed down by a wrapper.
  const fn = extractFunction(source, 'syncSafeArea')
  assert.match(fn, /frameTop\s*>\s*2/, 'the geometry gate must be measured, not assumed')
  assert.match(fn, /display-mode:\s*standalone/, 'the environment gate must be queried')
  assert.match(fn, /topPolicy/, 'the decision must be named, so the probe can report it')
  assert.match(fn, /const top = topPolicy === 'applied' \? insetTop : 0/,
    'exactly one policy value applies the inset')
  assert.match(fn, /room\s*>=\s*insetBottom\s*\?\s*insetBottom\s*:\s*0/,
    'a shell with no room left clamps its bottom inset to zero')
  assert.ok(/--pocket-inset-raw-t/.test(fn),
    'the raw inset is published too, so "ignored" and "reported zero" stay distinguishable')
})

check('the insets are re-measured on every pass and cleared on teardown', () => {
  // They depend on live geometry: the host rewrites the frame on resize, on
  // entering fullscreen, and whenever the drawer asks the sidebar to expand.
  assert.match(extractFunction(source, 'reconcile'), /lastInsets = syncSafeArea\(\)/)
  assert.match(extractFunction(source, 'activate'), /syncSafeArea\(\)/,
    'activate must measure before the first styled frame, not one frame later')
  assert.match(extractFunction(source, 'deactivate'), /clearSafeArea\(\)/,
    'teardown must leave no inline tokens behind')
})

check('reduced motion is respected', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
})

// --------------------------------------------------------------------------
// 4. store primitive
// --------------------------------------------------------------------------

check('createStore notifies subscribers and unsubscribes cleanly', () => {
  const store = mod.__internal.createStore(0)
  const seen = []
  const off = store.subscribe((v) => seen.push(v))
  store.set(1)
  store.set(1) // no-op: identical value
  store.set(2)
  off()
  store.set(3)
  assert.deepEqual(seen, [1, 2])
  assert.equal(store.get(), 3)
})

check('a throwing subscriber cannot break the others', () => {
  const store = mod.__internal.createStore(0)
  const seen = []
  store.subscribe(() => { throw new Error('boom') })
  store.subscribe((v) => seen.push(v))
  store.set(1)
  assert.deepEqual(seen, [1])
})

// --------------------------------------------------------------------------
// 4b. host-route resolution
// --------------------------------------------------------------------------
//
// The settings row is the user's only window into the host half, and it talks to
// it over HTTP. Those paths must be resolved document-relative, never
// root-absolute: a root-absolute path ignores a reverse-proxy mount point and,
// in the desktop shell, resolves under the `dsh-app://app/` scheme.
//
// That second case is where the priority matters, and it is the opposite of the
// platform's own `remoteStreamUrl()` order. The shell's `protocol.handle`
// intercepts only its static assets on that origin and forwards *everything
// else* to the Host through `forwardWebRequest`, which keeps the pathname and
// attaches the Host cookie — so `dsh-app://app/pocket/meta` DOES reach the
// plugin. `streamBaseUrl` instead names the Host's own origin, which the platform
// uses for its WebSocket mux (`url.protocol = 'wss:'`, not policed by CORS, and
// the shell has a dedicated `ws://127.0.0.1/*` cookie rule for it). Aiming a
// cross-origin `fetch()` there fails: no cookie, no `access-control-allow-origin`.

check('host routes resolve against the document base, then the transport, then the mount', () => {
  const { hostUrl } = mod.__internal
  assert.equal(typeof hostUrl, 'function', 'hostUrl must be exported for this test')

  const prevDocument = globalThis.document
  const prevTransport = globalThis.__DSH_TRANSPORT__
  try {
    globalThis.document = { baseURI: 'http://127.0.0.1:3080/' }
    delete globalThis.__DSH_TRANSPORT__
    assert.equal(hostUrl('/pocket/meta'), 'http://127.0.0.1:3080/pocket/meta',
      'a plain served page resolves against its own document base')

    // The load-bearing case. `dsh-app://app/` is the base the shell routes to the
    // Host, so it must win even though a transport is published; the transport's
    // cross-origin origin would be refused for want of CORS headers.
    globalThis.document = { baseURI: 'dsh-app://app/' }
    globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:55531/' }
    assert.equal(hostUrl('/pocket/meta'), 'dsh-app://app/pocket/meta',
      'the document base must win: the shell forwards that origin to the Host with its cookie')

    // A mount point must survive: the route is document-relative, not root-absolute.
    globalThis.document = { baseURI: 'http://nas.local:3080/dsh/' }
    delete globalThis.__DSH_TRANSPORT__
    assert.equal(hostUrl('/pocket/meta'), 'http://nas.local:3080/dsh/pocket/meta',
      'a reverse-proxy prefix is part of the route')

    // No usable document base: only then is the published transport worth trying.
    globalThis.document = {}
    globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:55531/' }
    assert.equal(hostUrl('/pocket/meta'), 'http://127.0.0.1:55531/pocket/meta',
      'the transport is the fallback for a page with no base of its own')

    // No base at all (a hostile/partial stub) must degrade to a relative URL
    // rather than inventing a root-absolute one.
    globalThis.document = {}
    delete globalThis.__DSH_TRANSPORT__
    assert.equal(hostUrl('/pocket/meta'), 'pocket/meta')

    // A leading slash on the *input* must not smuggle root-absoluteness back in.
    globalThis.document = { baseURI: 'http://nas.local:3080/dsh/' }
    assert.equal(hostUrl('pocket/meta'), 'http://nas.local:3080/dsh/pocket/meta')
    assert.equal(hostUrl('///pocket/meta'), 'http://nas.local:3080/dsh/pocket/meta')
  } finally {
    globalThis.document = prevDocument
    if (prevTransport === undefined) delete globalThis.__DSH_TRANSPORT__
    else globalThis.__DSH_TRANSPORT__ = prevTransport
  }
})

check('no host request is hard-coded to a root-absolute path', () => {
  // Structural, because this is a mistake that is invisible in review and only
  // shows up as "the plugin is installed but the host never answers".
  const calls = source.match(/\bfetch\(/g) || []
  assert.equal(calls.length, 4, 'expected the four known call sites, got ' + calls.length)
  assert.ok(!/fetch\(\s*['"]\//.test(source),
    'a root-absolute literal bypasses hostUrl() and breaks a path-prefixed deployment')
  // The transport is the fallback inside hostUrl(), never a base a call site
  // reaches for directly — that is the cross-origin request that fails.
  assert.ok(!/fetch\([^)]*__DSH_TRANSPORT__/.test(source),
    'no call site may fetch against the transport base directly')
})

check('the unreachable-host row names the remedy, not just the symptom', () => {
  // "host 半区无响应" on its own sends the user hunting for a broken plugin when the
  // real state is usually "the host half has not been loaded yet". It cannot be
  // loaded without restarting the server, because the module is already imported
  // into the Node process and has no unload path (see README, 开发循环). So the row
  // has to say that — otherwise the only evidence the user has is a dead-looking
  // update button, which is what made this hard to diagnose in the first place.
  const body = source.slice(source.indexOf('function PocketSettingsRow'))
  assert.match(body, /if \(link === 'down'\) hint\.push\('[^']*dsh web[^']*'\)/,
    'a down row must name the restart remedy')
  // And it must be conditional: a healthy row may not carry restart advice.
  const hintBlock = body.slice(body.indexOf('const hint = ['),
    body.indexOf('return React.createElement'))
  assert.ok(!/重启/.test(hintBlock.replace(/if \(link === 'down'\)[^\n]*\n/, '')),
    'restart advice must not appear on a connected row')
})

// --------------------------------------------------------------------------


// --------------------------------------------------------------------------
// 5. safe-area clamp — the arithmetic, not the shape of the source
// --------------------------------------------------------------------------
//
// The checks above assert what syncSafeArea() is *made of*. These run it. The
// function is pure with respect to four injected collaborators, so it can be
// evaluated against a fake frame and fake insets and its published values
// asserted exactly — which is the only way to be sure the phantom-title-bar fix
// actually zeroes the strip rather than merely mentioning it.

/** Extract one function declaration and evaluate it with injected globals. */
function evalWith(sourceText, fnName, globals) {
  const body = extractFunction(sourceText, fnName)
  const names = Object.keys(globals)
  // eslint-disable-next-line no-new-func
  const make = new Function(...names, body + '\nreturn ' + fnName)
  return make(...names.map((n) => globals[n]))
}

function fakeRoot() {
  const props = new Map()
  return {
    props,
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
    },
  }
}

function runClamp({ frameTop = 0, frameHeight = 844, insets = {}, viewport = 844, mode = 'standalone', matchMediaThrows = false }) {
  const root = fakeRoot()
  const fn = evalWith(source, 'syncSafeArea', {
    document: { documentElement: root },
    window: {
      innerHeight: viewport,
      visualViewport: { height: viewport },
      matchMedia: (q) => {
        // `mode: 'unknown'` models an engine that cannot answer at all, which is
        // the case the conservative branch exists for. Passing a mode name that
        // simply does not match any query is not the same thing: a browser that
        // matches nothing IS a browser.
        if (matchMediaThrows) throw new Error('matchMedia unavailable')
        return { matches: q === '(display-mode: ' + mode + ')' }
      },
    },
    findFrame: () => ({ getBoundingClientRect: () => ({ top: frameTop, height: frameHeight }) }),
    probeInset: (side) => insets[side] || 0,
  })
  return { result: fn(), props: root.props }
}

check('an immersive shell flush with the viewport keeps the full top inset', () => {
  // The notch case: a standalone/fullscreen view really does start under the
  // status bar, so the first row has to move down or it is unreachable.
  const { result, props } = runClamp({ frameTop: 0, mode: 'standalone', insets: { top: 48, bottom: 24 } })
  assert.equal(result.top, 48)
  assert.equal(result.pushedDown, false)
  assert.equal(result.topPolicy, 'applied')
  assert.equal(props.get('--pocket-safe-t'), '48px')
  assert.equal(props.get('--pocket-inset-raw-t'), '48px')
})

check('a non-immersive display drops the top inset even when the frame is flush', () => {
  // This is the reported bug, and the reason geometry alone is not enough: an
  // in-app WebView can report the status-bar inset while sitting entirely below
  // it, with its own frame flush to its own viewport. Padding by the inset then
  // produces a ~45px blank strip that no host rule asked for.
  const { result, props } = runClamp({ frameTop: 0, mode: 'browser', insets: { top: 45 } })
  assert.equal(result.top, 0, 'display-mode: browser cannot be underlapping system bars')
  assert.equal(result.topPolicy, 'not-an-immersive-display')
  assert.equal(props.get('--pocket-safe-t'), '0px')
  assert.equal(props.get('--pocket-inset-raw-t'), '45px', 'the device value stays visible')
})

check('an unknown display mode keeps the inset rather than gambling', () => {
  // The conservative direction matters: dropping an inset that was real puts the
  // first row of the sidebar under a notch, which is worse than an extra strip.
  const { result } = runClamp({ frameTop: 0, matchMediaThrows: true, insets: { top: 44 } })
  assert.equal(result.displayMode, 'unknown')
  assert.equal(result.top, 44, 'an unanswerable engine keeps the inset')
  assert.equal(result.topPolicy, 'applied')
})

check('a shell already below the device chrome drops the top inset to zero', () => {
  // The geometry gate on its own: an immersive view whose frame is nonetheless
  // pushed down has already had its inset spent by whoever pushed it.
  const { result, props } = runClamp({ frameTop: 45, mode: 'standalone', insets: { top: 45 } })
  assert.equal(result.top, 0, 'the inset has already been spent by whoever pushed the shell down')
  assert.equal(result.topPolicy, 'shell-below-device-chrome')
  assert.equal(props.get('--pocket-safe-t'), '0px')
  assert.equal(props.get('--pocket-inset-raw-t'), '45px',
    'the raw value stays visible so "ignored" is distinguishable from "reported zero"')
})

check('a sub-pixel frame offset is not mistaken for a pushed-down shell', () => {
  // Falling the wrong way here silently drops a real notch inset, and nothing on
  // screen would say so.
  const { result } = runClamp({ frameTop: 0.5, mode: 'standalone', insets: { top: 44 } })
  assert.equal(result.top, 44)
})

check('an absurd inset is treated as a misreport', () => {
  // 96px is taller than any real status bar or notch; a WebView reporting it is
  // describing something other than this document's overlap.
  const { result } = runClamp({ frameTop: 0, mode: 'standalone', insets: { top: 96 } })
  assert.equal(result.top, 0)
  assert.equal(result.topPolicy, 'implausible-inset')
})

check('a shell with room keeps the bottom inset, a taller one does not', () => {
  // The bottom inset is never gated on display mode: a home indicator overlaps
  // the viewport in a browser tab too.
  const roomy = runClamp({ mode: 'browser', frameHeight: 800, viewport: 844, insets: { bottom: 34 } })
  assert.equal(roomy.result.bottom, 34, '34px of slack can absorb a 34px home indicator')

  const tight = runClamp({ mode: 'browser', frameHeight: 844, viewport: 844, insets: { bottom: 34 } })
  assert.equal(tight.result.bottom, 0, 'no slack means the inset would become a phantom scroll')
  assert.equal(tight.props.get('--pocket-safe-b'), '0px')
})

check('the horizontal insets are never clamped', () => {
  // A landscape notch inset is about the viewport edge, not about the frame's
  // offset, so the pushing-down rule does not apply to it.
  const { result } = runClamp({ frameTop: 45, mode: 'browser', insets: { left: 44, right: 44, top: 45 } })
  assert.equal(result.left, 44)
  assert.equal(result.right, 44)
})

check('a missing frame degrades to zero rather than throwing', () => {
  const root = fakeRoot()
  const fn = evalWith(source, 'syncSafeArea', {
    document: { documentElement: root },
    window: {
      innerHeight: 844,
      visualViewport: { height: 844 },
      matchMedia: () => ({ matches: false }),
    },
    findFrame: () => null,
    probeInset: (side) => (side === 'top' ? 40 : 0),
  })
  const result = fn()
  assert.equal(result.frameTop, 0, 'an unmeasurable frame reads as flush')
  assert.equal(result.topPolicy, 'not-an-immersive-display')
})

console.log('\nclient smoke: ' + passed + ' checks passed')
