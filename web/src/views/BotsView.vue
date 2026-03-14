<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useBotsStore } from '@/stores/bots'
import { useAdminWs } from '@/composables/useAdminWs'
import { fetchBotWsMessages } from '@/api/bots'
import { isAuthError } from '@/api/client'
import { toast } from 'vue-sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bot, Pencil, Settings, Trash2, Plus, Wifi, WifiOff, RefreshCw, MessageSquare, Download } from 'lucide-vue-next'
import type { BotDetail, BotWsMessage } from '@/types/bot'

const store = useBotsStore()

// --- Add dialog ---
const addOpen = ref(false)
const addHost = ref('127.0.0.1')
const addPort = ref(8095)
const addToken = ref('')
const adding = ref(false)

async function handleAdd() {
  adding.value = true
  try {
    await store.createBot({
      wsHost: addHost.value,
      wsPort: addPort.value,
      wsToken: addToken.value,
    })
    addOpen.value = false
    addHost.value = '127.0.0.1'
    addPort.value = 8095
    addToken.value = ''
    toast.success('机器人添加成功')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '添加机器人失败')
  } finally {
    adding.value = false
  }
}

// --- Edit dialog (remark / description) ---
const editOpen = ref(false)
const editBot = ref<BotDetail | null>(null)
const editRemark = ref('')
const editDescription = ref('')
const saving = ref(false)

function openEdit(bot: BotDetail) {
  editBot.value = bot
  editRemark.value = bot.remark
  editDescription.value = bot.description
  editOpen.value = true
}

async function saveEdit() {
  if (!editBot.value) return
  saving.value = true
  try {
    await store.updateBot(editBot.value.id, {
      remark: editRemark.value,
      description: editDescription.value,
    })
    editOpen.value = false
    toast.success('机器人信息已更新')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '更新机器人信息失败')
  } finally {
    saving.value = false
  }
}

// --- Settings dialog (WS connection config) ---
const settingsOpen = ref(false)
const settingsBot = ref<BotDetail | null>(null)
const settingsHost = ref('')
const settingsPort = ref(8095)
const settingsToken = ref('')
const settingsClearToken = ref(false)
const savingSettings = ref(false)

function openSettings(bot: BotDetail) {
  settingsBot.value = bot
  settingsHost.value = bot.wsHost
  settingsPort.value = bot.wsPort
  settingsToken.value = ''
  settingsClearToken.value = false
  settingsOpen.value = true
}

async function saveSettings() {
  if (!settingsBot.value) return
  savingSettings.value = true
  try {
    const payload: Record<string, unknown> = {
      wsHost: settingsHost.value,
      wsPort: settingsPort.value,
    }
    // Only send wsToken if user explicitly entered a new value or cleared it
    if (settingsClearToken.value) {
      payload.wsToken = ''
    } else if (settingsToken.value) {
      payload.wsToken = settingsToken.value
    }
    await store.updateBot(settingsBot.value.id, payload)
    settingsOpen.value = false
    toast.success('连接设置已更新')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '更新连接设置失败')
  } finally {
    savingSettings.value = false
  }
}

// --- Delete dialog ---
const deleteOpen = ref(false)
const deleteBot = ref<BotDetail | null>(null)
const deleting = ref(false)

function openDelete(bot: BotDetail) {
  deleteBot.value = bot
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleteBot.value) return
  deleting.value = true
  try {
    await store.deleteBot(deleteBot.value.id)
    deleteOpen.value = false
    toast.success('机器人已删除')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '删除机器人失败')
  } finally {
    deleting.value = false
  }
}

// --- Enable / Disable toggle ---
const toggling = ref<number | null>(null)

