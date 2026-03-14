export interface BasicConfig {
  nickname: string
  masterQQ: number[]
  autoReply: boolean
  autoApproveFriend: boolean
  autoApproveGroup: boolean
  messageScope: 'private' | 'group' | 'both'
  selfCommandEnabled: boolean
  blacklistUsers: number[]
  groupFilterMode: 'none' | 'whitelist' | 'blacklist'
  groupFilterList: number[]
}

export interface KeywordRule {
  id: string
  keyword: string
  reply: string
  matchType: 'exact' | 'contains' | 'regex'
  enabled: boolean
}

export interface MessageConfig {
  keywordRules: KeywordRule[]
}

export interface OnlineTime {
  enabled: boolean
  startHour: number
  endHour: number
}

export interface RateLimit {
  enabled: boolean
  maxMessages: number
  windowSeconds: number
}

export interface RetryConfig {
  enabled: boolean
  maxRetries: number
  retryDelayMs: number
}

export interface RuntimeConfig {
  onlineTime: OnlineTime
  rateLimit: RateLimit
  retry: RetryConfig
}

export interface BotConfigData {
  basic: BasicConfig
  message: MessageConfig
  runtime: RuntimeConfig
}

export type ConfigSection = 'basic' | 'message' | 'runtime'
