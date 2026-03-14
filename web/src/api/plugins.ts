import { apiFetch, getToken } from './client'
import type { PluginInfo, PluginConfigItem } from '@/types/plugin'

export async function fetchPlugins(): Promise<{ plugins: PluginInfo[] }> {
  return apiFetch<{ plugins: PluginInfo[] }>('/api/plugins')
}

export async function fetchPlugin(id: string): Promise<PluginInfo> {
  return apiFetch<PluginInfo>(`/api/plugins/${id}`)
}

export async function uploadPlugin(file: File): Promise<PluginInfo> {
  const formData = new FormData()
  formData.append('file', file)

  return apiFetch<PluginInfo>('/api/plugins/upload', {
    method: 'POST',
    body: formData,
  })
}

export async function enablePlugin(id: string): Promise<void> {
  await apiFetch(`/api/plugins/${id}/enable`, { method: 'POST' })
}

export async function disablePlugin(id: string): Promise<void> {
  await apiFetch(`/api/plugins/${id}/disable`, { method: 'POST' })
}

export async function updatePluginPriority(id: string, priority: number): Promise<void> {
  await apiFetch(`/api/plugins/${id}/priority`, {
    method: 'PUT',
    body: JSON.stringify({ priority }),
  })
}

export async function deletePlugin(id: string): Promise<void> {
  await apiFetch(`/api/plugins/${id}`, { method: 'DELETE' })
}

export async function reloadAllPlugins(): Promise<{ total: number; failed: string[] }> {
  return apiFetch<{ total: number; failed: string[] }>('/api/plugins/reload', { method: 'POST' })
}

export async function fetchPluginConfig(id: string): Promise<{ schema: PluginConfigItem[], values: Record<string, unknown> }> {
  return apiFetch<{ schema: PluginConfigItem[], values: Record<string, unknown> }>(`/api/plugins/${id}/config`)
}

export async function savePluginConfig(id: string, values: Record<string, unknown>): Promise<void> {
  await apiFetch(`/api/plugins/${id}/config`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  })
}

export async function fetchPluginReadme(id: string): Promise<string> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`/api/plugins/${id}/readme`, { headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.text()
}
