import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LogEntry, LogLevel, LogSource } from '@/types/log'
import { isAuthError } from '@/api/client'
import * as logsApi from '@/api/logs'

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<LogEntry[]>([])
  const total = ref(0)
  const page = ref(1)
  const limit = ref(50)
  const loading = ref(false)
  const error = ref('')

  // Filters
  const filterLevel = ref<LogLevel | 'all'>('all')
  const filterSource = ref<LogSource | 'all'>('all')
  const filterSearch = ref('')

  async function fetchLogs() {
    loading.value = true
    error.value = ''
    try {
      const result = await logsApi.fetchLogs({
        level: filterLevel.value === 'all' ? undefined : filterLevel.value,
        source: filterSource.value === 'all' ? undefined : filterSource.value,
        search: filterSearch.value || undefined,
        page: page.value,
        limit: limit.value,
      })
      logs.value = result.logs
      total.value = result.total
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载日志失败'
    } finally {
      loading.value = false
    }
  }

  async function pollNewLogs() {
    if (logs.value.length === 0) {
      await fetchLogs()
      return
    }
    const maxId = Math.max(...logs.value.map((l) => l.id))
    try {
      const level = filterLevel.value === 'all' ? undefined : filterLevel.value
      const result = await logsApi.fetchLogsSince(maxId, level)
      if (result.logs.length > 0) {
        const merged = [...result.logs.reverse(), ...logs.value]
        logs.value = merged.slice(0, limit.value)
        total.value = Math.max(total.value + result.logs.length, merged.length)
      }
    } catch (e) {
      // Re-throw auth errors so callers can stop polling
      if (isAuthError(e)) throw e
      // Other polling errors handled silently
    }
  }

  async function clear() {
    await logsApi.clearLogs()
    logs.value = []
    total.value = 0
    page.value = 1
  }

  async function setPage(p: number) {
    page.value = p
    await fetchLogs()
  }

  function applyFilter() {
    page.value = 1
    fetchLogs()
  }

  function resetFilters() {
    filterLevel.value = 'all'
    filterSource.value = 'all'
    filterSearch.value = ''
    page.value = 1
    fetchLogs()
  }

  function pushLog(entry: LogEntry) {
    if (page.value !== 1) return
    if (filterSource.value !== 'all' && entry.source !== filterSource.value) return
    if (filterLevel.value !== 'all' && entry.level !== filterLevel.value) return
    if (filterSearch.value && !entry.message.includes(filterSearch.value)) return
    logs.value = [entry, ...logs.value].slice(0, limit.value)
    total.value++
  }

  return {
    logs, total, page, limit, loading, error,
    filterLevel, filterSource, filterSearch,
    fetchLogs, pollNewLogs, pushLog, clear, setPage,
    applyFilter, resetFilters,
  }
})
