window.__ModuleLoader__.load({
  id: "dsh-annual-activity",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    // 必须走 portal：入口挂在会话头部的 utilities 槽里，而那个头部位于
    // `.wSkVaW_scrollBody{overflow-y:auto}` 这个滚动容器内——position:fixed 的
    // 后代会被祖先滚动容器裁剪（同时被其层叠上下文困住），表现为面板被页面内容
    // 遮挡、悬浮说明顶部被切掉。portal 到 document.body 才能彻底跳出来。
    let ReactDOM = null;
    try { ReactDOM = require("react-dom"); } catch (err) { /* 旧运行时没有 react-dom：退化为内联渲染 */ }

    const name = "dsh-annual-activity";
    // 依赖必须显式声明：boot 阶段各插件并发激活，inject: [] 的插件可能在 slots
    // 服务就绪前 apply，导致 ctx.get("slots") 为空而静默失效（无报错、无 UI）。
    const inject = ["slots"];

    // ==================== 常量 / 工具 ====================

    // 活跃等级：与 Host 半区同源（Host 通过 /activity/pull 的 levels 字段下发，
    // 且色块颜色随数据里自带的 level 走；这里的兜底表仅用于 Host 不可用时）。
    const FALLBACK_LEVELS = [
      { level: 0, label: '未活跃', min: 0, max: 0 },
      { level: 1, label: '轻', min: 1, max: 1 },
      { level: 2, label: '中', min: 2, max: 5 },
      { level: 3, label: '高', min: 6, max: 15 },
      { level: 4, label: '极高', min: 16, max: null },
    ];
    const MONTH_NAMES = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
    const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const LS_YEAR = 'dsh-annual-activity:year';
    const LS_GEAR = 'dsh-annual-activity:setup-open';
    // portal 浮层的层级：必须压过页面上的内容与其它插件浮层（鲸鱼 999 / token 面板
    // 1000 / 市场 toast 等），同时留出余量避免将来更高层的组件把它盖住。
    const Z_PORTAL = 2147483000;

    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
    const dayKeyOf = (y, m, d) => y + '-' + pad2(m + 1) + '-' + pad2(d);
    const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInYear = (y) => (isLeap(y) ? 366 : 365);

    function fmtInt(n) {
      return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function fmtCompact(n) {
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
      if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
      return (n / 1e9).toFixed(2) + 'B';
    }
    function fmtPercent(rate, digits) {
      const v = (Number(rate) || 0) * 100;
      const d = typeof digits === 'number' ? digits : v > 0 && v < 1 ? 1 : 0;
      return (v > 0 && v < 0.1 ? '<0.1' : v.toFixed(d)) + '%';
    }
    function fmtClock(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function weekdayOf(day) {
      const [y, m, d] = String(day).split('-').map(Number);
      return (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = 周一
    }
    function todayKey() {
      const d = new Date();
      return dayKeyOf(d.getFullYear(), d.getMonth(), d.getDate());
    }
    /** 相对今天偏移 n 天的本地日期键（n 为负表示过去）。 */
    function dayKeyOffset(n) {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return dayKeyOf(d.getFullYear(), d.getMonth(), d.getDate());
    }

    /**
     * 入口按钮里的小热力图字形：最近 14 天，7 列 × 2 行（每列一周、周一在顶）。
     * 让按钮本身就是「活跃记录」的缩影，而不是一个与内容无关的图标。
     */
    function glyphCells(byDay) {
      const out = [];
      const todayDow = weekdayOf(dayKeyOffset(0)); // 0 = 周一
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 7; col++) {
          const offset = -13 + row * 7 + col + (6 - todayDow);
          const day = offset <= 0 ? dayKeyOffset(offset) : null;
          out.push({ day, level: day ? levelOfDay(byDay[day]) : -1 });
        }
      }
      return out;
    }

    /**
     * 把一年的数据排成 GitHub 风格的热力图网格：列 = 周（周一在顶），最多 53 列。
     * 首列前用 null 占位，使 1 月 1 日落在它真实的星期行上。
     */
    function buildWeeks(year) {
      const total = daysInYear(year);
      const lead = weekdayOf(dayKeyOf(year, 0, 1));
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(null);
      for (let i = 0; i < total; i++) {
        const d = new Date(year, 0, 1 + i);
        cells.push(dayKeyOf(year, d.getMonth(), d.getDate()));
      }
      while (cells.length % 7 !== 0) cells.push(null);
      const weeks = [];
      for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
      return weeks;
    }

    /** 月份轴：某列含有该月 1 日时，在这一列顶上标出月份（与设计图一致）。 */
    function monthLabels(weeks) {
      const labels = new Array(weeks.length).fill(null);
      const seen = new Set();
      for (let c = 0; c < weeks.length; c++) {
        for (const day of weeks[c]) {
          if (!day) continue;
          const m = Number(day.slice(5, 7));
          if (Number(day.slice(8, 10)) === 1 && !seen.has(m)) {
            seen.add(m);
            labels[c] = MONTH_NAMES[m - 1];
            break;
          }
        }
      }
      return labels;
    }

    function levelOfDay(rec) {
      if (!rec) return 0;
      return typeof rec.level === 'number' ? rec.level : 0;
    }

    /**
     * 把一次 pull 负载整理成「日 → 记录」查表。
     * 负载形状：`days` 是**当前选中年**的完整明细（有界），`byDay` 是全部年份的
     * 汇总（host 序列化时会剔除，只有本地直连时才可能带）；两者合并后，无论
     * 选中哪一年，「今天」的色块和计数都能查到。
     */
    function indexDays(data) {
      const map = {};
      if (!data) return map;
      if (data.byDay) for (const day of Object.keys(data.byDay)) map[day] = data.byDay[day];
      for (const rec of data.days || []) map[rec.day] = rec;
      return map;
    }

    // ==================== portal 宿主 ====================
    // 面板与悬浮说明都渲染到 document.body 下的一个固定层里，避开会话头部所在
    // 滚动容器的裁剪与层叠上下文。
    const PORTAL_CLASS = 'daa-portal';
    let portalHost = null;
    function ensurePortalHost() {
      if (portalHost && portalHost.isConnected !== false) return portalHost;
      portalHost = document.createElement('div');
      portalHost.className = PORTAL_CLASS;
      portalHost.setAttribute('data-plugin', 'dsh-annual-activity');
      // 内联层级 + 视口铺满：position:fixed 需要「视口大小的包含块」，
      // 否则父级（头部槽位）的尺寸会成为浮层的包含块，panel 会被挤在头部区域里。
      portalHost.style.position = 'fixed';
      portalHost.style.top = '0';
      portalHost.style.right = '0';
      portalHost.style.bottom = '0';
      portalHost.style.left = '0';
      portalHost.style.pointerEvents = 'none';
      portalHost.style.zIndex = String(Z_PORTAL);      document.body.appendChild(portalHost);
      return portalHost;
    }
    /** 把浮层内容 portal 到 body；运行时没有 react-dom 时退化为内联渲染。 */
    function portalToBody(node) {
      if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') return node;
      try { return ReactDOM.createPortal(node, ensurePortalHost()); } catch (err) { return node; }
    }

    // ==================== 迷你 store：轮询 host 的只读接口 ====================

    function createStore() {
      // 绝对 URL：不依赖文档 base（DSH Web 面板可能与页面不在同一路径前缀下），
      // 也让 host 路由在任何挂载点都命中（服务只监听回环地址）。
      const api = (p) => window.location.origin + p;
      let state = {
        data: null,          // 最近一次成功的 /activity/pull 负载
        loading: true,
        error: '',
        lastOkAt: 0,
        panelOpen: false,
        preferredYear: null, // 用户手选的年份（null = 跟随 host 的当前年）
      };
      const listeners = new Set();
      const emit = () => { for (const fn of Array.from(listeners)) { try { fn() } catch (e) { /* ignore */ } } };
      let timer = null;
      let inFlight = null;

      function pull() {
        if (inFlight) return inFlight;
        inFlight = (async () => {
          try {
            const year = state.preferredYear;
            // 绝对 URL：不依赖文档 base，也让 host 路由在任何挂载点都命中
            const res = await fetch(api('/activity/pull' + (year ? '?year=' + year : '')), { headers: { accept: 'application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            state = { ...state, data, loading: false, error: '', lastOkAt: Date.now() };
          } catch (err) {
            state = { ...state, loading: false, error: String((err && err.message) || err) };
          } finally {
            inFlight = null;
            emit();
          }
          return state;
        })();
        return inFlight;
      }

      async function refresh() {
        try { await fetch(api('/activity/refresh'), { method: 'POST' }); } catch (err) { /* host 未就绪时静默 */ }
        return pull();
      }

      function schedule() {
        if (timer) return;
        // 面板打开时 20s 一次（今天的新活动很快可见），关闭时 3 分钟一次保活
        const tick = () => { void pull(); timer = setTimeout(tick, state.panelOpen ? 20000 : 180000); };
        timer = setTimeout(tick, state.panelOpen ? 1000 : 8000);
      }

      return {
        getState: () => state,
        subscribe(fn) { listeners.add(fn); schedule(); return () => listeners.delete(fn); },
        /** 只在值真正变化时替换快照：否则 emit → setState → 重渲染会自激成环 */
        setPanelOpen(open) {
          const next = !!open;
          if (next === state.panelOpen) return Promise.resolve(state);
          state = { ...state, panelOpen: next };
          emit();
          return next ? pull() : Promise.resolve(state);
        },
        setYear(year) {
          const next = year || null;
          if (next === state.preferredYear) return inFlight || Promise.resolve(state);
          state = { ...state, preferredYear: next, loading: true };
          emit();
          return pull();
        },
        refresh,
        pull,
      };
    }

    const store = createStore();

    /**
     * 版本 / 升级 store：与活动数据分开，只在需要时拉取（打开面板、点检测更新），
     * 避免每次 20s 轮询都多打一次无关请求；升级进行中则自动加快轮询以便看到结果。
     */
    function createMetaStore() {
      const api = (p) => window.location.origin + p;
      let state = { meta: null, checking: false, upgrading: false, error: '', notice: '' };
      const listeners = new Set();
      const emit = () => { for (const fn of Array.from(listeners)) { try { fn() } catch (e) { /* ignore */ } } };
      let inFlight = null;
      let timer = null;

      function load() {
        if (inFlight) return inFlight;
        inFlight = (async () => {
          try {
            const res = await fetch(api('/activity/meta'), { headers: { accept: 'application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const meta = await res.json();
            state = { ...state, meta, error: '' };
          } catch (err) {
            state = { ...state, error: String((err && err.message) || err) };
          } finally {
            inFlight = null;
            emit();
          }
          return state;
        })();
        return inFlight;
      }

      async function post(path, patch) {
        state = { ...state, ...patch, notice: '' };
        emit();
        try {
          const res = await fetch(api(path), { method: 'POST', headers: { accept: 'application/json' } });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const meta = await res.json();
          state = { ...state, meta, error: '', notice: (meta && meta.upgrade && meta.upgrade.message) || '' };
        } catch (err) {
          state = { ...state, error: String((err && err.message) || err) };
        } finally {
          state = { ...state, checking: false, upgrading: false };
          emit();
        }
        return state;
      }

      return {
        getState: () => state,
        subscribe(fn) { listeners.add(fn); schedule(); return () => listeners.delete(fn); },
        load,
        /** 手动检测更新：强制查一次 registry（忽略 host 的 6h 周期） */
        check: () => { state = { ...state, checking: true }; return post('/activity/check-update', {}); },
        /** 执行在线升级；本地 link/file 安装会被 host 拒绝并在 notice 里说明 */
        upgrade: () => { state = { ...state, upgrading: true }; return post('/activity/upgrade', {}); },
        dismissNotice: () => { state = { ...state, notice: '' }; emit(); },
      };

      function schedule() {
        if (timer) return;
        const tick = () => {
          // 升级进行中 3s 一次（等结果），否则 5 分钟一次（保持 updateAvailable 新鲜）
          const busy = state.upgrading || (state.meta && state.meta.upgrade && state.meta.upgrade.running);
          void load();
          timer = setTimeout(tick, busy ? 3000 : 300000);
        };
        timer = setTimeout(tick, state.meta ? 300000 : 5000);
      }
    }

    const metaStore = createMetaStore();
    function useMetaStore() {
      const [snapshot, setSnapshot] = React.useState(metaStore.getState());
      React.useEffect(() => metaStore.subscribe(() => setSnapshot(metaStore.getState())), []);
      return snapshot;
    }

    /**
     * 订阅 store：快照对象引用变化才 setState。
     * 若这里用「计数器 +1」强制重渲染，emit 后 setState 会让宿主重渲染，宿主里
     * `useEffect(..., [open])` 依赖没变不会重跑，但任何依赖数组缺失的 effect
     * （或父级重渲染）会再次 emit，从而形成渲染循环——引用比较天然避免这一点。
     */
    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store.getState());
      React.useEffect(() => store.subscribe(() => setSnapshot(store.getState())), []);
      return snapshot;
    }

    // ==================== 小组件 ====================

    function HeatCell(props) {
      const { day, rec, isToday, size, onHover } = props;
      const ref = React.useRef(null);

      if (!day) {
        return React.createElement('div', { className: 'daa-cell daa-cell-pad', style: { width: size, height: size } });
      }
      const level = levelOfDay(rec);
      const cls = 'daa-cell daa-l' + level + (isToday ? ' daa-today' : '');
      const onEnter = () => {
        const el = ref.current;
        if (!el || !onHover) return;
        const r = el.getBoundingClientRect();
        onHover({ x: r.left + r.width / 2, y: r.top, day, rec });
      };
      return React.createElement('div', {
        ref,
        className: cls,
        style: { width: size, height: size },
        onMouseEnter: onEnter,
        onMouseLeave: () => { if (onHover) onHover(null); },
        'aria-label': day + (rec ? ' 活跃 ' + (rec.turns || 0) + ' 轮' : ' 未活跃'),
      });
    }

    function CellTip({ tip }) {
      const { day, rec, x, y } = tip;
      const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
      const head = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAY_NAMES[weekdayOf(day)];
      const rows = rec
        ? [
            ['活跃等级', (FALLBACK_LEVELS[levelOfDay(rec)] || {}).label || '—'],
            ['轮次', fmtInt(rec.turns)],
            ['工具调用', fmtInt(rec.toolCalls)],
            ['Token', fmtCompact(rec.tokens) + '（' + fmtCompact(rec.inputTokens) + ' 入 / ' + fmtCompact(rec.outputTokens) + ' 出）'],
            ['涉及会话', fmtInt(rec.activeSessions)],
          ]
        : [['状态', '未活跃']];
      // 贴近单元格上方，但不越出视口
      const top = Math.max(8, Math.round(y) - 8);
      const left = Math.min(Math.max(Math.round(x), 110), Math.max(110, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 110));
      const style = { left: left + 'px', top: top + 'px', zIndex: 20 };
      return React.createElement('div', { className: 'daa-tip', style },
        React.createElement('div', { className: 'daa-tip-head' }, head),
        rows.map(([k, v]) => React.createElement('div', { className: 'daa-tip-row', key: k },
          React.createElement('span', { className: 'daa-tip-k' }, k),
          React.createElement('span', { className: 'daa-tip-v' }, v))));
    }

    function Legend({ levels }) {
      const list = levels && levels.length ? levels : FALLBACK_LEVELS;
      return React.createElement('div', { className: 'daa-legend' },
        React.createElement('span', { className: 'daa-legend-cap' }, '未活跃'),
        list.map((l) => React.createElement('span', {
          key: l.level,
          className: 'daa-legend-cell daa-l' + l.level,
          title: l.level === 0 ? '未活跃' : l.label + '（' + (l.max == null ? l.min + '+ 轮' : l.min === l.max ? l.min + ' 轮' : l.min + '-' + l.max + ' 轮') + '）',
        })),
        React.createElement('span', { className: 'daa-legend-cap' }, '活跃'));
    }

    function YearSwitch({ years, year, onPick, currentYear, onClose }) {
      const idx = years.indexOf(year);
      const hasPrev = idx > 0;
      const hasNext = idx >= 0 && idx < years.length - 1;
      const [open, setOpen] = React.useState(false);
      return React.createElement('div', { className: 'daa-year' },
        React.createElement('button', {
          type: 'button', className: 'daa-year-btn', disabled: !hasPrev,
          title: hasPrev ? '上一年 ' + years[idx - 1] : '没有更早的记录',
          onClick: () => hasPrev && onPick(years[idx - 1]),
        }, '‹'),
        React.createElement('button', {
          type: 'button', className: 'daa-year-cur' + (year === currentYear ? ' daa-year-now' : ''),
          title: years.length > 1 ? '切换年份' : '仅记录到这一年',
          onClick: () => years.length > 1 && setOpen(!open),
        },
          React.createElement('span', null, year + ' 年'),
          years.length > 1 ? React.createElement('span', { className: 'daa-year-caret' }, '▾') : null),
        React.createElement('button', {
          type: 'button', className: 'daa-year-btn', disabled: !hasNext,
          title: hasNext ? '下一年 ' + years[idx + 1] : '已经是最新的一年',
          onClick: () => hasNext && onPick(years[idx + 1]),
        }, '›'),
        open ? React.createElement('div', { className: 'daa-year-menu' },
          years.map((y) => React.createElement('button', {
            key: y, type: 'button',
            className: 'daa-year-item' + (y === year ? ' on' : ''),
            onClick: () => { setOpen(false); onPick(y); },
          }, y + ' 年', y === currentYear ? React.createElement('span', { className: 'daa-year-badge' }, '今年') : null))) : null,
        React.createElement('button', { type: 'button', className: 'daa-close', title: '关闭 (Esc)', onClick: onClose }, '✕'));
    }

    function Stat(props) {
      const { value, unit, label, accent } = props;
      return React.createElement('div', { className: 'daa-stat' },
        React.createElement('span', { className: 'daa-stat-v' + (accent ? ' daa-accent' : '') }, value, unit ? React.createElement('span', null, ' ' + unit) : null),
        React.createElement('span', { className: 'daa-stat-l' }, label));
    }

    // ==================== 面板 ====================

    function ActivityPanel(props) {
      const { onClose, summary } = props;
      const state = useStore();
      const data = state.data;
      const today = (data && data.today) || todayKey();

      const years = (data && data.years && data.years.length ? data.years : [Number(today.slice(0, 4))]).slice();
      const hostYear = (data && data.currentYear) || Number(today.slice(0, 4));
      const [year, setYear] = React.useState(() => {
        try {
          const saved = Number(localStorage.getItem(LS_YEAR));
          if (saved >= 1970) return saved;
        } catch (e) { /* ignore */ }
        return hostYear;
      });
      // 用户选的年份若 host 尚未返回该年数据，则回落到 host 的当前年
      const shownYear = years.indexOf(year) >= 0 ? year : hostYear;
      const stats = (data && data.yearStats && data.yearStats[shownYear]) || null;

      React.useEffect(() => {
        try { localStorage.setItem(LS_YEAR, String(shownYear)); } catch (e) { /* ignore */ }
      }, [shownYear]);

      // 首开时若本地记住的年份不是 host 的当前年，按该年拉一次（host 只回该年明细）
      const firstPull = React.useRef(true);
      React.useEffect(() => {
        if (!data) return;
        if (firstPull.current) {
          firstPull.current = false;
          if (year !== hostYear && years.indexOf(year) >= 0) store.setYear(year);
        }
      }, [data, hostYear, year, years]);

      React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);

      const weeks = React.useMemo(() => buildWeeks(shownYear), [shownYear]);
      const labels = React.useMemo(() => monthLabels(weeks), [weeks]);
      const byDay = React.useMemo(() => indexDays(data), [data]);

      const levels = (data && data.levels) || FALLBACK_LEVELS;
      const gridStyle = { '--daa-cols': String(weeks.length) };
      const pickYear = (y) => { setYear(y); store.setYear(y); };
      // 悬浮明细提到面板层级：避免每个格子各自挂一个 fixed 提示（同时只可能出现一个）
      const [tip, setTip] = React.useState(null);
      // 设置/升级抽屉：开合状态持久化，避免每次打开面板都要重新点一次
      const [gear, setGear] = React.useState(() => {
        try { return localStorage.getItem(LS_GEAR) === '1' } catch (e) { return false }
      });
      const metaState = useMetaStore();
      React.useEffect(() => {
        try { localStorage.setItem(LS_GEAR, gear ? '1' : '0') } catch (e) { /* ignore */ }
      }, [gear]);
      // 面板打开即刷新一次版本信息（保持「有新版本」提示及时）
      React.useEffect(() => { void metaStore.load() }, []);

      const stats0 = stats || { activeDays: 0, totalDays: daysInYear(shownYear), rate: 0, weekStreak: 0, longestDayStreak: 0, longestWeekStreak: 0 };

      return React.createElement('div', {
        className: 'daa-backdrop',
        // 内联层级：这一层是 portal 宿主里唯一的直接子元素，层级写死避免被宿主样式覆盖
        style: { zIndex: Z_PORTAL },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
      },
        React.createElement('div', { className: 'daa-card', role: 'dialog', 'aria-label': summary || '全年活跃记录' },
          // ---- 头部 ----
          React.createElement('div', { className: 'daa-head' },
            React.createElement('div', { className: 'daa-head-l' },
              React.createElement('span', { className: 'daa-title' }, '全年活跃记录'),
              React.createElement('span', { className: 'daa-sub' },
                fmtInt(stats0.activeDays) + ' 天活跃 · 活跃率 ' + fmtPercent(stats0.rate))),
            React.createElement('div', { className: 'daa-head-r' },
              YearSwitch({ years, year: shownYear, onPick: pickYear, currentYear: hostYear, onClose }))),

          // ---- 统计行 + 图例 ----
          React.createElement('div', { className: 'daa-toolbar' },
            React.createElement('div', { className: 'daa-stats' },
              React.createElement(Stat, { value: fmtInt(stats0.activeDays), unit: '天', label: '活跃' }),
              React.createElement(Stat, { value: fmtPercent(stats0.rate), label: '活跃率', accent: true }),
              React.createElement(Stat, { value: fmtInt(stats0.weekStreak), unit: '周', label: '连登' }),
              React.createElement(Stat, { value: fmtInt(stats0.longestDayStreak), unit: '天', label: '最长连续' })),
            React.createElement(Legend, { levels })),

          // ---- 月份轴 + 热力图 ----
          React.createElement('div', { className: 'daa-heat' },
            React.createElement('div', { className: 'daa-months', style: gridStyle },
              labels.map((l, i) => React.createElement('span', { key: i, className: 'daa-month' }, l || ''))),
            React.createElement('div', { className: 'daa-grid', style: gridStyle },
              weeks.map((week, ci) => React.createElement('div', { className: 'daa-col', key: ci },
                week.map((day, ri) => React.createElement(HeatCell, {
                  key: ri, day, rec: day ? byDay[day] : null, size: 11, isToday: day === today, onHover: setTip,
                })))))),

          // ---- 底部 ----
          React.createElement('div', { className: 'daa-foot' },
            React.createElement('span', { className: 'daa-foot-txt' },
              '数据更新于 ' + fmtClock(data && data.scannedAt) + ' · 每 20 秒自动刷新 · 本机 ' + ((data && data.timeZone) || '本地时区') + ' 自然日口径'),
            React.createElement('span', { className: 'daa-foot-txt daa-foot-right' },
              data && data.totalTurns ? ('累计 ' + fmtInt(data.totalTurns) + ' 轮 · ' + fmtCompact(data.totalTokens) + ' tokens · ' + fmtInt(data.sessionCount) + ' 个会话') : ''),
            React.createElement('button', {
              type: 'button', className: 'daa-refresh' + (state.loading ? ' spin' : ''),
              title: '重新扫描本机会话',
              onClick: () => store.refresh(),
            }, '⟳'),
            React.createElement('button', {
              type: 'button',
              className: 'daa-refresh' + (gear ? ' gear-on' : '') + (metaState.meta && metaState.meta.updateAvailable ? ' has-update' : ''),
              title: metaState.meta && metaState.meta.updateAvailable ? '有新版本 v' + metaState.meta.latest + '（点此查看/升级）' : '设置与版本',
              onClick: () => setGear(!gear),
            }, '⚙')),
          gear ? React.createElement(SetupPanel, {
            onClose: () => setGear(false),
            metaState,
            onLoad: () => metaStore.load(),
          }) : null,
          state.error ? React.createElement('div', { className: 'daa-error' }, 'host 未就绪：' + state.error + '（重试中…）') : null,
          !data && state.loading ? React.createElement('div', { className: 'daa-loading' }, '正在扫描本机会话历史…') : null),
        tip ? React.createElement(CellTip, { tip }) : null);
    }

    // ==================== 设置 / 版本升级抽屉 ====================

    function SetupPanel(props) {
      const { onClose, metaState, onLoad } = props;
      const meta = metaState.meta;
      const up = (meta && meta.upgrade) || {};
      const busy = metaState.upgrading || up.running;
      const updateAvailable = !!(meta && meta.updateAvailable);

      React.useEffect(() => { if (onLoad) void onLoad() }, []);

      const buttonLabel = busy ? '升级中…'
        : metaState.checking ? '检测中…'
          : updateAvailable ? '升级到 v' + meta.latest
            : '检测更新';
      const onClick = () => {
        if (busy || metaState.checking) return;
        if (updateAvailable) void metaStore.upgrade();
        else void metaStore.check();
      };

      return React.createElement('div', { className: 'daa-setup' },
        React.createElement('div', { className: 'daa-setup-head' },
          React.createElement('span', { className: 'daa-setup-title' }, '插件设置'),
          React.createElement('button', {
            type: 'button', className: 'daa-setup-close', title: '收起', onClick: onClose,
          }, '✕')),
        React.createElement('div', { className: 'daa-setup-row' },
          React.createElement('span', { className: 'daa-setup-k' }, '当前版本'),
          React.createElement('span', { className: 'daa-setup-v' }, meta ? 'v' + meta.version : (metaState.error ? '—' : '读取中…'))),
        React.createElement('div', { className: 'daa-setup-row' },
          React.createElement('span', { className: 'daa-setup-k' }, '最新版本'),
          React.createElement('span', { className: 'daa-setup-v' },
            meta && meta.latest
              ? ('v' + meta.latest + (updateAvailable ? ' · 有更新' : ' · 已是最新'))
              : (meta && meta.updateChecked ? '未发布 / 离线' : '未检测'))),
        meta && meta.localInstall ? React.createElement('div', { className: 'daa-setup-note' },
          '本地安装（' + meta.localInstall + '）：直接改源码即可，在线升级已自动跳过。') : null,
        React.createElement('div', { className: 'daa-setup-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'daa-setup-btn' + (updateAvailable ? ' primary' : ''),
            disabled: busy || metaState.checking || !meta,
            onClick,
          }, buttonLabel)),
        up.message || metaState.notice ? React.createElement('div', { className: 'daa-setup-notice' }, up.message || metaState.notice) : null,
        up.ok === 'ok' ? React.createElement('div', { className: 'daa-setup-note' }, '升级只替换安装文件：重启 dsh web（或执行 scripts/restart-web.sh）后生效。') : null,
        metaState.error ? React.createElement('div', { className: 'daa-error' }, 'host 未就绪：' + metaState.error) : null,
        React.createElement('div', { className: 'daa-setup-foot' },
          '数据全部来自本机会话日志，不联网、不上报；仅「检测更新 / 升级」会访问 npm registry。'));
    }

    // ==================== 入口（会话头部右侧，紧邻「打开右侧边栏」）====================

    function HeaderEntry() {
      const state = useStore();
      const metaState = useMetaStore();
      const [open, setOpen] = React.useState(false);
      const [tip, setTip] = React.useState(null);
      const btnRef = React.useRef(null);

      // 面板开合驱动轮询频率（打开时 20s，关闭时 3 分钟）
      React.useEffect(() => {
        store.setPanelOpen(open);
      }, [open]);

      const data = state.data;
      const byDay = React.useMemo(() => indexDays(data), [data]);
      const today = (data && data.today) || todayKey();
      const rec = byDay[today] || null;
      const curStats = data && data.yearStats ? data.yearStats[data.currentYear] : null;
      const meta = metaState.meta;
      const updateAvailable = !!(meta && meta.updateAvailable);

      const title = '全年活跃记录 (dsh-annual-activity)'
        + (data
          ? '：' + fmtInt(curStats ? curStats.activeDays : 0) + ' 天活跃 · 活跃率 ' + fmtPercent(curStats ? curStats.rate : 0)
            + ' · 今日 ' + (rec ? fmtInt(rec.turns) + ' 轮' : '未活跃')
            + (meta ? ' · v' + meta.version : '')
          : '：加载中…')
        + '（点击查看年度面板）';

      const onEnter = () => {
        const el = btnRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setTip({ x: r.left + r.width / 2, y: r.bottom, today: rec, stats: curStats });
      };

      return React.createElement('div', { className: 'daa-host' },
        React.createElement('button', {
          ref: btnRef,
          type: 'button',
          className: 'daa-hbtn' + (open ? ' on' : ''),
          'aria-label': '全年活跃记录',
          // 刻意不设原生 title：浏览器自带的提示框会浮在按钮上方并遮挡按钮，
          // 提示改由下方自绘浮层承担（EntryTip）。
          onClick: () => setOpen(!open),
          onMouseEnter: onEnter,
          onMouseLeave: () => setTip(null),
        },
          React.createElement('span', { className: 'daa-glyph', 'aria-hidden': 'true' },
            glyphCells(byDay).map((c, i) => React.createElement('span', {
              key: i, className: 'daa-glyph-cell' + (c.level < 0 ? ' daa-glyph-void' : ' daa-l' + c.level),
            }))),
          updateAvailable ? React.createElement('span', { className: 'daa-hbtn-dot', 'aria-label': '有新版本' }) : null),
        tip ? portalToBody(React.createElement(EntryTip, { tip })) : null,
        open ? portalToBody(React.createElement(ActivityPanel, { onClose: () => setOpen(false), summary: title })) : null);
    }

    /** 入口悬浮说明：固定定位在按钮**下方**（放在上方会遮住按钮与标题行）。 */
    function EntryTip({ tip }) {
      const { today: rec, stats, x, y } = tip;
      const rows = [
        ['今日', rec ? fmtInt(rec.turns) + ' 轮' : '未活跃'],
        ['今年', (stats ? fmtInt(stats.activeDays) : '0') + ' 天活跃 · ' + fmtPercent(stats ? stats.rate : 0)],
        ['连登', fmtInt(stats ? stats.weekStreak : 0) + ' 周'],
      ];
      const left = Math.min(Math.max(Math.round(x), 110), Math.max(110, window.innerWidth - 130));
      return React.createElement('div', { className: 'daa-tip daa-tip-below', style: { left: left + 'px', top: Math.round(y) + 8 + 'px', zIndex: 20 } },
        rows.map(([k, v]) => React.createElement('div', { className: 'daa-tip-row', key: k },
          React.createElement('span', { className: 'daa-tip-k' }, k),
          React.createElement('span', { className: 'daa-tip-v' }, v))));
    }

    // ==================== 样式 ====================

    const CSS = `
.daa-host{position:relative;display:flex;align-items:center;
  font-family:'Inter','PingFang SC','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif;
  color:var(--dsh-text-1,#1f2937);}
/* ---------- 头部入口按钮（对齐「打开右侧边栏」：28×28 / radius 28 / 16px 图标）
   官方按钮是纯透明底，放在标题行里太「隐形」，所以这里给一个比悬停态更浅的
   常驻底色 + 一层细边（同样是官方 token，深色主题自动跟随）。---------- */
.daa-hbtn{position:relative;box-sizing:border-box;width:28px;height:28px;flex:none;padding:6px;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
  background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));
  border:none;border-radius:28px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(0,0,0,.10));
  color:var(--dsw-alias-label-secondary,#4b5563);
  transition:background .14s ease,color .14s ease,box-shadow .14s ease;}
.daa-hbtn:hover{background:var(--dsw-alias-interactive-bg-active,rgba(38,49,72,.10));
  box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3,rgba(0,0,0,.16));
  color:var(--dsw-alias-label-primary,#111827);}
.daa-hbtn.on{background:var(--dsw-alias-interactive-bg-active,rgba(38,49,72,.10));
  box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3,rgba(0,0,0,.16));
  color:var(--dsw-alias-label-primary,#111827);}
.daa-glyph{display:grid;grid-template-columns:repeat(7,2px);grid-template-rows:repeat(2,2px);gap:1px;}
.daa-glyph-cell{width:2px;height:2px;border-radius:.5px;}
.daa-glyph-void{background:transparent;}
.daa-hbtn-dot{position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:50%;
  background:var(--dsw-alias-state-business-primary,#f59e0b);
  box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#fff);}
/* 入口悬浮说明：贴在按钮下方（放在上方会盖住按钮本身与会话标题） */
.daa-tip-below{transform:translate(-50%,0);}
/* portal 宿主：铺满视口但不拦截事件（子元素各自开启 pointer-events）；
   层级用 JS 内联写死，避免被宿主的样式表覆盖。 */
.daa-portal{position:fixed;inset:0;pointer-events:none;}
.daa-tip-below::before{content:'';position:absolute;left:50%;top:-4px;width:8px;height:8px;
  margin-left:-4px;transform:rotate(45deg);background:inherit;
  border-left:1px solid var(--dsh-border,#e5e7eb);border-top:1px solid var(--dsh-border,#e5e7eb);
  border-top-left-radius:2px;}
/* ---------- 遮罩 + 卡片 ---------- */
.daa-backdrop{position:fixed;inset:0;pointer-events:auto;background:rgba(15,23,42,.42);
  display:flex;align-items:center;justify-content:center;padding:24px;animation:daa-fade .14s ease-out;}
@keyframes daa-fade{from{opacity:0}to{opacity:1}}
.daa-card{position:relative;width:min(828px,calc(100vw - 40px));max-height:calc(100vh - 48px);overflow:auto;
  background:var(--dsh-surface-1,#fff);border:1px solid var(--dsh-border,#e8eaee);border-radius:14px;
  box-shadow:0 24px 64px rgba(15,23,42,.26);padding:16px 20px 12px;
  animation:daa-pop .16s cubic-bezier(.2,.9,.3,1.2);}
@keyframes daa-pop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
/* ---------- 头部 ---------- */
.daa-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;}
.daa-head-l{display:flex;align-items:baseline;gap:8px;min-width:0;}
.daa-title{font-size:16px;font-weight:600;letter-spacing:.2px;color:var(--dsh-text-1,#111827);white-space:nowrap;}
.daa-sub{font-size:12px;color:var(--dsh-text-3,#9aa1ab);white-space:nowrap;}
.daa-head-r{display:flex;align-items:center;gap:8px;}
.daa-year{position:relative;display:flex;align-items:center;gap:2px;}
.daa-year-btn{width:24px;height:24px;border-radius:7px;border:1px solid var(--dsh-border,#e5e7eb);
  background:var(--dsh-surface-1,#fff);color:var(--dsh-text-2,#4b5563);cursor:pointer;font-size:14px;line-height:1;
  display:flex;align-items:center;justify-content:center;padding:0;}
.daa-year-btn:hover:not(:disabled){background:var(--dsh-surface-2,#f3f4f6);color:var(--dsh-text-1,#111827);}
.daa-year-btn:disabled{opacity:.35;cursor:default;}
.daa-year-cur{height:24px;padding:0 9px;border-radius:7px;border:1px solid var(--dsh-border,#e5e7eb);
  background:var(--dsh-surface-1,#fff);color:var(--dsh-text-1,#111827);cursor:pointer;font-size:12.5px;font-weight:600;
  display:flex;align-items:center;gap:5px;}
.daa-year-cur:hover{background:var(--dsh-surface-2,#f3f4f6);}
.daa-year-now{color:#15803d;border-color:#bbe3c6;}
.daa-year-caret{font-size:9px;color:var(--dsh-text-3,#9aa1ab);}
.daa-year-menu{position:absolute;top:28px;right:0;z-index:5;min-width:104px;padding:4px;border-radius:10px;
  background:var(--dsh-surface-1,#fff);border:1px solid var(--dsh-border,#e5e7eb);box-shadow:0 10px 28px rgba(15,23,42,.16);
  display:flex;flex-direction:column;gap:2px;}
.daa-year-item{display:flex;align-items:center;justify-content:space-between;gap:8px;height:26px;padding:0 8px;
  border:0;border-radius:7px;background:transparent;color:var(--dsh-text-2,#4b5563);cursor:pointer;font-size:12.5px;text-align:left;}
.daa-year-item:hover{background:var(--dsh-surface-2,#f3f4f6);color:var(--dsh-text-1,#111827);}
.daa-year-item.on{color:#15803d;font-weight:600;}
.daa-year-badge{font-size:10px;color:#15803d;background:#e8f6ec;border-radius:5px;padding:1px 4px;}
.daa-close{width:24px;height:24px;border-radius:999px;border:1px solid var(--dsh-border,#e5e7eb);
  background:var(--dsh-surface-1,#fff);color:var(--dsh-text-3,#9aa1ab);cursor:pointer;font-size:11px;line-height:1;
  display:flex;align-items:center;justify-content:center;padding:0;margin-left:2px;}
.daa-close:hover{background:var(--dsh-surface-2,#f3f4f6);color:var(--dsh-text-1,#111827);}
/* ---------- 统计行 + 图例 ---------- */
.daa-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;}
.daa-stats{display:flex;align-items:baseline;gap:22px;}
.daa-stat{display:flex;align-items:baseline;gap:5px;}
.daa-stat-v{font-size:15px;font-weight:700;color:var(--dsh-text-1,#111827);letter-spacing:.2px;}
.daa-stat-v.daa-accent{color:#16a34a;}
.daa-stat-l{font-size:12.5px;color:var(--dsh-text-3,#9aa1ab);}
.daa-legend{display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dsh-text-3,#9aa1ab);}
.daa-legend-cap{padding:0 3px;}
.daa-legend-cell{width:11px;height:11px;border-radius:3px;display:inline-block;}
/* ---------- 热力图 ---------- */
.daa-heat{overflow-x:auto;overflow-y:hidden;padding-bottom:2px;}
.daa-months{display:grid;grid-template-columns:repeat(var(--daa-cols,53),11px);gap:3px;margin-bottom:6px;min-width:max-content;}
.daa-month{font-size:11.5px;color:var(--dsh-text-3,#9aa1ab);white-space:nowrap;line-height:1;overflow:visible;}
.daa-grid{display:grid;grid-template-columns:repeat(var(--daa-cols,53),11px);gap:3px;min-width:max-content;}
.daa-col{display:flex;flex-direction:column;gap:3px;}
.daa-cell{border-radius:3px;position:relative;background:#eef0f2;transition:transform .1s ease,box-shadow .1s ease;}
.daa-cell-pad{background:transparent;}
.daa-cell:not(.daa-cell-pad):hover{transform:scale(1.18);box-shadow:0 0 0 1.5px rgba(22,163,74,.45);}
.daa-today{box-shadow:inset 0 0 0 1.5px #16a34a;}
/* 5 级色块：0 未活跃 → 4 极高（GitHub 风格绿色梯度） */
.daa-l0{background:#eef0f2;}
.daa-l1{background:#c6e8cf;}
.daa-l2{background:#7fce97;}
.daa-l3{background:#34a853;}
.daa-l4{background:#0f7a37;}
/* ---------- 悬浮明细 ---------- */
.daa-tip{position:fixed;transform:translate(-50%,-100%);z-index:20;pointer-events:none;
  background:var(--dsh-surface-1,#fff);border:1px solid var(--dsh-border,#e5e7eb);border-radius:9px;
  box-shadow:0 8px 26px rgba(15,23,42,.18);padding:8px 10px;min-width:184px;}
.daa-tip-head{font-size:12px;font-weight:600;color:var(--dsh-text-1,#111827);margin-bottom:5px;}
.daa-tip-row{display:flex;justify-content:space-between;gap:12px;font-size:11.5px;line-height:1.7;}
.daa-tip-k{color:var(--dsh-text-3,#9aa1ab);}
.daa-tip-v{color:var(--dsh-text-1,#111827);font-variant-numeric:tabular-nums;}
/* ---------- 底部 ---------- */
.daa-foot{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:9px;
  border-top:1px solid var(--dsh-border,#f0f1f3);font-size:11.5px;color:var(--dsh-text-3,#9aa1ab);}
.daa-foot-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.daa-foot-right{margin-left:auto;text-align:right;}
.daa-refresh{flex:none;width:22px;height:22px;border-radius:6px;border:1px solid var(--dsh-border,#e5e7eb);
  background:var(--dsh-surface-1,#fff);color:var(--dsh-text-3,#9aa1ab);cursor:pointer;font-size:12px;line-height:1;
  display:flex;align-items:center;justify-content:center;padding:0;}
.daa-refresh:hover{background:var(--dsh-surface-2,#f3f4f6);color:var(--dsh-text-1,#111827);}
.daa-refresh.spin{animation:daa-spin 1s linear infinite;}
@keyframes daa-spin{to{transform:rotate(360deg)}}
.daa-refresh.gear-on{background:var(--dsh-surface-2,#f3f4f6);color:var(--dsh-text-1,#111827);}
.daa-refresh.has-update{color:var(--dsw-alias-state-business-primary,#f59e0b);border-color:currentColor;}
/* ---------- 设置 / 版本升级抽屉 ---------- */
.daa-setup{margin-top:10px;padding:11px 12px;border:1px solid var(--dsh-border,#e8eaee);border-radius:10px;
  background:var(--dsh-surface-2,#fafbfc);}
.daa-setup-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.daa-setup-title{font-size:12.5px;font-weight:600;color:var(--dsh-text-1,#111827);}
.daa-setup-close{width:20px;height:20px;border-radius:6px;border:1px solid transparent;background:transparent;
  color:var(--dsh-text-3,#9aa1ab);cursor:pointer;font-size:10px;line-height:1;padding:0;
  display:flex;align-items:center;justify-content:center;}
.daa-setup-close:hover{background:var(--dsh-surface-1,#fff);border-color:var(--dsh-border,#e5e7eb);color:var(--dsh-text-1,#111827);}
.daa-setup-row{display:flex;justify-content:space-between;gap:12px;font-size:12px;line-height:1.9;}
.daa-setup-k{color:var(--dsh-text-3,#9aa1ab);}
.daa-setup-v{color:var(--dsh-text-1,#111827);font-variant-numeric:tabular-nums;}
.daa-setup-actions{display:flex;gap:8px;margin-top:9px;}
.daa-setup-btn{height:26px;padding:0 12px;border-radius:8px;cursor:pointer;font-size:12px;
  border:1px solid var(--dsh-border,#e5e7eb);background:var(--dsh-surface-1,#fff);color:var(--dsh-text-2,#4b5563);}
.daa-setup-btn:hover:not(:disabled){background:var(--dsh-surface-2,#f3f4f6);color:var(--dsh-text-1,#111827);}
.daa-setup-btn:disabled{opacity:.55;cursor:default;}
.daa-setup-btn.primary{border-color:transparent;background:#16a34a;color:#fff;}
.daa-setup-btn.primary:hover:not(:disabled){background:#15803d;color:#fff;}
.daa-setup-notice{margin-top:8px;font-size:11.5px;line-height:1.6;color:var(--dsh-text-2,#4b5563);
  background:var(--dsh-surface-1,#fff);border:1px solid var(--dsh-border,#e8eaee);border-radius:8px;padding:6px 9px;}
.daa-setup-note{margin-top:7px;font-size:11.5px;line-height:1.6;color:var(--dsh-text-3,#9aa1ab);}
.daa-setup-foot{margin-top:8px;padding-top:7px;border-top:1px solid var(--dsh-border,#eef0f2);
  font-size:11px;line-height:1.6;color:var(--dsh-text-3,#9aa1ab);}
.daa-error{margin-top:8px;font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 9px;}
.daa-loading{margin-top:10px;font-size:12px;color:var(--dsh-text-3,#9aa1ab);}
/* 深色主题兜底（DSH 未提供变量时按 prefers-color-scheme 走） */
@media (prefers-color-scheme:dark){
  .daa-host{color:var(--dsh-text-1,#e5e7eb);}
  .daa-card,.daa-year-cur,.daa-year-btn,.daa-close,.daa-refresh,.daa-tip,.daa-year-menu,
  .daa-setup-btn,.daa-setup-notice{
    background:var(--dsh-surface-1,#1b1e24);border-color:var(--dsh-border,#2f343d);}
  .daa-setup{background:var(--dsh-surface-2,#171a1f);border-color:var(--dsh-border,#2f343d);}
  .daa-hbtn-dot{box-shadow:0 0 0 1.5px var(--dsh-surface-1,#1b1e24);}
  .daa-l0{background:#2a2f37;}
  .daa-foot,.daa-toolbar,.daa-setup-foot{border-color:var(--dsh-border,#2f343d);}
  .daa-error{background:#3a2a12;border-color:#7c5310;color:#fbbf24;}
}
`;

    // ==================== 注册 ====================

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;

      // 注入样式（随插件卸载自动移除）：返回值才是清理函数
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-plugin", "dsh-annual-activity");
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);

      // portal 宿主随插件卸载一并移除（portal 出去的内容不在 React 树上，
      // 卸载时槽位卸载会清掉内容，但宿主 div 会留下空壳，这里显式回收）。
      const disposePortal = () => {
        try { if (portalHost && portalHost.remove) portalHost.remove(); } catch (e) { /* ignore */ }
        portalHost = null;
      };
      ctx.effect(() => () => {
        try { styleEl.remove(); } catch (e) { /* ignore */ }
        disposePortal();
      });

      // 注册到会话头部右侧「utility」列表槽：该槽在 DOM 中先于右上角
      // corner 槽（「打开右侧边栏」按钮所在处）渲染，所以这个入口会落在
      // 那个按钮的左边、同一行内。按钮尺寸/圆角/色板都与 corner 里的
      // 官方按钮保持一致（28×28、图标 16px、interactive-bg-hover 悬停底色）。
      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'annual-activity', order: 50 },
        () => React.createElement(HeaderEntry, null)
      ));
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.__internal = { buildWeeks, monthLabels, fmtPercent, fmtCompact, levelOfDay, indexDays, glyphCells, FALLBACK_LEVELS, store, metaStore };
    return module.exports;
  }
});
