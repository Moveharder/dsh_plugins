window.__ModuleLoader__.load({
  id: "dsh-whale-copilot",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const name = "dsh-whale-copilot";
    const inject = [];

    // ---- 插件 logo：dsh-dock 的鲸鱼剪影（base64 内嵌，随 bundle 一起加载，无额外请求）----
    const WHALE_LOGO =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iNTAuMDAwMDAwIiBoZWlnaHQ9IjUwLjAwMDAwMCIgdmlld0JveD0iMCAwIDUwIDUwIiBmaWxsPSJub25lIj4KCTxwYXRoIGlkPSJwYXRoIiBkPSJNNDguODM1NCAxMC4wNDc5QzQ4LjMyMzIgOS43OTE5OSA0OC4xMDI1IDEwLjI3OTggNDcuODAzMiAxMC41Mjc4QzQ3LjcwMDcgMTAuNjA3OSA0Ny42MTQzIDEwLjcxMTkgNDcuNTI3MyAxMC44MDc2QzQ2Ljc3OTMgMTEuNjI0IDQ1LjkwNDggMTIuMTU5NyA0NC43NjIyIDEyLjA5NTdDNDMuMDkyMyAxMiA0MS42NjYgMTIuNTM1NiA0MC40MDU4IDEzLjgzOThDNDAuMTM3NyAxMi4yMzE5IDM5LjI0NzYgMTEuMjcyIDM3Ljg5MjYgMTAuNjU1OEMzNy4xODM2IDEwLjMzNTkgMzYuNDY2OCAxMC4wMTU2IDM1Ljk3MDIgOS4zMTk4MkMzNS42MjM1IDguODIzNzMgMzUuNTI5MyA4LjI3MTk3IDM1LjM1NiA3LjcyNzU0QzM1LjI0NTYgNy4zOTk5IDM1LjEzNTMgNy4wNjM5NiAzNC43NjUxIDcuMDA3ODFDMzQuMzYzMyA2Ljk0Mzg1IDM0LjIwNTYgNy4yODc2IDM0LjA0NzkgNy41NzU2OEMzMy40MTggOC43NTE5NSAzMy4xNzMzIDEwLjA0NzkgMzMuMTk3MyAxMS4zNTk5QzMzLjI1MjQgMTQuMzEyIDM0LjQ3MzYgMTYuNjY0MSAzNi44OTk5IDE4LjMzNTlDMzcuMTc1OCAxOC41Mjc4IDM3LjI0NjYgMTguNzE5NyAzNy4xNTk3IDE5QzM2Ljk5NDYgMTkuNTc1NyAzNi43OTc0IDIwLjEzNTcgMzYuNjI0IDIwLjcxMTlDMzYuNTEzNyAyMS4wODAxIDM2LjM0ODYgMjEuMTU5NyAzNS45NjI0IDIxQzM0LjYzMDkgMjAuNDMyMSAzMy40ODEgMTkuNTkxOCAzMi40NjQ0IDE4LjU3NTdDMzAuNzM5MyAxNi44NzIxIDI5LjE3OTIgMTQuOTkxNyAyNy4yMzM0IDEzLjUyQzI2Ljc3NjQgMTMuMTc1OCAyNi4zMTkzIDEyLjg1NiAyNS44NDY3IDEyLjU1MThDMjMuODYxOCAxMC41ODQgMjYuMTA2OSA4Ljk2Nzc3IDI2LjYyNyA4Ljc3NTg4QzI3LjE3MDQgOC41NzU2OCAyNi44MTU5IDcuODg3NyAyNS4wNTkxIDcuODk2QzIzLjMwMjIgNy45MDM4MSAyMS42OTUzIDguNTAzOTEgMTkuNjQ3IDkuMzAzNzFDMTkuMzQ3NyA5LjQyMzgzIDE5LjAzMjIgOS41MTE3MiAxOC43MDk1IDkuNTgzOThDMTYuODUwMSA5LjIyMzYzIDE0LjkxOTkgOS4xNDM1NSAxMi45MDMzIDkuMzc1OThDOS4xMDU5NiA5LjgwNzYyIDYuMDcyNzUgMTEuNjM5NiAzLjg0MzI2IDE0Ljc2ODFDMS4xNjQ1NSAxOC41Mjc4IDAuNTM0MTggMjIuNzk5OCAxLjMwNjY0IDI3LjI1NTlDMi4xMTc2OCAzMS45NTIxIDQuNDY1ODIgMzUuODM5OCA4LjA3MzczIDM4Ljg3OTlDMTEuODE1OSA0Mi4wMzIyIDE2LjEyNTUgNDMuNTc2MiAyMS4wNDEgNDMuMjgwM0MyNC4wMjY5IDQzLjEwNCAyNy4zNTE2IDQyLjY5NjMgMzEuMTAxNiAzOS40NTYxQzMyLjA0NjkgMzkuOTM2IDMzLjAzOTYgNDAuMTI3OSAzNC42ODYgNDAuMjcyQzM1Ljk1NDYgNDAuMzkyMSAzNy4xNzU4IDQwLjIwOCAzOC4xMjExIDQwLjAwNzhDMzkuNjAyMSAzOS42ODggMzkuNDk5NSAzOC4yODgxIDM4Ljk2MzkgMzguMDMyMkMzNC42MjMgMzUuOTY3OCAzNS41NzYyIDM2LjgwODEgMzQuNzEgMzYuMTI3OUMzNi45MTU1IDMzLjQ2MzkgNDAuMjQwMiAzMC42OTU4IDQxLjU0IDIxLjcyOEM0MS42NDI2IDIxLjAxNjEgNDEuNTU1NyAyMC41Njc5IDQxLjU0IDE5Ljk5MTdDNDEuNTMyMiAxOS42Mzk2IDQxLjYxMDggMTkuNTAzOSA0Mi4wMDQ5IDE5LjQ2MzlDNDMuMDkyMyAxOS4zMzU5IDQ0LjE0NzkgMTkuMDMxNyA0NS4xMTY3IDE4LjQ4NzhDNDcuOTI5MiAxNi45MTk5IDQ5LjA2NCAxNC4zNDM4IDQ5LjMzMTUgMTEuMjU1OUM0OS4zNzExIDEwLjc4MzcgNDkuMzIzNyAxMC4yOTU5IDQ4LjgzNTQgMTAuMDQ3OVpNMjQuMzI2MiAzNy44Mzk4QzIwLjExOTYgMzQuNDYzOSAxOC4wNzkxIDMzLjM1MjEgMTcuMjM1OCAzMy4zOTk5QzE2LjQ0ODIgMzMuNDQ4MiAxNi41ODk4IDM0LjM2ODIgMTYuNzYzMiAzNC45Njc4QzE2Ljk0NDMgMzUuNTYwMSAxNy4xODEyIDM1Ljk2ODMgMTcuNTExNyAzNi40ODc4QzE3Ljc0MDIgMzYuODMyIDE3Ljg5NzkgMzcuMzQ0MiAxNy4yODMyIDM3LjcyOEMxNS45MjgyIDM4LjU4NCAxMy41NzI4IDM3LjQzOTkgMTMuNDYyNCAzNy4zODM4QzEwLjcyMDcgMzUuNzM1OCA4LjQyODIyIDMzLjU2MDEgNi44MTM0OCAzMC41ODRDNS4yNTM0MiAyNy43MTk3IDQuMzQ3NjYgMjQuNjQ3OSA0LjE5Nzc1IDIxLjM2NzdDNC4xNTgyIDIwLjU3NTcgNC4zODY3MiAyMC4yOTU5IDUuMTU4NjkgMjAuMTUxOUM2LjE3NTI5IDE5Ljk2IDcuMjIzMTQgMTkuOTE5OSA4LjIzOTI2IDIwLjA3MThDMTIuNTMyNyAyMC43MTE5IDE2LjE4ODUgMjIuNjcxOSAxOS4yNTI5IDI1Ljc3NTlDMjEuMDAyIDI3LjU0MzkgMjIuMzI1MiAyOS42NTU4IDIzLjY4ODUgMzEuNzIwMkMyNS4xMzc3IDMzLjkxMjEgMjYuNjk3OCAzNiAyOC42ODMxIDM3LjcxMTlDMjkuMzg0MyAzOC4zMTIgMjkuOTQzNCAzOC43NjgxIDMwLjQ3OSAzOS4xMDRDMjguODY0MyAzOS4yODgxIDI2LjE2OTkgMzkuMzI4MSAyNC4zMjYyIDM3LjgzOThaTTI2LjM0MzMgMjQuNjAwMUMyNi4zNDMzIDI0LjI0OCAyNi42MTkxIDIzLjk2NzggMjYuOTY1OCAyMy45Njc4QzI3LjA0NDQgMjMuOTY3OCAyNy4xMTUyIDIzLjk4MzkgMjcuMTc4MiAyNC4wMDc4QzI3LjI2NTEgMjQuMDQgMjcuMzQzOCAyNC4wODc5IDI3LjQwNjcgMjQuMTYwMkMyNy41MTcxIDI0LjI3MiAyNy41ODAxIDI0LjQzMjEgMjcuNTgwMSAyNC42MDAxQzI3LjU4MDEgMjQuOTUyMSAyNy4zMDQyIDI1LjIzMTkgMjYuOTU3NSAyNS4yMzE5QzI2LjYxMDggMjUuMjMxOSAyNi4zNDMzIDI0Ljk1MjEgMjYuMzQzMyAyNC42MDAxWk0zMi42MDY0IDI3Ljg3OTlDMzIuMjA0NiAyOC4wNDc5IDMxLjgwMjcgMjguMTkxOSAzMS40MTY1IDI4LjIwOEMzMC44MTc5IDI4LjIzOTcgMzAuMTY0MSAyNy45OTIyIDI5LjgwOTYgMjcuNjg4QzI5LjI1ODMgMjcuMjE1OCAyOC44NjQzIDI2Ljk1MjEgMjguNjk4NyAyNi4xMjc5QzI4LjYyNzkgMjUuNzc1OSAyOC42Njc1IDI1LjIzMTkgMjguNzMwNSAyNC45MTk5QzI4Ljg3MjEgMjQuMjQ4IDI4LjcxNDQgMjMuODE1OSAyOC4yNDk1IDIzLjQyMzhDMjcuODcxNiAyMy4xMDQgMjcuMzkxMSAyMy4wMTYxIDI2Ljg2MzMgMjMuMDE2MUMyNi42NjYgMjMuMDE2MSAyNi40ODQ5IDIyLjkyNzcgMjYuMzUxMSAyMi44NTZDMjYuMTMwNCAyMi43NDQxIDI1Ljk0OTIgMjIuNDYzOSAyNi4xMjI2IDIyLjEyMDFDMjYuMTc3NyAyMi4wMDc4IDI2LjQ0NTggMjEuNzM1OCAyNi41MDg4IDIxLjY4OEMyNy4yMjU2IDIxLjI3MiAyOC4wNTI3IDIxLjQwNzcgMjguODE2OSAyMS43MTk3QzI5LjUyNTkgMjIuMDE2MSAzMC4wNjE1IDIyLjU2MDEgMzAuODM0IDIzLjMyODFDMzEuNjIxNiAyNC4yNTU5IDMxLjc2MzIgMjQuNTExNyAzMi4yMTI0IDI1LjIwOEMzMi41NjY5IDI1Ljc1MiAzMi44OTAxIDI2LjMxMiAzMy4xMTA0IDI2Ljk1MjFDMzMuMjQ0NiAyNy4zNTIxIDMzLjA3MTMgMjcuNjgwMiAzMi42MDY0IDI3Ljg3OTlaIiBmaWxsPSIjMDAwIiBmaWxsLW9wYWNpdHk9IjEuMDAwMDAwIiBmaWxsLXJ1bGU9Im5vbnplcm8iLz4KPC9zdmc+Cg==";

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;

      // ---- 注入样式（作为本插件的 <style> 元素，随插件卸载自动移除）----
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-plugin", "dsh-whale-copilot");
      styleEl.textContent = `
.dsw-root{position:fixed;left:0;right:0;bottom:0;height:168px;pointer-events:none;z-index:999;font-family:ui-rounded,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;}
.dsw-tank{position:absolute;inset:0;overflow:hidden;background:linear-gradient(180deg,rgba(96,165,250,.10) 0%,rgba(37,99,235,.16) 46%,rgba(8,16,42,.40) 100%);}
.dsw-wave{position:absolute;left:0;width:200%;height:24px;pointer-events:none;}
.dsw-wave svg{width:100%;height:100%;display:block;}
.dsw-wave-1{top:4px;opacity:.45;animation:dsw-wave 16s linear infinite;}
.dsw-wave-2{top:0;opacity:.22;animation:dsw-wave 11s linear infinite reverse;}
@keyframes dsw-wave{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.dsw-bubble{position:absolute;bottom:-20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.85),rgba(255,255,255,.10) 65%);animation:dsw-rise linear infinite;pointer-events:none;}
@keyframes dsw-rise{from{transform:translateY(0);opacity:0}12%{opacity:.75}to{transform:translateY(-188px);opacity:0}}
.dsw-whale{position:absolute;bottom:22px;left:8px;width:216px;pointer-events:none;will-change:left;}
.dsw-whale-bounce{transform-origin:50% 80%;}
.dsw-whale-bounce,.dsw-whale-inner,.dsw-whale-scale{pointer-events:none;}
.dsw-whale-inner{animation:dsw-bob 3.6s ease-in-out infinite;}
@keyframes dsw-bob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-8px) rotate(2deg)}}
.dsw-whale-scale{transform-origin:50% 100%;}
.dsw-whale-svg{pointer-events:visiblePainted;cursor:pointer;will-change:transform;}
.dsw-act-celebrate .dsw-whale-bounce{animation:dsw-jump 2.3s ease-in-out 1;}
.dsw-act-attention .dsw-whale-bounce{animation:dsw-jump 1.4s ease-in-out 1;}
@keyframes dsw-jump{0%{transform:translateY(0) rotate(0)}18%{transform:translateY(-66px) rotate(-13deg)}38%{transform:translateY(-22px) rotate(7deg)}58%{transform:translateY(-74px) rotate(-9deg)}78%{transform:translateY(-14px) rotate(4deg)}100%{transform:translateY(0) rotate(0)}}
.dsw-act-approval .dsw-whale-inner,.dsw-act-question .dsw-whale-inner{animation:none;}
.dsw-act-approval .dsw-whale-bounce,.dsw-act-question .dsw-whale-bounce{animation:dsw-shake .9s ease-in-out infinite;}
@keyframes dsw-shake{0%,100%{transform:translateX(0) rotate(0)}12%{transform:translateX(-7px) rotate(-3deg)}24%{transform:translateX(7px) rotate(3deg)}36%{transform:translateX(-6px) rotate(-2.5deg)}48%{transform:translateX(6px) rotate(2.5deg)}60%{transform:translateX(-4px) rotate(-1.5deg)}72%{transform:translateX(4px) rotate(1.5deg)}84%{transform:translateX(-2px) rotate(0)}100%{transform:translateX(0) rotate(0)}}
.dsw-tail{animation:dsw-tail 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:85% 50%;}
@keyframes dsw-tail{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(12deg)}}
.dsw-fin{animation:dsw-fin 2.8s ease-in-out infinite;transform-box:fill-box;transform-origin:30% 20%;}
@keyframes dsw-fin{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(10deg)}}
.dsw-eye-sad,.dsw-mouth-sad{display:none;}
.dsw-act-sad .dsw-eye-happy,.dsw-act-sad .dsw-mouth-happy{display:none;}
.dsw-act-sad .dsw-eye-sad,.dsw-act-sad .dsw-mouth-sad{display:block;}
.dsw-act-sad .dsw-whale-inner{animation-duration:5.4s;}
.dsw-spout{opacity:0;transform-box:fill-box;transform-origin:50% 100%;}
.dsw-act-celebrate .dsw-spout,.dsw-act-attention .dsw-spout{animation:dsw-spout 1.6s ease-out 2;}
.dsw-act-approval .dsw-spout,.dsw-act-question .dsw-spout{animation:dsw-spout 1.6s ease-out infinite;}
@keyframes dsw-spout{0%{opacity:0;transform:scaleY(.1)}22%{opacity:1;transform:scaleY(1)}80%{opacity:.9}100%{opacity:0;transform:scaleY(1) translateY(-7px)}}
.dsw-drop{opacity:0;}
.dsw-act-celebrate .dsw-drop,.dsw-act-attention .dsw-drop{animation:dsw-drop 1.6s ease-in 2;}
.dsw-act-approval .dsw-drop,.dsw-act-question .dsw-drop{animation:dsw-drop 1.6s ease-in infinite;}
@keyframes dsw-drop{0%{opacity:0;transform:translateY(0)}30%{opacity:1}100%{opacity:0;transform:translateY(15px)}}
/* 提问用琥珀色喷水，和审批（蓝色）区分开 */
.dsw-act-question .dsw-spout path{fill:#fcd34d;}
.dsw-act-question .dsw-spout .dsw-drop{fill:#f59e0b;}
.dsw-act-thinking .dsw-spout{animation:dsw-think-spout 4s ease-in-out infinite;}
.dsw-act-thinking .dsw-drop{animation:dsw-think-drop 4s ease-in infinite;}
@keyframes dsw-think-spout{0%{opacity:0;transform:scaleY(.05)}8%{opacity:.85;transform:scaleY(.85)}20%{opacity:.65;transform:scaleY(1) translateY(-3px)}36%{opacity:0;transform:scaleY(1) translateY(-9px)}100%{opacity:0;transform:scaleY(.05)}}
@keyframes dsw-think-drop{0%{opacity:0;transform:translateY(0)}16%{opacity:.85}40%{opacity:0;transform:translateY(15px)}100%{opacity:0}}
.dsw-speech{position:absolute;bottom:90px;left:50%;transform:translateX(-52%);background:rgba(255,255,255,.96);color:#0f172a;font-size:13px;font-weight:600;padding:6px 12px;border-radius:14px;white-space:nowrap;box-shadow:0 4px 14px rgba(2,6,23,.28);pointer-events:none;animation:dsw-pop .22s ease-out;max-width:min(60vw,420px);overflow:hidden;text-overflow:ellipsis;}
.dsw-speech::after{content:'';position:absolute;left:26%;bottom:-7px;border:7px solid transparent;border-top-color:rgba(255,255,255,.96);border-bottom:0;}
@keyframes dsw-pop{from{transform:translateX(-52%) translateY(6px) scale(.8);opacity:0}to{transform:translateX(-52%) translateY(0) scale(1);opacity:1}}
.dsw-badge{position:absolute;top:-10px;right:4px;min-width:22px;height:22px;border-radius:11px;background:linear-gradient(135deg,#f43f5e,#e11d48);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 6px;box-shadow:0 2px 8px rgba(225,29,72,.55);animation:dsw-pulse 1.2s ease-in-out infinite;pointer-events:none;}
.dsw-badge-question{left:4px;right:auto;background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 2px 8px rgba(217,119,6,.55);}
@keyframes dsw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
/* ---- 状态面板：位置由 JS 按鲸鱼当前位置计算（跟随鲸鱼）---- */
.dsw-panel{position:absolute;bottom:178px;width:330px;max-width:calc(100vw - 28px);max-height:54vh;background:var(--dsw-panel-bg);border:1px solid var(--dsw-panel-bd);border-radius:16px;color:var(--dsw-panel-tx);pointer-events:auto;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(2,6,23,.55);backdrop-filter:blur(8px);
  --dsw-panel-bg: rgba(10,16,34,.94);
  --dsw-panel-bd: rgba(148,163,184,.25);
  --dsw-panel-tx: #e2e8f0;
  --dsw-panel-fg: #cbd5e1;
  --dsw-panel-mut: #94a3b8;
  --dsw-panel-sep: rgba(148,163,184,.16);
  --dsw-panel-soft: rgba(148,163,184,.14);
  --dsw-panel-inline: rgba(148,163,184,.13);
  --dsw-panel-hover: rgba(148,163,184,.12);}
.dsw-panel.dsw-theme-light{
  --dsw-panel-bg: rgba(255,255,255,.97);
  --dsw-panel-bd: rgba(15,23,42,.18);
  --dsw-panel-tx: #0f172a;
  --dsw-panel-fg: #334155;
  --dsw-panel-mut: #64748b;
  --dsw-panel-sep: rgba(15,23,42,.12);
  --dsw-panel-soft: rgba(15,23,42,.07);
  --dsw-panel-inline: rgba(15,23,42,.06);
  --dsw-panel-hover: rgba(15,23,42,.06);}
.dsw-panel-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-size:13px;font-weight:700;border-bottom:1px solid var(--dsw-panel-sep);}
.dsw-panel-head .dsw-logo{display:inline-block;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#ffffff,#cfe2ff);padding:3px;box-shadow:inset 0 0 0 1px rgba(79,109,254,.4);flex:none;margin-right:8px;vertical-align:-5px;}
.dsw-panel-head .dsw-logo img{width:100%;height:100%;display:block;}
.dsw-panel-head .dsw-online{width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block;margin-right:7px;box-shadow:0 0 6px rgba(52,211,153,.8);}
.dsw-panel-head .dsw-offline{background:#f87171;box-shadow:0 0 6px rgba(248,113,113,.8);}
.dsw-panel-actions{display:flex;gap:6px;}
.dsw-panel-gear,.dsw-panel-close{border:none;background:var(--dsw-panel-soft);color:var(--dsw-panel-fg);width:24px;height:24px;border-radius:8px;cursor:pointer;font-size:12px;line-height:1;}
.dsw-panel-gear:hover,.dsw-panel-close:hover{background:var(--dsw-panel-hover);}
.dsw-panel-body{overflow-y:auto;padding:8px;}
.dsw-settings{padding:8px 10px;border-bottom:1px solid var(--dsw-panel-sep);display:flex;flex-direction:column;gap:9px;}
.dsw-settings-row{display:flex;align-items:center;gap:8px;font-size:12px;}
.dsw-settings-label{flex:none;width:58px;color:var(--dsw-panel-mut);}
.dsw-settings-row input[type=range]{flex:1;accent-color:#4d6bfe;min-width:0;}
.dsw-settings-val{flex:none;width:72px;text-align:right;color:var(--dsw-panel-fg);font-variant-numeric:tabular-nums;}
.dsw-settings-reset{border:none;background:rgba(77,107,254,.22);color:#bcd0ff;font-size:11.5px;padding:4px 10px;border-radius:8px;cursor:pointer;align-self:flex-start;}
.dsw-settings-reset:hover{background:rgba(77,107,254,.36);}
.dsw-settings-ver .dsw-settings-val{width:auto;text-align:left;}
.dsw-theme-toggle{display:flex;gap:5px;flex:1;}
.dsw-theme-btn{flex:1;border:none;background:var(--dsw-panel-soft);color:var(--dsw-panel-mut);font-size:11.5px;padding:4px 0;border-radius:8px;cursor:pointer;}
.dsw-theme-btn:hover{background:var(--dsw-panel-hover);}
.dsw-theme-btn.dsw-theme-on{background:rgba(77,107,254,.88);color:#fff;font-weight:700;}
.dsw-up{flex:none;font-size:11px;padding:2px 8px;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;}
.dsw-up-ok{color:#6ee7b7;background:rgba(52,211,153,.12);}
.dsw-theme-light .dsw-up-ok{color:#059669;background:rgba(52,211,153,.16);}
.dsw-up-new{color:#7dd3fc;background:rgba(56,189,248,.12);}
.dsw-theme-light .dsw-up-new{color:#0369a1;background:rgba(56,189,248,.16);}
.dsw-up-run{color:var(--dsw-panel-mut);background:var(--dsw-panel-soft);}
.dsw-up-err{color:#fda4af;background:rgba(244,63,94,.12);}
.dsw-theme-light .dsw-up-err{color:#be123c;background:rgba(244,63,94,.14);}
.dsw-settings-upgrade{border:none;background:rgba(77,107,254,.22);color:#bcd0ff;font-size:11.5px;padding:4px 10px;border-radius:8px;cursor:pointer;flex:none;}
.dsw-settings-upgrade:hover{background:rgba(77,107,254,.36);}
.dsw-settings-upgrade:disabled{opacity:.55;cursor:default;}
.dsw-session-list{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;}
.dsw-session{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;cursor:pointer;}
.dsw-session:hover{background:var(--dsw-panel-hover);}
.dsw-dot{width:9px;height:9px;border-radius:50%;flex:none;}
.dsw-dot-idle{background:#64748b;}
.dsw-dot-thinking{background:#38bdf8;box-shadow:0 0 7px rgba(56,189,248,.9);animation:dsw-pulse 1.6s ease-in-out infinite;}
.dsw-dot-replying{background:#818cf8;}
.dsw-dot-tool{background:#a78bfa;box-shadow:0 0 7px rgba(167,139,250,.9);}
.dsw-dot-approval{background:#fbbf24;box-shadow:0 0 8px rgba(251,191,36,1);animation:dsw-pulse 1s ease-in-out infinite;}
.dsw-dot-question{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,1);animation:dsw-pulse 1s ease-in-out infinite;}
.dsw-session-name{flex:1;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-panel-tx);}
.dsw-phase{font-size:11px;color:var(--dsw-panel-mut);background:var(--dsw-panel-inline);border-radius:8px;padding:2px 7px;flex:none;}
.dsw-empty{font-size:12px;color:var(--dsw-panel-mut);padding:8px 10px;}
.dsw-feed-title{font-size:11px;color:var(--dsw-panel-mut);font-weight:700;padding:6px 4px;letter-spacing:.04em;}
.dsw-feed{display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--dsw-panel-sep);padding-top:6px;}
.dsw-feed-item{display:flex;align-items:center;gap:7px;padding:3px 4px;font-size:12px;}
.dsw-feed-icon{flex:none;}
.dsw-feed-text{flex:1;color:var(--dsw-panel-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dsw-feed-time{flex:none;font-size:10.5px;color:var(--dsw-panel-mut);}
.dsw-check{display:flex;align-items:center;gap:4px;color:var(--dsw-panel-fg);cursor:pointer;font-size:12px;flex:1;justify-content:center;}
.dsw-check input[type=checkbox]{accent-color:#4d6bfe;margin:0;}
/* ---- 全浏览器醒目提醒：页缘闪屏 + 顶部 toast ---- */
.dsw-alert{position:fixed;inset:0;z-index:1200;pointer-events:none;border:0 solid transparent;}
.dsw-alert::before{content:'';position:absolute;inset:0;opacity:0;}
.dsw-alert-approval{animation:dsw-alert-red 0.9s ease-in-out 4;}
.dsw-alert-approval::before{background:radial-gradient(circle at 50% 30%,rgba(244,63,94,.25),transparent 62%);animation:dsw-alert-wash 0.9s ease-in-out 4;}
.dsw-alert-question{animation:dsw-alert-amber 0.9s ease-in-out 4;}
.dsw-alert-question::before{background:radial-gradient(circle at 50% 30%,rgba(245,158,11,.26),transparent 62%);animation:dsw-alert-wash 0.9s ease-in-out 4;}
.dsw-alert-done{animation:dsw-alert-green 0.9s ease-in-out 4;}
.dsw-alert-done::before{background:radial-gradient(circle at 50% 30%,rgba(52,211,153,.22),transparent 62%);animation:dsw-alert-wash 0.9s ease-in-out 4;}
@keyframes dsw-alert-red{0%,100%{border-width:0;border-color:rgba(244,63,94,0)}25%,75%{border-width:14px;border-color:rgba(244,63,94,.65)}}
@keyframes dsw-alert-amber{0%,100%{border-width:0;border-color:rgba(245,158,11,0)}25%,75%{border-width:14px;border-color:rgba(245,158,11,.7)}}
@keyframes dsw-alert-green{0%,100%{border-width:0;border-color:rgba(52,211,153,0)}25%,75%{border-width:14px;border-color:rgba(52,211,153,.6)}}
@keyframes dsw-alert-wash{0%,100%{opacity:0}30%,70%{opacity:1}}
.dsw-alert-toast{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:rgba(10,16,34,.95);color:#fff;font-size:14px;font-weight:700;padding:10px 18px;border-radius:14px;box-shadow:0 10px 30px rgba(2,6,23,.5);display:flex;flex-direction:column;gap:3px;align-items:center;pointer-events:none;z-index:1201;max-width:min(86vw,480px);text-align:center;animation:dsw-toast-in .25s ease-out;}
.dsw-alert-approval .dsw-alert-toast{border:1px solid rgba(244,63,94,.65);}
.dsw-alert-question .dsw-alert-toast{border:1px solid rgba(245,158,11,.7);}
.dsw-alert-done .dsw-alert-toast{border:1px solid rgba(52,211,153,.65);}
.dsw-alert-sub{font-size:12px;font-weight:500;color:#cbd5e1;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
@keyframes dsw-toast-in{from{transform:translateX(-50%) translateY(-14px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
`;
      document.head.appendChild(styleEl);
      // 注意：ctx.effect 的返回值才是清理函数（回调本身立即执行），
      // 所以这里返回 () => remove，而不是直接 remove。
      ctx.effect(() => () => {
        try { styleEl.remove(); } catch (e) { /* ignore */ }
      });

      // ---- 迷你 store：每次更新替换为新对象引用，确保 React 重渲染 ----
      let state = { sessions: [], events: [], lastSeq: -1, connected: false, approvalCount: 0, questionCount: 0, version: null, latest: null, updateChecked: false, updateAvailable: false, upgrade: null }
      const subs = new Set()
      function getState() { return state }
      function setState(patch) {
        state = Object.assign({}, state, patch)
        for (const fn of subs) { try { fn(state) } catch (e) { /* ignore */ } }
      }
      function subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } }

      // ---- 轮询 Host 的 /whale/pull（HTTP 路由，由本插件 Host 半区提供）----
      let pulling = false
      async function pull() {
        if (pulling) return
        pulling = true
        try {
          const res = await fetch("/whale/pull?since=" + String(state.lastSeq), { cache: "no-store" })
          if (!res.ok) throw new Error("http " + res.status)
          const data = await res.json()
          if (!data || typeof data !== "object") return
          const fresh = Array.isArray(data.events) ? data.events : []
          const merged = fresh.length ? state.events.concat(fresh).slice(-80) : state.events
          const sessions = Array.isArray(data.sessions) ? data.sessions : []
          let approvalCount = 0
          let questionCount = 0
          for (const s of sessions) {
            if (s && s.phase === "approval") approvalCount++
            else if (s && s.phase === "question") questionCount++
          }
          setState({
            sessions,
            events: merged,
            lastSeq: typeof data.seq === "number" ? data.seq : state.lastSeq,
            connected: true,
            approvalCount,
            questionCount,
            version: typeof data.version === "string" ? data.version : state.version,
            latest: typeof data.latest === "string" ? data.latest : state.latest,
            updateChecked: !!data.updateChecked,
            updateAvailable: !!data.updateAvailable,
            upgrade: data.upgrade || state.upgrade
          })
        } catch (err) {
          setState({ connected: false })
        } finally { pulling = false }
      }

      const pollTimer = setInterval(() => { pull() }, 900)
      // 注意：ctx.effect 的返回值才是清理函数（回调本身立即执行）
      ctx.effect(() => () => clearInterval(pollTimer))
      pull()

      const sessionsSvc = ctx.get("sessions")

      // ---- 文案/图标 ----
      const ICONS = {
        think: '💭', reply: '💬', tool: '⚒️', approval: '❓', approve: '✅', reject: '🚫',
        done: '🎉', error: '💥', task: '📥', sub: '🐋', 'sub-end': '🐳', workflow: '🔄',
        'workflow-done': '🎊', 'workflow-error': '💥', goal: '🎯', 'goal-done': '🏆',
        'goal-blocked': '⛔', info: 'ℹ️', question: '❓', 'question-done': '✅'
      }
      const TEXTS = {
        think: '让我想想…', reply: '正在回复…', tool: (e) => (e.tool ? '正在使用 ' + e.tool : '正在执行动作'),
        approval: '需要审批！', approve: '批准啦！', reject: '被拒绝了…', done: '任务完成！',
        error: '呜哇，出错了…', task: '新任务来啦！', sub: '小助手开工！', 'sub-end': '小助手完成！',
        workflow: '工作流开始！', 'workflow-done': '工作流完成！', 'workflow-error': '工作流出错了…',
        goal: '新目标达成！', 'goal-done': '目标完成！', info: '…',
        question: (e) => (e.ask ? '问题：' + e.ask : '想问你个问题！'), 'question-done': '收到你的回答！'
      }

      function shortId(id) {
        if (typeof id !== 'string') return '?'
        return id.length > 10 ? id.slice(0, 10) + '…' : id
      }
      function fmtTime(t) {
        try { return new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) } catch (e) { return '' }
      }
      function phaseLabel(s) {
        switch (s.phase) {
          case 'approval': return '待审批'
          case 'question': return '提问中'
          case 'tool': return '执行 ' + (s.tool || '工具')
          case 'replying': return '回复中'
          case 'thinking': return '思考中'
          default: return s.status === 'running' ? '运行中' : '空闲'
        }
      }
      function deriveBaseMood(sessions) {
        for (const s of sessions) {
          if (s.phase === 'approval') return 'approval'
          if (s.phase === 'question') return 'question'
        }
        let mood = 'idle'
        for (const s of sessions) {
          if (s.phase === 'tool') mood = 'tool'
          else if (s.phase === 'replying' && mood !== 'tool' && mood !== 'thinking') mood = 'replying'
          else if (s.phase === 'thinking' && mood === 'idle') mood = 'thinking'
        }
        return mood
      }
      function pickAction(events, sinceSeq) {
        const fresh = []
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]
          if (e.seq > sinceSeq) fresh.push(e)
          else break
        }
        fresh.reverse()
        if (!fresh.length) return null
        const recent = fresh.slice(-3)
        let hit = null
        for (const e of recent) {
          if (e.mood === 'celebrate' || e.mood === 'sad') { hit = e; break }
        }
        if (!hit) {
          for (const e of recent) {
            if (e.mood === 'approval' || e.mood === 'question') { hit = e; break }
          }
        }
        if (!hit) {
          for (const e of recent) {
            if (e.mood === 'attention') { hit = e; break }
          }
        }
        if (hit) {
          const t = TEXTS[hit.type]
          const text = typeof t === 'function' ? t(hit) : (t || hit.text || '…')
          const type = hit.mood === 'attention' ? 'attention' : hit.mood
          return { key: hit.seq, type, text, kind: hit.type }
        }
        const last = fresh[fresh.length - 1]
        const t = TEXTS[last.type]
        const text = typeof t === 'function' ? t(last) : (t || last.text || '…')
        return { key: last.seq, type: 'talk', text, kind: last.type }
      }

      const WHALE_SVG_INNER = `
  <defs>
    <linearGradient id="dswBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#93a7ff"/>
      <stop offset="52%" stop-color="#4d6bfe"/>
      <stop offset="100%" stop-color="#2b3fd1"/>
    </linearGradient>
    <radialGradient id="dswBelly" cx="0.5" cy="0.4" r="0.7">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d9e2ff"/>
    </radialGradient>
  </defs>
  <g class="dsw-tail"><path d="M54 62 C 36 50, 15 46, 6 54 C 18 61, 21 71, 6 78 C 15 86, 36 82, 54 70 Z" fill="#2841d0"/></g>
  <ellipse cx="130" cy="72" rx="80" ry="47" fill="url(#dswBody)"/>
  <ellipse cx="142" cy="89" rx="46" ry="25" fill="url(#dswBelly)" opacity="0.85"/>
  <g class="dsw-fin"><path d="M122 90 C 128 106, 142 114, 154 108 C 148 100, 140 92, 133 88 Z" fill="#3552e8"/></g>
  <ellipse cx="163" cy="28" rx="7" ry="3" fill="#1c2a9e"/>
  <g class="dsw-eye-happy">
    <ellipse cx="176" cy="52" rx="11" ry="13" fill="#ffffff"/>
    <ellipse cx="179" cy="53" rx="5.5" ry="7" fill="#141f78"/>
    <circle cx="181.5" cy="49.5" r="2" fill="#ffffff"/>
  </g>
  <g class="dsw-eye-sad">
    <ellipse cx="176" cy="56" rx="11" ry="9" fill="#ffffff"/>
    <path d="M165 57 L187 57 Q187 64 176 64 Q165 64 165 57 Z" fill="#141f78"/>
    <circle cx="181" cy="54" r="2" fill="#ffffff"/>
  </g>
  <ellipse cx="162" cy="70" rx="8" ry="4.5" fill="#fda4af" opacity="0.4"/>
  <path class="dsw-mouth-happy" d="M172 78 Q 180 87, 192 80" stroke="#dbe4ff" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path class="dsw-mouth-sad" d="M174 84 Q 180 76, 190 82" stroke="#dbe4ff" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g class="dsw-spout">
    <path d="M163 24 C 165 13, 163 5, 161 1 C 166 6, 167 15, 166 24 Z" fill="#bfdbfe" opacity="0.9"/>
    <path d="M156 24 C 151 12, 147 5, 142 0 C 148 7, 153 15, 159 24 Z" fill="#93c5fd" opacity="0.85"/>
    <path d="M170 24 C 175 12, 180 5, 185 0 C 179 7, 174 15, 167 24 Z" fill="#93c5fd" opacity="0.85"/>
    <ellipse class="dsw-drop" cx="141" cy="2" rx="3.2" ry="4.4" fill="#7dd3fc"/>
    <ellipse class="dsw-drop" cx="161" cy="0" rx="3" ry="4" fill="#bae6fd"/>
    <ellipse class="dsw-drop" cx="184" cy="2" rx="3.2" ry="4.4" fill="#7dd3fc"/>
    <ellipse class="dsw-drop" cx="171" cy="-1" rx="2.6" ry="3.6" fill="#e0f2fe"/>
  </g>
`

      const WAVE_SVG = (opacity) => `<svg viewBox="0 0 1200 24" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 14 Q 50 4 100 14 T 200 14 T 300 14 T 400 14 T 500 14 T 600 14 T 700 14 T 800 14 T 900 14 T 1000 14 T 1100 14 T 1200 14 L 1200 24 L 0 24 Z" fill="#ffffff" opacity="${opacity}"/></svg>`

      const BUBBLES = [
        { left: '6%', size: 7, dur: 5.2, delay: 0 },
        { left: '16%', size: 5, dur: 4.2, delay: 1.4 },
        { left: '27%', size: 9, dur: 6.1, delay: .8 },
        { left: '38%', size: 5, dur: 3.9, delay: 2.3 },
        { left: '51%', size: 8, dur: 5.6, delay: .4 },
        { left: '62%', size: 5, dur: 4.5, delay: 1.9 },
        { left: '74%', size: 7, dur: 5.8, delay: 2.9 },
        { left: '85%', size: 6, dur: 4.8, delay: 1.1 },
        { left: '93%', size: 5, dur: 5.0, delay: 3.3 }
      ]

      // ---- 设置持久化：写入 localStorage，刷新/下次启动自动恢复 ----
      const SETTINGS_KEY = 'dsh-whale-copilot:settings'
      const LEGACY_SETTINGS_KEY = 'dsh-whale:settings'
      const DEFAULT_SETTINGS = { scale: 0.85, sink: 8, bubble: 90, opacity: 1, theme: 'dark', alertFlash: true, alertNotify: true, alertTitle: true }
      function clampNum(v, min, max, fallback) {
        return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
      }
      function defaultSettings() { return Object.assign({}, DEFAULT_SETTINGS) }
      function loadSettings() {
        try {
          // 优先读新键；旧包名键作为一次性迁移来源
          const raw = window.localStorage.getItem(SETTINGS_KEY) || window.localStorage.getItem(LEGACY_SETTINGS_KEY)
          if (raw) {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') {
              return {
                scale: clampNum(parsed.scale, 0.5, 1.3, DEFAULT_SETTINGS.scale),
                sink: clampNum(parsed.sink, -20, 22, DEFAULT_SETTINGS.sink),
                bubble: clampNum(parsed.bubble, 40, 180, DEFAULT_SETTINGS.bubble),
                opacity: clampNum(parsed.opacity, 0, 1, DEFAULT_SETTINGS.opacity),
                theme: (parsed.theme === 'light' || parsed.theme === 'dark') ? parsed.theme : DEFAULT_SETTINGS.theme,
                alertFlash: parsed.alertFlash === undefined ? DEFAULT_SETTINGS.alertFlash : !!parsed.alertFlash,
                alertNotify: parsed.alertNotify === undefined ? DEFAULT_SETTINGS.alertNotify : !!parsed.alertNotify,
                alertTitle: parsed.alertTitle === undefined ? DEFAULT_SETTINGS.alertTitle : !!parsed.alertTitle
              }
            }
          }
        } catch (e) { /* ignore */ }
        return defaultSettings()
      }

      // 提醒文案元信息（按事件 kind 区分：审批/提问/任务完成）
      const ALERT_META = {
        approval: { marker: '需要审批', title: '⚠️ 需要审批！', heading: '⚠️ 需要审批', fallback: '需要审批！' },
        question: { marker: '提问', title: '❓ 有提问待回答！', heading: '❓ 鲸鱼想问你', fallback: '鲸鱼想问你个问题' },
        done: { marker: '任务完成', title: '🎉 任务完成！', heading: '🎉 任务完成', fallback: '任务完成！' }
      }

      function WhaleApp() {
        const [data, setData] = React.useState(getState)
        React.useEffect(() => subscribe(setData), [])
        const [panel, setPanel] = React.useState(false)
        const [showSettings, setShowSettings] = React.useState(false)
        const [panelLeft, setPanelLeft] = React.useState(null)
        const [settings, setSettings] = React.useState(loadSettings)
        React.useEffect(() => {
          try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch (e) { /* ignore */ }
        }, [settings])
        const [action, setAction] = React.useState(null)
        const lastSeqRef = React.useRef(0)
        const bootedRef = React.useRef(false)
        const actionTimerRef = React.useRef(null)
        const lastCelebrateRef = React.useRef(0)
        const whaleElRef = React.useRef(null)
        // 游动的唯一状态源：pos 当前水平位置、dir 行进方向(+1 右 / -1 左)、
        // frozen 审批/提问冻结标志。朝向与位移都由它驱动，保证身体与头部始终同步。
        const swimRef = React.useRef({ pos: 8, dir: 1, frozen: false, last: 0, raf: 0, prevDir: 1 })

        function clearActionTimer() {
          if (actionTimerRef.current !== null) {
            try { clearTimeout(actionTimerRef.current) } catch (e) { /* ignore */ }
            actionTimerRef.current = null
          }
        }
        React.useEffect(() => () => { clearActionTimer() }, [])

        // ---- 全浏览器醒目提醒（审批 / 提问）----
        const [alert, setAlert] = React.useState(null)
        const alertTimerRef = React.useRef(null)
        const notifyAskedRef = React.useRef(false)
        const baseTitleRef = React.useRef(null)
        function clearAlertTimer() {
          if (alertTimerRef.current !== null) {
            try { clearTimeout(alertTimerRef.current) } catch (e) { /* ignore */ }
            alertTimerRef.current = null
          }
        }
        // 在用户手势（点击鲸鱼）时请求通知权限，只主动请求一次
        function requestNotifyPermission() {
          try {
            if (!window.Notification || notifyAskedRef.current) return
            notifyAskedRef.current = true
            if (Notification.permission === 'default') {
              Notification.requestPermission().catch(() => { /* 拒绝/被忽略则静默降级为页缘闪屏 */ })
            }
          } catch (e) { /* ignore */ }
        }
        function restoreBaseTitle() {
          if (baseTitleRef.current !== null) {
            try { document.title = baseTitleRef.current } catch (e) { /* ignore */ }
            baseTitleRef.current = null
          }
        }
        function emitAlert(kind, text, key) {
          const meta = ALERT_META[kind] || ALERT_META.question
          if (!text) text = meta.fallback
          // 1) 页缘闪屏 + 顶部 toast（无需权限，最可靠）
          if (settings.alertFlash) setAlert({ kind, text, key: (key !== undefined ? key : Date.now()) })
          // 2) 系统级原生通知（整个浏览器/系统弹窗；需已授权）
          if (settings.alertNotify) {
            try {
              if (window.Notification && Notification.permission === 'granted') {
                const n = new Notification('🐳 DSWhale', {
                  body: text, tag: 'dsw-alert-' + kind, icon: WHALE_LOGO, renotify: true
                })
                try { setTimeout(() => { try { n.close() } catch (e) { /* ignore */ } }, 8000) } catch (e) { /* ignore */ }
              }
            } catch (e) { /* ignore */ }
          }
          // 3) 浏览器标签栏闪烁（临时改 document.title 前缀）
          if (settings.alertTitle) {
            try {
              if (baseTitleRef.current === null) baseTitleRef.current = document.title
              if (document.title.indexOf(meta.marker) === -1) {
                document.title = meta.title + ' ' + baseTitleRef.current
              }
            } catch (e) { /* ignore */ }
          }
          clearAlertTimer()
          alertTimerRef.current = setTimeout(() => {
            alertTimerRef.current = null
            setAlert(null)
            restoreBaseTitle()
          }, 4500)
        }
        React.useEffect(() => () => {
          clearAlertTimer()
          restoreBaseTitle()
        }, [])

        // ---- 游动循环：JS 驱动水平位移与头部朝向（单一数据源）----
        // 相比旧的「两条独立 92s CSS 动画（游泳 + 掉头）」方案，位移与朝向由同一个
        // swimRef 状态驱动：审批/提问时一次性完全冻结，杜绝「身体停了、头还在转」的失步。
        React.useEffect(() => {
          const whale = whaleElRef.current
          if (!whale) return
          const MIN_X = 8
          const SPEED = 0.035 // px/ms，约等于旧版 92s 往返的慢速巡航
          function tankWidth() {
            return whale.parentElement ? whale.parentElement.clientWidth : window.innerWidth
          }
          function maxX() {
            return Math.max(MIN_X, tankWidth() - whale.offsetWidth - MIN_X)
          }
          function setFlip(dir) {
            const svg = whale.querySelector('.dsw-whale-svg')
            if (svg) svg.style.transform = 'scaleX(' + dir + ')'
          }
          const s = swimRef.current
          function frame(ts) {
            s.raf = requestAnimationFrame(frame)
            const delta = s.last ? ts - s.last : 0
            s.last = ts
            if (s.frozen) return // 审批/提问中：位移进度完全停止
            s.pos += s.dir * SPEED * delta
            const max = maxX()
            if (s.pos >= max) { s.pos = max; s.dir = -1 }
            else if (s.pos <= MIN_X) { s.pos = MIN_X; s.dir = 1 }
            whale.style.left = Math.round(s.pos) + 'px'
            if (s.dir !== s.prevDir) { s.prevDir = s.dir; setFlip(s.dir) }
          }
          s.prevDir = s.dir
          setFlip(s.dir)
          s.raf = requestAnimationFrame(frame)
          const onResize = () => {
            if (s.frozen) return
            const max = maxX()
            if (s.pos > max) { s.pos = max; s.dir = -1 }
            else if (s.pos < MIN_X) { s.pos = MIN_X; s.dir = 1 }
            whale.style.left = Math.round(s.pos) + 'px'
            if (s.dir !== s.prevDir) { s.prevDir = s.dir; setFlip(s.dir) }
          }
          window.addEventListener('resize', onResize)
          return () => {
            cancelAnimationFrame(s.raf)
            window.removeEventListener('resize', onResize)
          }
        }, [])

        React.useEffect(() => {
          if (data.lastSeq < lastSeqRef.current) {
            lastSeqRef.current = 0
            bootedRef.current = false
          }
          if (!bootedRef.current) {
            lastSeqRef.current = data.lastSeq
            bootedRef.current = true
            setAction({ key: 'hello', type: 'talk', text: '我来啦！🐳', kind: 'hello' })
            clearActionTimer()
            actionTimerRef.current = setTimeout(() => { actionTimerRef.current = null; setAction(null) }, 2600)
            return
          }
          const next = pickAction(data.events, lastSeqRef.current)
          lastSeqRef.current = data.lastSeq
          if (!next) return
          // 审批 / 提问 / 任务完成 到达 → 全浏览器醒目提醒（仅新事件触发一次）
          if (next.kind === 'approval') emitAlert('approval', next.text, next.key)
          else if (next.kind === 'question') emitAlert('question', next.text, next.key)
          else if (next.kind === 'done') emitAlert('done', next.text, next.key)
          let chosen = next
          if (next.type === 'celebrate' && Date.now() - lastCelebrateRef.current < 6000) {
            chosen = { key: next.key + ':t', type: 'talk', text: next.text, kind: next.kind }
          } else if (next.type === 'celebrate') {
            lastCelebrateRef.current = Date.now()
          }
          setAction(chosen)
          clearActionTimer()
          const dur = chosen.type === 'celebrate' ? 3600 : chosen.type === 'sad' ? 3200 : chosen.type === 'attention' ? 3000 : 3400
          actionTimerRef.current = setTimeout(() => { actionTimerRef.current = null; setAction(null) }, dur)
        }, [data])

        const mood = deriveBaseMood(data.sessions)
        // ---- 审批/提问冻结：回到最左侧并完全静止 ----
        // 1) 避免鲸鱼停在页面中部/右侧遮挡 DSH 的审批按钮/提问弹层；
        // 2) 位移与朝向一并冻结（同一状态源），恢复时方向一致、无跳变。
        const isFrozen = mood === 'approval' || mood === 'question'
        React.useEffect(() => {
          const s = swimRef.current
          const whale = whaleElRef.current
          s.frozen = isFrozen
          if (!whale) return
          if (isFrozen) {
            s.pos = 8
            s.dir = 1
            s.prevDir = 1
            s.last = 0
            whale.style.left = '8px'
            const svg = whale.querySelector('.dsw-whale-svg')
            if (svg) svg.style.transform = 'scaleX(1)'
          } else {
            s.last = 0 // 恢复游动时重置时间基准，避免突发大位移
          }
        }, [isFrozen])
        const actClass = action && action.type !== 'talk'
          ? ' dsw-act-' + action.type
          : (mood === 'thinking' ? ' dsw-act-thinking'
            : (mood === 'approval' || mood === 'question' ? ' dsw-act-' + mood : ''))
        const speechText = action
          ? action.text
          : (mood === 'approval' ? '需要审批！'
            : (mood === 'question' ? '想问你个问题！' : null))
        const speechKey = action ? ('a' + action.key) : 'mood'

        // ---- 面板跟随鲸鱼：按鲸鱼中心 x 定位，左右边界夹紧 ----
        function panelVisibleWidth() {
          return Math.min(330, window.innerWidth - 28)
        }
        function clampPanelLeft(centerX) {
          const pw = panelVisibleWidth()
          const vw = window.innerWidth
          let left = Math.round(centerX - pw / 2)
          left = Math.min(vw - pw - 10, Math.max(10, left))
          return left
        }
        function whaleCenterX() {
          const whale = whaleElRef.current
          if (whale) return swimRef.current.pos + whale.offsetWidth / 2
          return swimRef.current.pos + (216 * settings.scale) / 2
        }
        function openPanel() {
          setPanel(true)
          setShowSettings(false)
          setPanelLeft(clampPanelLeft(whaleCenterX()))
        }
        React.useEffect(() => {
          if (!panel) return
          const onResize = () => setPanelLeft(clampPanelLeft(whaleCenterX()))
          window.addEventListener('resize', onResize)
          return () => window.removeEventListener('resize', onResize)
        }, [panel, settings.scale, isFrozen])

        function togglePanel() {
          if (panel) setPanel(false)
          else { requestNotifyPermission(); openPanel() }
        }
        function toggleSettings() { setShowSettings(!showSettings) }
        function doUpgrade() {
          if (data.upgrade && data.upgrade.running) return
          try { fetch('/whale/upgrade', { method: 'POST', cache: 'no-store' }).catch(() => { /* 状态由轮询同步 */ }) } catch (e) { /* ignore */ }
        }
        function openSession(id) { if (sessionsSvc && id) { try { sessionsSvc.open(id) } catch (e) { /* ignore */ } } }

        const sessionRows = data.sessions.map((s) =>
          React.createElement('div', { key: s.id, className: 'dsw-session', onClick: () => openSession(s.id) },
            React.createElement('span', { className: 'dsw-dot dsw-dot-' + (s.phase || 'idle') }),
            React.createElement('span', { className: 'dsw-session-name' }, s.title || shortId(s.id)),
            React.createElement('span', { className: 'dsw-phase' }, phaseLabel(s))
          )
        )
        const feedRows = data.events.slice(-8).reverse().map((e) =>
          React.createElement('div', { key: e.seq, className: 'dsw-feed-item' },
            React.createElement('span', { className: 'dsw-feed-icon' }, ICONS[e.type] || '🐳'),
            React.createElement('span', { className: 'dsw-feed-text' }, String(e.text || '')),
            React.createElement('span', { className: 'dsw-feed-time' }, fmtTime(e.time))
          )
        )

        // ---- 版本/更新状态（Host 每 900ms 轮询回报）----
        const up = data.upgrade
        const upInfo = (up && up.ok === 'ok')
          ? { text: '已升级，重启生效', cls: 'ok', title: '' }
          : (up && up.running)
          ? { text: '升级中…', cls: 'run', title: '' }
          : (up && up.ok === 'fail')
          ? { text: '升级失败', cls: 'err', title: (up.message || '') }
          : data.updateAvailable && data.latest
          ? { text: '发现新版本 v' + data.latest, cls: 'new', action: true, title: '' }
          : data.updateChecked && !data.latest
          ? { text: '暂无更新源', cls: 'run', title: '' }
          : data.updateChecked
          ? { text: '已是最新', cls: 'ok', title: '' }
          : { text: '检查中…', cls: 'run', title: '' }

        const panelCls = 'dsw-panel' + (settings.theme === 'light' ? ' dsw-theme-light' : '')

        return React.createElement('div', { className: 'dsw-root' + actClass },
          React.createElement('div', { className: 'dsw-tank' },
            React.createElement('div', { className: 'dsw-wave dsw-wave-1', dangerouslySetInnerHTML: { __html: WAVE_SVG(0.5) } }),
            React.createElement('div', { className: 'dsw-wave dsw-wave-2', dangerouslySetInnerHTML: { __html: WAVE_SVG(0.28) } }),
            BUBBLES.map((b, i) =>
              React.createElement('span', { key: i, className: 'dsw-bubble', style: { left: b.left, width: b.size + 'px', height: b.size + 'px', animationDuration: b.dur + 's', animationDelay: b.delay + 's' } })
            ),
            React.createElement('div', { className: 'dsw-whale', ref: whaleElRef, style: { left: '8px', bottom: (22 - settings.sink) + 'px' } },
              data.approvalCount > 0 ? React.createElement('div', { className: 'dsw-badge' }, String(data.approvalCount)) : null,
              data.questionCount > 0 ? React.createElement('div', { className: 'dsw-badge dsw-badge-question' }, String(data.questionCount)) : null,
              React.createElement('div', { className: 'dsw-whale-bounce' },
                React.createElement('div', { className: 'dsw-whale-inner' },
                  speechText ? React.createElement('div', { key: speechKey, className: 'dsw-speech', style: { bottom: settings.bubble + 'px' } }, speechText) : null,
                  React.createElement('div', { className: 'dsw-whale-scale', style: { transform: 'scale(' + settings.scale + ')', opacity: settings.opacity } },
                    React.createElement('svg', {
                      className: 'dsw-whale-svg',
                      viewBox: '0 0 240 150',
                      width: '216',
                      height: '135',
                      xmlns: 'http://www.w3.org/2000/svg',
                      onClick: togglePanel,
                      title: 'DSWhale · 点击查看会话状态',
                      dangerouslySetInnerHTML: { __html: WHALE_SVG_INNER }
                    })
                  )
                )
              )
            )
          ),
          panel ? React.createElement('div', { className: panelCls, style: { left: panelLeft == null ? 14 : panelLeft } },
            React.createElement('div', { className: 'dsw-panel-head' },
              React.createElement('span', null,
                React.createElement('span', { className: 'dsw-logo' },
                  React.createElement('img', { src: WHALE_LOGO, alt: 'DSWhale', draggable: false })
                ),
                React.createElement('span', { className: 'dsw-online' + (data.connected ? '' : ' dsw-offline') }),
                'DSWhale · 会话状态'
              ),
              React.createElement('div', { className: 'dsw-panel-actions' },
                React.createElement('button', { className: 'dsw-panel-gear' + (showSettings ? ' dsw-gear-on' : ''), onClick: toggleSettings, title: '鲸鱼设置' }, '⚙'),
                React.createElement('button', { className: 'dsw-panel-close', onClick: () => setPanel(false) }, '✕')
              )
            ),
            React.createElement('div', { className: 'dsw-panel-body' },
              showSettings ? React.createElement('div', { className: 'dsw-settings' },
                React.createElement('div', { key: 'ver', className: 'dsw-settings-row dsw-settings-ver' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '版本'),
                  React.createElement('span', { className: 'dsw-settings-val' }, 'v' + (data.version || '…')),
                  React.createElement('span', { className: 'dsw-up dsw-up-' + upInfo.cls, title: upInfo.title || '' }, upInfo.text),
                  upInfo.action ? React.createElement('button', { className: 'dsw-settings-upgrade', onClick: doUpgrade, disabled: !!(up && up.running) }, '立即升级') : null
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '主题'),
                  React.createElement('div', { className: 'dsw-theme-toggle' },
                    React.createElement('button', { className: 'dsw-theme-btn' + (settings.theme === 'dark' ? ' dsw-theme-on' : ''), onClick: () => setSettings(Object.assign({}, settings, { theme: 'dark' })) }, '深色'),
                    React.createElement('button', { className: 'dsw-theme-btn' + (settings.theme === 'light' ? ' dsw-theme-on' : ''), onClick: () => setSettings(Object.assign({}, settings, { theme: 'light' })) }, '浅色')
                  )
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '大小'),
                  React.createElement('input', { type: 'range', min: '0.5', max: '1.3', step: '0.05', value: String(settings.scale), onChange: (e) => setSettings(Object.assign({}, settings, { scale: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, Math.round(settings.scale * 100) + '%')
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '上下位置'),
                  React.createElement('input', { type: 'range', min: '-20', max: '22', step: '1', value: String(settings.sink), onChange: (e) => setSettings(Object.assign({}, settings, { sink: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, (settings.sink >= 0 ? '下沉 ' : '上浮 ') + Math.abs(settings.sink) + 'px')
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '气泡距离'),
                  React.createElement('input', { type: 'range', min: '40', max: '180', step: '2', value: String(settings.bubble), onChange: (e) => setSettings(Object.assign({}, settings, { bubble: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, settings.bubble + 'px')
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '透明度'),
                  React.createElement('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings.opacity), onChange: (e) => setSettings(Object.assign({}, settings, { opacity: Number(e.target.value) })) }),
                  React.createElement('span', { className: 'dsw-settings-val' }, Math.round(settings.opacity * 100) + '%')
                ),
                React.createElement('div', { className: 'dsw-settings-row' },
                  React.createElement('span', { className: 'dsw-settings-label' }, '提醒'),
                  React.createElement('label', { className: 'dsw-check', title: '页面边缘闪屏 + 顶部提示（无需权限）' },
                    React.createElement('input', { type: 'checkbox', checked: settings.alertFlash, onChange: (e) => setSettings(Object.assign({}, settings, { alertFlash: e.target.checked })) }),
                    '闪屏'
                  ),
                  React.createElement('label', { className: 'dsw-check', title: '系统级原生通知（需授权，首次需点击鲸鱼）' },
                    React.createElement('input', { type: 'checkbox', checked: settings.alertNotify, onChange: (e) => setSettings(Object.assign({}, settings, { alertNotify: e.target.checked })) }),
                    '系统通知'
                  ),
                  React.createElement('label', { className: 'dsw-check', title: '浏览器标签栏闪烁（临时改文档标题）' },
                    React.createElement('input', { type: 'checkbox', checked: settings.alertTitle, onChange: (e) => setSettings(Object.assign({}, settings, { alertTitle: e.target.checked })) }),
                    '标签闪烁'
                  )
                ),
                React.createElement('button', { className: 'dsw-settings-reset', onClick: () => setSettings(defaultSettings()) }, '恢复默认')
              ) : null,
              data.sessions.length === 0
                ? React.createElement('div', { className: 'dsw-empty' }, '暂无活动会话，让鲸鱼游一会儿吧～')
                : React.createElement('div', { className: 'dsw-session-list' }, sessionRows),
              React.createElement('div', { className: 'dsw-feed' },
                React.createElement('div', { className: 'dsw-feed-title' }, '最近动态'),
                feedRows
              )
            )
          ) : null,
          alert ? React.createElement('div', { key: 'alert' + alert.key, className: 'dsw-alert dsw-alert-' + alert.kind },
            React.createElement('div', { className: 'dsw-alert-toast' },
              React.createElement('span', null, (ALERT_META[alert.kind] || ALERT_META.question).heading),
              React.createElement('span', { className: 'dsw-alert-sub' }, alert.text)
            )
          ) : null
        )
      }

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'whale-aquarium', order: 10000 },
        () => React.createElement(WhaleApp, null)
      ))
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
