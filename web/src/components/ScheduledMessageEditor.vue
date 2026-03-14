<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { Plus, Trash2, Pencil, Clock, Code, Eye } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface SingleTask {
  type?: undefined
  hour: number
  minute: number
  group_ids: (number | 'all')[]
  message?: string
  messages?: string[]
  self_id?: number
}

interface CronTask {
  type: 'cron'
  cron: string
  group_ids: (number | 'all')[]
  message?: string
  messages?: string[]
  self_id?: number
}

type ScheduledTask = SingleTask | CronTask

// 兼容旧格式 group_id -> group_ids
function normalizeTask(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw }
  if (!result.group_ids && result.group_id) {
    result.group_ids = [result.group_id]
    delete result.group_id
  }
  return result
}

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const tasks = ref<ScheduledTask[]>([])
const editOpen = ref(false)
const editIndex = ref(-1)
const editType = ref<'single' | 'cron'>('single')
const editGroupIds = ref('')
const editHour = ref(8)
const editMinute = ref(0)
const editMessages = ref<string[]>([''])
const editCron = ref('0 9 * * *')
const editSelfId = ref('')
const cronError = ref('')
const editMode = ref<'visual' | 'code'>('visual')
const editCode = ref('')
const codeError = ref('')

const CRON_PRESETS = [
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 8:00 和 18:00', value: '0 8,18 * * *' },
  { label: '工作日 9:00', value: '0 9 * * 1-5' },
  { label: '周末 10:00', value: '0 10 * * 0,6' },
  { label: '每小时整点', value: '0 * * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '每月 1 号 9:00', value: '0 9 1 * *' },
]

const TEMPLATE_VARS = `可用变量：{time} 时:分　{hour} 时　{minute} 分　{date} 日期　{datetime} 日期时间　{weekday} 星期`

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string]

  const dowNames: Record<string, string> = {
    '0': '周日', '1': '周一', '2': '周二', '3': '周三',
    '4': '周四', '5': '周五', '6': '周六', '7': '周日',
    '1-5': '工作日', '0,6': '周末', '6,0': '周末',
  }

  function describeTime(): string {
    const m = min === '0' ? '00' : min.padStart(2, '0')
    if (hour === '*') return `每小时第 ${m} 分`
    if (hour.includes(',')) return hour.split(',').map(h => `${h}:${m}`).join('、')
    if (hour.includes('/')) {
      const step = hour.split('/')[1]
      return `每 ${step} 小时 (第 ${m} 分)`
    }
    return `${hour.padStart(2, '0')}:${m}`
  }

  if (min.includes('/')) {
    const step = min.split('/')[1]
    let scope = ''
    if (dow !== '*') scope = ` (${dowNames[dow] || dow})`
    else if (dom !== '*') scope = ` (每月 ${dom} 号)`
    return `每 ${step} 分钟${scope}`
  }

  const time = describeTime()
  const scopeParts: string[] = []

  if (mon !== '*') scopeParts.push(`${mon} 月`)
  if (dom !== '*' && !dom.includes('/')) scopeParts.push(`每月 ${dom} 号`)
  if (dow !== '*') scopeParts.push(dowNames[dow] || `星期 ${dow}`)

  if (scopeParts.length === 0 && hour !== '*') return `每天 ${time}`
  if (scopeParts.length === 0) return time

  return `${scopeParts.join(' ')} ${time}`
}

function validateCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'Cron 表达式需要 5 个字段：分 时 日 月 周'
  const ranges = [
    { name: '分钟', min: 0, max: 59 },
    { name: '小时', min: 0, max: 23 },
    { name: '日', min: 1, max: 31 },
    { name: '月', min: 1, max: 12 },
    { name: '星期', min: 0, max: 7 },
  ]
  for (let i = 0; i < 5; i++) {
    const p = parts[i]!
    if (p === '*') continue
    const valid = /^(\*(\/[0-9]+)?|[0-9]+(-[0-9]+)?(\/[0-9]+)?)(,(\*(\/[0-9]+)?|[0-9]+(-[0-9]+)?(\/[0-9]+)?))*$/.test(p)
    if (!valid) return `${ranges[i]!.name} 字段格式无效: ${p}`
  }
  return ''
}

