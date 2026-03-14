import { apiFetch } from './client'

export interface GroupInfo {
  group_id: number
  group_name: string
  member_count: number
  max_member_count: number
  enabled: boolean
}

export interface GroupListResponse {
  groups: GroupInfo[]
  filterMode: 'none' | 'whitelist' | 'blacklist'
}

export async function fetchGroups(botId: number): Promise<GroupListResponse> {
  return apiFetch<GroupListResponse>(`/api/bots/${botId}/groups`)
}

export async function toggleGroup(botId: number, groupId: number, enabled: boolean): Promise<void> {
  await apiFetch(`/api/bots/${botId}/groups/${groupId}/toggle`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

export async function batchUpdateGroups(botId: number, enabledGroups: number[]): Promise<void> {
  await apiFetch(`/api/bots/${botId}/groups/batch`, {
    method: 'PUT',
    body: JSON.stringify({ enabledGroups }),
  })
}
