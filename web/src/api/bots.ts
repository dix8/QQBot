import { apiFetch } from './client'
import type { BotDetail, BotCreatePayload, BotUpdatePayload, BotWsMessage } from '@/types/bot'

export async function fetchBots(): Promise<{ bots: BotDetail[] }> {
  return apiFetch<{ bots: BotDetail[] }>('/api/bots')
}

export async function fetchBot(id: number): Promise<BotDetail> {
  return apiFetch<BotDetail>(`/api/bots/${id}`)
}

export async function createBot(data: BotCreatePayload): Promise<{ success: boolean; id: number }> {
  return apiFetch<{ success: boolean; id: number }>('/api/bots', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateBot(id: number, data: BotUpdatePayload): Promise<void> {
  await apiFetch(`/api/bots/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteBot(id: number): Promise<void> {
  await apiFetch(`/api/bots/${id}`, { method: 'DELETE' })
}

export async function enableBot(id: number): Promise<void> {
  await apiFetch(`/api/bots/${id}/enable`, { method: 'POST' })
}

export async function disableBot(id: number): Promise<void> {
  await apiFetch(`/api/bots/${id}/disable`, { method: 'POST' })
}

export async function fetchBotWsMessages(id: number, sinceId?: number): Promise<{ messages: BotWsMessage[] }> {
  const qs = sinceId !== undefined ? `?since=${sinceId}` : ''
  return apiFetch<{ messages: BotWsMessage[] }>(`/api/bots/${id}/ws-messages${qs}`)
}
