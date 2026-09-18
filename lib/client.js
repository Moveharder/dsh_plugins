/**
 * dsh-pocket-ui — client half.
 *
 * Mobile adaptation for the DSH Web UI, done by *adapting* the host's existing
 * DOM rather than reimplementing it. The host is a desktop-first React SPA: its
 * shell CSS contains no width breakpoints at all, no `viewport-fit=cover` and no
 * `env(safe-area-inset-*)`. Its only responsiveness is one JS constant
 * (`SIDEBAR_AUTO_COLLAPSE = 1024` in @deepseek-ai/dsh-client-ui-layout), which
 * merely collapses the sidebar into a 56px icon rail. Everything else — a real
 * drawer, bottom sheets, safe areas, a usable composer — has to come from here.
 *
 * Three mechanisms, in order of preference:
 *
 *   1. contribute React components into host slots (`shell.overlay`,
 *      `settings.general.item`);
 *   2. inject one stylesheet that rewrites host layout, every rule scoped under
 *      `html[data-pocket="on"]` so it is inert unless we say otherwise;
 *   3. a rAF-throttled reconciler that tags host landmarks with our own
 *      attributes, because CSS needs stable hooks and the host only offers
 *      content-hashed class names.
 *
 * Hard constraints of the bundle format (verified against dsh 0.1.5-rc.1):
 *   - `factory(require)` resolves exactly nine seed modules; every other
 *     `@deepseek-ai/*` specifier throws. Cross-plugin work goes through cordis
 *     services, never value imports.
 *   - the module body is lazy: side effects (including CSS injection) belong in
 *     the factory closure and run at materialisation.
 *   - `exports.inject` — not `dsh.client.inject` — is the activation gate.
 *     Without `slots` declared here, `apply` can run before the slots service
 *     exists and the plugin dies silently with no console error.
 *
 * Disabling: the standard mechanism, not a plugin-internal flag —
 *   - id: pocket-ui
 *     disabled: true
 */