watch(() => props.modelValue, (val) => {
  try {
    const parsed = JSON.parse(val || '[]')
    tasks.value = Array.isArray(parsed) ? parsed.map((t: Record<string, unknown>) => normalizeTask(t)) as unknown as ScheduledTask[] : []
  } catch {
    tasks.value = []
  }
}, { immediate: true })

function serialize() {
  emit('update:modelValue', JSON.stringify(tasks.value))
}

/** 获取任务的消息列表（兼容 message / messages 两种格式） */
function getTaskMessages(task: ScheduledTask): string[] {
  if (Array.isArray(task.messages) && task.messages.length > 0) return task.messages
  if (task.message) return [task.message]
  return []
}

function formatGroups(ids: (number | 'all')[]): string {
  if (!ids || ids.length === 0) return '未设置群'
  if (ids.includes('all')) return '所有启用群'
  const nums = ids.filter((id): id is number => typeof id === 'number')
  if (nums.length === 0) return '未设置群'
  if (nums.length <= 2) return nums.join('、')
  return `${nums[0]} 等 ${nums.length} 个群`
}

function isTaskEnabled(task: ScheduledTask): boolean {
  if (!task.group_ids || task.group_ids.length === 0) return false
  if (getTaskMessages(task).length === 0) return false
  return true
}

function taskSummary(task: ScheduledTask): string {
  const groups = formatGroups(task.group_ids)
  const botTag = task.self_id ? ` [Bot ${task.self_id}]` : ''
  if (task.type === 'cron') {
    return `${describeCron(task.cron)} -> ${groups}${botTag}`
  }
  return `${String(task.hour).padStart(2, '0')}:${String(task.minute).padStart(2, '0')} -> ${groups}${botTag}`
}

function taskMsgPreview(task: ScheduledTask): string {
  const msgs = getTaskMessages(task)
  if (msgs.length === 0) return ''
  if (msgs.length === 1) return msgs[0]!
  return `${msgs[0]} (共 ${msgs.length} 条随机)`
}

function taskBadge(task: ScheduledTask): string {
  if (task.type === 'cron') return 'Cron'
  return '定时'
}

/** 将当前表单状态序列化为 JSON */
function formToJson(): string {
  const gids = parseGroupIds(editGroupIds.value)
  const msgs = editMessages.value.map(m => m.trim()).filter(Boolean)
  const msgFields: Record<string, unknown> = msgs.length === 1
    ? { message: msgs[0] }
    : msgs.length > 1
      ? { messages: msgs }
      : {}
  const selfIdNum = parseInt(editSelfId.value.trim(), 10)
  const selfIdField: Record<string, unknown> = selfIdNum > 0 ? { self_id: selfIdNum } : {}

  let task: Record<string, unknown>
  if (editType.value === 'cron') {
    task = { type: 'cron', cron: editCron.value.trim(), group_ids: gids, ...msgFields, ...selfIdField }
  } else {
    task = { hour: editHour.value, minute: editMinute.value, group_ids: gids, ...msgFields, ...selfIdField }
  }
  return JSON.stringify(task, null, 2)
}

/** 从 JSON 解析并填充表单 */
function jsonToForm(json: string): boolean {
  try {
    const raw = JSON.parse(json)
    if (typeof raw !== 'object' || raw === null) return false
    const task = normalizeTask(raw)

    if (task.type === 'cron') {
      editType.value = 'cron'
      editCron.value = String(task.cron || '0 9 * * *')
    } else {
      editType.value = 'single'
      editHour.value = Number(task.hour ?? 8)
      editMinute.value = Number(task.minute ?? 0)
    }

    const gids = task.group_ids as (number | 'all')[] | undefined
    if (Array.isArray(gids) && gids.length > 0) {
      editGroupIds.value = gids.includes('all') ? 'all' : gids.filter((id): id is number => typeof id === 'number').join(', ')
    } else {
      editGroupIds.value = ''
    }

    const msgs: string[] = []
    if (Array.isArray(task.messages) && (task.messages as string[]).length > 0) {
      msgs.push(...(task.messages as string[]))
    } else if (task.message) {
      msgs.push(String(task.message))
    }
    editMessages.value = msgs.length > 0 ? msgs : ['']
    editSelfId.value = task.self_id ? String(task.self_id) : ''
    cronError.value = ''
    return true
  } catch {
    return false
  }
}

