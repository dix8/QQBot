<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiFetch, isAuthError } from '@/api/client'
import { useAdminWs } from '@/composables/useAdminWs'
import { checkUpdate, getAnnouncements } from '@/api/proman'
import type { UpdateCheckResult, ProManAnnouncement } from '@/types/proman'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { RefreshCw, Bot as BotIcon, ArrowUpCircle, Megaphone, Pin, ChevronDown, ChevronUp, X } from 'lucide-vue-next'
import { displayBotName } from '@/utils/bot'
import { toast } from 'vue-sonner'

interface BotOverview {
  id: number
  selfId: number | null
  remark: string
  nickname: string
  enabled: boolean
  online: boolean
  sentMessageCount: number
  lastHeartbeat?: string
}

interface HealthInfo {
  status: string
  timestamp: string
  connections: number
  totalMessagesSent: number
  bots: {
    total: number
    enabled: number
    connected: number
  }
  memory: {
    total: number
    used: number
    free: number
    percent: number
  }
  cpu: {
    cores: number
    usage: number
    model: string
  }
}

interface HourlyBucket {
  hour: string
  received: number
  sent: number
}

interface DailyBucket {
  date: string
  received: number
  sent: number
}

interface RankedEntry {
  id: number
  count: number
}

interface StatsInfo {
  hourly: HourlyBucket[]
  topGroups: RankedEntry[]
  topUsers: RankedEntry[]
  totalReceived: number
  totalSent: number
  daily?: DailyBucket[]
}

const health = ref<HealthInfo | null>(null)
const stats = ref<StatsInfo | null>(null)
const botList = ref<BotOverview[]>([])
const loading = ref(true)
const refreshing = ref(false)
const error = ref('')
const timeRange = ref<'24h' | '7d' | '30d'>('24h')

const { connected: wsConnected, on: wsOn, off: wsOff } = useAdminWs()

let fallbackTimer: ReturnType<typeof setInterval> | null = null
const FALLBACK_POLL_MS = 5000

function onStatsUpdate(data: unknown) {
  stats.value = data as StatsInfo
  error.value = ''
}

function onHealthUpdate(data: unknown) {
  health.value = data as HealthInfo
  loading.value = false
  error.value = ''
}

function startFallbackPolling() {
  stopFallbackPolling()
  fallbackTimer = setInterval(fetchData, FALLBACK_POLL_MS)
}

function stopFallbackPolling() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer)
    fallbackTimer = null
  }
}

watch(wsConnected, (connected) => {
  if (connected) {
    stopFallbackPolling()
  } else {
    startFallbackPolling()
  }
})

async function fetchData() {
  try {
    const rangeParam = timeRange.value !== '24h' ? `?range=${timeRange.value}` : ''
    const [h, s, b] = await Promise.all([
      apiFetch<HealthInfo>('/api/health'),
      apiFetch<StatsInfo>(`/api/stats${rangeParam}`),
      apiFetch<{ bots: BotOverview[] }>('/api/bots'),
    ])
    health.value = h
    stats.value = s
    botList.value = b.bots
    error.value = ''
  } catch (e) {
    if (isAuthError(e)) {
      stopFallbackPolling()
      return
    }
    const msg = e instanceof Error ? e.message : '请求失败'
    if (msg === '请先修改默认密码') {
      stopFallbackPolling()
      toast.warning('当前使用默认密码，请先修改密码')
      return
    } else {
      error.value = msg
    }
  } finally {
    loading.value = false
  }
}

async function handleRefresh() {
  refreshing.value = true
  try {
    await fetchData()
  } finally {
    refreshing.value = false
  }
}

async function switchRange(range: '24h' | '7d' | '30d') {
  timeRange.value = range
  await fetchData()
}

onMounted(() => {
  fetchData()
  fetchUpdateCheck()
  fetchLatestAnnouncements()
  wsOn('stats:update', onStatsUpdate)
  wsOn('health:update', onHealthUpdate)
  if (!wsConnected.value) {
    startFallbackPolling()
  }
})

onUnmounted(() => {
  stopFallbackPolling()
  wsOff('stats:update', onStatsUpdate)
  wsOff('health:update', onHealthUpdate)
})

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return gb.toFixed(1) + ' GB'
  const mb = bytes / (1024 * 1024)
  return mb.toFixed(0) + ' MB'
}

