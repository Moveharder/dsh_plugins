#!/usr/bin/env bash
# =============================================================================
# dsh web 重启脚本（用于让新安装/升级的 DSH 插件生效）
#
# 为什么需要它：Host 半区在进程启动时装配、浏览器半区在启动时注入
# window.__DSH_BOOT__，所以「装好插件」不等于「跑起来」——必须重启 dsh web。
# 直接在会话里 kill 掉正在服务的进程会中断当前会话，所以本脚本脱离终端运行
# （nohup + setsid 风格），重启过程不会牵连调用它的那个进程。
#
# 用法:
#   scripts/restart-web.sh            # 优雅重启，等待新实例就绪
#   scripts/restart-web.sh --port 3080
#   scripts/restart-web.sh --dry-run  # 只打印将要执行的动作
#   scripts/restart-web.sh --status   # 只看当前监听状态
#
# 环境变量:
#   DSH_PROFILE   要启动的 profile（默认 web）
#   DSH_LOG       新实例日志文件（默认 $TMPDIR/dsh-web.log）
# =============================================================================
set -uo pipefail

PORT=3080
PROFILE="${DSH_PROFILE:-web}"
LOG="${DSH_LOG:-${TMPDIR:-/tmp}/dsh-web.log}"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --status) STATUS_ONLY=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }

listen_pids() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u; }

if [ "${STATUS_ONLY:-0}" = 1 ]; then
  pids="$(listen_pids)"
  if [ -n "$pids" ]; then
    ok "端口 $PORT 正在监听，PID: $(echo "$pids" | tr '\n' ' ')"
    curl -s -m 3 "http://127.0.0.1:$PORT/activity/hello" || echo "(activity 路由尚未注册：插件可能还没生效)"
    echo
  else
    warn "端口 $PORT 没有监听进程"
  fi
  exit 0
fi

command -v lsof >/dev/null 2>&1 || { echo "缺少 lsof" >&2; exit 1; }
command -v dsh  >/dev/null 2>&1 || { echo "缺少 dsh（不在 PATH）" >&2; exit 1; }

pids="$(listen_pids)"
if [ "$DRY_RUN" = 1 ]; then
  info "将优雅停止 PID: ${pids:-（无）}"
  info "将启动: dsh --profile $PROFILE web  （日志 $LOG）"
  exit 0
fi

# 1) 优雅停止旧实例
if [ -n "$pids" ]; then
  info "优雅停止 dsh web（PID: $(echo "$pids" | tr '\n' ' ')）"
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  for i in $(seq 1 30); do
    [ -z "$(listen_pids)" ] && break
    sleep 0.5
  done
  if [ -n "$(listen_pids)" ]; then
    warn "5s 内未退出，强制结束"
    for p in $(listen_pids); do kill -9 "$p" 2>/dev/null || true; done
    sleep 1
  fi
  ok "旧实例已停止"
else
  info "端口 $PORT 无监听进程，直接启动"
fi

# 2) 启动新实例（脱离当前终端与进程组，避免被调用方退出带走）
info "启动: dsh --profile $PROFILE web  →  日志 $LOG"
: > "$LOG"
if command -v setsid >/dev/null 2>&1; then
  nohup setsid dsh --profile "$PROFILE" web >>"$LOG" 2>&1 < /dev/null &
else
  # macOS 无 setsid：nohup + 后台已足够脱离父 shell
  nohup dsh --profile "$PROFILE" web >>"$LOG" 2>&1 < /dev/null &
fi
NEW_PID=$!

# 3) 等待就绪（端口监听 + /activity/hello 有响应）
for i in $(seq 1 60); do
  sleep 1
  if [ -n "$(listen_pids)" ]; then
    if curl -s -m 2 "http://127.0.0.1:$PORT/activity/hello" >/dev/null 2>&1; then break; fi
  fi
done

if [ -z "$(listen_pids)" ]; then
  warn "新实例 60s 内未监听端口 $PORT，请查看日志：$LOG"
  tail -20 "$LOG" 2>/dev/null
  exit 1
fi

ok "dsh web 已就绪: http://127.0.0.1:$PORT  (启动脚本 PID $NEW_PID)"
echo "--- /activity/hello ---"
curl -s -m 3 "http://127.0.0.1:$PORT/activity/hello" || warn "activity 路由未注册（查看日志确认插件层是否装配）"
echo
echo "--- 最近日志 ---"
tail -5 "$LOG" 2>/dev/null
