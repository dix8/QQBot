import { apiFetch } from './client'
import type {
  UpdateCheckResult,
  ProManVersion,
  ProManChangelog,
  ProManAnnouncement,
} from '@/types/proman'

export function checkUpdate(): Promise<UpdateCheckResult> {
  return apiFetch<UpdateCheckResult>('/api/proman/update-check')
}

export function getVersions(page = 1, limit = 20): Promise<{ list: ProManVersion[]; total: number }> {
  return apiFetch<{ list: ProManVersion[]; total: number }>(`/api/proman/versions?page=${page}&limit=${limit}`)
}

export function getChangelogs(version: string): Promise<{ data: ProManChangelog[] }> {
  return apiFetch<{ data: ProManChangelog[] }>(`/api/proman/versions/${encodeURIComponent(version)}/changelogs`)
}

export function getAnnouncements(): Promise<{ data: ProManAnnouncement[] }> {
  return apiFetch<{ data: ProManAnnouncement[] }>('/api/proman/announcements')
}
