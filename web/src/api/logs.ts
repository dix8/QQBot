import { apiFetch, getToken } from './client'
import type { LogLevel, LogSource, LogEntry, LogQueryResult } from '@/types/log'

export async function fetchLogs(params: {
  level?: LogLevel
  source?: LogSource
  search?: string
  page?: number
  limit?: number
}): Promise<LogQueryResult> {
  const query = new URLSearchParams()
  if (params.level) query.set('level', params.level)
  if (params.source) query.set('source', params.source)
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  const qs = query.toString()
  return apiFetch<LogQueryResult>(`/api/logs${qs ? '?' + qs : ''}`)
}

export async function fetchLogsSince(sinceId: number, level?: LogLevel): Promise<{ logs: LogEntry[] }> {
  const qs = level ? `?level=${level}` : ''
  return apiFetch<{ logs: LogEntry[] }>(`/api/logs/since/${sinceId}${qs}`)
}

export async function clearLogs(): Promise<void> {
  await apiFetch('/api/logs', { method: 'DELETE' })
}
