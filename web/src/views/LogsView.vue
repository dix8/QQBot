<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLogsStore } from '@/stores/logs'
import { useAdminWs } from '@/composables/useAdminWs'
import { isAuthError, getToken } from '@/api/client'
import { toast } from 'vue-sonner'
import { RefreshCw, Trash2, Search, ChevronLeft, ChevronRight, Download } from 'lucide-vue-next'
import type { LogEntry } from '@/types/log'

const store = useLogsStore()
const { connected: wsConnected, on: wsOn, off: wsOff } = useAdminWs()
const autoRefresh = ref(localStorage.getItem('logs_auto_refresh') !== 'false')
const showClearConfirm = ref(false)
const clearing = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const LOG_POLL_INTERVAL_MS = 5000

function onLogPush(data: unknown) {
  if (!autoRefresh.value) return
  store.pushLog(data as LogEntry)
}

onMounted(() => {
  store.fetchLogs()
  wsOn('log:new', onLogPush)
  if (autoRefresh.value && !wsConnected.value) {
    startFallbackPolling()
  }
})

onUnmounted(() => {
  stopFallbackPolling()
  wsOff('log:new', onLogPush)
})

watch(wsConnected, (connected) => {
  if (connected) {
    stopFallbackPolling()
  } else if (autoRefresh.value) {
    startFallbackPolling()
  }
})

function toggleAutoRefresh(enabled: boolean) {
  autoRefresh.value = enabled
  localStorage.setItem('logs_auto_refresh', String(enabled))
  if (enabled && !wsConnected.value) {
    startFallbackPolling()
  } else {
    stopFallbackPolling()
  }
}

function startFallbackPolling() {
  stopFallbackPolling()
  pollTimer = setInterval(async () => {
    try {
      await store.pollNewLogs()
    } catch (e) {
      if (isAuthError(e)) {
        stopFallbackPolling()
        autoRefresh.value = false
        localStorage.setItem('logs_auto_refresh', 'false')
      }
    }
  }, LOG_POLL_INTERVAL_MS)
}

function stopFallbackPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function applyFilter() {
  store.applyFilter()
}

function resetFilter() {
  store.resetFilters()
}

async function confirmClear() {
  clearing.value = true
  try {
    await store.clear()
    showClearConfirm.value = false
    toast.success('日志已清空')
    await store.fetchLogs()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '清空日志失败')
  } finally {
    clearing.value = false
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.limit)))

