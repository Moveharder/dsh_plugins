/** oh-my-dshtoken — host half 类型声明 */

export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  /** 输入 + 输出 */
  grandTotal: number
  cacheReadTokens: number
  cacheWriteTokens: number
  steps: number
}

export interface ProjectUsage extends Omit<TokenTotals, 'grandTotal'> {
  cwd: string
  name: string
  sessionCount: number
  lastActive: number
  createdAtMin: number
  models: Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; steps: number }>
  grandTotal: number
}

export interface SessionUsage {
  id: string
  shortId: string
  title: string
  cwd: string
  projectName: string
  primaryModel: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  steps: number
  createdAt: number
  lastActive: number
  grandTotal: number
}

export interface ModelUsage {
  key: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  steps: number
  sessionCount: number
  grandTotal: number
}

export interface DailyTrendPoint {
  day: string
  inputTokens: number
  outputTokens: number
  grandTotal: number
}

export interface TokenStatsSnapshot {
  generatedAt: number
  totals: TokenTotals
  counts: {
    projects: number
    sessions: number
    models: number
    files: number
    errors: number
    truncated: boolean
  }
  projects: ProjectUsage[]
  sessions: SessionUsage[]
  models: ModelUsage[]
  dailyTrend: DailyTrendPoint[]
  sessionsRoot: string
}

export declare const name: string
export declare const inject: string[]
export declare function apply(ctx: any): void