function switchToCode() {
  editCode.value = formToJson()
  codeError.value = ''
  editMode.value = 'code'
}

function switchToVisual() {
  if (jsonToForm(editCode.value)) {
    codeError.value = ''
    editMode.value = 'visual'
  } else {
    codeError.value = 'JSON 格式无效，无法切换到可视化模式'
    toast.error('JSON 格式无效，无法切换')
  }
}

function openAdd() {
  editIndex.value = -1
  editType.value = 'single'
  editGroupIds.value = ''
  editHour.value = 8
  editMinute.value = 0
  editMessages.value = ['']
  editCron.value = '0 9 * * *'
  editSelfId.value = ''
  cronError.value = ''
  editMode.value = 'visual'
  codeError.value = ''
  editOpen.value = true
}

function openEdit(index: number) {
  const task = tasks.value[index]
  if (!task) return
  editIndex.value = index
  cronError.value = ''
  editMode.value = 'visual'
  codeError.value = ''
  // self_id
  editSelfId.value = task.self_id ? String(task.self_id) : ''
  // group_ids -> 编辑字符串
  if (task.group_ids.includes('all')) {
    editGroupIds.value = 'all'
  } else {
    editGroupIds.value = task.group_ids.filter((id): id is number => typeof id === 'number').join(', ')
  }
  // messages
  editMessages.value = getTaskMessages(task).length > 0 ? [...getTaskMessages(task)] : ['']
  if (task.type === 'cron') {
    editType.value = 'cron'
    editCron.value = task.cron
  } else {
    editType.value = 'single'
    editHour.value = task.hour
    editMinute.value = task.minute
  }
  editOpen.value = true
}

/** 解析群号输入，支持 "all" 和数字 */
function parseGroupIds(input: string): (number | 'all')[] {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return []
  if (trimmed === 'all' || trimmed === '全部' || trimmed === '所有群') return ['all']
  const parts = input.split(/[,，\s]+/).filter(Boolean)
  const nums = parts.map(s => parseInt(s.trim(), 10)).filter(n => n > 0 && !isNaN(n))
  if (nums.length > 0 && nums.length < parts.length) {
    toast.warning(`部分群号无效，已忽略 ${parts.length - nums.length} 项`)
  }
  return nums
}

function addMessage() {
  editMessages.value.push('')
}

function removeMessage(index: number) {
  if (editMessages.value.length <= 1) return
  editMessages.value.splice(index, 1)
}

function saveTask() {
  // 代码模式：先解析 JSON 回填表单
  if (editMode.value === 'code') {
    if (!jsonToForm(editCode.value)) {
      codeError.value = 'JSON 格式无效'
      toast.error('JSON 格式无效')
      return
    }
  }

  const gids = parseGroupIds(editGroupIds.value)

  const msgs = editMessages.value.map(m => m.trim()).filter(Boolean)
  if (msgs.length === 0) { toast.error('请输入至少一条消息内容'); return }

  // 构造 message/messages 字段（单条用 message 兼容旧格式，多条用 messages）
  const msgFields = msgs.length === 1
    ? { message: msgs[0] }
    : { messages: msgs }

  const selfIdNum = parseInt(editSelfId.value.trim(), 10)
  const selfIdField = selfIdNum > 0 ? { self_id: selfIdNum } : {}

  let task: ScheduledTask
  if (editType.value === 'cron') {
    const err = validateCron(editCron.value)
    if (err) { cronError.value = err; toast.error(err); return }
    task = {
      type: 'cron',
      cron: editCron.value.trim(),
      group_ids: gids,
      ...msgFields,
      ...selfIdField,
    } as CronTask
  } else {
    task = {
      hour: editHour.value,
      minute: editMinute.value,
      group_ids: gids,
      ...msgFields,
      ...selfIdField,
    } as SingleTask
  }

  if (editIndex.value >= 0) {
    tasks.value[editIndex.value] = task
  } else {
    tasks.value.push(task)
  }
  serialize()
  editOpen.value = false
}

