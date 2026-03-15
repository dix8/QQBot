export interface ProManVersion {
  version: string
  url?: string
  published_at: string
}

export interface ProManChangelog {
  type: string
  content: string
  sort_order: number
}

export interface ProManAnnouncement {
  title: string
  content: string
  is_pinned: boolean
  published_at: string
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  latestPublishedAt: string
  latestUrl: string
}