async function exportLogs(format: 'json' | 'csv') {
  const params = new URLSearchParams()
  params.set('format', format)
  params.set('limit', '10000')
  if (store.filterLevel && store.filterLevel !== 'all') params.set('level', store.filterLevel)
  if (store.filterSource && store.filterSource !== 'all') params.set('source', store.filterSource)
  if (store.filterSearch) params.set('search', store.filterSearch)

  try {
    const res = await fetch(`/api/logs/export?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) throw new Error('导出失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.${format}`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`日志已导出为 ${format.toUpperCase()}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '导出失败')
  }
}

function levelColor(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (level) {
    case 'error': return 'destructive'
    case 'warn': return 'outline'
    case 'info': return 'default'
    case 'debug': return 'secondary'
    default: return 'secondary'
  }
}

function levelLabel(level: string) {
  const map: Record<string, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' }
  return map[level] ?? level.toUpperCase()
}

function sourceLabel(source: string) {
  const map: Record<string, string> = { system: '系统', connection: '连接', bot: '机器人', plugin: '插件', config: '配置', auth: '认证' }
  return map[source] ?? source
}

function formatTime(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">日志</h1>
        <p class="text-sm text-muted-foreground mt-1">查看系统操作日志、连接日志和插件日志</p>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <Label class="text-sm">自动刷新</Label>
          <Switch :model-value="autoRefresh" @update:model-value="toggleAutoRefresh" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm">
              <Download class="w-4 h-4 mr-1" />
              导出
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="exportLogs('csv')">导出为 CSV</DropdownMenuItem>
            <DropdownMenuItem @click="exportLogs('json')">导出为 JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog v-model:open="showClearConfirm">
          <DialogTrigger as-child>
            <Button variant="destructive" size="sm">
              <Trash2 class="w-4 h-4 mr-1" />
              清空
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认清空日志</DialogTitle>
            </DialogHeader>
            <p class="text-sm text-muted-foreground py-4">此操作将删除所有日志记录，且不可恢复。确定要继续吗？</p>
            <DialogFooter>
              <DialogClose as-child>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <Button variant="destructive" @click="confirmClear" :disabled="clearing">
                {{ clearing ? '清空中...' : '确认清空' }}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>

    <!-- Filters -->
    <Card>
      <CardContent class="pt-4">
        <div class="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-3">
          <div class="space-y-1">
            <Label class="text-xs">级别</Label>
            <Select v-model="store.filterLevel">
              <SelectTrigger class="w-full sm:w-[120px]">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="debug">DEBUG</SelectItem>
                <SelectItem value="info">INFO</SelectItem>
                <SelectItem value="warn">WARN</SelectItem>
                <SelectItem value="error">ERROR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1">
            <Label class="text-xs">来源</Label>
            <Select v-model="store.filterSource">
              <SelectTrigger class="w-full sm:w-[120px]">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="system">系统</SelectItem>
                <SelectItem value="connection">连接</SelectItem>
                <SelectItem value="bot">机器人</SelectItem>
                <SelectItem value="plugin">插件</SelectItem>
                <SelectItem value="config">配置</SelectItem>
                <SelectItem value="auth">认证</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1 col-span-2 sm:flex-1 sm:min-w-[200px]">
            <Label class="text-xs">搜索</Label>
            <Input v-model="store.filterSearch" placeholder="搜索日志内容..." @keyup.enter="applyFilter" />
          </div>
          <div class="col-span-2 flex gap-2 sm:col-span-1">
            <Button @click="applyFilter" size="sm" class="flex-1 sm:flex-initial">
              <Search class="w-4 h-4 mr-1" />
              筛选
            </Button>
            <Button @click="resetFilter" variant="outline" size="sm" class="flex-1 sm:flex-initial">重置</Button>
            <Button @click="store.fetchLogs()" variant="outline" size="sm">
              <RefreshCw class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Logs -->
    <Card>
      <CardContent class="pt-4">
        <div v-if="store.error" class="text-sm text-destructive py-8 text-center">
          {{ store.error }}
        </div>
        <div v-else-if="store.loading && store.logs.length === 0" class="text-sm text-muted-foreground py-8 text-center">
          加载中...
        </div>
        <div v-else-if="store.logs.length === 0" class="text-sm text-muted-foreground py-8 text-center">
          暂无日志
        </div>

        <!-- Mobile: card list -->
        <div v-else class="sm:hidden space-y-3">
          <div
            v-for="log in store.logs"
            :key="log.id"
            class="border rounded-lg p-3 space-y-2"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Badge :variant="levelColor(log.level)">{{ levelLabel(log.level) }}</Badge>
                <span class="text-sm text-muted-foreground">{{ sourceLabel(log.source) }}</span>
              </div>
              <span class="text-xs text-muted-foreground">{{ formatTime(log.createdAt) }}</span>
            </div>
            <p class="text-sm break-all">{{ log.message }}</p>
            <p v-if="log.details" class="text-xs text-muted-foreground break-all">{{ log.details }}</p>
          </div>
        </div>

        <!-- Desktop: table -->
        <Table v-if="store.logs.length > 0" class="hidden sm:table">
          <TableHeader>
            <TableRow>
              <TableHead class="w-20">级别</TableHead>
              <TableHead class="w-20">来源</TableHead>
              <TableHead>内容</TableHead>
              <TableHead class="w-44">时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="log in store.logs" :key="log.id">
              <TableCell>
                <Badge :variant="levelColor(log.level)">{{ levelLabel(log.level) }}</Badge>
              </TableCell>
              <TableCell class="text-sm text-muted-foreground">{{ sourceLabel(log.source) }}</TableCell>
              <TableCell class="text-sm max-w-[500px]">
                <span class="break-all">{{ log.message }}</span>
                <span v-if="log.details" class="block text-xs text-muted-foreground mt-1 break-all">{{ log.details }}</span>
              </TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ formatTime(log.createdAt) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <!-- Pagination -->
        <div v-if="store.total > store.limit" class="flex items-center justify-between mt-4 pt-4 border-t">
          <span class="text-sm text-muted-foreground">
            共 {{ store.total }} 条，第 {{ store.page }} / {{ totalPages }} 页
          </span>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="store.page <= 1"
              @click="store.setPage(store.page - 1)"
            >
              <ChevronLeft class="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="store.page >= totalPages"
              @click="store.setPage(store.page + 1)"
            >
              <ChevronRight class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