function removeTask(index: number) {
  tasks.value.splice(index, 1)
  serialize()
}

function applyPreset(preset: string) {
  editCron.value = preset
  cronError.value = ''
}

const hours = computed(() => Array.from({ length: 24 }, (_, i) => i))
const minutes = computed(() => Array.from({ length: 60 }, (_, i) => i))
const cronDescription = computed(() => editCron.value ? describeCron(editCron.value) : '')
</script>

<template>
  <div class="space-y-3">
    <!-- Task list -->
    <div v-if="tasks.length === 0" class="text-sm text-muted-foreground py-3 text-center border rounded-md">
      暂未配置定时任务
    </div>
    <div v-else class="space-y-2">
      <Card v-for="(task, i) in tasks" :key="i" class="overflow-hidden" :class="!isTaskEnabled(task) && 'opacity-50'">
        <CardContent class="p-3 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <Clock class="w-4 h-4 text-muted-foreground shrink-0" />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">{{ taskBadge(task) }}</span>
                <span v-if="!isTaskEnabled(task)" class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-destructive/10 text-destructive">未启用</span>
                <span v-else-if="getTaskMessages(task).length > 1" class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-500/10 text-blue-500">随机{{ getTaskMessages(task).length }}条</span>
                <p class="text-sm font-medium truncate">{{ taskSummary(task) }}</p>
              </div>
              <p v-if="task.type === 'cron'" class="text-xs text-muted-foreground truncate">
                <code class="text-[10px] bg-muted px-1 rounded mr-1">{{ task.cron }}</code>{{ taskMsgPreview(task) }}
              </p>
              <p v-else class="text-xs text-muted-foreground truncate">{{ taskMsgPreview(task) }}</p>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="openEdit(i)">
              <Pencil class="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive" @click="removeTask(i)">
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Button variant="outline" size="sm" class="w-full" @click="openAdd">
      <Plus class="w-4 h-4 mr-1" /> 添加定时任务
    </Button>

    <!-- Edit dialog -->
    <Dialog v-model:open="editOpen">
      <DialogContent class="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div class="flex items-center justify-between pr-6">
            <DialogTitle>{{ editIndex >= 0 ? '编辑' : '添加' }}定时任务</DialogTitle>
            <div class="flex items-center rounded-md border p-0.5 gap-0.5">
              <button
                class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                :class="editMode === 'visual' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
                @click="editMode === 'code' ? switchToVisual() : undefined">
                <Eye class="w-3 h-3" /> 可视化
              </button>
              <button
                class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                :class="editMode === 'code' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
                @click="editMode === 'visual' ? switchToCode() : undefined">
                <Code class="w-3 h-3" /> 代码
              </button>
            </div>
          </div>
        </DialogHeader>

        <div v-if="editMode === 'visual'" class="space-y-4 py-2">
          <!-- Task type -->
          <div class="space-y-2">
            <Label>任务类型</Label>
            <Select v-model="editType">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">每日定时</SelectItem>
                <SelectItem value="cron">Cron 表达式</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Group IDs -->
          <div class="space-y-2">
            <Label>目标群号</Label>
            <Input v-model="editGroupIds" placeholder="输入 all 表示所有启用群，或群号用逗号分隔" />
            <p class="text-xs text-muted-foreground">输入 <code class="bg-muted px-1 rounded">all</code> 发送到所有已启用群，或输入群号如 123456, 789012</p>
          </div>

          <!-- Self ID (optional, for multi-Bot) -->
          <div class="space-y-2">
            <Label>指定 Bot QQ（可选）</Label>
            <Input v-model="editSelfId" placeholder="留空则自动选择（单 Bot 时自动使用）" />
            <p class="text-xs text-muted-foreground">多 Bot 环境下指定由哪个 Bot 发送，留空时仅在单 Bot 时生效</p>
          </div>

          <!-- Single task fields -->
          <template v-if="editType === 'single'">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-2">
                <Label>小时</Label>
                <Select :model-value="String(editHour)" @update:model-value="editHour = Number($event)">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in hours" :key="h" :value="String(h)">{{ String(h).padStart(2, '0') }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-2">
                <Label>分钟</Label>
                <Select :model-value="String(editMinute)" @update:model-value="editMinute = Number($event)">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="m in minutes" :key="m" :value="String(m)">{{ String(m).padStart(2, '0') }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </template>

          <!-- Cron task fields -->
          <template v-if="editType === 'cron'">
            <div class="space-y-2">
              <Label>Cron 表达式</Label>
              <Input v-model="editCron" placeholder="分 时 日 月 周 (如 0 9 * * 1-5)" class="font-mono text-sm"
                @input="cronError = ''" />
              <p v-if="cronError" class="text-xs text-destructive">{{ cronError }}</p>
              <p v-else-if="cronDescription" class="text-xs text-muted-foreground">
                调度：{{ cronDescription }}
              </p>
            </div>
            <div class="space-y-2">
              <Label class="text-xs text-muted-foreground">常用预设</Label>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="p in CRON_PRESETS" :key="p.value"
                  class="text-xs px-2 py-1 rounded-md border hover:bg-muted transition-colors"
                  :class="editCron === p.value ? 'bg-primary/10 border-primary text-primary' : ''"
                  @click="applyPreset(p.value)">
                  {{ p.label }}
                </button>
              </div>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">格式：<code class="bg-muted px-1 rounded">分 时 日 月 周</code></p>
              <p class="text-xs text-muted-foreground"><code class="bg-muted px-1 rounded">*</code> 任意　<code class="bg-muted px-1 rounded">*/N</code> 每N　<code class="bg-muted px-1 rounded">1,3,5</code> 列举　<code class="bg-muted px-1 rounded">1-5</code> 范围</p>
            </div>
          </template>

          <!-- Messages (shared between single & cron) -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label>消息内容</Label>
              <span v-if="editMessages.length > 1" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                {{ editMessages.length }} 条随机
              </span>
            </div>
            <div class="space-y-2">
              <div v-for="(_, mi) in editMessages" :key="mi" class="flex items-center gap-2">
                <Input v-model="editMessages[mi]" :placeholder="`消息 ${mi + 1}`" class="flex-1" />
                <Button v-if="editMessages.length > 1" variant="ghost" size="sm" class="h-8 w-8 p-0 shrink-0 text-destructive"
                  @click="removeMessage(mi)">
                  <Trash2 class="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Button variant="outline" size="sm" @click="addMessage">
                <Plus class="w-3.5 h-3.5 mr-1" /> 添加随机消息
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ TEMPLATE_VARS }}</p>
            <p v-if="editMessages.length > 1" class="text-xs text-muted-foreground">多条消息时，每次触发随机选取一条发送</p>
          </div>
        </div>

        <!-- Code mode -->
        <div v-else class="space-y-2 py-2">
          <textarea
            v-model="editCode"
            class="w-full min-h-[300px] rounded-md border bg-muted/50 p-3 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="粘贴 JSON 格式的定时任务配置..."
            spellcheck="false"
            @input="codeError = ''"
          />
          <p v-if="codeError" class="text-xs text-destructive">{{ codeError }}</p>
          <p class="text-xs text-muted-foreground">{{ TEMPLATE_VARS }}</p>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button @click="saveTask">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
