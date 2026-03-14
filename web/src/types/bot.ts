export interface BotDetail {
  id: number
  selfId: number | null
  nickname: string
  remark: string
  description: string
  avatarUrl: string
  wsHost: string
  wsPort: number
  hasToken: boolean
  enabled: boolean
  online: boolean
  connectionId?: string
  state?: string
  connectedAt?: string
  lastHeartbeat?: string
  remoteAddress?: string
  error?: string
}

export interface BotCreatePayload {
  wsHost: string
  wsPort: number
  wsToken?: string
}

export interface BotUpdatePayload {
  remark?: string
  description?: string
  avatarUrl?: string
  wsHost?: string
  wsPort?: number
  wsToken?: string
}

export interface BotWsMessage {
  id: number
  timestamp: string
  type: string
  summary: string
  detail?: string
  source?: string
}