function formatTime(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

const memoryBarColor = computed(() => {
  if (!health.value) return 'bg-green-500'
  const p = health.value.memory.percent
  if (p >= 90) return 'bg-red-500'
  if (p >= 70) return 'bg-yellow-500'
  return 'bg-green-500'
})

const cpuBarColor = computed(() => {
  if (!health.value) return 'bg-green-500'
  const u = health.value.cpu.usage
  if (u >= 90) return 'bg-red-500'
  if (u >= 70) return 'bg-yellow-500'
  return 'bg-green-500'
})

const hourlyMax = computed(() => {
  if (!stats.value) return 1
  return Math.max(1, ...stats.value.hourly.map(b => Math.max(b.received, b.sent)))
})

const dailyMax = computed(() => {
  if (!stats.value?.daily) return 1
  return Math.max(1, ...stats.value.daily.map(b => Math.max(b.received, b.sent)))
})

// --- ProMan: update check & announcements ---
const updateInfo = ref<UpdateCheckResult | null>(null)
const updateDismissed = ref(false)
const announcements = ref<ProManAnnouncement[]>([])
const announcementsExpanded = ref(false)

async function fetchUpdateCheck() {
  try {
    updateInfo.value = await checkUpdate()
  } catch {
    // silent
  }
}

async function fetchLatestAnnouncements() {
  try {
    const res = await getAnnouncements()
    announcements.value = res.data ?? []
  } catch {
    // silent — don't break dashboard
  }
}

function renderMd(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }) as string)
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('zh-CN')
  } catch {
    return ''
  }
}

