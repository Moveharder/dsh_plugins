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
  assert.ok(css.includes('html[data-pocket="on"] .pocket-tab'), 'tab styles present and scoped')
  assert.ok(css.includes('html[data-pocket="on"] .pocket-backdrop'), 'backdrop styles present and scoped')
  // The components must additionally bail out when inactive, because a slot
  // entry is rendered by the host at any width.
  const chrome = source.slice(source.indexOf('function PocketChrome'))
  assert.match(chrome.slice(0, 900), /if \(!active\) return null/,
    'PocketChrome must return null while inactive')
})

/** Read a numeric custom property out of our own stylesheet. */
function cssToken(name) {
  const m = css.match(new RegExp(name + ':\\s*([0-9.]+)px'))
  assert.ok(m, name + ' must be defined in px in the stylesheet')
  return parseFloat(m[1])
}

/** Split a CSS shorthand on the whitespace that is *not* inside parentheses. */
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) parts.push(current)
  return parts
}

/** Resolve a length written either as a literal or as a var() fallback, in px. */
function resolvePx(value) {
  const literal = value.match(/^([0-9.]+)(px)?$/)
  if (literal) return parseFloat(literal[1])
  const fallback = value.match(/,\s*([0-9.]+)(px)?\s*\)$/)
  return fallback ? parseFloat(fallback[1]) : NaN
}

/** The declarations of the `.pocket-tab` rule, as text. */
function tabRule() {
  const rule = css.match(/html\[data-pocket="on"\] \.pocket-tab \{[^}]*\}/)
  assert.ok(rule, '.pocket-tab rule present')
  return rule[0]
}

