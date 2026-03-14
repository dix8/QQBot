<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AcceptableValue } from 'reka-ui'
import BotSelector from '@/components/BotSelector.vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useConfigStore } from '@/stores/config'
import { useBotsStore } from '@/stores/bots'
import { displayBotName } from '@/utils/bot'
import type { BasicConfig, MessageConfig, RuntimeConfig, KeywordRule } from '@/types/config'
import { Download, Upload, Plus, Trash2, Save, Bot, Pencil } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const configStore = useConfigStore()
const botsStore = useBotsStore()

const saving = ref(false)
const selectedBotId = ref<number | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

// Local editable copies
const basic = ref<BasicConfig>({ nickname: 'QQBot', masterQQ: [], autoReply: true, autoApproveFriend: false, autoApproveGroup: false, messageScope: 'both', selfCommandEnabled: false, blacklistUsers: [], groupFilterMode: 'none', groupFilterList: [] })
const message = ref<MessageConfig>({ keywordRules: [] })
const runtime = ref<RuntimeConfig>({
  onlineTime: { enabled: false, startHour: 8, endHour: 22 },
  rateLimit: { enabled: false, maxMessages: 20, windowSeconds: 60 },
  retry: { enabled: true, maxRetries: 3, retryDelayMs: 1000 },
})

// Master QQ input
const newMasterQQ = ref('')

// Blacklist user input
const newBlacklistUser = ref('')

// Group filter input
const newGroupFilter = ref('')

// New keyword rule dialog
const showAddRule = ref(false)
const newRule = ref<Omit<KeywordRule, 'id'>>({ keyword: '', reply: '', matchType: 'contains', enabled: true })

// Edit keyword rule dialog
const showEditRule = ref(false)
const editRule = ref<KeywordRule>({ id: '', keyword: '', reply: '', matchType: 'contains', enabled: true })

async function loadBotConfig(botId: number) {
  selectedBotId.value = botId
  await configStore.loadConfig(botId)
  if (configStore.config) {
    basic.value = {
      ...{ nickname: 'QQBot', masterQQ: [], autoReply: true, autoApproveFriend: false,
        autoApproveGroup: false, messageScope: 'both' as const, selfCommandEnabled: false,
        blacklistUsers: [], groupFilterMode: 'none' as const, groupFilterList: [] },
      ...configStore.config.basic,
    }
    message.value = JSON.parse(JSON.stringify(configStore.config.message))
    runtime.value = JSON.parse(JSON.stringify(configStore.config.runtime))
  }
}

onMounted(async () => {
  await botsStore.fetchBots()
  if (botsStore.bots.length > 0) {
    await loadBotConfig(botsStore.bots[0]!.id)
  }
})

watch(selectedBotId, async (newId) => {
  if (newId !== null) {
    await loadBotConfig(newId)
  }
})

async function saveBasic() {
  if (!selectedBotId.value) return
  saving.value = true
  try {
    await configStore.updateSection(selectedBotId.value, 'basic', basic.value)
    toast.success('基础配置已保存')
  } catch {
    toast.error('保存基础配置失败')
  } finally {
    saving.value = false
  }
}

async function saveMessage_() {
  if (!selectedBotId.value) return
  saving.value = true
  try {
    await configStore.updateSection(selectedBotId.value, 'message', message.value)
    toast.success('消息配置已保存')
  } catch {
    toast.error('保存消息配置失败')
  } finally {
    saving.value = false
  }
}

async function saveRuntime() {
  if (!selectedBotId.value) return
  saving.value = true
  try {
    await configStore.updateSection(selectedBotId.value, 'runtime', runtime.value)
    toast.success('运行配置已保存')
  } catch {
    toast.error('保存运行配置失败')
  } finally {
    saving.value = false
  }
}

function addMasterQQ() {
  const qq = parseInt(newMasterQQ.value.trim(), 10)
  if (isNaN(qq) || qq <= 0) {
    toast.error('请输入有效的 QQ 号')
    return
  }
  if (basic.value.masterQQ.includes(qq)) {
    toast.error('该 QQ 号已存在')
    return
  }
  basic.value.masterQQ.push(qq)
  newMasterQQ.value = ''
}