const displayAnnouncements = computed(() => {
  const sorted = [...announcements.value].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  })
  return announcementsExpanded.value ? sorted : sorted.slice(0, 2)
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">仪表盘</h1>
        <p class="text-sm text-muted-foreground mt-1">
          系统状态概览
          <span v-if="wsConnected" class="inline-flex items-center gap-1 ml-2 text-green-600 dark:text-green-400">
            <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            实时
          </span>
        </p>
      </div>
      <Button variant="outline" size="sm" @click="handleRefresh" :disabled="refreshing">
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': refreshing }" />
      </Button>
    </div>

    <!-- Update banner -->
    <div
      v-if="updateInfo?.hasUpdate && !updateDismissed"
      class="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
    >
      <ArrowUpCircle class="w-5 h-5 text-primary shrink-0" />
      <div class="flex-1 text-sm">
        <span class="font-medium">新版本 v{{ updateInfo.latestVersion }} 已发布</span>
        <span class="text-muted-foreground ml-1">（当前 v{{ updateInfo.currentVersion }}）</span>
      </div>
      <RouterLink to="/about" class="text-sm text-primary hover:underline shrink-0">查看详情</RouterLink>
      <button class="text-muted-foreground hover:text-foreground shrink-0" @click="updateDismissed = true">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Announcements -->
    <Card v-if="announcements.length > 0">
      <CardHeader class="pb-2">
        <CardTitle class="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Megaphone class="w-4 h-4" /> 公告
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div
          v-for="(ann, idx) in displayAnnouncements"
          :key="idx"
          class="rounded-md border p-3"
          :class="ann.is_pinned ? 'border-primary/30 bg-primary/5' : ''"
        >
          <div class="flex items-center gap-2 mb-2">
            <Pin v-if="ann.is_pinned" class="w-3.5 h-3.5 text-primary shrink-0" />
            <span class="font-semibold text-sm">{{ ann.title }}</span>
            <Badge v-if="ann.is_pinned" variant="default" class="text-xs shrink-0 ml-auto">置顶</Badge>
          </div>
          <hr class="border-border mb-2" />
          <div class="text-sm prose prose-sm dark:prose-invert max-w-none" v-html="renderMd(ann.content)" />
          <div class="text-xs text-muted-foreground mt-2 text-right">{{ formatDate(ann.published_at) }}</div>
        </div>
        <Button
          v-if="announcements.length > 2"
          variant="ghost"
          size="sm"
          class="w-full text-xs"
          @click="announcementsExpanded = !announcementsExpanded"
        >
          <component :is="announcementsExpanded ? ChevronUp : ChevronDown" class="w-3.5 h-3.5 mr-1" />
          {{ announcementsExpanded ? '收起' : `查看全部 ${announcements.length} 条公告` }}
        </Button>
      </CardContent>
    </Card>

    <div v-if="loading" class="text-sm text-muted-foreground">加载中...</div>
    <div v-else-if="error" class="text-sm text-red-500">{{ error }}</div>

    <template v-else-if="health">
      <!-- Top row: status + bots + messages -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">服务状态</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full"
                :class="health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'" />
              <span class="text-2xl font-bold">{{ health.status === 'ok' ? '正常' : health.status }}</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">更新于 {{ formatTime(health.timestamp) }}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">机器人</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-end justify-between">
              <div class="flex items-baseline gap-2">
                <span class="text-2xl font-bold">{{ health.bots.total }}</span>
                <span class="text-sm text-muted-foreground">个机器人</span>
              </div>
              <div class="flex gap-4 text-sm">
                <span>启用 <strong>{{ health.bots.enabled }}</strong></span>
                <span>已连接 <strong class="text-green-600 dark:text-green-400">{{ health.bots.connected }}</strong></span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">消息统计</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ (stats?.totalReceived ?? 0).toLocaleString() }}</span>
              <span class="text-sm text-muted-foreground">收</span>
              <span class="text-lg font-semibold text-muted-foreground">/</span>
              <span class="text-2xl font-bold">{{ (stats?.totalSent ?? health.totalMessagesSent ?? 0).toLocaleString() }}</span>
              <span class="text-sm text-muted-foreground">发</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">累计统计</p>
          </CardContent>
        </Card>
      </div>

      <!-- Bot overview (multi-bot aggregated view) -->
      <Card v-if="botList.length > 1">
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <BotIcon class="w-4 h-4" /> Bot 总览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div v-for="bot in botList" :key="bot.id"
              class="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <img
                :src="bot.selfId ? `https://q1.qlogo.cn/g?b=qq&nk=${bot.selfId}&s=100` : ''"
                class="w-10 h-10 rounded-full bg-muted shrink-0"
                :alt="displayBotName(bot)"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium truncate">{{ displayBotName(bot) }}</span>
                  <span class="w-2 h-2 rounded-full shrink-0"
                    :class="bot.online ? 'bg-green-500' : bot.enabled ? 'bg-yellow-500' : 'bg-gray-400'" />
                </div>
                <div class="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{{ bot.online ? '在线' : bot.enabled ? '离线' : '已禁用' }}</span>
                  <span>发送 {{ bot.sentMessageCount ?? 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Time range toggle + hourly/daily chart -->
      <Card v-if="stats">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium text-muted-foreground">消息趋势</CardTitle>
            <div class="flex gap-1">
              <Button v-for="r in (['24h', '7d', '30d'] as const)" :key="r"
                :variant="timeRange === r ? 'default' : 'ghost'" size="sm"
                class="h-7 px-2 text-xs" @click="switchRange(r)">
                {{ r === '24h' ? '24小时' : r === '7d' ? '7天' : '30天' }}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <!-- Hourly chart (24h) -->
          <template v-if="timeRange === '24h' && stats.hourly.length > 0">
            <div class="flex items-end gap-[2px] h-32">
              <div v-for="(bucket, i) in stats.hourly" :key="i"
                class="flex-1 flex flex-col items-center gap-[1px] min-w-0 group relative">
                <div class="w-full rounded-t-sm bg-blue-500/80 transition-all duration-300"
                  :style="{ height: (bucket.received / hourlyMax * 100) + '%', minHeight: bucket.received > 0 ? '2px' : '0' }" />
                <div class="w-full rounded-b-sm bg-emerald-500/80 transition-all duration-300"
                  :style="{ height: (bucket.sent / hourlyMax * 100) + '%', minHeight: bucket.sent > 0 ? '2px' : '0' }" />
                <div class="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-xs rounded px-2 py-1 shadow-md whitespace-nowrap z-10">
                  {{ bucket.hour }}<br>收: {{ bucket.received }} / 发: {{ bucket.sent }}
                </div>
              </div>
            </div>
            <div class="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>{{ stats.hourly[0]?.hour }}</span>
              <span>{{ stats.hourly[Math.floor(stats.hourly.length / 2)]?.hour }}</span>
              <span>{{ stats.hourly[stats.hourly.length - 1]?.hour }}</span>
            </div>
          </template>

          <!-- Daily chart (7d / 30d) -->
          <template v-else-if="stats.daily && stats.daily.length > 0">
            <div class="flex items-end gap-[2px] h-32">
              <div v-for="(bucket, i) in stats.daily" :key="i"
                class="flex-1 flex flex-col items-center gap-[1px] min-w-0 group relative">
                <div class="w-full rounded-t-sm bg-blue-500/80 transition-all duration-300"
                  :style="{ height: (bucket.received / dailyMax * 100) + '%', minHeight: bucket.received > 0 ? '2px' : '0' }" />
                <div class="w-full rounded-b-sm bg-emerald-500/80 transition-all duration-300"
                  :style="{ height: (bucket.sent / dailyMax * 100) + '%', minHeight: bucket.sent > 0 ? '2px' : '0' }" />
                <div class="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-xs rounded px-2 py-1 shadow-md whitespace-nowrap z-10">
                  {{ bucket.date }}<br>收: {{ bucket.received }} / 发: {{ bucket.sent }}
                </div>
              </div>
            </div>
            <div class="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>{{ stats.daily[0]?.date }}</span>
              <span>{{ stats.daily[stats.daily.length - 1]?.date }}</span>
            </div>
          </template>

          <div v-else class="text-sm text-muted-foreground py-4 text-center">暂无数据</div>

          <div class="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span class="flex items-center gap-1">
              <span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500/80" /> 接收
            </span>
            <span class="flex items-center gap-1">
              <span class="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/80" /> 发送
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- Top groups & users -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4" v-if="stats">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">活跃群组 Top5</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="stats.topGroups.length === 0" class="text-sm text-muted-foreground">暂无数据</div>
            <div v-else class="space-y-2">
              <div v-for="(g, i) in stats.topGroups.slice(0, 5)" :key="g.id" class="flex items-center gap-2">
                <span class="w-5 text-xs font-mono text-muted-foreground text-right">{{ i + 1 }}.</span>
                <div class="flex-1 min-w-0">
                  <div class="flex justify-between text-sm">
                    <span class="font-mono truncate">{{ g.id }}</span>
                    <span class="text-muted-foreground ml-2 shrink-0">{{ g.count }} 条</span>
                  </div>
                  <div class="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                    <div class="h-full bg-blue-500/70 rounded-full transition-all duration-300"
                      :style="{ width: (g.count / (stats.topGroups[0]?.count || 1) * 100) + '%' }" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">活跃用户 Top5</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="stats.topUsers.length === 0" class="text-sm text-muted-foreground">暂无数据</div>
            <div v-else class="space-y-2">
              <div v-for="(u, i) in stats.topUsers.slice(0, 5)" :key="u.id" class="flex items-center gap-2">
                <span class="w-5 text-xs font-mono text-muted-foreground text-right">{{ i + 1 }}.</span>
                <div class="flex-1 min-w-0">
                  <div class="flex justify-between text-sm">
                    <span class="font-mono truncate">{{ u.id }}</span>
                    <span class="text-muted-foreground ml-2 shrink-0">{{ u.count }} 条</span>
                  </div>
                  <div class="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                    <div class="h-full bg-emerald-500/70 rounded-full transition-all duration-300"
                      :style="{ width: (u.count / (stats.topUsers[0]?.count || 1) * 100) + '%' }" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Memory usage -->
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">内存占用</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-2xl font-bold">{{ health.memory.percent }}%</span>
            <span class="text-sm text-muted-foreground">
              {{ formatBytes(health.memory.used) }} / {{ formatBytes(health.memory.total) }}
            </span>
          </div>
          <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500"
              :class="memoryBarColor"
              :style="{ width: health.memory.percent + '%' }" />
          </div>
          <p class="text-xs text-muted-foreground mt-2">
            可用 {{ formatBytes(health.memory.free) }}
          </p>
        </CardContent>
      </Card>

      <!-- CPU load -->
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">CPU 负载</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-2xl font-bold">{{ health.cpu.usage }}%</span>
            <span class="text-sm text-muted-foreground">{{ health.cpu.cores }} 核心</span>
          </div>
          <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500"
              :class="cpuBarColor"
              :style="{ width: health.cpu.usage + '%' }" />
          </div>
          <p class="text-xs text-muted-foreground mt-2">{{ health.cpu.model }}</p>
        </CardContent>
      </Card>

    </template>
  </div>
</template>
