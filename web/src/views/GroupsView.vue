<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useBotsStore } from '@/stores/bots'
import { toast } from 'vue-sonner'
import { RefreshCw, Users, Search, ToggleLeft, ToggleRight } from 'lucide-vue-next'
import * as groupsApi from '@/api/groups'
import type { GroupInfo } from '@/api/groups'
import BotSelector from '@/components/BotSelector.vue'

const botsStore = useBotsStore()

const selectedBotId = ref<number | null>(null)
const groups = ref<GroupInfo[]>([])
const filterMode = ref<string>('none')
const loading = ref(false)
const toggling = ref<Set<number>>(new Set())
const searchQuery = ref('')
const avatarFailed = ref<Set<number>>(new Set())

const filteredGroups = computed(() => {
  if (!searchQuery.value.trim()) return groups.value
  const q = searchQuery.value.trim().toLowerCase()
  return groups.value.filter(
    (g) => g.group_name.toLowerCase().includes(q) || String(g.group_id).includes(q),
  )
})

const enabledCount = computed(() => groups.value.filter((g) => g.enabled).length)
const totalCount = computed(() => groups.value.length)

async function loadGroups(botId: number) {
  loading.value = true
  try {
    const result = await groupsApi.fetchGroups(botId)
    groups.value = result.groups
    filterMode.value = result.filterMode
  } catch (e) {
    const msg = e instanceof Error ? e.message : '加载群列表失败'
    toast.error(msg)
    groups.value = []
  } finally {
    loading.value = false
  }
}

async function handleToggle(group: GroupInfo, enabled: boolean) {
  if (!selectedBotId.value) return
  toggling.value.add(group.group_id)
  try {
    await groupsApi.toggleGroup(selectedBotId.value, group.group_id, enabled)
    group.enabled = enabled
    toast.success(`${group.group_name || group.group_id} 已${enabled ? '启用' : '禁用'}`)
  } catch {
    toast.error('操作失败')
  } finally {
    toggling.value.delete(group.group_id)
  }
}

async function enableAll() {
  if (!selectedBotId.value) return
  loading.value = true
  try {
    const allIds = groups.value.map((g) => g.group_id)
    await groupsApi.batchUpdateGroups(selectedBotId.value, allIds)
    groups.value.forEach((g) => (g.enabled = true))
    toast.success('已启用全部群')
  } catch {
    toast.error('操作失败')
  } finally {
    loading.value = false
  }
}

async function disableAll() {
  if (!selectedBotId.value) return
  loading.value = true
  try {
    await groupsApi.batchUpdateGroups(selectedBotId.value, [])
    groups.value.forEach((g) => (g.enabled = false))
    toast.success('已禁用全部群')
  } catch {
    toast.error('操作失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await botsStore.fetchBots()
  if (botsStore.bots.length > 0) {
    selectedBotId.value = botsStore.bots[0]!.id
  }
})

watch(selectedBotId, async (newId) => {
  if (newId !== null) {
    await loadGroups(newId)
  }
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-4 sm:space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-bold">群管理</h1>
        <p class="text-sm text-muted-foreground mt-1">管理 Bot 加入的群聊，控制哪些群可以触发指令</p>
      </div>
      <BotSelector v-model="selectedBotId" />
    </div>

    <!-- No bots -->
    <div v-if="botsStore.bots.length === 0 && !botsStore.loading" class="text-center py-12">
      <Users class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
      <p class="text-muted-foreground">暂无机器人，请先添加机器人</p>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="text-center py-12">
      <RefreshCw class="w-8 h-8 mx-auto text-muted-foreground mb-4 animate-spin" />
      <p class="text-sm text-muted-foreground">加载群列表中...</p>
    </div>

    <!-- Group list -->
    <template v-else-if="selectedBotId">
      <!-- Toolbar -->
      <Card>
        <CardContent class="pt-4">
          <div class="space-y-3">
            <div class="relative w-full">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                v-model="searchQuery"
                placeholder="搜索群名称或群号..."
                class="pl-9"
              />
            </div>
            <div class="flex items-center justify-between gap-2">
              <Badge variant="secondary" class="whitespace-nowrap text-xs">
                {{ enabledCount }} / {{ totalCount }} 已启用
              </Badge>
              <div class="flex items-center gap-1.5">
                <Button variant="outline" size="sm" class="h-8 text-xs px-2 sm:px-3" @click="enableAll" :disabled="loading">
                  <ToggleRight class="w-3.5 h-3.5 sm:mr-1" />
                  <span class="hidden sm:inline">全部启用</span>
                </Button>
                <Button variant="outline" size="sm" class="h-8 text-xs px-2 sm:px-3" @click="disableAll" :disabled="loading">
                  <ToggleLeft class="w-3.5 h-3.5 sm:mr-1" />
                  <span class="hidden sm:inline">全部禁用</span>
                </Button>
                <Button variant="outline" size="sm" class="h-8 w-8 p-0" @click="loadGroups(selectedBotId!)" :disabled="loading">
                  <RefreshCw class="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Empty state -->
      <div v-if="groups.length === 0" class="text-center py-12">
        <Users class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p class="text-muted-foreground">Bot 尚未加入任何群聊，或当前未连接</p>
      </div>

      <!-- No search results -->
      <div v-else-if="filteredGroups.length === 0" class="text-center py-12">
        <Search class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p class="text-muted-foreground">没有匹配的群</p>
      </div>

      <!-- Group cards -->
      <div v-else class="grid gap-2 sm:gap-3">
        <Card
          v-for="group in filteredGroups"
          :key="group.group_id"
          class="transition-colors"
          :class="{ 'opacity-60': !group.enabled }"
        >
          <CardContent class="py-3 px-3 sm:px-6 sm:pt-4">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <img
                  v-if="!avatarFailed.has(group.group_id)"
                  :src="`https://p.qlogo.cn/gh/${group.group_id}/${group.group_id}/100/`"
                  :alt="group.group_name"
                  class="w-9 h-9 sm:w-10 sm:h-10 rounded-full shrink-0 object-cover bg-muted"
                  loading="lazy"
                  @error="avatarFailed.add(group.group_id)"
                />
                <div
                  v-else
                  class="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-medium"
                  :class="group.enabled
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'"
                >
                  {{ (group.group_name || '群')[0] }}
                </div>
                <div class="min-w-0">
                  <div class="font-medium text-sm sm:text-base truncate">
                    {{ group.group_name || '未命名群' }}
                  </div>
                  <div class="text-xs sm:text-sm text-muted-foreground flex items-center gap-1.5 sm:gap-2">
                    <span>{{ group.group_id }}</span>
                    <span class="text-xs">·</span>
                    <span>{{ group.member_count }} / {{ group.max_member_count }} 人</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 sm:gap-3 shrink-0">
                <Badge :variant="group.enabled ? 'default' : 'secondary'" class="text-xs hidden sm:inline-flex">
                  {{ group.enabled ? '已启用' : '已禁用' }}
                </Badge>
                <Switch
                  :model-value="group.enabled"
                  :disabled="toggling.has(group.group_id)"
                  @update:model-value="(v: boolean) => handleToggle(group, v)"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