window.__ModuleLoader__.load({
    id: 'dsh-pocket-ui',
    factory: (require) => {
        var module = { exports: {} }
        var exports = module.exports

        const React = require('react')

        const name = 'dsh-pocket-ui'
        const inject = ['slots', 'layout']

        /**
         * Mobile gate. `pointer: coarse` is not optional: width alone makes
         * desktop narrow windows and OS display scaling falsely enter mobile UI.
         * 1023px keeps us just under the host's own 1024px LG breakpoint so the
         * two never disagree.
         */
        const MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'

        /** Another mobile adapter already owns this DOM; we stand down. */
        const RIVAL_PLUGIN = 'dsh-web-mobile'

        /** Debug override: ?pocket=mobile forces on, ?pocket=off forces off. */
        const FORCE_PARAM = 'pocket'

        // =====================================================================
        // stylesheet
        // =====================================================================
        //
        // Every rule is scoped under html[data-pocket="on"], so the sheet is
        // completely inert on desktop — no rule matches, nothing to undo. The
        // gate lives in JS (single source of truth) rather than in @media, which
        // is what makes the ?pocket= debug override work without duplicating the
        // rule block.
        //
        // Selector policy: semantic hooks first ([data-slot], ARIA, our own
        // data-pocket-* tags), host class names never — they are content-hashed
        // and change on every host build.
        const CSS = `
/* ---------------------------------------------------------------- tokens */
html[data-pocket="on"] {
  --pocket-safe-t: env(safe-area-inset-top, 0px);
  --pocket-safe-b: env(safe-area-inset-bottom, 0px);
  --pocket-safe-l: env(safe-area-inset-left, 0px);
  --pocket-safe-r: env(safe-area-inset-right, 0px);
  --pocket-drawer-w: min(84vw, 320px);
  --pocket-fab: 40px;
  --pocket-fab-gap: 10px;
}

/* ------------------------------------------------- frame: single column */
/* The host writes grid-template-columns as a React *inline* style, so an
   !important override is the only way in. Collapsing all three tracks to one
   full-width column is what frees the sidebar and rightbar to become overlays. */
html[data-pocket="on"] [data-pocket-frame] {
  grid-template-columns: minmax(0, 1fr) 0 0 !important;
}

/* ------------------------------------------------ sidebar -> slide-in drawer */
/* Animates 'left', deliberately NOT 'transform'.
   A transform — and even 'will-change: transform' — makes this element the
   containing block for fixed-position descendants. The host renders the
   settings dialog *inline* inside the sidebar subtree (no portal), and its
   overlay is 'position: fixed; inset: 0', so a transform here traps that dialog
   inside the 320px drawer instead of letting it cover the viewport. Verified by
   probe: the sheet measured 319px wide instead of 390px. Animating 'left'
   costs a layout pass per frame but keeps the containing block at the viewport,
   which is what the host's own fixed overlays assume. */
html[data-pocket="on"] [data-pocket-sidebar] {
  position: absolute !important;
  top: 0;
  bottom: 0;
  left: calc(-1 * var(--pocket-drawer-w));
  width: var(--pocket-drawer-w) !important;
  max-width: var(--pocket-drawer-w) !important;
  min-width: 0 !important;
  z-index: 30;                       /* above the host overlay layer (z-index:20) */
  transition: left var(--ds-transition-duration-slow, 250ms) var(--ds-ease-in-out, cubic-bezier(.4, 0, .2, 1));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 40px rgba(0, 0, 0, .28));
  padding-top: var(--pocket-safe-t);
  padding-bottom: var(--pocket-safe-b);
  padding-left: var(--pocket-safe-l);
  /* Safe-area padding and border-box must travel together. With content-box the
     inset is added *outside* the box, pushing the element past the viewport and
     producing a phantom outer scroll plus a composer that sits below the fold —
     a bug that is invisible on desktop because the inset is 0 there. Our drawer
     is absolutely positioned with top/bottom:0 so it is already bounded, but the
     pairing is cheap insurance against future edits. */
  box-sizing: border-box;
}
html[data-pocket="on"][data-pocket-drawer="open"] [data-pocket-sidebar] {
  left: 0;
}
@media (prefers-reduced-motion: reduce) {
  html[data-pocket="on"] [data-pocket-sidebar] { transition: none !important; }
}

/* Freeze the conversation behind an open drawer so the page cannot scroll
   underneath the overlay. */
html[data-pocket="on"][data-pocket-drawer="open"] [data-conversation-scroll] {
  overflow: hidden !important;
}

/* ------------------------------------------------ rightbar -> full-screen pane */
/* A 300-420px side panel is unusable on a 390px phone; promote it to a
   full-bleed pane whenever the host is actually tracking it. */
html[data-pocket="on"] [data-pocket-frame]:not([data-rightbar-collapsed]) [data-pocket-rightbar] {
  position: absolute !important;
  inset: 0 !important;
  width: auto !important;
  z-index: 25;
  background: var(--dsw-alias-bg-base);
}

/* ------------------------------------------------ dialogs -> bottom sheets */
/* Anchored on ARIA, not on the host's hashed class names: the settings dialog
   is a [role="presentation"] wrapper holding a mask plus a [role="dialog"]
   [aria-modal="true"] panel. */
html[data-pocket="on"] [role="presentation"]:has(> [role="dialog"][aria-modal="true"]) {
  align-items: flex-end !important;
  justify-content: stretch !important;
}
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] {
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  max-height: 88vh !important;
  max-height: 88dvh !important;   /* dvh tracks the mobile URL bar; vh does not */
  border-radius: 20px 20px 0 0 !important;
  flex-direction: column !important;
  padding-bottom: var(--pocket-safe-b);
}
/* Flipping the panel from row to column swaps which automatic minimum applies.
   The content column ships 'flex:1; min-width:0' — correct for the host's own
   row layout, but in a column the binding constraint is 'min-height', whose
   default ('auto') refuses to shrink below its content. The column then grows
   past the panel's max-height, the panel clips it ('overflow:hidden'), and the
   inner scroller never gets a bounded height — so the settings page cannot
   scroll at all and everything below the fold is unreachable.
   'nav + *' is the content column: the panel has exactly two children, the nav
   and the content. */
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] > nav + *,
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] > nav + * > * {
  min-height: 0 !important;
}
/* The sheet's vertical nav column becomes a horizontal scrolling tab strip.
   The nav element is a direct child of the dialog and holds two children of its
   own — the title and the item list — so both the nav AND its children have to
   be turned into rows, otherwise the list stays a column and eats the whole
   sheet. The children are addressed structurally (child combinator + universal)
   because the host offers no semantic hook for the list and its class name is
   content-hashed. */
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] > nav {
  width: 100% !important;
  flex: none !important;
  flex-direction: row !important;
  align-items: center;
  gap: 4px !important;
  padding: 10px 12px 4px !important;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  scrollbar-width: none;
}
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] > nav > * {
  flex: none;
  flex-direction: row !important;
  align-items: center;
  gap: 4px !important;
  padding: 0 !important;
  width: auto !important;
}
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] > nav::-webkit-scrollbar {
  display: none;
}
/* The content header (title + actions) is 54px of mostly padding on a phone. */
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"] > div > div:first-child {
  height: auto !important;
  padding: 4px 12px 0 16px !important;
}
/* Drag affordance at the top of the sheet. */
html[data-pocket="on"] [role="presentation"] > [role="dialog"][aria-modal="true"]::before {
  content: "";
  flex: none;
  align-self: center;
  width: 36px;
  height: 4px;
  margin: 8px 0 0;
  border-radius: 2px;
  background: var(--dsw-alias-border-l3, rgba(128, 128, 128, .4));
}

/* ------------------------------------------------ conversation chrome */
html[data-pocket="on"] [data-pocket-center] header {
  min-height: 56px !important;
  padding: calc(var(--pocket-safe-t) + 8px) 12px 0 calc(var(--pocket-safe-l) + 52px) !important;
}
/* Tab strips overflow instead of wrapping one character per line. */
html[data-pocket="on"] [data-pocket-center] header nav,
html[data-pocket="on"] [data-pocket-center] [role="tablist"] {
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  scrollbar-width: none;
}
html[data-pocket="on"] [data-pocket-center] header nav::-webkit-scrollbar,
html[data-pocket="on"] [data-pocket-center] [role="tablist"]::-webkit-scrollbar {
  display: none;
}
/* The host gives tabs a 44px min-height, which with its empty utility seat
   inflates the header to ~97px on a phone. min-height beats height, so it has
   to be overridden explicitly. */
html[data-pocket="on"] [data-pocket-center] [role="tab"] {
  min-height: 32px !important;
}

/* ------------------------------------------------ composer */
html[data-pocket="on"] [data-pocket-frame] {
  --dsh-composer-side-clearance: 10px;
}
html[data-pocket="on"] [data-composer-seat] {
  padding-bottom: var(--pocket-safe-b);
}
html[data-pocket="on"] [data-composer-card] {
  border-radius: 18px;
}
/* Model/agent selectors are capped at 220px by the host, which on a phone
   pushes the send button off the row. */
html[data-pocket="on"] [data-composer-card] select,
html[data-pocket="on"] [data-composer-card] [role="combobox"] {
  max-width: min(42vw, 150px) !important;
}
/* iOS force-zooms any focused input under 16px and will not zoom back out. */
html[data-pocket="on"] [data-lexical-editor="true"],
html[data-pocket="on"] [data-composer-input] input,
html[data-pocket="on"] [data-composer-input] textarea {
  font-size: 16px !important;
}

/* ------------------------------------------------ our own chrome */
/* Scoped like everything else, so the desktop no-op invariant holds for the
   whole sheet: no rule matches unless we turned the gate on. The components
   additionally return null while inactive — belt and braces. */
html[data-pocket="on"] .pocket-fab {
  position: fixed;
  top: calc(var(--pocket-safe-t) + var(--pocket-fab-gap));
  left: calc(var(--pocket-safe-l) + var(--pocket-fab-gap));
  z-index: 40;
  width: var(--pocket-fab);
  height: var(--pocket-fab);
  display: grid;
  place-items: center;
  padding: 0;
  border: .5px solid var(--dsw-alias-border-l3, rgba(128, 128, 128, .3));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff));
  color: var(--dsw-alias-label-primary, currentColor);
  box-shadow: var(--dsw-elevation-prominent, 0 4px 16px rgba(0, 0, 0, .18));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
html[data-pocket="on"] .pocket-fab:active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .12));
}
html[data-pocket="on"] .pocket-fab svg { display: block; }

html[data-pocket="on"] .pocket-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;                     /* below the drawer (30), above the page */
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .4));
  -webkit-tap-highlight-color: transparent;
}

html[data-pocket="on"] .pocket-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 0;
}
html[data-pocket="on"] .pocket-row-text { flex: 1; min-width: 0; }
html[data-pocket="on"] .pocket-row-title {
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 14px;
  line-height: 22px;
}
html[data-pocket="on"] .pocket-row-hint {
  color: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 1));
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
html[data-pocket="on"] .pocket-row button {
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(128, 128, 128, .3));
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
html[data-pocket="on"] .pocket-row button:disabled { opacity: .5; cursor: default; }
`

        // =====================================================================
        // tiny observable store
        // =====================================================================

        function createStore(initial) {
            let value = initial
            const subscribers = new Set()
            return {
                get: () => value,
                set(next) {
                    if (value === next) return
                    value = next
                    subscribers.forEach((fn) => { try { fn(value) } catch (err) { /* subscriber fault */ } })
                },
                subscribe(fn) {
                    subscribers.add(fn)
                    return () => { subscribers.delete(fn) }
                },
            }
        }

        /** Whether mobile mode is currently applied (drives React rendering). */
        const activeStore = createStore(false)
        /** Drawer open state. */
        const drawerStore = createStore(false)

        /**
         * The live plugin context, bound in `apply`. Components are declared at
         * factory scope so React sees a stable component identity across
         * renders; they reach the context through this instead of props.
         */
        let boundCtx = null

        // =====================================================================
        // host landmark discovery
        // =====================================================================
        //
        // All host-shape knowledge is concentrated here so a host upgrade has
        // exactly one place to reconcile. Preferred hooks, in order:
        //   - our own attributes (already tagged this pass)
        //   - [data-slot="<key>"] outlet anchors (renderer-emitted, stable)
        //   - [data-shell-overlay] (AppFrame's overlay layer)
        //   - an inline grid-template-columns (AppFrame's own inline style)
        // Never: host class names.

        function findFrame() {
            const overlay = document.querySelector('[data-shell-overlay]')
            if (overlay && overlay.parentElement) return overlay.parentElement
            // Fallback: the AppFrame is the only element carrying an inline
            // grid-template-columns.
            return document.querySelector('#root div[style*="grid-template-columns"]')
        }

        /** The slot outlet is display:contents, so its *parent* is the real box. */
        function parentOfSlot(slotKey) {
            const outlet = document.querySelector('[data-slot="' + slotKey + '"]')
            return outlet && outlet.parentElement ? outlet.parentElement : null
        }

        // =====================================================================
        // gate
        // =====================================================================

        function forcedMode() {
            try {
                const raw = new URLSearchParams(window.location.search).get(FORCE_PARAM)
                if (raw === null) return null
                const v = String(raw).toLowerCase()
                if (v === '' || v === '1' || v === 'on' || v === 'mobile') return 'on'
                if (v === '0' || v === 'off' || v === 'desktop') return 'off'
            } catch (err) { /* no URL API */ }
            return null
        }

        /**
         * A rival mobile adapter present in the DOM. Two of us fighting over the
         * same frame produces problems that are very hard to attribute, so we
         * stand down entirely and say why.
         */
        function rivalPresent() {
            return document.querySelector('style[data-plugin="' + RIVAL_PLUGIN + '"]') !== null
        }

        function mediaMatches() {
            try { return window.matchMedia(MOBILE_QUERY).matches } catch (err) { return false }
        }

        // =====================================================================
        // viewport meta (safe areas)
        // =====================================================================
        //
        // env(safe-area-inset-*) only reports non-zero once the viewport meta
        // carries viewport-fit=cover, and the host ships without it. The host can
        // also rewrite the tag at runtime, so we re-assert rather than set once —
        // while preserving whatever maximum-scale the host chose, so pinch-zoom
        // behaviour stays official.

        function ensureViewportMeta() {
            const head = document.head
            if (!head) return
            let meta = head.querySelector('meta[name="viewport"]')
            if (!meta) {
                meta = document.createElement('meta')
                meta.setAttribute('name', 'viewport')
                head.appendChild(meta)
            }
            const current = meta.getAttribute('content') || ''
            if (/viewport-fit\s*=\s*cover/i.test(current)) return
            const base = current.trim() || 'width=device-width, initial-scale=1'
            meta.setAttribute('content', base.replace(/\s*,\s*$/, '') + ', viewport-fit=cover')
        }

        // =====================================================================
        // drawer
        // =====================================================================

        /**
         * The host renders the sidebar in *collapsed rail* mode whenever the
         * viewport is under 1024px, and only renders the full session list when
         * its own `narrowExpanded` flag is set. So opening our drawer has to ask
         * the host to expand — we read the host's own `data-sidebar-collapsed`
         * attribute as the source of truth for whether that call is needed, then
         * our CSS takes the expanded sidebar out of flow and turns it into an
         * overlay. The host never learns it is being used as a drawer.
         */
        function hostSidebarCollapsed() {
            const frame = findFrame()
            return !!(frame && frame.hasAttribute('data-sidebar-collapsed'))
        }

        function toggleHostSidebar() {
            const layout = boundCtx ? boundCtx.get('layout') : null
            if (layout && typeof layout.toggleSidebar === 'function') layout.toggleSidebar()
        }

        /**
         * Open/close the drawer. The attribute write is the load-bearing part:
         * CSS keys the slide-in off `html[data-pocket-drawer="open"]`, so React
         * state alone would render a backdrop over a drawer that never moves.
         */
        function setDrawerOpen(open) {
            if (drawerStore.get() === open) return
            drawerStore.set(open)
            if (open) {
                document.documentElement.setAttribute('data-pocket-drawer', 'open')
                if (hostSidebarCollapsed()) toggleHostSidebar()
            } else {
                document.documentElement.removeAttribute('data-pocket-drawer')
                if (!hostSidebarCollapsed()) toggleHostSidebar()
            }
        }

        // =====================================================================
        // reconciler
        // =====================================================================
        //
        // Streaming output floods the DOM with mutations, so the observer is
        // rAF-throttled and every pass is idempotent: we only ever add our own
        // attributes, and only when they are missing.

        const OWN_TAGS = ['data-pocket-frame', 'data-pocket-sidebar', 'data-pocket-center', 'data-pocket-rightbar']

        function tagLandmarks() {
            const frame = findFrame()
            if (!frame) return
            if (!frame.hasAttribute('data-pocket-frame')) frame.setAttribute('data-pocket-frame', '')

            const sidebar = parentOfSlot('sidebar')
            if (sidebar && !sidebar.hasAttribute('data-pocket-sidebar')) {
                sidebar.setAttribute('data-pocket-sidebar', '')
            }
            const center = parentOfSlot('main')
            if (center && !center.hasAttribute('data-pocket-center')) {
                center.setAttribute('data-pocket-center', '')
            }
            const rightbar = parentOfSlot('rightbar')
            if (rightbar && !rightbar.hasAttribute('data-pocket-rightbar')) {
                rightbar.setAttribute('data-pocket-rightbar', '')
            }
        }

        function untagLandmarks() {
            document.querySelectorAll(OWN_TAGS.map((a) => '[' + a + ']').join(',')).forEach((el) => {
                OWN_TAGS.forEach((attr) => el.removeAttribute(attr))
            })
        }

        // =====================================================================
        // components
        // =====================================================================

        function MenuIcon() {
            return React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': 'true' },
                React.createElement('path', {
                    d: 'M3 5h14M3 10h14M3 15h14',
                    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none',
                }))
        }

        /**
         * Drawer backdrop plus its toggle button, contributed to `shell.overlay`.
         * That slot is a list whose children already get `pointer-events: auto`
         * from the host, and it sits at z-index 20 — under the drawer at 30, so
         * the backdrop dims the page without covering the panel.
         */
        function PocketChrome() {
            const [active, setActive] = React.useState(activeStore.get())
            const [open, setOpen] = React.useState(drawerStore.get())

            React.useEffect(() => activeStore.subscribe(setActive), [])
            React.useEffect(() => drawerStore.subscribe(setOpen), [])

            if (!active) return null

            return React.createElement(React.Fragment, null,
                open
                    ? React.createElement('div', {
                        className: 'pocket-backdrop',
                        'aria-hidden': 'true',
                        onClick: () => setDrawerOpen(false),
                    })
                    : null,
                open
                    ? null
                    : React.createElement('button', {
                        type: 'button',
                        className: 'pocket-fab',
                        'aria-label': '打开目录',
                        'aria-expanded': false,
                        onClick: () => setDrawerOpen(true),
                    }, React.createElement(MenuIcon, null)))
        }

        /**
         * Status + update row contributed to `settings.general.item`. The version
         * shown here is the same value the host half reads out of package.json,
         * so the two can never drift.
         */
        function PocketSettingsRow() {
            const [meta, setMeta] = React.useState(null)
            const [busy, setBusy] = React.useState(false)
            const [active, setActive] = React.useState(activeStore.get())

            React.useEffect(() => activeStore.subscribe(setActive), [])

            React.useEffect(() => {
                let cancelled = false
                fetch('/pocket/meta', { headers: { accept: 'application/json' } })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((doc) => { if (!cancelled && doc) setMeta(doc) })
                    .catch(() => { /* host half unavailable: stay quiet */ })
                return () => { cancelled = true }
            }, [])

            const post = (path) => {
                setBusy(true)
                fetch(path, { method: 'POST', headers: { accept: 'application/json' } })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((doc) => { if (doc) setMeta(doc) })
                    .catch(() => { /* offline: silent */ })
                    .finally(() => setBusy(false))
            }

            const version = meta && meta.version ? 'v' + meta.version : 'host 半区未就绪'
            const latest = meta && meta.latest ? 'v' + meta.latest : '未检测'
            const upgrade = (meta && meta.upgrade) || {}
            const updateAvailable = !!(meta && meta.updateAvailable)

            let action
            if (busy || upgrade.running) {
                action = React.createElement('button', { type: 'button', disabled: true }, '处理中…')
            } else if (updateAvailable) {
                action = React.createElement('button', { type: 'button', onClick: () => post('/pocket/upgrade') },
                    '升级到 v' + meta.latest)
            } else {
                action = React.createElement('button', { type: 'button', onClick: () => post('/pocket/check-update') },
                    '检测更新')
            }

            const hint = [
                active ? '移动端布局生效中' : '桌面端（未启用）',
                '当前 ' + version + ' · 最新 ' + latest,
            ]
            if (upgrade.message) hint.push(upgrade.message)

            return React.createElement('div', { className: 'pocket-row' },
                React.createElement('div', { className: 'pocket-row-text' },
                    React.createElement('div', { className: 'pocket-row-title' }, 'Pocket UI · 移动端适配'),
                    React.createElement('div', { className: 'pocket-row-hint' }, hint.join(' · '))),
                action)
        }

        // =====================================================================
        // apply
        // =====================================================================

        function apply(ctx) {
            const slots = ctx.get('slots')
            if (!slots) return
            boundCtx = ctx

            // ---- stylesheet: always present, inert unless html[data-pocket="on"] ----
            ctx.effect(() => {
                const tag = document.createElement('style')
                tag.setAttribute('data-plugin', name)
                tag.setAttribute('data-plugin-css', name + '/pocket.css')
                tag.textContent = CSS
                document.head.appendChild(tag)
                // Re-append so our overrides land after host sheets injected later
                // in the same frame (several host rules also use !important, so
                // order decides).
                const reorder = window.setTimeout(() => {
                    if (tag.isConnected) document.head.appendChild(tag)
                }, 0)
                return () => {
                    window.clearTimeout(reorder)
                    try { tag.remove() } catch (err) { /* already gone */ }
                }
            }, name + ': styles')

            // ---- mutable state, declared before any function that reads it ----
            let active = false
            let warnedRival = false
            let rafId = null
            let pollTimer = null
            let mediaList = null
            let observedSidebar = null
            let sidebarClickHandler = null
            let keyHandler = null

            const ACTIVATE_SELECTOR = 'a[href], button, [role="button"], [role="option"], [role="treeitem"], [role="menuitem"]'
            const KEEP_OPEN_SELECTOR = '[aria-haspopup], [role="menu"], [role="dialog"], [data-pocket-keep-open]'

            function activate() {
                if (active) return
                active = true
                document.documentElement.setAttribute('data-pocket', 'on')
                activeStore.set(true)
            }

            function deactivate() {
                if (!active) return
                active = false
                document.documentElement.removeAttribute('data-pocket')
                document.documentElement.removeAttribute('data-pocket-drawer')
                drawerStore.set(false)
                untagLandmarks()
                activeStore.set(false)
            }

            /**
             * Decide whether mobile mode should be on, and apply the difference.
             * Runs on every reconcile pass, so a rival plugin that injects its
             * stylesheet after us is still detected.
             */
            function evaluate() {
                const forced = forcedMode()
                if (forced === 'off') { deactivate(); return }
                const want = forced === 'on' ? true : mediaMatches()
                if (want && rivalPresent()) {
                    deactivate()
                    if (!warnedRival) {
                        warnedRival = true
                        console.warn('[' + name + '] 检测到 ' + RIVAL_PLUGIN + ' 已启用，dsh-pocket-ui 自动让位'
                            + '（两套移动端布局会互相干扰）。移除其中一个即可。')
                    }
                    return
                }
                if (want) activate()
                else deactivate()
            }

            function reconcile() {
                evaluate()
                if (!active) return
                tagLandmarks()
                ensureViewportMeta()
                attachSidebarHandler()
            }

            function schedule() {
                if (rafId !== null) return
                rafId = window.requestAnimationFrame(() => {
                    rafId = null
                    reconcile()
                })
            }

            /**
             * Tapping a session row should select it *and* get out of the way.
             * Expand/collapse toggles and kebab menus must not close the drawer,
             * hence the exclusion list.
             */
            function attachSidebarHandler() {
                const sidebar = parentOfSlot('sidebar')
                if (!sidebar || sidebar === observedSidebar) return
                if (observedSidebar && sidebarClickHandler) {
                    observedSidebar.removeEventListener('click', sidebarClickHandler, true)
                }
                observedSidebar = sidebar
                sidebarClickHandler = (event) => {
                    if (!drawerStore.get()) return
                    const target = event.target
                    if (!target || typeof target.closest !== 'function') return
                    if (target.closest(KEEP_OPEN_SELECTOR)) return
                    if (target.closest(ACTIVATE_SELECTOR)) setDrawerOpen(false)
                }
                sidebar.addEventListener('click', sidebarClickHandler, true)
            }

            // ---- reconciler loop ----
            ctx.effect(() => {
                const observer = new MutationObserver(schedule)
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    // `style` matters: the host rewrites AppFrame's inline
                    // grid-template-columns on resize. `data-phase` marks the
                    // conversation settling into its active layout. Our own
                    // data-pocket-* writes are deliberately absent, so the
                    // reconciler cannot re-trigger itself.
                    attributeFilter: ['class', 'style', 'content', 'data-phase',
                        'data-sidebar-collapsed', 'data-shell-overlay'],
                })
                schedule()
                return () => {
                    observer.disconnect()
                    if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null }
                }
            }, name + ': reconciler')

            // ---- Escape closes the drawer ----
            ctx.effect(() => {
                keyHandler = (event) => {
                    if (event.key === 'Escape' && drawerStore.get()) setDrawerOpen(false)
                }
                document.addEventListener('keydown', keyHandler)
                return () => {
                    document.removeEventListener('keydown', keyHandler)
                    keyHandler = null
                }
            }, name + ': escape')

            // ---- leaving the mobile range must not strand an open drawer ----
            ctx.effect(() => {
                const onChange = () => {
                    if (!mediaMatches()) setDrawerOpen(false)
                    schedule()
                }
                try {
                    mediaList = window.matchMedia(MOBILE_QUERY)
                    mediaList.addEventListener('change', onChange)
                } catch (err) { mediaList = null }
                window.addEventListener('resize', onChange, { passive: true })
                window.addEventListener('orientationchange', onChange, { passive: true })
                return () => {
                    if (mediaList) {
                        try { mediaList.removeEventListener('change', onChange) } catch (err) { /* ignore */ }
                    }
                    window.removeEventListener('resize', onChange)
                    window.removeEventListener('orientationchange', onChange)
                }
            }, name + ': viewport')

            // ---- early re-checks: a rival may inject its stylesheet a beat after us ----
            ctx.effect(() => {
                let ticks = 0
                pollTimer = window.setInterval(() => {
                    ticks += 1
                    evaluate()
                    if (ticks >= 20 || active) {
                        window.clearInterval(pollTimer)
                        pollTimer = null
                    }
                }, 150)
                return () => {
                    if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null }
                }
            }, name + ': gate-settle')

            // ---- slot contributions ----
            slots.inject('shell.overlay', () => slots.register(
                { name: 'shell.overlay', id: 'pocket-ui-chrome', order: 9000 },
                () => React.createElement(PocketChrome, null)))

            slots.inject('settings.general.item', () => slots.register(
                { name: 'settings.general.item', id: 'pocket-ui-status', order: 100 },
                () => React.createElement(PocketSettingsRow, null)))

            // ---- teardown: leave no trace on the host DOM ----
            ctx.effect(() => () => {
                deactivate()
                if (observedSidebar && sidebarClickHandler) {
                    observedSidebar.removeEventListener('click', sidebarClickHandler, true)
                }
                observedSidebar = null
                sidebarClickHandler = null
                boundCtx = null
            }, name + ': teardown')
        }

        // Test hooks: the smoke test drives these without a DOM.
        exports.__internal = { MOBILE_QUERY, CSS, createStore }

        exports.name = name
        exports.inject = inject
        exports.apply = apply
        return module.exports
    },
})
