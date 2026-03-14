import { apiFetch } from './client'
import type { BotConfigData, ConfigSection } from '@/types/config'

export async function fetchAllConfig(botId: number): Promise<BotConfigData> {
  return apiFetch<BotConfigData>(`/api/bots/${botId}/config`)
}

export async function fetchConfigSection<T>(botId: number, section: ConfigSection): Promise<T> {
  return apiFetch<T>(`/api/bots/${botId}/config/${section}`)
}

export async function updateConfigSection(botId: number, section: ConfigSection, value: unknown): Promise<void> {
  await apiFetch(`/api/bots/${botId}/config/${section}`, {
    method: 'PUT',
    body: JSON.stringify(value),
  })
}

export async function exportConfig(botId: number): Promise<BotConfigData> {
  return apiFetch<BotConfigData>(`/api/bots/${botId}/config/export`)
}

export async function importConfig(botId: number, data: BotConfigData): Promise<void> {
  await apiFetch(`/api/bots/${botId}/config/import`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
