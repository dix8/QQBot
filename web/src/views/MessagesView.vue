<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MessageSquare, Search, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { apiFetch } from '@/api/client'
import { useBotsStore } from '@/stores/bots'
import { toast } from 'vue-sonner'
import BotSelector from '@/components/BotSelector.vue'

interface StoredMessage {
  id: number
  botId: number | null
  messageId: number | null
  messageType: string
  groupId: number | null
  userId: number
  nickname: string | null
  rawMessage: string | null
  time: number
  createdAt: string
}

const botsStore = useBotsStore()

const messages = ref<StoredMessage[]>([])
const total = ref(0)
const page = ref(1)
const limit = 50
const loading = ref(false)

const selectedBotId = ref<number | null>(null)
const typeFilter = ref('all')
const groupFilter = ref('')
const userFilter = ref('')
const searchText = ref('')

onMounted(async () => {
  await botsStore.fetchBots()
  if (botsStore.bots.length > 0 && botsStore.bots[0]) {
    selectedBotId.value = botsStore.bots[0].id
  }
})

watch(selectedBotId, () => {
  page.value = 1
  loadMessages()
})

watch(typeFilter, () => {
  page.value = 1
  loadMessages()
})

async function loadMessages() {
  if (!selectedBotId.value) return
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('botId', String(selectedBotId.value))
    params.set('page', String(page.value))
    params.set('limit', String(limit))
    if (typeFilter.value !== 'all') params.set('type', typeFilter.value)
    if (groupFilter.value) params.set('groupId', groupFilter.value)
    if (userFilter.value) params.set('userId', userFilter.value)
    if (searchText.value) params.set('search', searchText.value)

    const result = await apiFetch<{ messages: StoredMessage[]; total: number }>(`/api/messages?${params}`)
    messages.value = result.messages
    total.value = result.total
  } catch (e) { toast.error('加载消息失败') }
  finally { loading.value = false }
}

function doSearch() {
  page.value = 1
  loadMessages()
}

const totalPages = () => Math.max(1, Math.ceil(total.value / limit))

function prevPage() {
  if (page.value > 1) { page.value--; loadMessages() }
}
function nextPage() {
  if (page.value < totalPages()) { page.value++; loadMessages() }
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time
  const date = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  return `${date} ${time}`
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2">
          <MessageSquare class="w-6 h-6" />
          消息记录
        </h1>
        <p class="text-sm text-muted-foreground mt-1">查看 Bot 收到的历史消息</p>
      </div>
      <BotSelector v-model="selectedBotId" />
    </div>

    <!-- Filters -->
    <Card>
      <CardContent class="p-3 sm:p-4">
        <div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 items-end">
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">消息类型</label>
            <Select v-model="typeFilter">
              <SelectTrigger class="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="group">群聊</SelectItem>
                <SelectItem value="private">私聊</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">群号</label>
            <Input v-model="groupFilter" placeholder="筛选群号" class="w-full sm:w-36" @keyup.enter="doSearch" />
          </div>
          <div class="space-y-1">
            <label class="text-xs text-muted-foreground">用户 QQ</label>
            <Input v-model="userFilter" placeholder="筛选 QQ" class="w-full sm:w-36" @keyup.enter="doSearch" />
          </div>
          <div class="space-y-1 col-span-2 sm:flex-1 sm:min-w-[200px]">
            <label class="text-xs text-muted-foreground">搜索内容</label>
            <div class="flex gap-2">
              <Input v-model="searchText" placeholder="搜索消息内容" @keyup.enter="doSearch" />
              <Button size="sm" @click="doSearch">
                <Search class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Messages -->
    <Card>
      <CardContent class="p-0">
        <div v-if="!selectedBotId" class="py-12 text-center text-sm text-muted-foreground">请先选择机器人</div>
        <div v-else-if="loading" class="py-12 text-center text-sm text-muted-foreground">加载中...</div>
        <div v-else-if="messages.length === 0" class="py-12 text-center text-sm text-muted-foreground">暂无消息记录</div>
        <div v-else class="divide-y">
          <div v-for="msg in messages" :key="msg.id" class="px-3 sm:px-4 py-3 hover:bg-muted/30 transition-colors">
            <div class="flex gap-2.5">
              <!-- Avatar -->
              <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-muted shrink-0 mt-0.5 overflow-hidden flex items-center justify-center text-xs text-muted-foreground">
                <img
                  :src="`https://q1.qlogo.cn/g?b=qq&nk=${msg.userId}&s=100`"
                  class="w-full h-full object-cover"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
              </div>
              <!-- Content -->
              <div class="flex-1 min-w-0">
                <!-- Header -->
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-sm font-medium truncate max-w-[120px] sm:max-w-none">{{ msg.nickname || msg.userId }}</span>
                  <span class="text-[10px] text-muted-foreground font-mono hidden sm:inline">({{ msg.userId }})</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                    :class="msg.messageType === 'group' ? 'bg-blue-500/10 text-blue-500' : 'bg-green-500/10 text-green-500'">
                    {{ msg.messageType === 'group' ? '群' : '私' }}
                  </span>
                  <span v-if="msg.groupId" class="text-[10px] text-muted-foreground shrink-0">{{ msg.groupId }}</span>
                  <span class="text-[10px] text-muted-foreground ml-auto shrink-0">{{ formatTime(msg.time) }}</span>
                </div>
                <!-- Message body -->
                <p class="text-sm mt-1 break-all text-foreground/90 leading-relaxed">{{ msg.rawMessage }}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div v-if="total > 0" class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">共 {{ total }} 条消息</span>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="page <= 1" @click="prevPage">
          <ChevronLeft class="w-4 h-4" />
        </Button>
        <span class="text-sm">{{ page }} / {{ totalPages() }}</span>
        <Button variant="outline" size="sm" :disabled="page >= totalPages()" @click="nextPage">
          <ChevronRight class="w-4 h-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