check('the tab is a half pill: square against the edge, rounded on the free side', () => {
  const rule = tabRule()
  // Read as four corners rather than as a string, because that *is* the shape that
  // was asked for: no rounding where it meets the edge, rounding on the side that
  // faces the content. A later tweak to the shorthand cannot quietly round the
  // edge side too without failing here.
  //
  // Parenthesis-aware splitting is not pedantry: the declaration is written with
  // var() fallbacks, so a plain split on whitespace yields six tokens for four
  // corners and every index below would land on the wrong corner.
  const corners = splitTopLevel(rule.match(/border-radius:\s*([^;]+);/)[1])
  assert.equal(corners.length, 4, 'border-radius must be spelled out per corner')
  assert.equal(resolvePx(corners[0]), 0, 'top-left must be square')
  assert.equal(resolvePx(corners[3]), 0, 'bottom-left must be square')
  const r = resolvePx(corners[1])
  assert.ok(r > 0, 'top-right must be rounded')
  assert.equal(corners[1], corners[2], 'the two free corners must match')
  // The host's small-control step. Deliberately not --dsw-radius-md (12px), which
  // on a 22px-wide box clamps to an 11px semicircle and loses the "handle" read —
  // which is why the step is asserted by name *and* the geometry by arithmetic.
  assert.match(corners[1], /var\(--dsw-radius-sm/, 'radius must be the host small-control step')
  assert.ok(r < cssToken('--pocket-tab-w') / 2,
    'a radius at or past half the width clamps to a semicircle, got ' + r)
  // No seam where the tab meets the edge of the screen.
  assert.match(rule, /border-left:\s*0/, 'the edge side must not draw a border')
})

check('top names the centre, and the fallback was measured clear on its own', () => {
  const rule = tabRule()
  // -50% of the tab's *own* height, so whatever top resolves to is the centre. A
  // percentage rather than a hand-computed offset: the height is a token, and a px
  // offset would silently bias the tab the moment that token changed.
  assert.match(rule, /transform:\s*translateY\(-50%\)/,
    'the transform must pull the box back by exactly half its own height')
  // top is the measured band centre, with a static fallback for the pass before
  // measurement and for any page whose landmarks cannot be found. The fallback has
  // to be safe by itself, so it is the value measured clear in the empty-session
  // case — the harder of the two states, because that is where the host centres
  // the composer and a plain 50% anchor overlaps it.
  const anchor = rule.match(/top:\s*var\(--pocket-tab-top,\s*([0-9.]+)%\)/)
  assert.ok(anchor, 'top must be the measured override with a percentage fallback')
  const fallback = parseFloat(anchor[1])
  assert.ok(fallback > 0 && fallback < 38,
    'the fallback must stay below the 45% where the centred composer begins, got ' + fallback + '%')
  // And it must clear the 56px header at every plausible height, or the tab would
  // sit on the title instead of on the content.
  const tabH = cssToken('--pocket-tab-h')
  for (const h of [568, 667, 844, 932]) {
    const top = h * fallback / 100 - tabH / 2
    assert.ok(top > 56, 'the fallback must clear the header at a ' + h + 'px viewport, got ' + top)
  }
})

check('a slim column of pixels, but a full tap target', () => {
  const w = cssToken('--pocket-tab-w')
  const h = cssToken('--pocket-tab-h')
  // Width is the one dimension that costs content — the conversation's own left
  // gutter is about 20px — so it is the dimension held down.
  assert.ok(w <= 24, 'the tab must stay slim, got ' + w + 'px')
  // Height costs no content at all, so it is where the touch target is bought.
  assert.ok(h >= 44, 'the height must meet the 44px touch minimum, got ' + h + 'px')
  assert.ok(h > w, 'the tab must be taller than it is wide')
})

check('one token drives the accent', () => {
  // The glyph takes its colour from the same token as everything else. Two
  // independent hex literals would drift the moment someone tweaks one of them.
  assert.match(css, /--pocket-accent:\s*#4176e6/, 'the accent token must be the requested colour')
  assert.match(tabRule(), /color:\s*var\(--pocket-accent\)/, 'the glyph must take the accent')
  assert.equal((css.match(/#4176e6/g) || []).length, 1,
    'the hex must appear exactly once — everywhere else goes through the token')
})

check('the tab is legible even though its fill matches the page', () => {
  const rule = tabRule()
  // --dsw-alias-bg-layer-2 resolves to the same colour as --dsw-alias-bg-base in
  // light mode (both neutral-bluish-00), so a tab trusting its fill would be
  // invisible on a light page. The outline is load-bearing, not decorative, and it
  // has to be the l2 step: l1 is 4% black, against 10% for l2.
  assert.match(rule, /border:\s*\.5px solid var\(--dsw-alias-border-l2/,
    'the outline must use the stronger l2 step')
  // Directional, because an edge fixture must not read as a floating card.
  assert.match(rule, /box-shadow:\s*[1-9]px 0 /, 'the shadow must fall away from the edge')
})

check('the tab never moves, so it has nothing to animate', () => {
  // The old corner button transitioned `bottom`, because a growing composer moved
  // it. This one is anchored to the viewport middle, so a transition could only
  // ever fire on an orientation change — and the reduced-motion opt-out that
  // accompanied the old one is gone with it.
  assert.ok(!/transition/.test(tabRule()), 'the tab must not animate')
  assert.ok(!/prefers-reduced-motion[^}]*\.pocket-tab/.test(css),
    'and must need no motion opt-out')
})

check('the toggle glyph is drawn thin, on its own grid', () => {
  // The old icon was a 20-unit grid rendered at 20px with a 1.6 stroke; at a 28px
  // button that reads as a solid block. Shrinking the render size alone would
  // have scaled the stroke implicitly, so the geometry is restated explicitly.
  const body = source.slice(source.indexOf('function MenuIcon')).slice(0, 700)
  assert.match(body, /width: 16, height: 16/, 'glyph renders at 16px inside the edge tab')
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

check('a process older than its own package says so instead of offering an upgrade', () => {
  // The failure this guards: a row reading "v0.1.4 · 可升级到 v0.1.7" on a
  // checkout that was already v0.1.7, whose upgrade button then died with
  // "cannot locate the profile install root". Both halves were telling the truth
  // about different things — the host half runs the code it imported at startup
  // and has no unload path, while the client half is served from disk and
  // hot-reloads. The host now reports both versions, and the row has to prefer
  // the restart: an upgrade cannot fix a process that is *behind* its own
  // package, because the newer files are already in place.
  const body = source.slice(source.indexOf('function PocketSettingsRow'))
  assert.match(body, /const stale = !!\(meta && meta\.stale\)/, 'the row must read the flag')
  assert.match(body, /meta\.installedVersion/, 'and name the version that is actually on disk')
  assert.match(body, /（进程内）/, 'the running version must be labelled as such')

  // Order is the assertion: every branch below would name the wrong remedy for a
  // stale process — `localInstall` points at "edit the source", and
  // `updateAvailable` at a button that cannot possibly help.
  const staleAt = body.indexOf('if (stale)')
  assert.ok(staleAt !== -1, 'there must be a stale branch')
  assert.ok(staleAt < body.indexOf('} else if (localInstall)'),
    'stale must be decided before the local-install line')
  assert.ok(staleAt < body.indexOf('updateAvailable && !localInstall && !stale'),
    'and before the upgrade offer')

  assert.match(body, /updateAvailable && !localInstall && !stale/,
    'a stale process must not be offered an upgrade at all')
  assert.match(body, /重启 dsh web 后生效/, 'the stale row must name the restart remedy')
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
      getPropertyValue: (k) => (props.has(k) ? props.get(k) : ''),
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

// --------------------------------------------------------------------------
// 6. edge-tab placement — the adaptive band, and the retired placements
// --------------------------------------------------------------------------
//
// Three placements were shipped and then withdrawn (bottom-left with a lift, the
// header row, then a plain 50% anchor), so this section does three jobs: it runs
// the band arithmetic, it pins the result to numbers taken from a real page, and
// it makes sure the withdrawn versions cannot come back half-way.

/** Read a top-level numeric const out of the client source. */
function sourceNumber(name) {
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*([0-9.]+)'))
  assert.ok(m, 'const ' + name + ' must exist as a number in client.js')
  return parseFloat(m[1])
}

/**
 * Drive syncTabSeat() against fake landmarks and read what it published.
 *
 * `header` is the header's bottom edge and `seat` the composer block's top edge —
 * the two values the function actually reads, so the test speaks in the same terms
 * as the code. `missing` drops one landmark to exercise the decline path.
 */
function runTabSeat({ header = 56, seat = 698, tabH = 44, missing = null } = {}) {
  const root = fakeRoot()
  const boxOf = (value, kind) => ({
    getBoundingClientRect: () => (kind === 'header' ? { bottom: value } : { top: value }),
  })
  const body = extractFunction(source, 'syncTabSeat') + '\n'
    + extractFunction(source, 'clearTabSeat')
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'window', 'TAB_EDGE_GAP',
    body + '\nreturn { syncTabSeat, clearTabSeat }')
  const impl = make(
    {
      documentElement: root,
      querySelector: (sel) => {
        if (missing === 'header' && sel.includes('header')) return null
        if (missing === 'seat' && sel.includes('composer-seat')) return null
        if (sel.includes('header')) return boxOf(header, 'header')
        if (sel.includes('composer-seat')) return boxOf(seat, 'seat')
        return null
      },
    },
    { getComputedStyle: () => ({ getPropertyValue: () => tabH + 'px' }) },
    sourceNumber('TAB_EDGE_GAP'),
  )
  return { result: impl.syncTabSeat(), props: root.props }
}

check('the tab centres in the free band, not on the screen', () => {
  // The two real states, measured live at 390x844. Docked, the composer block
  // starts at y 698; on an empty session the host centres it, at y 331. A plain
  // 50% anchor (422) lands inside the composer in that second case, which is
  // exactly the bug this replaced.
  const docked = runTabSeat({ header: 56, seat: 698 })
  assert.equal(docked.result, 377, 'a docked composer puts the tab at the band centre')
  assert.equal(docked.props.get('--pocket-tab-top'), '377px')

  const empty = runTabSeat({ header: 56, seat: 331 })
  assert.equal(empty.result, 193.5, 'an empty session raises it to the shorter band centre')
  assert.equal(empty.props.get('--pocket-tab-top'), '194px',
    'the published value is rounded to whole pixels')

  // The invariant is the middle of the band, not the specific numbers.
  for (const [top, bottom] of [[56, 698], [56, 331], [100, 500]]) {
    const { result } = runTabSeat({ header: top, seat: bottom })
    assert.equal(result, (top + bottom) / 2, 'centre of the band ' + top + ' -> ' + bottom)
  }
})

check('the centre never leaves the band or eats its gap', () => {
  const tabH = cssToken('--pocket-tab-h')
  const gap = sourceNumber('TAB_EDGE_GAP')
  for (const top of [56, 120, 300]) {
    for (const bottom of [top + 20, top + 100, top + 400, 844]) {
      const { result } = runTabSeat({ header: top, seat: bottom, tabH })
      assert.ok(result !== null, 'a band of ' + (bottom - top) + 'px must still produce a centre')
      assert.ok(result - tabH / 2 >= top,
        'the tab must never reach into the header (band ' + top + ' -> ' + bottom + ')')
      const low = top + gap + tabH / 2
      const high = bottom - gap - tabH / 2
      if (high < low) {
        // No centre can satisfy a band this short, so the direction of the failure
        // is chosen rather than left to arithmetic legend: just under the header,
        // never further down into the composer.
        assert.equal(result, low,
          'a band too short to hold the tab must pin it just below the header')
      } else {
        assert.ok(result >= low && result <= high,
          'the tab must keep its gap at both ends of the band ' + top + ' -> ' + bottom)
      }
    }
  }
})

check('an unmeasurable band declines rather than guessing', () => {
  // Removing the published value is the whole point: the stylesheet then falls back
  // to a value measured clear, whereas a stale pixel value would keep applying
  // after the composer had moved somewhere else entirely.
  for (const missing of ['header', 'seat']) {
    const { result, props } = runTabSeat({ missing })
    assert.equal(result, null, 'a missing ' + missing + ' must decline to publish')
    assert.equal(props.get('--pocket-tab-top'), undefined,
      'and must remove any previously published value')
  }
  // A collapsed box reports an all-zero rect, which inverts the band.
  const inverted = runTabSeat({ header: 300, seat: 100 })
  assert.equal(inverted.result, null, 'an inverted band must decline')
  assert.equal(inverted.props.get('--pocket-tab-top'), undefined)
  // With no readable height there is nothing to clamp against.
  const noHeight = runTabSeat({ tabH: 0 })
  assert.equal(noHeight.result, null, 'an unreadable height must decline')
  assert.equal(noHeight.props.get('--pocket-tab-top'), undefined)
})

check('the static fallback clears the composer in the state that broke 50%', () => {
  // The fallback applies before the first measurement, and on any page whose
  // landmarks cannot be found, so it has to be safe on its own. It is anchored to
  // the empty-session case, the harder one: at 390x844 the host centres the
  // composer block at y 331, against y 698 once there is history.
  const tabH = cssToken('--pocket-tab-h')
  const fallback = parseFloat(
    tabRule().match(/top:\s*var\(--pocket-tab-top,\s*([0-9.]+)%\)/)[1])
  const bottom = 844 * fallback / 100 + tabH / 2
  assert.ok(bottom < 331,
    'at 390x844 the fallback must clear the centred composer block, got ' + bottom)
  // 45% is where the centred composer begins at every height measured, so anything
  // at or above that is unsafe on the empty state.
  assert.ok(fallback < 38, 'and must stay below the 45% threshold, got ' + fallback + '%')
})

check('the band observer is wired in, and released rather than leaked', () => {
  // The reconciler is MutationObserver-driven and does not observe characterData,
  // so typing a second line changes no mutation it would ever see. Without this
  // observer the band would keep its one-line bounds indefinitely.
  const recount = extractFunction(source, 'reconcile')
  assert.match(recount, /observeTabBand\(\)/, 'the band must be observed on every pass')
  assert.match(recount, /lastTabSeat = syncTabSeat\(\)/, 'and re-measured on every pass')

  const observe = extractFunction(source, 'observeTabBand')
  assert.match(observe, /if \(seat === tabSeatObserved\) return/,
    'an unchanged composer must not be re-observed')
  assert.match(observe, /unobserve\(tabSeatObserved\)/,
    'a replaced composer must be unobserved, not merely added to')
  // observeTabBand() is called between syncSafeArea() and syncDrawerWithHost(), so a
  // throw here would abort the rest of the pass and freeze the layout on the previous
  // frame. An optional enhancement must not be able to do that.
  assert.match(observe, /typeof ResizeObserver !== 'function'/,
    'a missing ResizeObserver must degrade, not abort the reconcile pass')

  const release = extractFunction(source, 'releaseTabBand')
  assert.match(release, /tabSeatObserver\.disconnect\(\)/, 'teardown must disconnect the observer')
  assert.match(release, /clearTabSeat\(\)/, 'and remove the published offset')
  assert.match(extractFunction(source, 'deactivate'), /releaseTabBand\(\)/,
    'deactivate() must release the band, not just the insets')
})

check('the band observer state is declared at factory scope', () => {
  // Not hypothetical, and not new: this exact mistake has already been made once in
  // this file. observeTabBand() and the teardown are both factory-scope functions,
  // so declaring these next to the other mutables inside apply() looks natural and
  // is wrong — the binding is invisible to them. The symptom is a ReferenceError on
  // the first reconcile pass, i.e. after activation, on a device, with every offline
  // check still green.
  const factoryEnd = source.indexOf('function apply(')
  assert.ok(factoryEnd > 0, 'apply() must exist')
  for (const name of ['tabSeatObserver', 'tabSeatObserved', 'lastTabSeat']) {
    const decl = source.indexOf('let ' + name + ' = ')
    assert.ok(decl !== -1, 'let ' + name + ' must be declared')
    assert.ok(decl < factoryEnd,
      name + ' must be declared before apply() — observeTabBand() runs at factory '
      + 'scope and a ReferenceError here only shows up after activation')
  }
})

check('the retired placements leave no trace', () => {
  // Reverting a placement is where half-reverted states come from, and this check
  // has already earned its place: after the seating machinery was deleted,
  // deactivate() still assigned `lastFabSeat = null`. Under ESM strict mode that is
  // a ReferenceError, so it would have thrown on every teardown — reached only
  // after activation, on a device, with no other test covering that line.
  //
  // The same list catches the more common version of the same mistake: a stale
  // selector or custom property left in the stylesheet, quietly doing nothing.
  const retired = ['pocket-fab', 'syncFabSeat', 'observeComposer', 'FAB_DOCKED_BAND',
    'FAB_GAP_DEFAULT', 'fabObserver', 'fabObservedCard', 'lastFabSeat', 'fabSeat']
  for (const gone of retired) {
    assert.ok(!source.includes(gone), 'client.js must no longer mention ' + gone)
  }
  assert.ok(!css.includes('--pocket-fab-'), 'and no corner-button custom properties survive')
  // The header slot was another attempt, withdrawn before shipping, so nothing
  // should reference it at all.
  assert.ok(!source.includes('conversation.header.leading'),
    'the abandoned header-slot toggle must not be referenced')
})

console.log('\nclient smoke: ' + passed + ' checks passed')
