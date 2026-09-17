/**
 * 全年活跃记录 (dsh-annual-activity) — host half type declarations.
 *
 * 纯本地的活跃度统计引擎：扫描 $DSH_HOME/sessions 下的历史会话日志，按本地日历日
 * 聚合活跃天 / 轮次 / 工具调用 / Token，并通过 webServer 暴露只读 HTTP 路由。
 */

/** 一天的活跃记录（`level` 由「轮次」主口径决定，0-4）。 */
export interface ActivityDay {
  /** 本地日历日 'YYYY-MM-DD' */
  day: string
  /** 当天有活动的会话数（去重） */
  activeSessions: number
  turns: number
  steps: number
  userMessages: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  /** 输入 + 输出（缓存读取不计入，另见 tooltip） */
  tokens: number
  level: number
}

/** 活跃等级定义（Host 下发，保证色块深度与口径一致）。 */
export interface ActivityLevel {
  level: number
  label: string
  min: number
  /** null = 无上限 */
  max: number | null
}

/** 某年的派生统计。 */
export interface ActivityYearStats {
  year: number
  activeDays: number
  /** 活跃率分母：当前年 = 已过天数，历史年 = 全年天数 */
  totalDays: number
  rate: number
  /** 当前周连登（周一为一周起点，上周仍有记录则视为未断） */
  weekStreak: number
  longestWeekStreak: number
  longestDayStreak: number
}

/** 会话摘要（用于面板补充信息，按最近活跃倒序，最多 400 条）。 */
export interface ActivitySessionSummary {
  id: string
  title: string
  project: string
  createdAt: number
  lastActive: number
  turns: number
  tokens: number
  activeDays: number
}

/** `GET /activity/pull` 的响应体。 */
export interface ActivityPayload {
  version: string
  seq: number
  today: string
  currentYear: number
  years: number[]
  yearStats: Record<string, ActivityYearStats>
  /** 本次响应选中的年份 */
  year: number
  /** 选中年份的日明细（有界） */
  days: ActivityDay[]
  stats: ActivityYearStats | null
  levels: ActivityLevel[]
  sessions: ActivitySessionSummary[]
  sessionCount: number
  projects: number
  totalTurns: number
  totalTokens: number
  scannedAt: number
  scanMs: number
  scanErrors: number
  timeZone: string
  scanning: boolean
  lastError: string
}

/** 插件名（bundle id）。 */
export declare const name: 'dsh-annual-activity'
/** 依赖服务：webServer 注册路由，timer 提供周期任务。 */
export declare const inject: readonly ['timer', 'webServer']
/** Cordis 插件入口。 */
export declare function apply(ctx: unknown): void
