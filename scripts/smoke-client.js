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
  const reconcile = source.slice(source.indexOf('function reconcile()'))
  assert.match(reconcile.slice(0, 400), /syncDrawerWithHost\(\)/,
    'syncDrawerWithHost must run on every reconcile pass')
})

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

check('safe-area insets are consumed', () => {
  assert.match(css, /env\(safe-area-inset-top/)
  assert.match(css, /env\(safe-area-inset-bottom/)
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

console.log('\nclient smoke: ' + passed + ' checks passed')