async function handleToggle(bot: BotDetail) {
  toggling.value = bot.id
  try {
    if (bot.enabled) {
      await store.disableBot(bot.id)
      toast.success('机器人已禁用')
    } else {
      await store.enableBot(bot.id)
      toast.success('机器人已启用')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    toggling.value = null
  }
}

// --- WS Messages dialog ---
const messagesOpen = ref(false)
const messagesBot = ref<BotDetail | null>(null)
const wsMessages = ref<BotWsMessage[]>([])
const messagesLoading = ref(false)
let messagesPollTimer: ReturnType<typeof setInterval> | undefined

const WS_MESSAGES_POLL_MS = 3000
const BOTS_POLL_MS = 30000

function openMessages(bot: BotDetail) {
  messagesBot.value = bot
  wsMessages.value = []
  messagesOpen.value = true
  loadMessages(bot.id)
  messagesPollTimer = setInterval(() => pollMessages(bot.id), WS_MESSAGES_POLL_MS)
}

function closeMessages() {
  messagesOpen.value = false
  if (messagesPollTimer) {
    clearInterval(messagesPollTimer)
    messagesPollTimer = undefined
  }
}

async function loadMessages(botId: number) {
  messagesLoading.value = true
  try {
    const result = await fetchBotWsMessages(botId)
    wsMessages.value = result.messages
  } catch (e) {
    if (isAuthError(e)) closeMessages()
  } finally {
    messagesLoading.value = false
  }
}

async function pollMessages(botId: number) {
  if (!messagesOpen.value) return
  const maxId = wsMessages.value.length > 0
    ? Math.max(...wsMessages.value.map(m => m.id))
    : undefined
  try {
    const result = await fetchBotWsMessages(botId, maxId)
    if (result.messages.length > 0) {
      wsMessages.value = [...wsMessages.value, ...result.messages]
      // Keep last 500
      if (wsMessages.value.length > 500) {
        wsMessages.value = wsMessages.value.slice(-500)
      }
    }
  } catch (e) {
    if (isAuthError(e)) closeMessages()
  }
}

// --- WS Messages filter & download ---
const messageFilter = ref('all')
const sourceFilter = ref('all')

const MESSAGE_TYPES = [
  { value: 'all', label: '全部' },
  { value: 'private', label: '私聊' },
  { value: 'group', label: '群聊' },
  { value: 'notice', label: '通知' },
  { value: 'request', label: '请求' },
  { value: 'lifecycle', label: '生命周期' },
]

/** Collect unique source values from messages for the source filter dropdown */
const availableSources = computed(() => {
  const sources = new Set<string>()
  for (const m of wsMessages.value) {
    if (m.source) sources.add(m.source)
  }
  return Array.from(sources).sort()
})

const filteredMessages = computed(() => {
  let msgs = wsMessages.value.filter(m => m.type !== 'heartbeat')
  if (messageFilter.value !== 'all') {
    const f = messageFilter.value
    msgs = msgs.filter(m => m.type === f || m.type === `send_${f}`)
  }
  if (sourceFilter.value !== 'all') {
    msgs = msgs.filter(m => m.source === sourceFilter.value)
  }
  return [...msgs].reverse()
})

function downloadMessages() {
  if (!messagesBot.value) return
  const data = filteredMessages.value.map(m => {
    const sourceTag = m.source ? ` [${m.source}]` : ''
    return `[${m.timestamp}] [${messageTypeLabel(m.type)}]${sourceTag} ${m.summary}`
  }).reverse().join('\n')
  const blob = new Blob([data], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bot-${messagesBot.value.id}-ws-messages-${new Date().toISOString().slice(0, 10)}.log`
  a.click()
  URL.revokeObjectURL(url)
  toast.success('消息日志已下载')
}

function messageTypeColor(type: string): string {
  switch (type) {
    case 'private': return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    case 'group': return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
    case 'send_private': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
    case 'send_group': return 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300'
    case 'notice': return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
    case 'request': return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
    case 'lifecycle': return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
    default: return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  }
}

function messageTypeLabel(type: string): string {
  const map: Record<string, string> = {
    private: '私聊',
    group: '群聊',
    send_private: '发送私聊',
    send_group: '发送群聊',
    notice: '通知',
    request: '请求',
    lifecycle: '生命周期',
  }
  return map[type] ?? type
}

// --- Helpers ---
function displayName(bot: BotDetail) {
  return bot.remark || bot.nickname || (bot.selfId ? String(bot.selfId) : `Bot #${bot.id}`)
}

function avatarUrl(bot: BotDetail) {
  if (bot.avatarUrl) return bot.avatarUrl
  if (bot.selfId) return `https://q1.qlogo.cn/g?b=qq&nk=${bot.selfId}&s=640`
  return undefined
}

function formatTime(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

function formatTimeShort(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString()
}

// WS + fallback polling
const { connected: wsConnected, on: wsOn, off: wsOff } = useAdminWs()
let pollTimer: ReturnType<typeof setInterval> | undefined
const refreshing = ref(false)

async function handleRefresh() {
  refreshing.value = true
  try {
    await store.fetchBots()
  } finally {
    refreshing.value = false
  }
}

function onBotStatus() {
  store.fetchBots()
}

function startFallbackPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => store.fetchBots(), BOTS_POLL_MS)
}

function stopFallbackPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

watch(wsConnected, (connected) => {
  if (connected) {
    stopFallbackPolling()
  } else {
    startFallbackPolling()
  }
})

onMounted(() => {
  store.fetchBots()
  wsOn('bot:status', onBotStatus)
  if (!wsConnected.value) {
    startFallbackPolling()
  }
})

onUnmounted(() => {
  stopFallbackPolling()
  if (messagesPollTimer) clearInterval(messagesPollTimer)
  wsOff('bot:status', onBotStatus)
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">机器人管理</h1>
        <p class="text-sm text-muted-foreground mt-1">管理 NapCat 机器人连接</p>
      </div>
      <div class="flex items-center gap-2">
        <Button @click="addOpen = true">
          <Plus class="w-4 h-4 mr-1" />
          添加机器人
        </Button>
        <Button variant="outline" size="sm" @click="handleRefresh" :disabled="refreshing">
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': refreshing }" />
        </Button>
      </div>
    </div>

    <div v-if="store.error" class="text-sm text-destructive py-4">
      {{ store.error }}
    </div>

    <div v-if="store.loading && store.bots.length === 0" class="text-sm text-muted-foreground">
      加载中...
    </div>

    <!-- Empty state -->
    <div v-if="store.bots.length === 0 && !store.loading && !store.error" class="text-center py-12">
      <Bot class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
      <p class="text-muted-foreground">暂无机器人</p>
      <p class="text-sm text-muted-foreground mt-1">
        点击"添加机器人"输入 NapCat 的 WebSocket 地址来添加
      </p>
    </div>

    <!-- Bot cards -->
    <div v-else class="space-y-4">
      <Card v-for="bot in store.bots" :key="bot.id">
        <CardContent class="pt-4">
          <div class="flex flex-col sm:flex-row sm:items-start gap-4">
            <!-- Top row: Avatar + Info -->
            <div class="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
              <!-- Avatar -->
              <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-full shrink-0 bg-muted flex items-center justify-center overflow-hidden">
                <img
                  v-if="avatarUrl(bot)"
                  :src="avatarUrl(bot)"
                  :alt="displayName(bot)"
                  class="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover"
                />
                <Bot v-else class="w-6 h-6 sm:w-7 sm:h-7 text-muted-foreground" />
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <span class="font-semibold text-base sm:text-lg truncate max-w-[160px] sm:max-w-none">{{ displayName(bot) }}</span>
                  <Badge :variant="bot.online ? 'default' : 'secondary'">
                    <component :is="bot.online ? Wifi : WifiOff" class="w-3 h-3 mr-1" />
                    {{ bot.online ? '在线' : '离线' }}
                  </Badge>
                </div>

                <p v-if="bot.selfId" class="text-sm text-muted-foreground">QQ: {{ bot.selfId }}</p>

                <p v-if="bot.nickname && bot.remark" class="text-sm text-muted-foreground">
                  昵称: {{ bot.nickname }}
                </p>

                <p v-if="bot.description" class="text-sm text-muted-foreground mt-1">
                  {{ bot.description }}
                </p>

                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                  <span>WS: {{ bot.wsHost }}:{{ bot.wsPort }}</span>
                  <span v-if="bot.online && bot.connectedAt">连接时间: {{ formatTime(bot.connectedAt) }}</span>
                  <span v-if="bot.online && bot.lastHeartbeat">最近心跳: {{ formatTime(bot.lastHeartbeat) }}</span>
                </div>

                <p v-if="bot.error" class="text-sm text-red-500 mt-1">{{ bot.error }}</p>
              </div>
            </div>

            <!-- Actions -->
            <div class="shrink-0 flex items-center gap-1 border-t sm:border-t-0 pt-3 sm:pt-0 -mx-2 px-2 sm:mx-0 sm:px-0">
              <Switch
                :model-value="bot.enabled"
                :disabled="toggling === bot.id"
                @update:model-value="handleToggle(bot)"
              />
              <Button variant="ghost" size="sm" @click="openMessages(bot)" title="WS 消息">
                <MessageSquare class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" @click="openSettings(bot)" title="连接设置">
                <Settings class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" @click="openEdit(bot)" title="编辑备注">
                <Pencil class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" @click="openDelete(bot)" title="删除" class="text-red-500 hover:text-red-600">
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Add Dialog -->
    <Dialog v-model:open="addOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加机器人</DialogTitle>
          <DialogDescription>配置反向 WebSocket 监听地址（NapCat 将连接到此地址）</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label>反向 WebSocket 主机</Label>
            <Input v-model="addHost" placeholder="127.0.0.1" />
          </div>
          <div class="space-y-2">
            <Label>反向 WebSocket 端口</Label>
            <Input v-model.number="addPort" type="number" placeholder="8095" />
          </div>
          <div class="space-y-2">
            <Label>Access Token（必填）</Label>
            <Input v-model="addToken" placeholder="用于 NapCat 反向 WS 鉴权" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="addOpen = false">取消</Button>
          <Button @click="handleAdd" :disabled="adding || !addHost || !addPort || !addToken">
            {{ adding ? '添加中...' : '添加' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Edit Dialog (remark / description) -->
    <Dialog v-model:open="editOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑机器人信息</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label>备注名</Label>
            <Input v-model="editRemark" placeholder="自定义备注名" />
          </div>
          <div class="space-y-2">
            <Label>描述</Label>
            <Input v-model="editDescription" placeholder="自定义描述信息" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="editOpen = false">取消</Button>
          <Button @click="saveEdit" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Settings Dialog (WS connection config) -->
    <Dialog v-model:open="settingsOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>连接设置</DialogTitle>
          <DialogDescription>修改反向 WebSocket 监听参数（保存后将自动重启监听服务）</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label>反向 WebSocket 主机</Label>
            <Input v-model="settingsHost" placeholder="0.0.0.0" />
          </div>
          <div class="space-y-2">
            <Label>反向 WebSocket 端口</Label>
            <Input v-model.number="settingsPort" type="number" placeholder="8095" />
          </div>
          <div class="space-y-2">
            <Label>Access Token</Label>
            <div class="relative">
              <Input v-model="settingsToken"
                :placeholder="settingsClearToken ? '已清空，保存后生效' : settingsBot?.hasToken ? '已设置，留空保持不变' : '请设置鉴权 Token'"
                :disabled="settingsClearToken"
                :class="(settingsBot?.hasToken || settingsClearToken) ? 'pr-16' : ''" />
              <button v-if="settingsBot?.hasToken && !settingsClearToken" type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                @click="settingsClearToken = true; settingsToken = ''">
                清空
              </button>
              <button v-if="settingsClearToken" type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                @click="settingsClearToken = false">
                撤销
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="settingsOpen = false">取消</Button>
          <Button @click="saveSettings" :disabled="savingSettings || !settingsHost || !settingsPort">
            {{ savingSettings ? '保存中...' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm Dialog -->
    <Dialog v-model:open="deleteOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            确定要删除机器人「{{ deleteBot ? displayName(deleteBot) : '' }}」吗？此操作将断开连接并删除记录，不可恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="deleteOpen = false">取消</Button>
          <Button variant="destructive" @click="confirmDelete" :disabled="deleting">
            {{ deleting ? '删除中...' : '删除' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- WS Messages Dialog -->
    <Dialog :open="messagesOpen" @update:open="(v: boolean) => { if (!v) closeMessages() }">
      <DialogContent class="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>WS 消息 — {{ messagesBot ? displayName(messagesBot) : '' }}</DialogTitle>
          <DialogDescription>实时显示从 NapCat 接收到的 WebSocket 消息（最近 500 条）</DialogDescription>
        </DialogHeader>
        <!-- Filter bar -->
        <div class="flex items-center gap-2">
          <Select v-model="messageFilter">
            <SelectTrigger class="w-[140px]">
              <SelectValue placeholder="消息类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in MESSAGE_TYPES" :key="t.value" :value="t.value">
                {{ t.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="sourceFilter" v-if="availableSources.length > 0">
            <SelectTrigger class="w-[140px]">
              <SelectValue placeholder="来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              <SelectItem v-for="s in availableSources" :key="s" :value="s">
                {{ s }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span class="text-xs text-muted-foreground flex-1">共 {{ filteredMessages.length }} 条</span>
          <Button variant="outline" size="sm" @click="downloadMessages" :disabled="filteredMessages.length === 0">
            <Download class="w-4 h-4 mr-1" />
            下载
          </Button>
        </div>
        <!-- Messages list -->
        <div class="flex-1 overflow-y-auto min-h-0 space-y-1 py-2">
          <div v-if="messagesLoading && wsMessages.length === 0" class="text-sm text-muted-foreground text-center py-8">
            加载中...
          </div>
          <div v-else-if="filteredMessages.length === 0" class="text-sm text-muted-foreground text-center py-8">
            暂无消息
          </div>
          <div
            v-for="msg in filteredMessages"
            :key="msg.id"
            class="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm"
          >
            <span class="text-xs text-muted-foreground shrink-0 w-20 pt-0.5">{{ formatTimeShort(msg.timestamp) }}</span>
            <span :class="['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium shrink-0', messageTypeColor(msg.type)]">
              {{ messageTypeLabel(msg.type) }}
            </span>
            <span
              v-if="msg.source"
              class="inline-flex items-center rounded-full border border-violet-300 dark:border-violet-600 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950 shrink-0"
            >
              {{ msg.source }}
            </span>
            <span class="break-all min-w-0">{{ msg.summary }}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="closeMessages">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