function removeMasterQQ(qq: number) {
  basic.value.masterQQ = basic.value.masterQQ.filter(q => q !== qq)
}

function addBlacklistUser() {
  const qq = parseInt(newBlacklistUser.value.trim(), 10)
  if (isNaN(qq) || qq <= 0) {
    toast.error('请输入有效的 QQ 号')
    return
  }
  if (basic.value.blacklistUsers.includes(qq)) {
    toast.error('该 QQ 号已在黑名单中')
    return
  }
  basic.value.blacklistUsers.push(qq)
  newBlacklistUser.value = ''
}

function removeBlacklistUser(qq: number) {
  basic.value.blacklistUsers = basic.value.blacklistUsers.filter(q => q !== qq)
}

function addGroupFilter() {
  const gid = parseInt(newGroupFilter.value.trim(), 10)
  if (isNaN(gid) || gid <= 0) {
    toast.error('请输入有效的群号')
    return
  }
  if (basic.value.groupFilterList.includes(gid)) {
    toast.error('该群号已在列表中')
    return
  }
  basic.value.groupFilterList.push(gid)
  newGroupFilter.value = ''
}

function removeGroupFilter(gid: number) {
  basic.value.groupFilterList = basic.value.groupFilterList.filter(g => g !== gid)
}

function addKeywordRule() {
  if (!newRule.value.keyword || !newRule.value.reply) return
  message.value.keywordRules.push({
    id: Date.now().toString(),
    ...newRule.value,
  })
  newRule.value = { keyword: '', reply: '', matchType: 'contains', enabled: true }
  showAddRule.value = false
}

function removeKeywordRule(id: string) {
  message.value.keywordRules = message.value.keywordRules.filter((r) => r.id !== id)
}

function openEditRule(rule: KeywordRule) {
  editRule.value = { ...rule }
  showEditRule.value = true
}

function saveEditedRule() {
  const idx = message.value.keywordRules.findIndex((r) => r.id === editRule.value.id)
  if (idx !== -1) {
    message.value.keywordRules[idx] = { ...editRule.value }
  }
  showEditRule.value = false
}

async function handleExport() {
  if (!selectedBotId.value) return
  try {
    const data = await configStore.exportConfig(selectedBotId.value)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bot-${selectedBotId.value}-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('配置已导出')
  } catch {
    toast.error('导出失败')
  }
}

