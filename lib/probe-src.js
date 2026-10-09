/**
 * dsh-pocket-ui — in-page geometry probe (source of truth).
 *
 * This file is deliberately *not* a module: it is a self-contained IIFE that the
 * client half injects with `new Function(PROBE_SOURCE)()` when the page is opened
 * with `?pocket=probe`. Keeping it as real, lintable JavaScript (instead of a
 * string with escaped newlines buried in client.js) is what makes it editable.
 *
 * Why it exists
 * -------------
 * The plugin's whole job is cancelling host geometry the user should not see.
 * Two classes of defect are invisible to unit tests and to a desktop browser:
 *
 *   1. `env(safe-area-inset-top)` does not mean the same thing in every mobile
 *      WebView. A browser tab and an in-app WebView that already sits *below* the
 *      system status bar both report `viewport-fit=cover`, but only one of them
 *      actually has chrome overlapping the document. Padding by the inset in the
 *      second case produces a phantom strip — a "title bar" of empty space that
 *      belongs to nobody.
 *   2. Which element owns the top of a column. "There is a blank strip" is a
 *      symptom; the probe has to name the box, its padding, and the rule that
 *      produced it. Anything less is guessing.
 *
 * Output is rendered as an overlay so it can be read *on the device*, with a
 * copy button, and it is also left on `window.__pocket` for a console session.
 * No network, no dependency on the plugin's own internals beyond an optional
 * `boot` object the caller passes in.
 *
 * Everything is wrapped in try/catch: a probe that throws is worse than no probe.
 */
