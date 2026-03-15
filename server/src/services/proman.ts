import { env } from '../config/env.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, ts: Date.now() });
}

async function promanFetch<T>(path: string): Promise<T> {
  const url = `${env.PROMAN_API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.PROMAN_API_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`ProMan API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface ProManVersion {
  version: string;
  url?: string;
  published_at: string;
}

export interface ProManChangelog {
  type: string;
  content: string;
  sort_order: number;
}

export interface ProManAnnouncement {
  title: string;
  content: string;
  is_pinned: boolean;
  published_at: string;
}

// ProMan API wraps all responses in { code, message, data }
interface ProManResponse<T> {
  code: number;
  message: string;
  data: T;
}

export const promanService = {
  async getVersions(page = 1, limit = 20): Promise<{ list: ProManVersion[]; total: number }> {
    const key = `versions:${page}:${limit}`;
    const cached = getCached<{ list: ProManVersion[]; total: number }>(key);
    if (cached) return cached;

    const res = await promanFetch<ProManResponse<{ list: ProManVersion[]; total: number }>>(
      `/v1/versions?page=${page}&limit=${limit}`,
    );
    const result = { list: res.data.list ?? [], total: res.data.total ?? 0 };
    setCache(key, result);
    return result;
  },

  async getChangelogs(version: string): Promise<ProManChangelog[]> {
    const key = `changelogs:${version}`;
    const cached = getCached<ProManChangelog[]>(key);
    if (cached) return cached;

    const res = await promanFetch<ProManResponse<{ changelogs: ProManChangelog[] }>>(
      `/v1/versions/${encodeURIComponent(version)}/changelogs`,
    );
    const data = res.data.changelogs ?? [];
    setCache(key, data);
    return data;
  },

  async getAnnouncements(): Promise<ProManAnnouncement[]> {
    const key = 'announcements';
    const cached = getCached<ProManAnnouncement[]>(key);
    if (cached) return cached;

    const res = await promanFetch<ProManResponse<{ list: ProManAnnouncement[] }>>('/v1/announcements');
    const data = res.data.list ?? [];
    setCache(key, data);
    return data;
  },

  async checkUpdate(currentVersion: string): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    latestPublishedAt: string;
    latestUrl: string;
  }> {
    const key = 'update-check';
    const cached = getCached<{ hasUpdate: boolean; currentVersion: string; latestVersion: string; latestPublishedAt: string; latestUrl: string }>(key);
    if (cached && cached.currentVersion === currentVersion) return cached;

    const { list } = await this.getVersions(1, 1);
    const latest = list[0];
    if (!latest) {
      const result = { hasUpdate: false, currentVersion, latestVersion: currentVersion, latestPublishedAt: '', latestUrl: '' };
      setCache(key, result);
      return result;
    }

    const result = {
      hasUpdate: latest.version !== currentVersion,
      currentVersion,
      latestVersion: latest.version,
      latestPublishedAt: latest.published_at,
      latestUrl: latest.url || '',
    };
    setCache(key, result);
    return result;
  },
};