function handleImport(event: Event) {
  if (!selectedBotId.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const botId = selectedBotId.value
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target?.result as string)
      await configStore.importConfig(botId, data)
      if (configStore.config) {
        basic.value = { ...configStore.config.basic }
        message.value = JSON.parse(JSON.stringify(configStore.config.message))
        runtime.value = JSON.parse(JSON.stringify(configStore.config.runtime))
      }
      toast.success('配置已导入')
    } catch {
      toast.error('导入失败：无效的配置文件')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

const matchTypeLabel: Record<string, string> = {
  exact: '精确匹配',
  contains: '包含',
  regex: '正则',
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">Bot 配置</h1>
        <p class="text-sm text-muted-foreground mt-1">管理每个 Bot 的基础设置、消息规则和运行参数</p>
      </div>
      <BotSelector v-model="selectedBotId" />
    </div>

    <!-- No bots -->
    <div v-if="botsStore.bots.length === 0 && !botsStore.loading" class="text-center py-12">
      <Bot class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
      <p class="text-muted-foreground">暂无机器人，请先添加机器人</p>
    </div>

    <!-- Loading -->
    <div v-else-if="configStore.loading" class="text-sm text-muted-foreground">加载配置中...</div>

    <!-- Error -->
    <div v-else-if="configStore.error" class="text-sm text-destructive">{{ configStore.error }}</div>

    <!-- Config tabs -->
    <Tabs v-else-if="selectedBotId" default-value="basic">
      <TabsList class="grid w-full grid-cols-4">
        <TabsTrigger value="basic">基础配置</TabsTrigger>
        <TabsTrigger value="message">消息配置</TabsTrigger>
        <TabsTrigger value="runtime">运行配置</TabsTrigger>
        <TabsTrigger value="io">导入导出</TabsTrigger>
      </TabsList>

      <!-- Basic Config -->
      <TabsContent value="basic">
        <Card>
          <CardHeader>
            <CardTitle>基础配置</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>Bot 昵称</Label>
              <Input v-model="basic.nickname" placeholder="Bot 昵称" />
            </div>

            <!-- Master QQ -->
            <div class="space-y-2">
              <Label>主人 QQ</Label>
              <p class="text-sm text-muted-foreground">拥有最高权限的 QQ 号码</p>
              <div class="flex gap-2">
                <Input
                  v-model="newMasterQQ"
                  placeholder="输入 QQ 号"
                  type="number"
                  @keyup.enter="addMasterQQ"
                />
                <Button size="sm" @click="addMasterQQ">
                  <Plus class="w-4 h-4 mr-1" />
                  添加
                </Button>
              </div>
              <div v-if="basic.masterQQ.length > 0" class="flex flex-wrap gap-2 mt-2">
                <Badge
                  v-for="qq in basic.masterQQ"
                  :key="qq"
                  variant="secondary"
                  class="text-sm px-3 py-1"
                >
                  {{ qq }}
                  <button
                    class="ml-2 text-muted-foreground hover:text-red-500"
                    @click="removeMasterQQ(qq)"
                  >
                    &times;
                  </button>
                </Badge>
              </div>
              <p v-else class="text-sm text-muted-foreground">尚未设置主人 QQ</p>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label>自动回复</Label>
                <p class="text-sm text-muted-foreground">启用关键词自动回复功能</p>
              </div>
              <Switch :model-value="basic.autoReply" @update:model-value="basic.autoReply = $event" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label>自动同意好友请求</Label>
                <p class="text-sm text-muted-foreground">收到好友申请时自动通过</p>
              </div>
              <Switch :model-value="basic.autoApproveFriend" @update:model-value="basic.autoApproveFriend = $event" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label>自动同意入群邀请</Label>
                <p class="text-sm text-muted-foreground">收到入群邀请时自动通过</p>
              </div>
              <Switch :model-value="basic.autoApproveGroup" @update:model-value="basic.autoApproveGroup = $event" />
            </div>

            <div class="space-y-2">
              <Label>消息范围</Label>
              <Select v-model="basic.messageScope">
                <SelectTrigger>
                  <SelectValue placeholder="选择消息范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">私聊 + 群聊</SelectItem>
                  <SelectItem value="private">仅私聊</SelectItem>
                  <SelectItem value="group">仅群聊</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label>自身消息指令</Label>
                <p class="text-sm text-muted-foreground">开启后，Bot 账号自己发送的消息也能触发指令和插件</p>
              </div>
              <Switch :model-value="basic.selfCommandEnabled" @update:model-value="basic.selfCommandEnabled = $event" />
            </div>

            <!-- User Blacklist -->
            <div class="space-y-2">
              <Label>用户黑名单</Label>
              <p class="text-sm text-muted-foreground">黑名单中的用户消息将被完全忽略</p>
              <div class="flex gap-2">
                <Input
                  v-model="newBlacklistUser"
                  placeholder="输入 QQ 号"
                  type="number"
                  @keyup.enter="addBlacklistUser"
                />
                <Button size="sm" @click="addBlacklistUser">
                  <Plus class="w-4 h-4 mr-1" />
                  添加
                </Button>
              </div>
              <div v-if="basic.blacklistUsers.length > 0" class="flex flex-wrap gap-2 mt-2">
                <Badge
                  v-for="qq in basic.blacklistUsers"
                  :key="qq"
                  variant="destructive"
                  class="text-sm px-3 py-1"
                >
                  {{ qq }}
                  <button
                    class="ml-2 hover:text-red-200"
                    @click="removeBlacklistUser(qq)"
                  >
                    &times;
                  </button>
                </Badge>
              </div>
              <p v-else class="text-sm text-muted-foreground">黑名单为空</p>
            </div>

            <!-- Group Filter -->
            <div class="space-y-2">
              <Label>群组过滤</Label>
              <p class="text-sm text-muted-foreground">控制 Bot 服务的群组范围</p>
              <Select
                :model-value="basic.groupFilterMode"
                @update:model-value="(v: AcceptableValue) => { basic.groupFilterMode = v as 'none' | 'whitelist' | 'blacklist' }"
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择过滤模式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不过滤</SelectItem>
                  <SelectItem value="whitelist">白名单模式（仅服务列表中的群）</SelectItem>
                  <SelectItem value="blacklist">黑名单模式（屏蔽列表中的群）</SelectItem>
                </SelectContent>
              </Select>
              <div v-if="basic.groupFilterMode !== 'none'" class="space-y-2 mt-2">
                <div class="flex gap-2">
                  <Input
                    v-model="newGroupFilter"
                    placeholder="输入群号"
                    type="number"
                    @keyup.enter="addGroupFilter"
                  />
                  <Button size="sm" @click="addGroupFilter">
                    <Plus class="w-4 h-4 mr-1" />
                    添加
                  </Button>
                </div>
                <div v-if="basic.groupFilterList.length > 0" class="flex flex-wrap gap-2 mt-2">
                  <Badge
                    v-for="gid in basic.groupFilterList"
                    :key="gid"
                    :variant="basic.groupFilterMode === 'whitelist' ? 'secondary' : 'destructive'"
                    class="text-sm px-3 py-1"
                  >
                    {{ gid }}
                    <button
                      class="ml-2 text-muted-foreground hover:text-red-500"
                      @click="removeGroupFilter(gid)"
                    >
                      &times;
                    </button>
                  </Badge>
                </div>
                <p v-else class="text-sm text-muted-foreground">列表为空</p>
              </div>
            </div>

            <Button @click="saveBasic" :disabled="saving">
              <Save class="w-4 h-4 mr-1" />
              保存
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <!-- Message Config -->
      <TabsContent value="message">
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle>关键词回复规则</CardTitle>
              <Dialog v-model:open="showAddRule">
                <DialogTrigger as-child>
                  <Button size="sm">
                    <Plus class="w-4 h-4 mr-1" />
                    添加规则
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>添加关键词规则</DialogTitle>
                  </DialogHeader>
                  <div class="space-y-4 py-4">
                    <div class="space-y-2">
                      <Label>关键词</Label>
                      <Input v-model="newRule.keyword" placeholder="触发关键词" />
                    </div>
                    <div class="space-y-2">
                      <Label>回复内容</Label>
                      <Textarea v-model="newRule.reply" placeholder="回复内容" />
                    </div>
                    <div class="space-y-2">
                      <Label>匹配方式</Label>
                      <Select v-model="newRule.matchType">
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exact">精确匹配</SelectItem>
                          <SelectItem value="contains">包含</SelectItem>
                          <SelectItem value="regex">正则表达式</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose as-child>
                      <Button variant="outline">取消</Button>
                    </DialogClose>
                    <Button @click="addKeywordRule">添加</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <!-- Edit rule dialog -->
            <Dialog v-model:open="showEditRule">
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>编辑关键词规则</DialogTitle>
                </DialogHeader>
                <div class="space-y-4 py-4">
                  <div class="space-y-2">
                    <Label>关键词</Label>
                    <Input v-model="editRule.keyword" placeholder="触发关键词" />
                  </div>
                  <div class="space-y-2">
                    <Label>回复内容</Label>
                    <Textarea v-model="editRule.reply" placeholder="回复内容" />
                  </div>
                  <div class="space-y-2">
                    <Label>匹配方式</Label>
                    <Select v-model="editRule.matchType">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact">精确匹配</SelectItem>
                        <SelectItem value="contains">包含</SelectItem>
                        <SelectItem value="regex">正则表达式</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose as-child>
                    <Button variant="outline">取消</Button>
                  </DialogClose>
                  <Button @click="saveEditedRule">保存</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Table v-if="message.keywordRules.length > 0">
              <TableHeader>
                <TableRow>
                  <TableHead>关键词</TableHead>
                  <TableHead>回复</TableHead>
                  <TableHead>匹配方式</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead class="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="rule in message.keywordRules" :key="rule.id">
                  <TableCell class="font-medium">{{ rule.keyword }}</TableCell>
                  <TableCell class="max-w-[200px] truncate">{{ rule.reply }}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{{ matchTypeLabel[rule.matchType] }}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch :model-value="rule.enabled" @update:model-value="rule.enabled = $event" />
                  </TableCell>
                  <TableCell>
                    <div class="flex gap-1">
                      <Button variant="ghost" size="sm" @click="openEditRule(rule)">
                        <Pencil class="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" @click="removeKeywordRule(rule.id)">
                        <Trash2 class="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p v-else class="text-sm text-muted-foreground">暂无规则，点击"添加规则"创建</p>

            <Button class="mt-4" @click="saveMessage_" :disabled="saving">
              <Save class="w-4 h-4 mr-1" />
              保存消息配置
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <!-- Runtime Config -->
      <TabsContent value="runtime">
        <Card>
          <CardHeader>
            <CardTitle>运行配置</CardTitle>
          </CardHeader>
          <CardContent class="space-y-6">
            <!-- Online Time -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <Label class="text-base">在线时段</Label>
                  <p class="text-sm text-muted-foreground">限制 Bot 的工作时间</p>
                </div>
                <Switch :model-value="runtime.onlineTime.enabled" @update:model-value="runtime.onlineTime.enabled = $event" />
              </div>
              <div v-if="runtime.onlineTime.enabled" class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label>开始时间 (时)</Label>
                  <Input type="number" v-model.number="runtime.onlineTime.startHour" min="0" max="23" />
                </div>
                <div class="space-y-2">
                  <Label>结束时间 (时)</Label>
                  <Input type="number" v-model.number="runtime.onlineTime.endHour" min="0" max="23" />
                </div>
              </div>
            </div>

            <!-- Rate Limit -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <Label class="text-base">频率限制</Label>
                  <p class="text-sm text-muted-foreground">限制消息处理频率</p>
                </div>
                <Switch :model-value="runtime.rateLimit.enabled" @update:model-value="runtime.rateLimit.enabled = $event" />
              </div>
              <div v-if="runtime.rateLimit.enabled" class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label>最大消息数</Label>
                  <Input type="number" v-model.number="runtime.rateLimit.maxMessages" min="1" />
                </div>
                <div class="space-y-2">
                  <Label>时间窗口 (秒)</Label>
                  <Input type="number" v-model.number="runtime.rateLimit.windowSeconds" min="1" />
                </div>
              </div>
            </div>

            <!-- Retry -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <Label class="text-base">重试设置</Label>
                  <p class="text-sm text-muted-foreground">API 调用失败后的重试策略</p>
                </div>
                <Switch :model-value="runtime.retry.enabled" @update:model-value="runtime.retry.enabled = $event" />
              </div>
              <div v-if="runtime.retry.enabled" class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label>最大重试次数</Label>
                  <Input type="number" v-model.number="runtime.retry.maxRetries" min="1" max="10" />
                </div>
                <div class="space-y-2">
                  <Label>重试延迟 (ms)</Label>
                  <Input type="number" v-model.number="runtime.retry.retryDelayMs" min="100" step="100" />
                </div>
              </div>
            </div>

            <Button @click="saveRuntime" :disabled="saving">
              <Save class="w-4 h-4 mr-1" />
              保存
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <!-- Import/Export -->
      <TabsContent value="io">
        <Card>
          <CardHeader>
            <CardTitle>导入 / 导出</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex gap-4">
              <Button @click="handleExport" variant="outline">
                <Download class="w-4 h-4 mr-1" />
                导出配置
              </Button>
              <div>
                <input
                  type="file"
                  accept=".json"
                  class="hidden"
                  ref="importInput"
                  @change="handleImport"
                />
                <Button variant="outline" @click="importInput?.click()">
                  <Upload class="w-4 h-4 mr-1" />
                  导入配置
                </Button>
              </div>
            </div>
            <p class="text-sm text-muted-foreground">
              导出当前机器人的配置为 JSON 格式，可在其他机器人或实例中导入恢复配置。
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </div>
</template>
