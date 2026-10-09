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
/* The four insets are DELIBERATELY left unspecified here, and the values are
   written as inline properties by syncSafeArea() instead.
   "var(--pocket-safe-t, env(safe-area-inset-top, 0px))" is invalid CSS — a
   var() fallback may not contain an env() — so it cannot serve as the static
   default. Leaving them unset is also the correct *behavioural* default: if the
   reconciler never runs, the plugin adds no padding at all rather than padding
   the layout by an inset it has not yet measured.

   Why measurement is needed at all: env(safe-area-inset-top) reports the same
   number in two very different situations.
     (a) the document really is under the status bar / notch  -> pad, or the
         first row of the sidebar disappears under the clock;
     (b) the shell already starts *below* the system chrome (an in-app WebView
         with a native title bar, a browser tab under its URL bar) -> padding by
         the inset carves out a blank strip that belongs to nobody. This is the
         "phantom title bar" bug: the page dutifully reserves 45px for chrome
         that is not over it.
   syncSafeArea() tells the two apart by measuring the frame against the
   visual viewport, which is a fact about this device rather than an assumption
   about the environment. */
html[data-pocket="on"] {
  --pocket-drawer-w: min(84vw, 320px);
  --pocket-fab: 28px;
  --pocket-fab-gap: 10px;
  /* One accent for the whole button, so the hairline border and the glyph read
     as a single mark rather than two colours that happen to be nearby. */
  --pocket-accent: #4176e6;
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
/* The 52px left padding here used to reserve room for the toggle button while it
   sat in the top-left corner (40px button + 10px gap + 2px). The button now lives
   at the bottom-left, so that reservation is dead weight — the title gets the
   ordinary 12px inset back. */
html[data-pocket="on"] [data-pocket-center] header {
  min-height: 56px !important;
  padding: calc(var(--pocket-safe-t) + 8px) 12px 0 calc(var(--pocket-safe-l) + 12px) !important;
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
/* Two different scoping rules live here, and conflating them caused a real bug.
   The drawer toggle and its backdrop only render while mobile mode is active
   (the component returns null otherwise), so scoping them is belt-and-braces.
   The settings row is different: the settings.general.item slot is rendered by
   the host at EVERY width, so its rules must stay unscoped — scoping them left
   the row as bare unstyled HTML on desktop (no padding, no separator, 14px hint
   text where the host uses 12px).
   Rule of thumb: scope what rewrites the host; do not scope what styles chrome
   that exists in both modes. */
/* Bottom-left, not top-left: the drawer's own header already carries the host's
   sidebar toggle at the top of the screen, and a second control up there reads as
   a duplicate. The lower corner is also where the thumb already rests.
   Sized to 28px with a hairline accent border, so it sits in the conversation
   like a small mark rather than a floating button. */
html[data-pocket="on"] .pocket-fab {
  position: fixed;
  bottom: calc(var(--pocket-safe-b) + var(--pocket-fab-gap));
  left: calc(var(--pocket-safe-l) + var(--pocket-fab-gap));
  z-index: 40;
  width: var(--pocket-fab);
  height: var(--pocket-fab);
  display: grid;
  place-items: center;
  padding: 0;
  border: .5px solid var(--pocket-accent);
  /* Proportional to the old 12px on 40px (30%), so shrinking the button does not
     quietly turn it into a circle. */
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff));
  color: var(--pocket-accent);
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

/* The settings row. Unscoped on purpose — see the note above. Metrics are copied
   from the host's own general-settings rows so this one does not look like a
   foreign body: a .5px solid var(--dsw-alias-border-l2) separator, 16px 0
   padding, a text column with 48px right padding, 14px/22px title and
   12px/18px hint. The host's GeneralSection strips the separator from the last
   row via its ":last-child { border-bottom: none }" rule, which covers this too. */
.pocket-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
}
.pocket-row-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 4px;
  min-width: 0;
  padding-right: 48px;
}
.pocket-row-title {
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 14px;
  line-height: 22px;
}
.pocket-row-hint {
  color: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 1));
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.pocket-row button {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  border-radius: 16px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
}
.pocket-row button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .1)); }
.pocket-row button:disabled { opacity: .5; cursor: default; }
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

        /**
         * True between asking the host to expand its sidebar and the host
         * actually doing it. While a request of ours is in flight the host is
         * legitimately still in its collapsed state, and that must not be
         * mistaken for the user collapsing the sidebar. See `syncDrawerWithHost`.
         */
        let awaitingExpand = false

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
                if (v === 'probe' || v === 'diag' || v === 'debug') return 'probe'
                if (v === '0' || v === 'off' || v === 'desktop') return 'off'
            } catch (err) { /* no URL API */ }
            return null
        }

        // =====================================================================
        // diagnostics probe
        // =====================================================================
        //
        // `?pocket=probe` loads lib/probe-src.js from the host half and runs it.
        // This exists because the two defects this plugin is most likely to have
        // are invisible from a desktop browser: a misreported `env()` inset and a
        // host landmark that moved. Both are questions about the DOM *on the
        // device*, and an in-app WebView offers no console to ask them in.
        //
        // The probe is fetched rather than bundled so it stays real, lintable
        // source — see lib/probe-src.js and the note on the host route. Its two
        // entry points live inside apply(), because what they report (the live
        // gate decision and the last inset measurement) only exists there.

        /** Mode gate. `probe` keeps the ordinary gate decision and only adds the overlay. */
        function probeMode() {
            return forcedMode() === 'probe'
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
        // safe-area measurement
        // =====================================================================
        //
        // `env(safe-area-inset-top, 0px)` is probed once per pass through a
        // throwaway element. Reading the raw custom property is not enough:
        // `getPropertyValue('--pocket-safe-t')` returns the *specified* token
        // stream, which is exactly the string "env(safe-area-inset-top, 0px)"
        // rather than a length. Inheriting it into a real element and reading a
        // resolved length property is what forces the substitution.

        /** Resolve one `env(safe-area-inset-<side>)` to a number of px. */
        function probeInset(side) {
            const prop = 'padding' + side.charAt(0).toUpperCase() + side.slice(1)
            try {
                const el = document.createElement('div')
                el.setAttribute('data-pocket-inset-probe', '')
                // Out of flow and zero-sized: this must never be able to affect
                // layout, even for the one frame it exists.
                el.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none'
                el.style[prop] = 'env(safe-area-inset-' + side + ', 0px)'
                document.documentElement.appendChild(el)
                const value = parseFloat(window.getComputedStyle(el)[prop]) || 0
                el.remove()
                return value
            } catch (err) {
                return 0
            }
        }

        /**
         * Publish `--pocket-safe-*`, so the plugin only ever reserves space the
         * document actually occupies.
         *
         * The problem this solves, stated plainly: `env(safe-area-inset-top)` is
         * not a statement about *this document*. It is a statement about the
         * display, and a WebView that already starts below the system chrome still
         * reports it. Padding the layout by it in that case carves out a blank
         * strip that belongs to nobody — a "phantom title bar". Measured on the
         * device this plugin was reported broken on, the strip is ~45px, which is
         * exactly the status-bar height the WebView no longer covers.
         *
         * Two independent gates, because either alone can be wrong:
         *
         *   1. GEOMETRY. If the shell's top edge already sits below the viewport's,
         *      something consumed the inset before us; padding again double-counts.
         *      This catches a browser tab under its URL bar and any wrapper that
         *      lays the app out below native chrome.
         *   2. ENVIRONMENT. `display-mode: browser` means the page is not being
         *      presented as a standalone/fullscreen app, i.e. it cannot be
         *      underlapping system bars. An in-app WebView reports this too — and
         *      it is exactly the case where the inset is a lie. A standalone PWA or
         *      a fullscreen/immersive view reports standalone/fullscreen and keeps
         *      its inset.
         *
         * The bottom inset is clamped from the other direction: a layout taller
         * than the room left over cannot absorb it, and adding it produces the
         * phantom outer scroll (the classic "composer pushed below the fold").
         *
         * Every decision is reported in the returned record, and the settings
         * probe prints it verbatim. A silent policy here is indistinguishable from
         * a plugin that is ignoring the device.
         */
        function syncSafeArea() {
            const root = document.documentElement
            const insetTop = probeInset('top')
            const insetBottom = probeInset('bottom')
            const insetLeft = probeInset('left')
            const insetRight = probeInset('right')

            const frame = findFrame()
            const rect = frame ? frame.getBoundingClientRect() : null
            const frameTop = rect ? rect.top : 0
            const frameHeight = rect ? rect.height : 0
            const viewport = (window.visualViewport && window.visualViewport.height) || window.innerHeight

            // `> 2` rather than `> 0`: a browser may report the frame edge a
            // sub-pixel below zero, and misreading that would silently drop a real
            // inset. A genuine offset is tens of px.
            const pushedDown = frameTop > 2

            const mode = (() => {
                try {
                    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone'
                    if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen'
                    if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui'
                    return 'browser'
                } catch (err) { return 'unknown' }
            })()
            // An unknown mode is treated as immersive: the conservative choice is to
            // keep an inset the device asked for rather than drop it and put content
            // under a notch.
            const immersive = mode === 'standalone' || mode === 'fullscreen' || mode === 'minimal-ui' || mode === 'unknown'
            const implausible = insetTop > 64

            let topPolicy
            if (pushedDown) topPolicy = 'shell-below-device-chrome'
            else if (!immersive) topPolicy = 'not-an-immersive-display'
            else if (implausible) topPolicy = 'implausible-inset'
            else topPolicy = 'applied'
            const top = topPolicy === 'applied' ? insetTop : 0

            const room = viewport - frameHeight
            const bottom = room >= insetBottom ? insetBottom : 0

            const px = (n) => Math.round(n) + 'px'
            root.style.setProperty('--pocket-safe-t', px(top))
            root.style.setProperty('--pocket-safe-b', px(bottom))
            root.style.setProperty('--pocket-safe-l', px(insetLeft))
            root.style.setProperty('--pocket-safe-r', px(insetRight))
            // The raw device values are published too, so "the plugin decided not to
            // pad" stays distinguishable from "the device reported no inset".
            root.style.setProperty('--pocket-inset-raw-t', px(insetTop))

            return {
                insetTop, insetBottom, insetLeft, insetRight,
                top, bottom, left: insetLeft, right: insetRight,
                pushedDown, frameTop, displayMode: mode, topPolicy,
            }
        }

        function clearSafeArea() {
            const root = document.documentElement
            for (const name of ['--pocket-safe-t', '--pocket-safe-b', '--pocket-safe-l',
                '--pocket-safe-r', '--pocket-inset-raw-t']) {
                root.style.removeProperty(name)
            }
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
            if (!layout || typeof layout.toggleSidebar !== 'function') return false
            layout.toggleSidebar()
            return true
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
                if (hostSidebarCollapsed()) awaitingExpand = toggleHostSidebar()
                return
            }
            document.documentElement.removeAttribute('data-pocket-drawer')
            awaitingExpand = false
            // Only push the host back to its rail if it is still expanded. When
            // the user closed us with the host's own 收起侧边栏 button the host
            // has already collapsed, and toggling again would re-expand the
            // sidebar right after their click — the button would look broken.
            // This single guard covers every close path, so no caller has to
            // declare which kind of close it is.
            if (!hostSidebarCollapsed()) toggleHostSidebar()
        }

        /**
         * Adopt the host sidebar's collapsed state as the drawer's closed state.
         *
         * The drawer's close control is the host's own 收起侧边栏 button: we do
         * not intercept clicks inside the panel, so the host collapses the
         * sidebar and we follow. `data-pocket-drawer` is ours and the host never
         * writes it, so without this the drawer would stay slid in over a
         * sidebar that had already collapsed behind it.
         */
        function syncDrawerWithHost() {
            if (!drawerStore.get()) { awaitingExpand = false; return }
            // Still expanded, or we asked for the expand and it has not landed
            // yet — either way there is nothing to adopt.
            if (!hostSidebarCollapsed()) { awaitingExpand = false; return }
            if (awaitingExpand) return
            setDrawerOpen(false)
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

        /**
         * Three bars, drawn on their own 16-unit grid rather than the old 20-unit
         * one scaled down: at 28px the previous 14-unit bars with a 1.6 stroke
         * filled the button and read as a block. Here the bars span 10 units with
         * a 1.25 stroke — thin, evenly spaced (3 units apart) and centred on 8,8,
         * so they stay crisp at this size. Colour comes from the button's `color`.
         */
        function MenuIcon() {
            return React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
                React.createElement('path', {
                    d: 'M3 5h10M3 8h10M3 11h10',
                    stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', fill: 'none',
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
         *
         * The row is rendered by the host while the plugin tree may still be
         * starting, and the host half's routes only exist once `webServer` is
         * ready — the two are NOT synchronised. One un-retried fetch therefore
         * had a real failure mode: if the request landed early, `/pocket/meta`
         * 404'd, the promise was swallowed ("offline: silent"), and the row said
         * "host 半区未就绪 · 未检测更新" for the rest of the page's life even
         * though the host half had come up a moment later. On a phone, where the
         * page may stay open for days, that is permanent.
         *
         * So: retry with backoff, and distinguish "still trying" from "give up".
         */
        const META_RETRY_MS = [400, 1200, 3000, 8000]

        function PocketSettingsRow() {
            const [meta, setMeta] = React.useState(null)
            // 'pending' until a fetch either succeeds or exhausts its retries.
            const [link, setLink] = React.useState('pending')
            const [busy, setBusy] = React.useState(false)
            const [active, setActive] = React.useState(activeStore.get())

            React.useEffect(() => activeStore.subscribe(setActive), [])

            React.useEffect(() => {
                let cancelled = false
                let timer = null
                let attempt = 0

                const load = () => {
                    fetch('/pocket/meta', { headers: { accept: 'application/json' } })
                        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
                        .then((doc) => {
                            if (cancelled) return
                            if (doc && doc.version) { setMeta(doc); setLink('ready'); return }
                            throw new Error('host half reported no version')
                        })
                        .catch(() => {
                            if (cancelled) return
                            // Only the last failure is allowed to give up. A route
                            // that answers 404 during startup is the expected case,
                            // not an error worth reporting once.
                            if (attempt >= META_RETRY_MS.length) { setLink('down'); return }
                            timer = window.setTimeout(load, META_RETRY_MS[attempt])
                            attempt += 1
                        })
                }

                load()
                return () => {
                    cancelled = true
                    if (timer !== null) window.clearTimeout(timer)
                }
            }, [])

            const post = (path) => {
                setBusy(true)
                fetch(path, { method: 'POST', headers: { accept: 'application/json' } })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((doc) => { if (doc) { setMeta(doc); setLink('ready') } })
                    .catch(() => { /* the user-initiated path stays silent: they can press again */ })
                    .finally(() => setBusy(false))
            }

            let version
            if (meta && meta.version) version = 'v' + meta.version
            else if (link === 'pending') version = '正在连接 host 半区…'
            else version = 'host 半区无响应'

            const upgrade = (meta && meta.upgrade) || {}
            const updateAvailable = !!(meta && meta.updateAvailable)

            // Say the state, not two version numbers that are usually identical.
            // "未检测更新" was itself misleading: it is what the row says when the
            // registry lookup has not answered, which is not a statement about
            // whether an update exists. The host half now reports why.
            let latestText
            if (updateAvailable) latestText = '可升级到 v' + meta.latest
            else if (meta && meta.latest) latestText = '已是最新'
            else if (link !== 'ready') latestText = ''
            else if (meta.updateDisabled) latestText = '已关闭更新检查'
            else if (meta.updateChecked) latestText = '无法访问 npm registry（离线？）'
            else latestText = '正在检查更新…'

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
                version,
                latestText,
            ].filter(Boolean)
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
            let keyHandler = null
            /** Last {@link syncSafeArea} result, shared with the diagnostics probe. */
            let lastInsets = null
            /** The probe is fetched once per page; re-runs push fresh data into it. */
            let probeInstalled = false

            /**
             * The host half is the single source of truth for the version (it reads
             * package.json). Fetched only in probe mode, so the ordinary page load
             * gains no request, and the version is a diagnostic nicety here.
             */
            let probeVersion = ''

            /** Everything the probe needs to explain the gate without re-deriving it. */
            function probeBoot(reason) {
                return {
                    version: probeVersion,
                    mobileQuery: MOBILE_QUERY,
                    active: activeStore.get(),
                    rival: rivalPresent(),
                    forced: forcedMode(),
                    reason,
                    insets: lastInsets,
                }
            }

            function installProbe(reason) {
                const boot = probeBoot(reason)
                if (probeInstalled) {
                    // Already on the page. Hand over the fresh pass but do NOT
                    // re-render: this runs inside a reconcile pass, the overlay is a
                    // DOM mutation, and the reconciler observes DOM mutations — so
                    // re-rendering from here is a feedback loop, not a refresh. The
                    // probe's own 重新检测 button re-measures on demand instead.
                    try { window.__pocket.boot = boot } catch (err) { /* non-fatal */ }
                    return
                }
                probeInstalled = true
                // Published BEFORE the script runs: the probe reads its payload from
                // this global at load time, so assigning it afterwards would make the
                // very first report describe the previous pass.
                window.__pocket = Object.assign({}, window.__pocket, { boot })
                fetch('/pocket/hello', { headers: { accept: 'application/json' } })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((doc) => {
                        if (!doc || !doc.version) return
                        probeVersion = String(doc.version)
                        // Safe to re-render here: this resolves from a fetch, outside
                        // the reconcile pass, and the version is worth showing.
                        window.__pocket.boot = probeBoot(reason)
                        const overlay = document.querySelector('[data-pocket-probe-ui]')
                        if (overlay) overlay.remove()
                        if (window.__pocket.show) window.__pocket.show()
                    })
                    .catch(() => { /* diagnostics only: a missing version is not an error */ })
                fetch('/pocket/probe.js', { headers: { accept: 'text/javascript' } })
                    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('http ' + r.status))))
                    .then((code) => {
                        // eslint-disable-next-line no-new-func
                        new Function(code)()
                    })
                    .catch((err) => {
                        probeInstalled = false
                        console.warn('[' + name + '] 探针加载失败（host 半区未就绪时需重启 dsh web）：', err)
                    })
            }

            function activate() {
                if (active) return
                active = true
                document.documentElement.setAttribute('data-pocket', 'on')
                // Measure before the first paint that uses the tokens: every rule
                // reads --pocket-safe-*, and at this instant they are still unset,
                // so without this the drawer renders one frame with no top padding.
                lastInsets = syncSafeArea()
                activeStore.set(true)
            }

            function deactivate() {
                if (!active) return
                active = false
                document.documentElement.removeAttribute('data-pocket')
                document.documentElement.removeAttribute('data-pocket-drawer')
                drawerStore.set(false)
                awaitingExpand = false
                untagLandmarks()
                clearSafeArea()
                lastInsets = null
                activeStore.set(false)
            }

            /**
             * Decide whether mobile mode should be on, and apply the difference.
             * Runs on every reconcile pass, so a rival plugin that injects its
             * stylesheet after us is still detected.
             *
             * The returned string is the *reason*, kept next to the decision rather
             * than reconstructed later: the probe reports it verbatim, and a gate
             * that closes without saying why is the hardest kind of bug to see from
             * a phone.
             */
            function evaluate() {
                const forced = forcedMode()
                if (forced === 'off') { deactivate(); return 'forced off by ?pocket=off' }
                const want = forced === 'on' || forced === 'probe' ? true : mediaMatches()
                if (want && rivalPresent()) {
                    deactivate()
                    if (!warnedRival) {
                        warnedRival = true
                        console.warn('[' + name + '] 检测到 ' + RIVAL_PLUGIN + ' 已启用，dsh-pocket-ui 自动让位'
                            + '（两套移动端布局会互相干扰）。移除其中一个即可。')
                    }
                    return 'stood down: ' + RIVAL_PLUGIN + ' is present'
                }
                if (want) { activate(); return forced ? 'forced on by ?pocket=' + forced : 'media query matched' }
                deactivate()
                return 'media query did not match (' + MOBILE_QUERY + ')'
            }

            function reconcile() {
                const reason = evaluate()
                if (!active) {
                    // Probing an inactive gate is the point: it is how "the plugin
                    // decided not to run" is told apart from "the plugin ran and the
                    // layout is still wrong".
                    if (probeMode()) installProbe(reason)
                    return
                }
                tagLandmarks()
                ensureViewportMeta()
                // Re-measured every pass, not once at activation: the numbers depend
                // on the frame's live geometry, which the host rewrites on resize,
                // on entering fullscreen, and whenever the drawer asks it to expand.
                lastInsets = syncSafeArea()
                syncDrawerWithHost()
                if (probeMode()) installProbe(reason)
            }

            function schedule() {
                if (rafId !== null) return
                rafId = window.requestAnimationFrame(() => {
                    rafId = null
                    reconcile()
                })
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
