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

check('the stylesheet contains no stray backticks', () => {
  // The CSS lives in a template literal. A backtick inside a comment — easy to
  // type when referring to properties in prose — terminates the string and
  // turns the whole bundle into a syntax error, which surfaces as "no UI at all"
  // rather than as a helpful message.
  const marker = 'const CSS = `'
  const body = source.slice(source.indexOf(marker) + marker.length)
  const end = body.indexOf('\n`')
  assert.ok(end !== -1, 'CSS template literal is terminated')
  assert.ok(!body.slice(0, end).includes('`'),
    'no backtick may appear inside the CSS template literal')
})

check('every rule is inert unless html[data-pocket="on"]', () => {
  // The desktop no-op invariant, asserted structurally. No exceptions: even our
  // own .pocket-* chrome is scoped, so an inactive plugin contributes exactly
  // zero matching rules and there is nothing to undo on a wide screen.
  const offenders = []
  for (const head of topLevelRules(css)) {
    for (const selector of selectorsOf(head)) {
      if (!selector.startsWith('html[data-pocket="on"]')) offenders.push(selector)
    }
  }
  assert.deepEqual(offenders, [],
    'unscoped rules would leak into desktop:\n    ' + offenders.join('\n    '))
})

check('our own chrome is rendered only while active', () => {
  assert.ok(css.includes('html[data-pocket="on"] .pocket-fab'), 'fab styles present and scoped')
  assert.ok(css.includes('html[data-pocket="on"] .pocket-backdrop'), 'backdrop styles present and scoped')
  // The components must additionally bail out when inactive, because a slot
  // entry is rendered by the host at any width.
  const chrome = source.slice(source.indexOf('function PocketChrome'))
  assert.match(chrome.slice(0, 900), /if \(!active\) return null/,
    'PocketChrome must return null while inactive')
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
