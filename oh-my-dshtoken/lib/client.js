window.__ModuleLoader__.load({
  id: "oh-my-dshtoken",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const name = "oh-my-dshtoken";
    // 依赖必须显式声明：当前运行时在启动时并发激活各插件，inject: [] 的插件
    // 可能在 slots 服务就绪前 apply，导致 ctx.get("slots") 为空而静默退出。
    const inject = ["slots"];

    // ==================== 工具函数 ====================

    // Token 数量紧凑格式：<1000 原样；K / M / B 自适应，保留 1 位小数
    function fmtTok(n) {
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + 'K';
      if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
      return (n / 1e9).toFixed(2) + 'B';
    }
    // 千分位完整数字（悬浮提示用）
    function fmtFull(n) {
      n = Math.round(Number(n) || 0);
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function fmtTime(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      const pad = (x) => (x < 10 ? '0' + x : '' + x);
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function fmtDay(day) { return day ? day.slice(5) : ''; }
    function pct(part, total) {
      if (!total) return '0%';
      return ((part / total) * 100).toFixed(total >= 1e7 ? 1 : 2) + '%';
    }

    const PALETTE = ['#4f8ef7', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#84cc16', '#e879f9', '#60a5fa', '#fbbf24', '#2dd4bf'];

    // 设置持久化：localStorage 键带插件前缀
    const SETTINGS_KEY = 'oh-my-dshtoken:settings';
    function defaultSettings() { return { autoRefresh: true, lastTab: '' }; }
    function loadSettings() {
      try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '');
        return Object.assign(defaultSettings(), raw && typeof raw === 'object' ? raw : {});
      } catch (e) { return defaultSettings(); }
    }
    function saveSettings(s) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    }

    // ==================== 迷你 store + 轮询 ====================

    const storeState = {
      connected: false,
      meta: null,          // { version, latest, updateChecked, updateAvailable, upgrade, scanning, seq }
      data: null,          // 快照 data
      lastError: '',
      panelOpen: false,
      refreshing: false,
    };
    const subs = new Set();
    function setState(patch) {
      Object.assign(storeState, patch);
      const snapshot = Object.assign({}, storeState);
      subs.forEach((fn) => { try { fn(snapshot) } catch (e) { /* ignore */ } });
    }
    function subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } }

    let lastSeq = -1;
    let lastPollAt = 0;
    let pollInFlight = false;
    async function pollOnce(force) {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const res = await fetch('/dshtoken/pull?since=' + (force ? -1 : lastSeq));
        if (!res.ok) throw new Error('http ' + res.status);
        const body = await res.json();
        lastSeq = typeof body.seq === 'number' ? body.seq : lastSeq;
        const patch = { connected: true, meta: body, lastError: '' };
        if (!body.unchanged && body.data) patch.data = body.data;
        setState(patch);
      } catch (err) {
        setState({ connected: false, lastError: String((err && err.message) || err) });
      } finally {
        lastPollAt = Date.now();
        pollInFlight = false;
      }
    }
    // 统一节拍器：面板开 → 4s；面板关 → 25s（保活入口徽标）
    let ticker = null;
    function ensureTicker() {
      if (ticker) return;
      ticker = setInterval(() => {
        const gap = storeState.panelOpen
          ? (storeState.meta && storeState.data && (storeState.settingsAutoRefresh === false) ? 15000 : 4000)
          : 25000;
        if (Date.now() - lastPollAt >= gap) pollOnce(false);
      }, 1000);
    }
    function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null } }

    async function postAction(pathname) {
      try {
        await fetch(pathname, { method: 'POST' });
        pollOnce(true);
      } catch (err) { /* 状态经轮询回报 */ }
    }

    // ==================== 样式 ====================
    // 所有 class 带 .dtk- 前缀防冲突；主题跟随官方 body[data-ds-dark-theme] 属性。

    const CSS = `
.dtk-root{position:fixed;top:0;right:0;z-index:1200;font-family:'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif;pointer-events:none;}
.dtk-root .dtk-entry,.dtk-root .dtk-panel{pointer-events:auto;}
.dtk-entry{position:fixed;bottom:14px;right:14px;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;border:none;background:rgba(79,142,247,.16);color:#4f8ef7;box-shadow:inset 0 0 0 1px rgba(79,142,247,.35);transition:background .15s,transform .15s;padding:0;}
.dtk-entry:hover{background:rgba(79,142,247,.28);transform:translateY(1px);}
.dtk-entry svg{width:11px;height:11px;display:block;}
.dtk-entry-dot{position:absolute;top:-4px;right:-4px;min-width:10px;height:10px;border-radius:5px;background:linear-gradient(135deg,#f43f5e,#e11d48);color:#fff;font-size:7px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 2px;box-shadow:0 1px 4px rgba(225,29,72,.5);}
body[data-ds-dark-theme] .dtk-entry{background:rgba(96,165,250,.14);color:#93c5fd;box-shadow:inset 0 0 0 1px rgba(96,165,250,.4);}

.dtk-panel{position:fixed;bottom:42px;right:14px;width:min(780px,calc(100vw - 28px));height:min(640px,calc(100vh - 76px));display:flex;flex-direction:column;pointer-events:auto;border-radius:16px;color:#0f172a;background:rgba(255,255,255,.97);border:1px solid rgba(15,23,42,.16);box-shadow:0 18px 50px rgba(2,6,23,.30);backdrop-filter:blur(10px);animation:dtk-pop .18s ease-out;overflow:hidden;
  --dtk-tx:#0f172a; --dtk-fg:#334155; --dtk-mut:#64748b; --dtk-faint:#94a3b8;
  --dtk-sep:rgba(15,23,42,.10); --dtk-soft:rgba(15,23,42,.05); --dtk-hover:rgba(15,23,42,.07);
  --dtk-card:#f8fafc; --dtk-bar1:#4f8ef7; --dtk-bar2:#34d399;
  --dtk-btn-bg:rgba(79,142,247,.14); --dtk-btn-tx:#2b6cb0; --dtk-btn-bd:rgba(79,142,247,.35);
  --dtk-inp-bg:#ffffff; --dtk-inp-bd:rgba(15,23,42,.18);
  color:var(--dkt, #0f172a); color:var(--dtk-tx);}
body[data-ds-dark-theme] .dtk-panel{color:#e2e8f0;background:rgba(10,16,32,.95);border-color:rgba(148,163,184,.22);box-shadow:0 18px 50px rgba(0,0,0,.55);
  --dtk-tx:#e2e8f0; --dtk-fg:#cbd5e1; --dtk-mut:#94a3b8; --dtk-faint:#64748b;
  --dtk-sep:rgba(148,163,184,.16); --dtk-soft:rgba(148,163,184,.10); --dtk-hover:rgba(148,163,184,.12);
  --dtk-card:rgba(148,163,184,.08); --dtk-bar1:#60a5fa; --dtk-bar2:#34d399;
  --dtk-btn-bg:rgba(96,165,250,.18); --dtk-btn-tx:#bfdbfe; --dtk-btn-bd:rgba(96,165,250,.4);
  --dtk-inp-bg:rgba(15,23,42,.5); --dtk-inp-bd:rgba(148,163,184,.3);}
@keyframes dtk-pop{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}

.dtk-head{display:flex;align-items:center;gap:9px;padding:11px 14px;border-bottom:1px solid var(--dtk-sep);flex:none;}
.dtk-logo{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#4f8ef7,#34d399);display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 2px 8px rgba(79,142,247,.4);}
.dtk-logo svg{width:16px;height:16px;}
.dtk-title{font-size:14px;font-weight:700;letter-spacing:.2px;}
.dtk-ver{font-size:10.5px;color:var(--dtk-faint);border:1px solid var(--dtk-sep);padding:1px 6px;border-radius:8px;}
.dtk-live{width:8px;height:8px;border-radius:50%;margin-left:auto;flex:none;}
.dtk-live.on{background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.8);}
.dtk-live.off{background:#f87171;box-shadow:0 0 6px rgba(248,113,113,.8);}
.dtk-headbtn{border:none;background:var(--dtk-soft);color:var(--dtk-fg);width:26px;height:26px;border-radius:8px;cursor:pointer;font-size:12.5px;line-height:1;display:flex;align-items:center;justify-content:center;flex:none;padding:0;}
.dtk-headbtn:hover{background:var(--dtk-hover);}
.dtk-headbtn.spin{animation:dtk-spin 1s linear infinite;}
@keyframes dtk-spin{to{transform:rotate(360deg)}}
.dtk-headbtn.dtk-close:hover{background:rgba(248,113,113,.2);color:#ef4444;}

.dtk-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px 14px 14px;}
.dtk-body::-webkit-scrollbar{width:9px;height:9px;}
.dtk-body::-webkit-scrollbar-thumb{background:var(--dtk-sep);border-radius:5px;}

/* ---- 汇总卡 ---- */
.dtk-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;}
@media (max-width:720px){.dtk-cards{grid-template-columns:repeat(3,1fr)}}
.dtk-card{background:var(--dtk-card);border-radius:12px;padding:9px 11px;min-width:0;}
.dtk-card .dtk-k{font-size:10.5px;color:var(--dtk-mut);white-space:nowrap;display:flex;align-items:center;gap:5px;}
.dtk-card .dtk-swatch{width:8px;height:8px;border-radius:3px;flex:none;}
.dtk-card .dtk-v{font-size:17px;font-weight:750;margin-top:3px;font-variant-numeric:tabular-nums;letter-spacing:.2px;cursor:default;}
.dtk-card .dtk-sub{font-size:10px;color:var(--dtk-faint);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ---- Tab 栏 ---- */
.dtk-tabs{display:flex;gap:4px;background:var(--dtk-soft);border-radius:11px;padding:3px;margin-bottom:10px;width:max-content;max-width:100%;}
.dtk-tab{border:none;background:transparent;color:var(--dtk-mut);font-size:12.5px;font-weight:600;padding:5px 14px;border-radius:8px;cursor:pointer;transition:all .15s;white-space:nowrap;}
.dtk-tab.on{background:var(--dtk-inp-bg);color:var(--dtk-tx);box-shadow:0 1px 4px rgba(2,6,23,.14);}
body[data-ds-dark-theme] .dtk-tab.on{background:rgba(148,163,184,.18);}
.dtk-seg{display:inline-flex;background:var(--dtk-soft);border-radius:8px;padding:2px;margin-left:auto;}
.dtk-seg button{border:none;background:transparent;color:var(--dtk-mut);font-size:10.5px;font-weight:600;padding:2.5px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;}
.dtk-seg button.on{background:var(--dtk-inp-bg);color:var(--dtk-tx);box-shadow:0 1px 3px rgba(2,6,23,.14);}
body[data-ds-dark-theme] .dtk-seg button.on{background:rgba(148,163,184,.18);}

/* ---- 趋势图 ---- */
.dtk-section-title{font-size:12px;font-weight:700;color:var(--dtk-mut);margin:2px 0 6px;display:flex;align-items:center;gap:8px;}
.dtk-section-title .dtk-legend{display:flex;gap:10px;font-weight:500;font-size:10.5px;color:var(--dtk-faint);margin-left:auto;}
.dtk-legend i{display:inline-block;width:8px;height:8px;border-radius:2.5px;margin-right:4px;vertical-align:0;}

.dtk-trend{background:var(--dtk-card);border-radius:12px;padding:10px 12px 6px;margin-bottom:12px;}
.dtk-trend svg{display:block;width:100%;height:auto;}
.dtk-trend-empty{color:var(--dtk-faint);font-size:12px;padding:14px 0;text-align:center;}

/* ---- 项目条形列表 ---- */
.dtk-prow{border-radius:11px;transition:background .12s;}
.dtk-prow:hover{background:var(--dtk-hover);}
.dtk-pmain{display:grid;grid-template-columns:minmax(90px,1.25fr) 2.2fr repeat(3,minmax(58px,.62fr)) 30px;gap:8px;align-items:center;padding:7px 9px;cursor:pointer;}
.dtk-pname{min-width:0;}
.dtk-pname b{display:block;font-size:12.5px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dtk-pname span{display:block;font-size:10px;color:var(--dtk-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;}
.dtk-pbarwrap{height:16px;border-radius:5px;background:var(--dtk-soft);position:relative;overflow:hidden;}
.dtk-pbar{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:linear-gradient(90deg,var(--dtk-bar1),#6366f1);}
.dtk-num{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;color:var(--dtk-fg);cursor:default;white-space:nowrap;}
.dtk-num.strong{font-weight:700;color:var(--dtk-tx);}
.dtk-caret{text-align:center;color:var(--dtk-faint);font-size:10px;transition:transform .15s;}
.dtk-caret.open{transform:rotate(90deg);}
.dtk-psub{padding:2px 9px 8px 18px;}
.dtk-psubrow{display:flex;gap:8px;font-size:11.5px;color:var(--dtk-mut);padding:3.5px 8px;border-radius:7px;align-items:center;}
.dtk-psubrow:hover{background:var(--dtk-soft);}
.dtk-psubrow b{color:var(--dtk-fg);font-weight:600;max-width:34%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dtk-psubrow .dtk-model{font-size:10px;background:var(--dtk-soft);padding:1px 7px;border-radius:7px;white-space:nowrap;}
.dtk-psubrow .dtk-spacer{flex:1}
.dtk-psubrow .dtk-n{font-variant-numeric:tabular-nums;color:var(--dtk-fg);}

/* ---- 表格（会话/模型）---- */
.dtk-search{width:100%;box-sizing:border-box;border:1px solid var(--dtk-inp-bd);background:var(--dtk-inp-bg);color:var(--dtk-tx);border-radius:9px;padding:6px 11px;font-size:12.5px;outline:none;margin-bottom:8px;}
.dtk-search:focus{border-color:rgba(79,142,247,.6);}
.dtk-table{width:100%;border-collapse:collapse;font-size:12px;}
.dtk-table th{position:sticky;top:0;background:var(--dtk-inp-bg);text-align:right;font-size:10.5px;color:var(--dtk-mut);font-weight:650;padding:6px 8px;border-bottom:1px solid var(--dtk-sep);z-index:1;white-space:nowrap;}
body[data-ds-dark-theme] .dtk-table th{background:rgba(15,23,42,.85);}
.dtk-table th.l,.dtk-table td.l{text-align:left;}
.dtk-table td{padding:6.5px 8px;border-bottom:1px solid var(--dtk-sep);text-align:right;font-variant-numeric:tabular-nums;color:var(--dtk-fg);white-space:nowrap;}
.dtk-table tr:hover td{background:var(--dtk-hover);}
.dtk-table .dtk-celltitle{max-width:230px;overflow:hidden;text-overflow:ellipsis;font-weight:600;color:var(--dtk-tx);}
.dtk-table .dtk-cellsub{display:block;font-size:10px;color:var(--dtk-faint);font-weight:400;max-width:230px;overflow:hidden;text-overflow:ellipsis;}
.dtk-modelchip{display:inline-flex;align-items:center;gap:6px;max-width:210px;}
.dtk-modelchip i{width:9px;height:9px;border-radius:3px;flex:none;}
.dtk-modelchip span{overflow:hidden;text-overflow:ellipsis;direction:ltr;}
.dtk-empty{padding:34px 0;text-align:center;color:var(--dtk-faint);font-size:12.5px;}

/* ---- 模型环形图 ---- */
.dtk-donut-wrap{display:flex;gap:18px;align-items:center;background:var(--dtk-card);border-radius:12px;padding:12px 16px;margin-bottom:12px;flex-wrap:wrap;}
.dtk-donut{flex:none;position:relative;}
.dtk-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;}
.dtk-donut-center b{font-size:16px;font-weight:750;font-variant-numeric:tabular-nums;}
.dtk-donut-center span{font-size:9.5px;color:var(--dtk-faint);margin-top:1px;}
.dtk-donut-legend{flex:1;min-width:220px;display:flex;flex-direction:column;gap:5px;}
.dtk-lg-row{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dtk-fg);}
.dtk-lg-row i{width:9px;height:9px;border-radius:3px;flex:none;}
.dtk-lg-row .dtk-lg-name{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.dtk-lg-row .dtk-lg-val{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--dtk-mut);}
.dtk-lg-row .dtk-lg-pct{width:52px;text-align:right;color:var(--dtk-faint);font-variant-numeric:tabular-nums;}

/* ---- 设置抽屉 ---- */
.dtk-settings{border-top:1px solid var(--dtk-sep);background:var(--dtk-card);padding:12px 14px;flex:none;max-height:46%;overflow-y:auto;}
.dtk-set-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;font-size:12px;color:var(--dtk-fg);flex-wrap:wrap;}
.dtk-set-label{width:74px;flex:none;color:var(--dtk-mut);font-weight:600;}
.dtk-btn{border:1px solid var(--dtk-btn-bd);background:var(--dtk-btn-bg);color:var(--dtk-btn-tx);border-radius:9px;padding:4.5px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:filter .12s;}
.dtk-btn:hover{filter:brightness(1.08);}
.dtk-btn:disabled{opacity:.5;cursor:not-allowed;}
.dtk-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;}
.dtk-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--dtk-mut);word-break:break-all;user-select:text;}
.dtk-upmsg{font-size:11.5px;color:var(--dtk-mut);margin-top:2px;line-height:1.5;}
.dtk-ok{color:#10b981;} .dtk-bad{color:#ef4444;} .dtk-warn{color:#f59e0b;}
.dtk-about{font-size:10.5px;color:var(--dtk-faint);line-height:1.65;margin-top:4px;}

.dtk-toast{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:rgba(15,23,42,.86);color:#fff;font-size:12px;padding:7px 16px;border-radius:20px;animation:dtk-pop .18s ease-out;pointer-events:none;white-space:nowrap;}
`;

    // 入口小图标（柱状图）
    function EntryIcon() {
      return React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' },
        React.createElement('rect', { x: '3.5', y: '12', width: '4', height: '8.5', rx: '1.2', fill: 'currentColor', opacity: '.75' }),
        React.createElement('rect', { x: '10', y: '6.5', width: '4', height: '14', rx: '1.2', fill: 'currentColor' }),
        React.createElement('rect', { x: '16.5', y: '3', width: '4', height: '17.5', rx: '1.2', fill: 'currentColor', opacity: '.55' }),
        React.createElement('path', { d: 'M4 8.2c3.2-.4 5.6-2.3 8-4.7 2.1-2 4.9-1.4 8 .5', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', fill: 'none', opacity: '.9' })
      );
    }
    function LogoIcon() {
      return React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' },
        React.createElement('rect', { x: '4', y: '12.5', width: '3.6', height: '7.5', rx: '1', fill: '#fff', opacity: '.92' }),
        React.createElement('rect', { x: '10.2', y: '8', width: '3.6', height: '12', rx: '1', fill: '#fff' }),
        React.createElement('rect', { x: '16.4', y: '4', width: '3.6', height: '16', rx: '1', fill: '#fff', opacity: '.78' })
      );
    }

    // ==================== 图表组件（纯 SVG，零依赖）====================

    /** 每日趋势堆叠柱状图：近 N 天 输入/输出 */
    function TrendChart({ trend }) {
      const days = (trend || []).slice(-21);
      if (!days.length) return React.createElement('div', { className: 'dtk-trend' },
        React.createElement('div', { className: 'dtk-trend-empty' }, '暂无按日分布数据'));
      const W = 720, H = 132, PADL = 44, PADR = 8, PADT = 12, PADB = 20;
      const innerW = W - PADL - PADR, innerH = H - PADT - PADB;
      const maxVal = Math.max.apply(null, days.map((d) => d.grandTotal).concat([1]));
      // 纵轴刻度：取一条好看的整数值
      const step = Math.pow(10, Math.floor(Math.log10(maxVal)));
      const yMax = Math.ceil(maxVal / step) * step;
      const bandW = innerW / days.length;
      const barW = Math.min(Math.max(bandW * 0.55, 4), 38);
      const ticks = [0, 0.5, 1].map((r) => ({ v: yMax * r, y: PADT + innerH * (1 - r) }));
      return React.createElement('div', { className: 'dtk-trend' },
        React.createElement('div', { className: 'dtk-section-title', style: { margin: '0 0 4px' } }, '每日消耗趋势',
          React.createElement('span', { className: 'dtk-legend' },
            React.createElement('span', null, React.createElement('i', { style: { background: 'var(--dtk-bar1)' } }), '输入'),
            React.createElement('span', null, React.createElement('i', { style: { background: 'var(--dtk-bar2)' } }), '输出'))),
        React.createElement('svg', { viewBox: '0 0 ' + W + ' ' + H },
          ticks.map((t, i) => React.createElement('g', { key: i },
            React.createElement('line', { x1: PADL, x2: W - PADR, y1: t.y, y2: t.y, stroke: 'var(--dtk-sep)', strokeWidth: 1 }),
            React.createElement('text', { x: PADL - 6, y: t.y + 3.5, textAnchor: 'end', fontSize: 9, fill: 'var(--dtk-faint)' }, fmtTok(t.v)))),
          days.map((d, i) => {
            const x = PADL + bandW * i + (bandW - barW) / 2;
            const hIn = (d.inputTokens / yMax) * innerH;
            const hOut = (d.outputTokens / yMax) * innerH;
            const yOut = PADT + innerH - hIn - hOut;
            const label = d.day.slice(5) + ' · 输入 ' + fmtFull(d.inputTokens) + ' / 输出 ' + fmtFull(d.outputTokens);
            return React.createElement('g', { key: d.day },
              hIn > 0 && React.createElement('rect', { x, y: PADT + innerH - hIn, width: barW, height: hIn, rx: Math.min(3, barW / 3), fill: 'var(--dtk-bar1)' },
              ),
              hOut > 0 && React.createElement('rect', { x, y: yOut, width: barW, height: hOut, rx: Math.min(3, barW / 3), fill: 'var(--dtk-bar2)' }),
              React.createElement('title', null, d.day + '\n输入 ' + fmtFull(d.inputTokens) + '\n输出 ' + fmtFull(d.outputTokens)),
              (i % Math.ceil(days.length / 8) === 0 || i === days.length - 1) &&
              React.createElement('text', { x: x + barW / 2, y: H - 6, textAnchor: 'middle', fontSize: 9, fill: 'var(--dtk-faint)' }, fmtDay(d.day)));
          })));
    }

    /** 模型占比环形图：metric = 'total'（总消耗）| 'cacheRead'（缓存读取） */
    function DonutChart({ models, metric }) {
      const field = metric === 'cacheRead' ? 'cacheReadTokens' : 'grandTotal';
      const centerLabel = metric === 'cacheRead' ? '缓存读取 Token' : '总 Token';
      const top = models.slice(0, 10);
      const total = models.reduce((s, m) => s + (m[field] || 0), 0);
      if (!total) return React.createElement('div', { className: 'dtk-empty' }, metric === 'cacheRead' ? '暂无缓存读取数据' : '暂无模型数据');
      const R = 52, CIRC = 2 * Math.PI * R;
      let acc = 0;
      return React.createElement('div', { className: 'dtk-donut-wrap' },
        React.createElement('div', { className: 'dtk-donut' },
          React.createElement('svg', { width: 136, height: 136, viewBox: '0 0 136 136' },
            React.createElement('circle', { cx: 68, cy: 68, r: R, fill: 'none', stroke: 'var(--dtk-soft)', strokeWidth: 16 }),
            top.map((m, i) => {
              const frac = (m[field] || 0) / total;
              const dash = frac * CIRC;
              const off = -acc * CIRC;
              acc += frac;
              return React.createElement('circle', {
                key: m.key, cx: 68, cy: 68, r: R, fill: 'none',
                stroke: PALETTE[i % PALETTE.length], strokeWidth: 16,
                strokeDasharray: Math.max(dash - 1.5, 0.5) + ' ' + (CIRC - dash + 1.5),
                strokeDashoffset: off, transform: 'rotate(-90 68 68)',
              });
            })),
          React.createElement('div', { className: 'dtk-donut-center' },
            React.createElement('b', null, fmtTok(total)),
            React.createElement('span', null, centerLabel))),
        React.createElement('div', { className: 'dtk-donut-legend' },
          top.map((m, i) => React.createElement('div', { key: m.key, className: 'dtk-lg-row' },
            React.createElement('i', { style: { background: PALETTE[i % PALETTE.length] } }),
            React.createElement('span', { className: 'dtk-lg-name', title: m.key }, m.key),
            React.createElement('span', { className: 'dtk-lg-val', title: fmtFull(m[field] || 0) }, fmtTok(m[field] || 0)),
            React.createElement('span', { className: 'dtk-lg-pct' }, pct(m[field] || 0, total))))));
    }

    // ==================== 主面板 ====================

    const TABS = [
      { id: 'projects', label: '项目' },
      { id: 'sessions', label: '会话' },
      { id: 'models', label: '模型' },
    ];

    function SummaryCards({ data }) {
      if (!data) return null;
      const t = data.totals || {};
      const c = data.counts || {};
      // 缓存命中率 = 缓存读取 ÷ (缓存读取 + 未命中输入)
      const hitDenom = (t.cacheReadTokens || 0) + (t.inputTokens || 0);
      const hitRate = hitDenom ? ((t.cacheReadTokens / hitDenom) * 100).toFixed(1) + '%' : '—';
      const cards = [
        { k: '总消耗', v: fmtTok(t.grandTotal), sub: '输入+输出', full: t.grandTotal, swatch: null },
        { k: '输入', v: fmtTok(t.inputTokens), sub: '未含缓存', full: t.inputTokens, swatch: 'var(--dtk-bar1)' },
        { k: '输出', v: fmtTok(t.outputTokens), sub: '', full: t.outputTokens, swatch: 'var(--dtk-bar2)' },
        { k: '缓存读取', v: fmtTok(t.cacheReadTokens), sub: '命中提示词', full: t.cacheReadTokens, swatch: '#a78bfa' },
        { k: '缓存命中率', v: hitRate, sub: '缓存÷(缓存+输入)', title: '命中率 = 缓存读取 ' + fmtFull(t.cacheReadTokens || 0) + ' ÷ (缓存读取 ' + fmtFull(t.cacheReadTokens || 0) + ' + 输入 ' + fmtFull(t.inputTokens || 0) + ')', swatch: '#22d3ee' },
        { k: '会话', v: String(c.sessions || 0), sub: c.files ? ('日志文件 ' + c.files) : '', full: null, swatch: null },
        { k: '项目', v: String(c.projects || 0), sub: '模型 ' + (c.models || 0) + ' 个', full: null, swatch: null },
      ];
      return React.createElement('div', { className: 'dtk-cards' },
        cards.map((cd) => React.createElement('div', { className: 'dtk-card', key: cd.k },
          React.createElement('div', { className: 'dtk-k' },
            cd.swatch ? React.createElement('i', { className: 'dtk-swatch', style: { background: cd.swatch } }) : null, cd.k),
          React.createElement('div', { className: 'dtk-v', title: cd.title ? cd.title : (cd.full != null ? fmtFull(cd.full) : undefined) }, cd.v),
          cd.sub ? React.createElement('div', { className: 'dtk-sub' }, cd.sub) : null)));
    }

    function ProjectsTab({ data }) {
      const [expanded, setExpanded] = React.useState(null);
      const projects = (data && data.projects) || [];
      const allSessions = (data && data.sessions) || [];
      if (!projects.length) return React.createElement('div', { className: 'dtk-empty' }, '暂无项目数据');
      const maxGrand = projects[0].grandTotal || 1;
      return React.createElement('div', null,
        React.createElement('div', { className: 'dtk-section-title' }, '各项目累计消耗',
          React.createElement('span', { className: 'dtk-legend' },
            React.createElement('span', null, '条长 = 总消耗（输入+输出）'))),
        projects.map((p, idx) => {
          const open = expanded === p.cwd;
          const projSessions = allSessions.filter((s) => s.cwd === p.cwd).slice(0, 8);
          return React.createElement('div', { className: 'dtk-prow', key: p.cwd },
            React.createElement('div', {
              className: 'dtk-pmain',
              onClick: () => setExpanded(open ? null : p.cwd),
            },
              React.createElement('div', { className: 'dtk-pname', title: p.cwd },
                React.createElement('b', null, (idx + 1) + '. ' + p.name),
                React.createElement('span', null, p.cwd)),
              React.createElement('div', { className: 'dtk-pbarwrap', title: fmtFull(p.grandTotal) + ' tokens' },
                React.createElement('div', { className: 'dtk-pbar', style: { width: Math.max((p.grandTotal / maxGrand) * 100, 1.2) + '%' } })),
              React.createElement('div', { className: 'dtk-num strong', title: '总计 ' + fmtFull(p.grandTotal) }, fmtTok(p.grandTotal)),
              React.createElement('div', { className: 'dtk-num', title: '输入 ' + fmtFull(p.inputTokens) }, fmtTok(p.inputTokens)),
              React.createElement('div', { className: 'dtk-num', title: '输出 ' + fmtFull(p.outputTokens) }, fmtTok(p.outputTokens)),
              React.createElement('div', { className: 'dtk-caret' + (open ? ' open' : '') }, '▶')),
            open ? React.createElement('div', { className: 'dtk-psub' },
              React.createElement('div', { className: 'dtk-psubrow', style: { fontSize: 10, color: 'var(--dtk-faint)' } },
                React.createElement('span', null, '会话明细（最多 8 条 · 共 ' + p.sessionCount + ' 个会话 · 缓存读取 ' + fmtTok(p.cacheReadTokens) + ' · 最近活跃 ' + fmtTime(p.lastActive) + '）')),
              projSessions.map((s) => React.createElement('div', { className: 'dtk-psubrow', key: s.id },
                React.createElement('b', { title: s.title || s.id }, s.title || s.shortId),
                React.createElement('span', { className: 'dtk-model' }, s.primaryModel || '?'),
                React.createElement('span', { className: 'dtk-spacer' }),
                React.createElement('span', { className: 'dtk-n', title: '总计 ' + fmtFull(s.grandTotal) }, fmtTok(s.grandTotal)),
                React.createElement('span', { style: { color: 'var(--dtk-faint)', fontSize: 10 } }, fmtTime(s.lastActive))))) : null);
        }));
    }

    function SessionsTab({ data }) {
      const [q, setQ] = React.useState('');
      const sessions = (data && data.sessions) || [];
      const kw = q.trim().toLowerCase();
      const shown = kw
        ? sessions.filter((s) =>
          (s.title || '').toLowerCase().includes(kw) ||
          (s.id || '').toLowerCase().includes(kw) ||
          (s.projectName || '').toLowerCase().includes(kw) ||
          (s.cwd || '').toLowerCase().includes(kw) ||
          (s.primaryModel || '').toLowerCase().includes(kw))
        : sessions;
      return React.createElement('div', null,
        React.createElement('input', {
          className: 'dtk-search', placeholder: '搜索标题 / 会话 ID / 项目 / 模型…', value: q,
          onChange: (e) => setQ(e.target.value),
        }),
        !shown.length
          ? React.createElement('div', { className: 'dtk-empty' }, kw ? '没有匹配的会话' : '暂无会话数据')
          : React.createElement('table', { className: 'dtk-table' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', { className: 'l' }, '会话'),
              React.createElement('th', { className: 'l' }, '模型'),
              React.createElement('th', null, '输入'),
              React.createElement('th', null, '输出'),
              React.createElement('th', null, '总计'),
              React.createElement('th', null, '缓存读取'),
              React.createElement('th', null, '最近活跃'))),
            React.createElement('tbody', null, shown.map((s) =>
              React.createElement('tr', { key: s.id },
                React.createElement('td', { className: 'l' },
                  React.createElement('span', { className: 'dtk-celltitle', title: s.title || s.id }, s.title || s.shortId),
                  React.createElement('span', { className: 'dtk-cellsub', title: s.cwd }, s.projectName)),
                React.createElement('td', { className: 'l' }, React.createElement('span', { className: 'dtk-modelchip', title: s.primaryModel || '?' },
                  React.createElement('span', null, s.primaryModel || '?'))),
                React.createElement('td', { title: fmtFull(s.inputTokens) }, fmtTok(s.inputTokens)),
                React.createElement('td', { title: fmtFull(s.outputTokens) }, fmtTok(s.outputTokens)),
                React.createElement('td', { title: fmtFull(s.grandTotal), style: { fontWeight: 700, color: 'var(--dtk-tx)' } }, fmtTok(s.grandTotal)),
                React.createElement('td', { title: fmtFull(s.cacheReadTokens) }, fmtTok(s.cacheReadTokens)),
                React.createElement('td', { style: { color: 'var(--dtk-mut)' } }, fmtTime(s.lastActive)))))));
    }

    function ModelsTab({ data }) {
      const models = (data && data.models) || [];
      // 环形图口径切换：总消耗 / 缓存读取
      const [metric, setMetric] = React.useState('total');
      if (!models.length) return React.createElement('div', { className: 'dtk-empty' }, '暂无模型数据');
      return React.createElement('div', null,
        React.createElement('div', { className: 'dtk-section-title' }, '环形图分布',
          React.createElement('span', { className: 'dtk-seg' },
            React.createElement('button', {
              className: metric !== 'cacheRead' ? 'on' : '',
              onClick: () => setMetric('total'),
            }, '总消耗'),
            React.createElement('button', {
              className: metric === 'cacheRead' ? 'on' : '',
              onClick: () => setMetric('cacheRead'),
              title: '各模型的缓存读取 token 占比',
            }, '缓存读取'))),
        React.createElement(DonutChart, { models, metric }),
        React.createElement('table', { className: 'dtk-table' },
          React.createElement('thead', null, React.createElement('tr', null,
            React.createElement('th', { className: 'l' }, '模型'),
            React.createElement('th', null, '输入'),
            React.createElement('th', null, '输出'),
            React.createElement('th', null, '总计'),
            React.createElement('th', null, '缓存读取'),
            React.createElement('th', null, '占比'),
            React.createElement('th', null, '会话数'))),
          React.createElement('tbody', null, models.map((m, i) =>
            React.createElement('tr', { key: m.key },
              React.createElement('td', { className: 'l' }, React.createElement('span', { className: 'dtk-modelchip' },
                React.createElement('i', { style: { background: PALETTE[i % PALETTE.length] } }),
                React.createElement('span', { title: m.provider + ' / ' + m.model }, m.model))),
              React.createElement('td', { title: fmtFull(m.inputTokens) }, fmtTok(m.inputTokens)),
              React.createElement('td', { title: fmtFull(m.outputTokens) }, fmtTok(m.outputTokens)),
              React.createElement('td', { title: fmtFull(m.grandTotal), style: { fontWeight: 700, color: 'var(--dtk-tx)' } }, fmtTok(m.grandTotal)),
              React.createElement('td', { title: fmtFull(m.cacheReadTokens) }, fmtTok(m.cacheReadTokens)),
              React.createElement('td', null, pct(m.grandTotal, models.reduce((s, x) => s + x.grandTotal, 0))),
              React.createElement('td', null, m.sessionCount))))));
    }

    function SettingsDrawer({ meta, data, settings, onSettings, onClose }) {
      const up = (meta && meta.upgrade) || {};
      const checking = up.running;
      return React.createElement('div', { className: 'dtk-settings' },
        React.createElement('div', { className: 'dtk-set-row' },
          React.createElement('span', { className: 'dtk-set-label' }, '数据源'),
          React.createElement('span', { className: 'dtk-path' }, (data && data.sessionsRoot) || '~/.dsh/sessions'),
          React.createElement('button', {
            className: 'dtk-btn', onClick: () => postAction('/dshtoken/refresh'), disabled: storeState.refreshing,
          }, '重新扫描')),
        React.createElement('div', { className: 'dtk-set-row' },
          React.createElement('span', { className: 'dtk-set-label' }, '自动刷新'),
          React.createElement('label', { className: 'dtk-check' },
            React.createElement('input', {
              type: 'checkbox', checked: !!settings.autoRefresh,
              onChange: (e) => onSettings(Object.assign({}, settings, { autoRefresh: e.target.checked })),
            }), '面板打开时每 4 秒自动拉取')),
        React.createElement('div', { className: 'dtk-set-row' },
          React.createElement('span', { className: 'dtk-set-label' }, '版本'),
          React.createElement('span', null, '当前 v' + ((meta && meta.version) || '?'),
            meta && meta.latest ? React.createElement('span', null, ' · npm 最新 v' + meta.latest) :
              (meta && meta.updateChecked ? React.createElement('span', { className: 'dtk-warn' }, ' · 未获取到线上版本（未发布或离线）') : null))),
        React.createElement('div', { className: 'dtk-set-row' },
          React.createElement('span', { className: 'dtk-set-label' }, '在线升级'),
          React.createElement('button', {
            className: 'dtk-btn', disabled: checking,
            onClick: () => postAction('/dshtoken/check-update'),
          }, checking ? '处理中…' : '检测更新'),
          React.createElement('button', {
            className: 'dtk-btn', disabled: checking || !(meta && meta.updateAvailable),
            onClick: () => postAction('/dshtoken/upgrade'),
            title: (meta && meta.updateAvailable) ? '升级到 v' + meta.latest : '没有可用的更新',
          }, '一键升级')),
        up.message ? React.createElement('div', { className: 'dtk-upmsg' },
          React.createElement('span', {
            className: up.ok === 'ok' ? 'dtk-ok' : (up.ok === 'fail' ? 'dtk-bad' : ''),
          }, up.message)) : null,
        React.createElement('div', { className: 'dtk-about' },
          '统计口径：总计 = 输入 + 输出；「输入」为未含缓存的提示词输入，缓存命中单独计入「缓存读取」。数据全部来自本机 ~/.dsh/sessions 会话日志，纯本地解析，不经任何网络上传。',
          React.createElement('br'), '插件卸载：dsh plugin --profile web remove oh-my-dshtoken；临时禁用请在 profile 的 cordis.patch.yml 中将 id 为 dshtoken 的行设置 disabled: true。'));
    }

    function TokenApp() {
      const [snap, setSnap] = React.useState(Object.assign({}, storeState));
      React.useEffect(() => subscribe((s) => setSnap(s)), []);
      const [panel, setPanel] = React.useState(false);
      // 记住上次停留的维度 Tab（持久化到设置）
      const [tab, setTab] = React.useState(() => {
        const s = loadSettings();
        return TABS.some((t) => t.id === s.lastTab) ? s.lastTab : 'projects';
      });
      const setTabPersist = (id) => { setTab(id); const s = loadSettings(); saveSettings(Object.assign(s, { lastTab: id })); };
      const [showSettings, setShowSettings] = React.useState(false);
      const [settings, setSettingsRaw] = React.useState(loadSettings);
      const setSettings = (s) => { setSettingsRaw(s); saveSettings(s); setState({ settingsAutoRefresh: s.autoRefresh }); };
      React.useEffect(() => { setState({ settingsAutoRefresh: settings.autoRefresh }); }, []);

      const data = snap.data;
      const meta = snap.meta;

      // 面板开合 → 驱动轮询频率 + 首开立即拉取
      React.useEffect(() => {
        setState({ panelOpen: panel });
        if (panel) pollOnce(true);
      }, [panel]);
      // 卸载时停止节拍器
      React.useEffect(() => () => stopTicker(), []);
      ensureTicker();

      // 入口防遮挡：右下角落点被其他元素占据时自动上移找空位（一次性，挂载时执行）
      const rootRef = React.useRef(null);
      const entryRef = React.useRef(null);
      React.useEffect(() => {
        const btn = entryRef.current;
        if (!btn) return;
        const GAP = 14, STEP = 30;
        let bottom = GAP;
        btn.style.bottom = bottom + 'px';
        try {
          for (let i = 0; i < 16; i++) {
            const r = btn.getBoundingClientRect();
            if (r.height <= 0) break;
            const cx = window.innerWidth - GAP - r.width / 2;
            const cy = window.innerHeight - bottom - r.height / 2;
            const el = document.elementFromPoint(cx, cy);
            if (!el || el === btn || (rootRef.current && rootRef.current.contains(el))) break;
            bottom += STEP;
            if (bottom + r.height > window.innerHeight * 0.6) break;
            btn.style.bottom = bottom + 'px';
          }
        } catch (e) { /* 探测失败保持默认位置 */ }
      }, []);

      // 点击外部 / Esc 关闭
      React.useEffect(() => {
        if (!panel) return;
        const onDown = (e) => {
          if (rootRef.current && rootRef.current.contains && !rootRef.current.contains(e.target)) setPanel(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setPanel(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [panel]);

      const scanning = !!(meta && meta.scanning);

      return React.createElement('div', { className: 'dtk-root', ref: rootRef },
        // 右下角入口
        React.createElement('button', {
          ref: entryRef,
          className: 'dtk-entry', title: 'AI Token 消耗统计 (oh-my-dshtoken)',
          onClick: () => setPanel(!panel),
        },
          React.createElement(EntryIcon, null),
          meta && meta.updateAvailable ? React.createElement('span', { className: 'dtk-entry-dot' }, '!') : null),
        // 面板
        panel ? React.createElement('div', { className: 'dtk-panel' },
          React.createElement('div', { className: 'dtk-head' },
            React.createElement('div', { className: 'dtk-logo' }, React.createElement(LogoIcon, null)),
            React.createElement('span', { className: 'dtk-title' }, 'AI Token 消耗统计'),
            React.createElement('span', { className: 'dtk-ver' }, 'v' + ((meta && meta.version) || '?')),
            scanning ? React.createElement('span', { className: 'dtk-ver', style: { color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' } }, '扫描中…') : null,
            React.createElement('span', { className: 'dtk-live ' + (snap.connected ? 'on' : 'off'), title: snap.connected ? '已连接 host' : '连接断开：' + snap.lastError }),
            React.createElement('button', {
              className: 'dtk-headbtn' + (scanning ? ' spin' : ''), title: '强制重新扫描',
              onClick: () => postAction('/dshtoken/refresh'),
            }, '⟳'),
            React.createElement('button', {
              className: 'dtk-headbtn', title: showSettings ? '收起设置' : '设置与升级',
              style: showSettings ? { background: 'var(--dtk-btn-bg)', color: 'var(--dtk-btn-tx)' } : null,
              onClick: () => setShowSettings(!showSettings),
            }, '⚙'),
            React.createElement('button', { className: 'dtk-headbtn dtk-close', title: '关闭 (Esc)', onClick: () => setPanel(false) }, '✕')),
          React.createElement('div', { className: 'dtk-body' },
            React.createElement(SummaryCards, { data }),
            React.createElement(TrendChart, { trend: data && data.dailyTrend }),
            React.createElement('div', { className: 'dtk-tabs' },
              TABS.map((t) => React.createElement('button', {
                key: t.id, className: 'dtk-tab' + (tab === t.id ? ' on' : ''),
                onClick: () => setTabPersist(t.id),
              }, t.label))),
            tab === 'projects' ? React.createElement(ProjectsTab, { data }) : null,
            tab === 'sessions' ? React.createElement(SessionsTab, { data }) : null,
            tab === 'models' ? React.createElement(ModelsTab, { data }) : null,
            !data ? React.createElement('div', { className: 'dtk-toast' }, '正在扫描本机会话历史…') : null),
          showSettings ? React.createElement(SettingsDrawer, {
            meta, data, settings,
            onSettings: setSettings,
            onClose: () => setShowSettings(false),
          }) : null) : null);
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;

      // ---- 注入样式（随插件卸载自动移除）----
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-plugin", "oh-my-dshtoken");
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
      ctx.effect(() => () => { try { styleEl.remove() } catch (e) { } }); // 返回值才是清理函数

      // 注册到 shell 浮层插槽（list 槽：默认点击穿透，交互元素已显式开启 pointer-events）
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'dshtoken-panel', order: 9500 },
        () => React.createElement(TokenApp, null)
      ));
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