(function () {
    'use strict';

    var pad = function (n) { return (Math.round(n * 10) / 10) + 'px'; };
    var esc = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    };
    /** Host class names are content-hashed noise; only our own marks are worth showing. */
    var klass = function (el) {
        var raw = (el && el.className && typeof el.className === 'string') ? el.className : '';
        var own = raw.split(/\s+/).filter(function (c) { return c.indexOf('pocket') !== -1; });
        return (el && el.tagName ? el.tagName.toLowerCase() : '?') +
            (el && el.id ? '#' + el.id : '') +
            (own.length ? '.' + own.join('.') : '');
    };
    var box = function (el) {
        if (!el || !el.getBoundingClientRect) return null;
        var r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    var media = function (q) {
        try { return window.matchMedia(q).matches; } catch (e) { return 'error'; }
    };

    /**
     * Resolve every CSS custom property the plugin (and the host) publishes, by
     * injecting a throwaway child of <html> and reading computed values off it.
     *
     * `getComputedStyle(el).getPropertyValue('--x')` returns the *specified*
     * token stream, not a resolved length, so it can hand back "env(safe-area-inset-top, 0px)"
     * verbatim. Inheriting into a real element and reading a real length property
     * is what forces the substitution — that is the whole trick here.
     */
    function readTokens(html) {
        var cs = getComputedStyle(html);
        var names = [
            '--pocket-safe-t', '--pocket-safe-b', '--pocket-safe-l', '--pocket-safe-r',
            '--pocket-drawer-w', '--pocket-fab',
            '--dsh-frame-top-clearance', '--dsh-frame-chrome-top', '--dsh-frame-overlay-top',
            '--dsh-frame-leading-clearance', '--dsh-windows-titlebar-height',
            '--dsh-content-font-size', '--ds-transition-duration-slow'
        ];
        var out = {};
        var rootFs = parseFloat(cs.fontSize) || 16;

        var probe = document.createElement('div');
        probe.setAttribute('data-pocket-token-probe', '');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none';
        html.appendChild(probe);
        var pcs = getComputedStyle(probe);

        var ref = document.createElement('div');
        ref.style.cssText = 'display:block;height:0';
        probe.appendChild(ref);

        names.forEach(function (n) {
            var raw = cs.getPropertyValue(n).trim();
            /* An inline property wins over the stylesheet, which is how
               syncSafeArea() publishes the values it decided on. The resolved
               read below would otherwise report the CSS fallback and disagree
               with the very decision this probe exists to observe. */
            var inline = (html.style && html.style.getPropertyValue)
                ? html.style.getPropertyValue(n).trim()
                : '';
            var resolved = '';
            try {
                /* Assign the token, then re-query the computed style — a snapshot
                   taken before the write would hand back the previous answer. */
                probe.style.paddingTop = 'var(' + n + ')';
                resolved = getComputedStyle(probe).paddingTop;
                probe.style.paddingTop = '';
            } catch (e) { resolved = 'read-failed'; }
            out[n] = {
                raw: raw,
                inline: inline,
                resolved: inline || resolved,
                /* em/rem tokens (font size, durations) are not lengths we compare against px boxes */
                px: /px$/.test(inline || resolved)
                    ? Math.round(parseFloat(inline || resolved) * 10) / 10
                    : null
            };
        });

        /* The four inset env()s on their own, with no token layer in between.
           Each read re-queries the computed style: a browser returns a live
           object, but a stale reference is exactly the kind of thing a stub (and
           a caching engine) gets wrong, and the cost of being explicit is
           nothing. */
        var insets = {};
        ['top', 'right', 'bottom', 'left'].forEach(function (side) {
            var key = 'env(safe-area-inset-' + side + ')';
            var prop = 'padding' + side.charAt(0).toUpperCase() + side.slice(1);
            try {
                probe.style[prop] = 'env(safe-area-inset-' + side + ', 0px)';
                insets[key] = getComputedStyle(probe)[prop];
                probe.style[prop] = '';
            } catch (e) { insets[key] = 'read-failed'; }
        });

        /* A pure-CSS branch is the only reliable "is this platform the desktop
           Electron shell" test at runtime; data-platform is set by its preload. */
        try {
            probe.style.width = '0px';
            ref.style.minHeight = '0px';
            void ref.offsetHeight;
        } catch (e) { /* measurement is best-effort */ }

        probe.remove();
        return { rootFontSize: rootFs, tokens: out, safeAreaInsets: insets };
    }

    /** Per-element geometry for one host landmark. */
    function describe(el, label) {
        if (!el) return { label: label, present: false };
        var cs = getComputedStyle(el);
        var r = el.getBoundingClientRect();
        var first = el.firstElementChild;
        var firstCs = first ? getComputedStyle(first) : null;
        var fr = first ? first.getBoundingClientRect() : null;
        var lh = parseFloat(cs.lineHeight);
        return {
            label: label,
            present: true,
            tag: klass(el),
            box: box(el),
            display: cs.display,
            position: cs.position,
            overflow: cs.overflow,
            padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
            margin: cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft,
            minHeight: cs.minHeight,
            height: cs.height,
            /* distance from this box's top edge to its first child's top edge:
               for a container with no padding/border this is 0, so a non-zero
               value is the strip itself. */
            firstChild: first ? {
                tag: klass(first),
                box: box(first),
                marginTop: firstCs.marginTop,
                lineHeight: firstCs.lineHeight,
                fontSize: firstCs.fontSize,
                empty: !first.firstElementChild && !(first.textContent || '').trim()
            } : null,
            /* the strip above the first child, minus that child's own leading */
            leadingGap: fr
                ? Math.round((fr.top - r.top) * 10) / 10
                : null,
            firstChildLeading: firstCs
                ? Math.round((((fr ? fr.height : 0) - (parseFloat(firstCs.fontSize) || 0) * 1.2) / 2) * 10) / 10
                : null,
            lineHeightPx: isNaN(lh) ? null : lh,
        };
    }

    /**
     * Walk up from `el` to `stop`, listing every ancestor that adds vertical
     * space. The first entry whose top is above its parent's content edge is the
     * actual owner of the strip.
     */
    function chain(el, stop) {
        var out = [];
        var node = el;
        var guard = 0;
        while (node && node !== stop && guard++ < 12) {
            var cs = getComputedStyle(node);
            var r = node.getBoundingClientRect();
            var pr = node.parentElement ? node.parentElement.getBoundingClientRect() : null;
            out.push({
                tag: klass(node),
                y: Math.round(r.top),
                h: Math.round(r.height),
                offsetFromParent: pr ? Math.round(r.top - pr.top) : null,
                paddingTop: cs.paddingTop,
                marginTop: cs.marginTop,
                borderTop: cs.borderTopWidth,
            });
            node = node.parentElement;
        }
        return out;
    }

    function elementAt(x, y) {
        try {
            var el = document.elementFromPoint(x, y);
            if (!el) return null;
            return {
                tag: klass(el),
                box: box(el),
                background: getComputedStyle(el).backgroundColor,
                pointerEvents: getComputedStyle(el).pointerEvents,
            };
        } catch (e) { return 'error'; }
    }

    function scrollInfo() {
        var de = document.documentElement;
        var b = document.body;
        return {
            scrollHeight: Math.max(de.scrollHeight, b ? b.scrollHeight : 0),
            clientHeight: de.clientHeight,
            innerHeight: window.innerHeight,
            visualViewportHeight: (window.visualViewport || {}).height || null,
            visualViewportOffsetTop: (window.visualViewport || {}).offsetTop || 0,
            scrollingElement: de.scrollHeight > de.clientHeight ? 'html' : 'none',
            rootScrollTop: de.scrollTop,
            bodyScrollTop: b ? b.scrollTop : null,
            /* a phantom outer scroll is exactly `scrollHeight > clientHeight` on a
               shell that should be viewport-locked */
            phantomScroll: de.scrollHeight - de.clientHeight,
        };
    }

    function collect(boot) {
        var html = document.documentElement;
        boot = boot || {};

        var frame = document.querySelector('[data-pocket-frame]') ||
            document.querySelector('[data-shell-overlay]') &&
            document.querySelector('[data-shell-overlay]').parentElement;
        var sidebar = document.querySelector('[data-pocket-sidebar]');
        var center = document.querySelector('[data-pocket-center]');
        var rightbar = document.querySelector('[data-pocket-rightbar]');
        var header = center ? center.querySelector('header') : null;
        var firstRow = sidebar ? sidebar.querySelector('*') : null;

        var tokens = readTokens(html);
        var out = {
            at: new Date().toISOString(),
            version: boot.version || null,
            url: String(location.href).replace(/([?&]token=)[^&]*/i, '$1<redacted>'),
            userAgent: navigator.userAgent,
            standalone: ('standalone' in navigator) ? navigator.standalone : null,
            displayModeStandalone: media('(display-mode: standalone)'),
            displayModeFullscreen: media('(display-mode: fullscreen)'),
            displayModeBrowser: media('(display-mode: browser)'),
            plugin: {
                attribute: html.getAttribute('data-pocket'),
                active: boot.active !== undefined ? boot.active : (html.getAttribute('data-pocket') === 'on'),
                drawer: html.getAttribute('data-pocket-drawer'),
                rivalPresent: !!document.querySelector('style[data-plugin="dsh-web-mobile"]'),
                stylesheetPresent: !!document.querySelector('style[data-plugin="dsh-pocket-ui"]'),
                styleRules: (function () {
                    var tag = document.querySelector('style[data-plugin="dsh-pocket-ui"]');
                    if (!tag) return null;
                    return tag.sheet ? tag.sheet.cssRules.length : 'sheet-unavailable';
                })(),
                inject: boot.inject || null,
                rivalQuery: boot.mobileQuery || null,
            },
            media: {
                pluginQuery: media(boot.mobileQuery || '(max-width: 1023px) and (pointer: coarse)'),
                widthOnly: media('(max-width: 1023px)'),
                pointerCoarse: media('(pointer: coarse)'),
                pointerFine: media('(pointer: fine)'),
                pointerNone: media('(pointer: none)'),
                anyPointerCoarse: media('(any-pointer: coarse)'),
                hoverNone: media('(hover: none)'),
                orientation: media('(orientation: portrait)'),
            },
            viewport: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
                screen: { w: screen.width, h: screen.height, availH: screen.availHeight },
                viewportMeta: (function () {
                    var m = document.querySelector('meta[name="viewport"]');
                    return m ? m.getAttribute('content') : null;
                })(),
            },
            tokens: tokens.tokens,
            safeAreaInsets: tokens.safeAreaInsets,
            frame: describe(frame, 'frame'),
            sidebar: describe(sidebar, 'sidebar'),
            sidebarChain: chain(firstRow, frame),
            center: describe(center, 'center'),
            header: describe(header, 'center > header'),
            headerChain: chain(header, frame),
            rightbar: describe(rightbar, 'rightbar'),
            pluginBoot: null,   /* filled in asynchronously by the host half probe */
            topOfCenterColumn: elementAt(Math.round(window.innerWidth / 2), 4),
            topOfScreenCenter: elementAt(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2)),
            scroll: scrollInfo(),
            hostClasses: (function () {
                /* Report the host's own frame class so a host upgrade that renames it
                   is visible here rather than as a silent selector miss. */
                var f = frame;
                return f ? String(f.className || '').split(/\s+/).filter(Boolean) : null;
            })(),
        };

        /* ---- derived verdicts: the part a human reads first ---- */
        out.verdict = {
            active: out.plugin.active,
            gateOpenBecause: (function () {
                if (!out.plugin.active) {
                    return 'plugin inactive: pluginQuery=' + out.media.pluginQuery +
                        ' (widthOnly=' + out.media.widthOnly + ', pointerCoarse=' + out.media.pointerCoarse + ')';
                }
                return 'plugin active (mobile layout applied)';
            })(),
            topStripPx: (function () {
                if (!out.center.present) return null;
                var first = center.firstElementChild;
                if (!first) return null;
                return Math.round(first.getBoundingClientRect().top - out.center.box.y);
            })(),
            topStripOwner: null,
            safeAreaTopLooksTrustworthy: null,
            warnings: [],
        };

        /* The owner is the deepest element in the chain whose top edge is pushed
           down relative to its parent's top edge. */
        var owners = (out.headerChain || []).filter(function (n) {
            return n.offsetFromParent !== null && n.offsetFromParent > 0.5;
        });
        if (owners.length) {
            out.verdict.topStripOwner = owners[0].tag + ' pushed +' + owners[0].offsetFromParent +
                'px (padding-top ' + owners[0].paddingTop + ', margin-top ' + owners[0].marginTop + ')';
        } else {
            out.verdict.topStripOwner = 'none — nothing in the center column is pushed down';
        }

        var safeTop = parseFloat(tokens.safeAreaInsets['env(safe-area-inset-top)']) || 0;
        var insetApplied = (out.tokens['--pocket-safe-t'] || {}).px || 0;
        var insets = (boot && boot.insets) || null;
        out.verdict.safeAreaTopPx = safeTop;
        out.verdict.pocketSafeTopPx = insetApplied;
        out.verdict.insetPolicy = insets ? insets.topPolicy : null;
        out.verdict.pluginDisplayMode = insets ? insets.displayMode : null;

        /* The plugin's own decision is the thing to check, not a re-derivation of
           it: the probe would otherwise disagree with the code it is describing. */
        if (insets) {
            if (insets.top === 0 && insets.insetTop > 0) {
                out.verdict.safeAreaTopLooksTrustworthy = false;
                out.verdict.warnings.push(
                    'the device reports a ' + pad(insets.insetTop) + ' top inset, but the plugin is NOT ' +
                    'padding by it (policy: ' + insets.topPolicy + '). If a blank strip is still visible ' +
                    'above the content, this policy is what to change.');
            } else {
                out.verdict.safeAreaTopLooksTrustworthy = true;
            }
            if (insets.top > 0) {
                out.verdict.warnings.push('the plugin IS padding the layout by ' + pad(insets.top) +
                    ' of top inset (policy: ' + insets.topPolicy + '). If that space is blank, this is ' +
                    'the strip.');
            }
        } else if (insetApplied > 0) {
            out.verdict.warnings.push('the plugin is padding by ' + pad(insetApplied) +
                ' of top inset and did not report why (host half older than this probe?).');
        }

        if (out.scroll.phantomScroll > 1) {
            out.verdict.warnings.push('document scrolls by ' + out.scroll.phantomScroll +
                'px beyond the viewport — a bottom inset is being added outside the viewport.');
        }
        if (!out.plugin.stylesheetPresent) {
            out.verdict.warnings.push('the plugin stylesheet is not in <head> at all.');
        }
        if (out.plugin.rivalPresent) {
            out.verdict.warnings.push('a rival mobile adapter (dsh-web-mobile) is present; the plugin stands down by design.');
        }

        /* A quick "what is the plugin's own top padding worth" number: the header
           rule is `calc(var(--pocket-safe-t) + 8px)`, so anything above 8px here is
           safe-area padding and nothing else. */
        if (out.header.present && out.plugin.active) {
            var headerPad = parseFloat(out.header.padding) || 0;
            out.verdict.headerPaddingTopPx = headerPad;
            out.verdict.headerPaddingFromSafeArea = Math.round((headerPad - 8) * 10) / 10;
        }

        return out;
    }

    function lines(o) {
        var L = [];
        L.push('Pocket UI probe · v' + (o.version || '?') + ' · ' + o.at);
        L.push('');
        L.push('== verdict ==');
        L.push('active                : ' + o.verdict.active + '  (' + o.verdict.gateOpenBecause + ')');
        L.push('top strip in center   : ' + o.verdict.topStripPx + 'px');
        L.push('top strip owner       : ' + o.verdict.topStripOwner);
        L.push('safe-area top (env)   : ' + o.verdict.safeAreaTopPx);
        L.push('--pocket-safe-t       : ' + o.verdict.pocketSafeTopPx);
        L.push('inset policy          : ' + o.verdict.insetPolicy + '  (display-mode ' + o.verdict.pluginDisplayMode + ')');
        L.push('header padding-top    : ' + o.verdict.headerPaddingTopPx +
            '  (safe-area part: ' + o.verdict.headerPaddingFromSafeArea + ')');
        L.push('inset trustworthy?    : ' + o.verdict.safeAreaTopLooksTrustworthy);
        (o.verdict.warnings || []).forEach(function (w) { L.push('WARNING               : ' + w); });
        L.push('');
        L.push('== environment ==');
        L.push('ua                    : ' + o.userAgent);
        L.push('display-mode          : standalone=' + o.displayModeStandalone +
            ' fullscreen=' + o.displayModeFullscreen + ' browser=' + o.displayModeBrowser);
        L.push('viewport              : ' + o.viewport.innerWidth + 'x' + o.viewport.innerHeight +
            ' dpr=' + o.viewport.devicePixelRatio + ' screen=' + o.viewport.screen.w + 'x' + o.viewport.screen.h);
        L.push('viewport meta         : ' + o.viewport.viewportMeta);
        L.push('media pluginQuery     : ' + o.media.pluginQuery);
        L.push('media width/pointer   : ' + o.media.widthOnly + ' / ' + o.media.pointerCoarse +
            ' (fine=' + o.media.pointerFine + ' none=' + o.media.pointerNone + ' anyCoarse=' + o.media.anyPointerCoarse + ')');
        L.push('media hover: none     : ' + o.media.hoverNone);
        L.push('');
        L.push('== resolved tokens ==');
        Object.keys(o.tokens).forEach(function (k) {
            var t = o.tokens[k];
            L.push(('  ' + k).padEnd(32) + ': ' + (t.px !== null ? t.px + 'px' : t.resolved || t.raw));
        });
        L.push('');
        L.push('== safe-area env() ==');
        Object.keys(o.safeAreaInsets).forEach(function (k) {
            L.push('  ' + k.padEnd(32) + ': ' + o.safeAreaInsets[k]);
        });
        L.push('');
        L.push('== boxes ==');
        ['frame', 'sidebar', 'center', 'header', 'rightbar'].forEach(function (key) {
            var d = o[key];
            if (!d || !d.present) { L.push(('[' + key + ']').padEnd(10) + ': absent'); return; }
            L.push(('[' + key + ']').padEnd(10) + ': ' + d.tag + '  box=' + JSON.stringify(d.box));
            L.push('  display=' + d.display + ' position=' + d.position + ' overflow=' + d.overflow);
            L.push('  padding=' + d.padding + '  margin=' + d.margin + '  height=' + d.height);
            if (d.firstChild) {
                L.push('  first child=' + d.firstChild.tag + ' box=' + JSON.stringify(d.firstChild.box) +
                    ' marginTop=' + d.firstChild.marginTop + ' lineHeight=' + d.firstChild.lineHeight);
                L.push('  leading gap (first child top - box top) = ' + d.leadingGap + 'px');
            }
        });
        L.push('');
        L.push('== header parent chain (top-down offsets) ==');
        (o.headerChain || []).forEach(function (n) {
            L.push('  ' + n.tag.padEnd(28) + ' y=' + n.y + ' h=' + n.h +
                ' offsetFromParent=' + n.offsetFromParent + ' padTop=' + n.paddingTop + ' marginTop=' + n.marginTop);
        });
        L.push('');
        L.push('== hit test ==');
        L.push('  (centerX, 4px)        : ' + JSON.stringify(o.topOfCenterColumn));
        L.push('  (centerX, centerY)    : ' + JSON.stringify(o.topOfScreenCenter));
        L.push('');
        L.push('== scroll ==');
        L.push('  ' + JSON.stringify(o.scroll));
        L.push('  host frame classes    : ' + JSON.stringify(o.hostClasses));
        L.push('');
        L.push('== host half (/pocket/hello) ==');
        L.push('  ' + JSON.stringify(window.__pocket && window.__pocket.pluginBoot));
        return L;
    }

    var last = null;

    function render(o) {
        last = o;
        var host = document.createElement('div');
        host.setAttribute('data-pocket-probe-ui', '');
        host.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483000', 'background:#fff', 'color:#111',
            'overflow:auto', '-webkit-overflow-scrolling:touch',
            "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
            'padding:12px 12px calc(12px + env(safe-area-inset-bottom, 0px))',
            'box-sizing:border-box', 'overscroll-behavior:contain',
        ].join(';');

        var bar = document.createElement('div');
        bar.style.cssText = 'position:sticky;top:0;background:#fff;padding-bottom:8px;' +
            'border-bottom:1px solid #ddd;margin:-12px -12px 10px;padding:12px 12px 8px';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:6px';
        title.textContent = 'Pocket UI 探针 · v' + (o.version || '?');

        var verdict = document.createElement('div');
        verdict.style.cssText = 'background:#f6f8fa;border:1px solid #e1e4e8;border-radius:8px;' +
            'padding:8px 10px;margin-bottom:8px;word-break:break-word';
        verdict.innerHTML = [
            '<b>插件生效</b>: ' + esc(String(o.verdict.active)) + ' — ' + esc(o.verdict.gateOpenBecause),
            '<br><b>顶部空白</b>: ' + esc(String(o.verdict.topStripPx)) + 'px（center 第一个子元素相对 center 顶部）',
            '<br><b>空白归属</b>: ' + esc(String(o.verdict.topStripOwner)),
            '<br><b>env(safe-area-inset-top)</b>: ' + esc(String(o.verdict.safeAreaTopPx)) + 'px' +
            ' · <b>--pocket-safe-t</b>: ' + esc(String(o.verdict.pocketSafeTopPx)) + 'px',
            '<br><b>会话头 padding-top</b>: ' + esc(String(o.verdict.headerPaddingTopPx)) + 'px',
            (o.verdict.warnings || []).length
                ? '<br><span style="color:#b3261e"><b>⚠ ' + esc(o.verdict.warnings.join('<br>⚠ ')) + '</b></span>'
                : '',
        ].join('');

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        var full = JSON.stringify(o, null, 2);

        function mkBtn(text, fn) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.style.cssText = 'font:inherit;padding:7px 12px;border:1px solid #d0d7de;border-radius:16px;' +
                'background:#f6f8fa;color:#111';
            b.addEventListener('click', fn);
            return b;
        }

        var copyBtn = mkBtn('复制全部 JSON', function () {
            /* Two paths on purpose: the async clipboard API is missing or
               permission-gated in a lot of in-app WebViews, and this button is
               the entire point of the probe. */
            var done = function (ok) {
                copyBtn.textContent = ok ? '已复制 ✓ 粘贴给助手' : '复制失败：长按下方文本手动复制';
                setTimeout(function () { copyBtn.textContent = '复制全部 JSON'; }, 2500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(full).then(function () { done(true); }, function () { done(legacy()); });
            } else { done(legacy()); }
        });

        function legacy() {
            try {
                var ta = document.createElement('textarea');
                ta.value = full;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, ta.value.length);
                var ok = document.execCommand('copy');
                ta.remove();
                return ok;
            } catch (e) { return false; }
        }

        var rerunBtn = mkBtn('重新检测', function () {
            host.remove();
            var fresh = collect(window.__pocket.boot || BOOT);
            window.__pocket.result = fresh;
            window.__pocket.json = JSON.stringify(fresh, null, 2);
            render(fresh);
        });
        var closeBtn = mkBtn('关闭', function () { host.remove(); });

        btnRow.appendChild(copyBtn);
        btnRow.appendChild(rerunBtn);
        btnRow.appendChild(closeBtn);

        bar.appendChild(title);
        bar.appendChild(verdict);
        bar.appendChild(btnRow);

        var pre = document.createElement('pre');
        pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin:0;font:inherit';
        pre.textContent = lines(o).join('\n');

        var details = document.createElement('details');
        details.style.marginTop = '12px';
        var summary = document.createElement('summary');
        summary.textContent = '完整 JSON（' + full.length + ' 字符）';
        var preJson = document.createElement('pre');
        preJson.style.cssText = 'white-space:pre-wrap;word-break:break-word;background:#f6f8fa;' +
            'padding:8px;border-radius:8px';
        preJson.textContent = full;
        details.appendChild(summary);
        details.appendChild(preJson);

        host.appendChild(bar);
        host.appendChild(pre);
        host.appendChild(details);
        document.body.appendChild(host);
    }

    var BOOT = (window.__pocket && window.__pocket.boot) || {};

    window.__pocket = window.__pocket || {};
    window.__pocket.boot = BOOT;
    window.__pocket.collect = function (boot) { return collect(boot || BOOT); };
    window.__pocket.lines = lines;

    /**
     * Render the *current* pass. The caller pushes a fresh `boot` payload on every
     * reconcile pass, so this must not measure again: `collect()` writes to the DOM
     * and reads geometry, and running it from inside a pass that is itself reacting
     * to DOM mutations is how a "diagnostic" turns into a feedback loop.
     */
    window.__pocket.show = function () {
        BOOT = window.__pocket.boot || BOOT;
        var o = collect(BOOT);
        window.__pocket.result = o;
        window.__pocket.json = JSON.stringify(o, null, 2);
        var old = document.querySelector('[data-pocket-probe-ui]');
        if (old) old.remove();
        render(o);
        return o;
    };

    /** Re-measure on demand (the overlay's 重新检测 button and console use). */
    window.__pocket.rerun = function () {
        BOOT = window.__pocket.boot || BOOT;
        return window.__pocket.show();
    };

    /**
     * "The plugin seems to be running but the status row says otherwise" has no
     * console to check in an in-app WebView, so the probe asks the host half the
     * same question the settings row asks — and prints the raw answer. A plugin
     * that renders but never wired its settings row shows up here as a
     * `/pocket/hello` that does not answer.
     */
    fetch('/pocket/hello', { headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)) })
        .then(function (doc) {
            window.__pocket.pluginBoot = { ok: true, doc: doc };
            var overlay = document.querySelector('[data-pocket-probe-ui]');
            if (overlay) overlay.remove();
            window.__pocket.show();
        })
        .catch(function (err) {
            window.__pocket.pluginBoot = { ok: false, error: String(err && err.message || err) };
        });

    try {
        window.__pocket.show();
    } catch (err) {
        /* A probe that takes the page down with it is worse than no probe. */
        try { console.error('[dsh-pocket-ui] probe failed', err); } catch (e) { /* nothing left to do */ }
    }
})();
