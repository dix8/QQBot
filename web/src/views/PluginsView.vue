<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePluginsStore } from '@/stores/plugins'
import { toast } from 'vue-sonner'
import { Upload, Trash2, Puzzle, Terminal, Settings, BookOpen, Github, ChevronDown, ChevronRight, RefreshCw } from 'lucide-vue-next'
import type { PluginCommand, PluginPermission, PluginInfo, PluginConfigItem } from '@/types/plugin'
import { fetchPluginConfig, savePluginConfig, fetchPluginReadme } from '@/api/plugins'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import ScheduledMessageEditor from '@/components/ScheduledMessageEditor.vue'

const store = usePluginsStore()

const showUpload = ref(false)
const uploadFile = ref<File | null>(null)
const uploading = ref(false)

const installedPlugin = ref<PluginInfo | null>(null)
const showInstallResult = ref(false)

const deleteConfirmId = ref<string | null>(null)
const deleteConfirmName = ref('')
const togglingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const reloading = ref(false)

const commandsDialogOpen = ref(false)
const commandsDialogName = ref('')
const commandsDialogList = ref<PluginCommand[]>([])
const expandedCommands = ref<Set<number>>(new Set())

interface GroupedCommand {
  primary: PluginCommand
  aliases: string[]
}

const groupedCommands = computed<GroupedCommand[]>(() => {
  const commands = commandsDialogList.value
  if (!commands.length) return []

  const groups: GroupedCommand[] = []
  const consumed = new Set<number>()

  for (let i = 0; i < commands.length; i++) {
    if (consumed.has(i)) continue

    const cmd = commands[i]!

    // Case 1: command has explicit aliases field
    if (cmd.aliases && cmd.aliases.length > 0) {
      groups.push({ primary: cmd, aliases: [...cmd.aliases] })
      // Mark any standalone entries that match these aliases as consumed
      for (let j = i + 1; j < commands.length; j++) {
        if (!consumed.has(j) && cmd.aliases.includes(commands[j]!.command)) {
          consumed.add(j)
        }
      }
      continue
    }

    // Case 2: auto-group by identical description + permission (backward compat)
    if (cmd.description) {
      const aliases: string[] = []
      for (let j = i + 1; j < commands.length; j++) {
        if (consumed.has(j)) continue
        const other = commands[j]!
        if (other.description === cmd.description && other.permission === cmd.permission && !other.aliases?.length) {
          aliases.push(other.command)
          consumed.add(j)
        }
      }
      groups.push({ primary: cmd, aliases })
      continue
    }

    // No aliases
    groups.push({ primary: cmd, aliases: [] })
  }

  return groups
})

const configDialogOpen = ref(false)
const configDialogName = ref('')
const configDialogPluginId = ref('')
const configDialogSchema = ref<PluginConfigItem[]>([])
const configDialogValues = ref<Record<string, unknown>>({})
const configLoading = ref(false)
const configSaving = ref(false)

const permissionLabels: Record<PluginPermission, string> = {
  sendMessage: '发送消息',
  callApi: '调用 Bot API',
  getConfig: '读取配置',
  setConfig: '写入配置',
}

onMounted(() => {
  store.fetchPlugins()
})

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  uploadFile.value = input.files?.[0] ?? null
}

async function handleUpload() {
  if (!uploadFile.value) return
  uploading.value = true
  try {
    const result = await store.upload(uploadFile.value)
    showUpload.value = false
    uploadFile.value = null
    if (result.permissions && result.permissions.length > 0) {
      installedPlugin.value = result
      showInstallResult.value = true
    } else {
      toast.success('插件安装成功')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '插件安装失败')
  } finally {
    uploading.value = false
  }
}

async function togglePlugin(id: string, enabled: boolean) {
  togglingId.value = id
  try {
    if (enabled) {
      await store.enable(id)
      toast.success('插件已启用')
    } else {
      await store.disable(id)
      toast.success('插件已禁用')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    togglingId.value = null
  }
}

function showDeleteConfirm(id: string, name: string) {
  deleteConfirmId.value = id
  deleteConfirmName.value = name
}

async function confirmDelete() {
  if (!deleteConfirmId.value) return
  deletingId.value = deleteConfirmId.value
  try {
    await store.remove(deleteConfirmId.value)
    toast.success('插件已删除')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '删除插件失败')
  } finally {
    deletingId.value = null
  }
  deleteConfirmId.value = null
}

async function handlePriorityChange(id: string, event: Event) {
  const input = event.target as HTMLInputElement
  const priority = parseInt(input.value, 10)
  if (isNaN(priority) || priority < 0) return
  try {
    await store.updatePriority(id, priority)
    toast.success('优先级已更新')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '更新优先级失败')
  }
}

async function handleReloadAll() {
  reloading.value = true
  try {
    const result = await store.reloadAll()
    if (result.failed.length > 0) {
      toast.warning(`重载完成: ${result.total - result.failed.length}/${result.total} 成功`, {
        description: result.failed.join('\n'),
      })
    } else {
      toast.success(`已重载全部 ${result.total} 个插件`)
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '重载插件失败')
  } finally {
    reloading.value = false
  }
}

function formatTime(iso?: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

function showCommands(name: string, commands: PluginCommand[]) {
  commandsDialogName.value = name
  commandsDialogList.value = commands
  expandedCommands.value = new Set()
  commandsDialogOpen.value = true
}

function toggleCommandExpand(idx: number) {
  const s = new Set(expandedCommands.value)
  if (s.has(idx)) s.delete(idx)
  else s.add(idx)
  expandedCommands.value = s
}

async function openConfigDialog(plugin: PluginInfo) {
  configDialogName.value = plugin.name
  configDialogPluginId.value = plugin.id
  configDialogSchema.value = plugin.configSchema
  configDialogValues.value = {}
  configDialogOpen.value = true
  configLoading.value = true
  try {
    const result = await fetchPluginConfig(plugin.id)
    configDialogValues.value = result.values
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '加载配置失败')
  } finally {
    configLoading.value = false
  }
}

async function handleSaveConfig(pluginId: string) {
  configSaving.value = true
  try {
    await savePluginConfig(pluginId, configDialogValues.value)
    toast.success('配置已保存')
    configDialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '保存配置失败')
  } finally {
    configSaving.value = false
  }
}

function updateConfigValue(key: string, value: unknown) {
  configDialogValues.value = { ...configDialogValues.value, [key]: value }
}

const readmeDialogOpen = ref(false)
const readmeDialogName = ref('')
const readmeHtml = ref('')
const readmeLoading = ref(false)

async function openReadmeDialog(plugin: PluginInfo) {
  readmeDialogName.value = plugin.name
  readmeHtml.value = ''
  readmeDialogOpen.value = true
  readmeLoading.value = true
  try {
    const md = await fetchPluginReadme(plugin.id)
    readmeHtml.value = DOMPurify.sanitize(await marked(md))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '加载文档失败')
    readmeDialogOpen.value = false
  } finally {
    readmeLoading.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">插件管理</h1>
        <p class="text-sm text-muted-foreground mt-1">安装、配置和管理 Bot 插件</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" :disabled="reloading" @click="handleReloadAll">
          <RefreshCw class="w-4 h-4 mr-1" :class="{ 'animate-spin': reloading }" />
          {{ reloading ? '重载中...' : '重载插件' }}
        </Button>
        <Dialog v-model:open="showUpload">
          <DialogTrigger as-child>
            <Button>
              <Upload class="w-4 h-4 mr-1" />
              上传插件
            </Button>
          </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传插件</DialogTitle>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label>选择插件文件 (.zip)</Label>
              <Input type="file" accept=".zip" @change="onFileChange" />
            </div>
            <p class="text-sm text-muted-foreground">
              插件需包含 manifest.json 文件，定义名称、版本和入口文件。
            </p>
            <div class="rounded-md border p-3" style="background: hsl(var(--destructive) / 0.08); border-color: hsl(var(--destructive) / 0.3);">
              <p class="text-sm font-medium" style="color: hsl(var(--destructive));">
                安全提示
              </p>
              <p class="text-xs mt-1" style="color: hsl(var(--destructive) / 0.85);">
                插件运行在服务端 Node.js 进程中，没有沙箱隔离，拥有与主程序相同的系统权限。请仅安装来自可信来源的插件。
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose as-child>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button @click="handleUpload" :disabled="!uploadFile || uploading">
              {{ uploading ? '上传中...' : '上传安装' }}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
      </div>
    </div>

    <div v-if="store.loading && store.plugins.length === 0" class="text-sm text-muted-foreground">加载中...</div>

    <div v-if="store.plugins.length === 0 && !store.loading" class="text-center py-12">
      <Puzzle class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
      <p class="text-muted-foreground">暂无安装的插件</p>
      <p class="text-sm text-muted-foreground mt-1">点击"上传插件"安装第一个插件</p>
    </div>

    <div v-else class="space-y-4">
      <Card v-for="plugin in store.plugins" :key="plugin.id">
        <CardContent class="pt-4">
          <div class="flex flex-col gap-4">
            <!-- Top: icon + info -->
            <div class="flex items-start gap-3 flex-1">
              <!-- Plugin icon -->
              <div class="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center overflow-hidden bg-muted">
                <img
                  v-if="plugin.hasIcon"
                  :src="`/api/plugins/${plugin.id}/icon`"
                  :alt="plugin.name"
                  class="w-10 h-10 object-cover rounded-lg"
                />
                <Puzzle v-else class="w-5 h-5 text-muted-foreground" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <span class="font-semibold text-base sm:text-lg">{{ plugin.name }}</span>
                  <Badge v-if="plugin.builtin" variant="outline" class="border-blue-500 text-blue-500">内置</Badge>
                  <Badge variant="secondary">v{{ plugin.version }}</Badge>
                  <Badge v-if="plugin.loaded" variant="default">运行中</Badge>
                  <Badge v-else-if="plugin.enabled" variant="outline">已启用</Badge>
                  <Badge v-else variant="secondary">已禁用</Badge>
                  <Badge v-if="plugin.errorCount > 0" variant="destructive">
                    {{ plugin.errorCount }} 错误
                  </Badge>
                </div>
                <p v-if="plugin.description" class="text-sm text-muted-foreground">{{ plugin.description }}</p>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                  <span v-if="plugin.author">作者: {{ plugin.author }}</span>
                  <a
                    v-if="plugin.repo"
                    :href="plugin.repo"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center hover:text-foreground transition-colors"
                    title="查看仓库"
                  >
                    <Github class="w-3.5 h-3.5" />
                  </a>
                  <span v-if="!plugin.builtin">安装时间: {{ formatTime(plugin.installedAt) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-1 mt-2">
                  <Button
                    v-if="plugin.commands.length > 0"
                    variant="ghost"
                    size="sm"
                    class="h-6 px-2 text-xs gap-1"
                    @click="showCommands(plugin.name, plugin.commands)"
                  >
                    <Terminal class="w-3 h-3" />
                    指令
                  </Button>
                  <Button
                    v-if="plugin.configSchema && plugin.configSchema.length > 0"
                    variant="ghost"
                    size="sm"
                    class="h-6 px-2 text-xs gap-1"
                    @click="openConfigDialog(plugin)"
                  >
                    <Settings class="w-3 h-3" />
                    配置
                  </Button>
                  <Button
                    v-if="plugin.hasReadme"
                    variant="ghost"
                    size="sm"
                    class="h-6 px-2 text-xs gap-1"
                    @click="openReadmeDialog(plugin)"
                  >
                    <BookOpen class="w-3 h-3" />
                    文档
                  </Button>
                </div>
                <div v-if="plugin.permissions && plugin.permissions.length > 0" class="flex flex-wrap items-center gap-1.5 mt-2">
                  <span class="text-xs text-muted-foreground">权限:</span>
                  <Badge v-for="perm in plugin.permissions" :key="perm" variant="outline" class="text-xs">
                    {{ permissionLabels[perm] || perm }}
                  </Badge>
                </div>
              </div>
            </div>
            <!-- Bottom: actions -->
            <div v-if="!plugin.builtin" class="flex items-center gap-3 border-t pt-3 -mx-2 px-2">
              <div class="flex items-center gap-2">
                <Label class="text-xs text-muted-foreground">优先级</Label>
                <Input
                  type="number"
                  class="w-20 h-8 text-sm"
                  :model-value="plugin.priority"
                  min="0"
                  @change="handlePriorityChange(plugin.id, $event)"
                />
              </div>
              <div class="flex-1" />
              <Switch
                :model-value="plugin.enabled"
                :disabled="togglingId === plugin.id"
                @update:model-value="togglePlugin(plugin.id, $event)"
              />
              <Button
                variant="ghost"
                size="sm"
                @click="showDeleteConfirm(plugin.id, plugin.name)"
              >
                <Trash2 class="w-4 h-4 text-red-500" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Delete confirmation dialog -->
    <Dialog :open="!!deleteConfirmId" @update:open="(v: boolean) => { if (!v) deleteConfirmId = null }">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除插件</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground py-4">
          确定要删除插件 <strong>{{ deleteConfirmName }}</strong> 吗？此操作不可恢复。
        </p>
        <DialogFooter>
          <Button variant="outline" @click="deleteConfirmId = null">取消</Button>
          <Button variant="destructive" @click="confirmDelete" :disabled="!!deletingId">
            {{ deletingId ? '删除中...' : '确认删除' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Commands dialog -->
    <Dialog v-model:open="commandsDialogOpen">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ commandsDialogName }} - 指令列表</DialogTitle>
        </DialogHeader>
        <div class="space-y-1 py-2 max-h-80 overflow-y-auto">
          <div
            v-for="(group, idx) in groupedCommands"
            :key="idx"
          >
            <div class="flex items-start gap-3 px-3 py-2 rounded-md hover:bg-muted/50">
              <button
                v-if="group.aliases.length > 0"
                class="shrink-0 mt-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground"
                @click="toggleCommandExpand(idx)"
                :title="expandedCommands.has(idx) ? '收起别名' : `还有 ${group.aliases.length} 个别名指令`"
              >
                <ChevronDown v-if="expandedCommands.has(idx)" class="w-3.5 h-3.5" />
                <ChevronRight v-else class="w-3.5 h-3.5" />
              </button>
              <span v-else class="shrink-0 w-[22px]" />
              <code class="shrink-0 text-sm font-mono bg-muted px-1.5 py-0.5 rounded">{{ group.primary.usage || group.primary.command }}</code>
              <span :class="group.primary.description ? 'text-sm text-muted-foreground flex-1' : 'text-sm text-muted-foreground/50 italic flex-1'">
                {{ group.primary.description || '未设置描述' }}
              </span>
              <Badge v-if="group.primary.permission === 'super_admin'" variant="destructive" class="shrink-0 text-xs">超管</Badge>
              <Badge v-else-if="group.primary.permission === 'master'" variant="outline" class="shrink-0 text-xs">主人</Badge>
            </div>
            <!-- Expanded aliases -->
            <div
              v-if="group.aliases.length > 0 && expandedCommands.has(idx)"
              class="ml-[22px] border-l-2 border-muted"
            >
              <div
                v-for="alias in group.aliases"
                :key="alias"
                class="flex items-center gap-3 px-3 py-1.5 text-muted-foreground"
              >
                <code class="shrink-0 text-xs font-mono bg-muted/60 px-1.5 py-0.5 rounded">{{ alias }}</code>
                <span class="text-xs">别名</span>
              </div>
            </div>
          </div>
          <p v-if="groupedCommands.length === 0" class="text-sm text-muted-foreground text-center py-4">
            暂无可用指令
          </p>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <!-- Install result dialog (shows permissions) -->
    <Dialog v-model:open="showInstallResult">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>插件安装成功</DialogTitle>
        </DialogHeader>
        <div v-if="installedPlugin" class="py-4 space-y-3">
          <p class="text-sm">
            <span class="font-medium">{{ installedPlugin.name }}</span>
            <span class="text-muted-foreground"> v{{ installedPlugin.version }}</span>
          </p>
          <div v-if="installedPlugin.permissions.length > 0">
            <p class="text-sm text-muted-foreground mb-2">该插件声明了以下权限：</p>
            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="perm in installedPlugin.permissions" :key="perm" variant="outline">
                {{ permissionLabels[perm] || perm }}
              </Badge>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button>确认</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Plugin config dialog -->
    <Dialog v-model:open="configDialogOpen">
      <DialogContent class="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{{ configDialogName }} - 插件配置</DialogTitle>
        </DialogHeader>
        <div v-if="configLoading" class="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        <div v-else class="space-y-4 py-4 overflow-y-auto pr-2">
          <div v-for="item in configDialogSchema" :key="item.key" class="space-y-1.5">
            <Label class="text-sm">
              {{ item.label }}
              <span v-if="item.required" class="text-red-500">*</span>
            </Label>
            <p v-if="item.description" class="text-xs text-muted-foreground">{{ item.description }}</p>

            <!-- scheduled-messages editor -->
            <ScheduledMessageEditor
              v-if="item.editor === 'scheduled-messages'"
              :model-value="String(configDialogValues[item.key] ?? '[]')"
              @update:model-value="updateConfigValue(item.key, $event)"
            />

            <!-- string -->
            <Input
              v-else-if="item.type === 'string'"
              :model-value="String(configDialogValues[item.key] ?? '')"
              :placeholder="item.placeholder"
              @update:model-value="updateConfigValue(item.key, $event)"
            />

            <!-- number -->
            <Input
              v-else-if="item.type === 'number'"
              type="number"
              :model-value="String(configDialogValues[item.key] ?? '')"
              :placeholder="item.placeholder"
              @update:model-value="updateConfigValue(item.key, $event === '' ? undefined : Number($event))"
            />

            <!-- boolean -->
            <div v-else-if="item.type === 'boolean'" class="flex items-center gap-2">
              <Switch
                :model-value="!!configDialogValues[item.key]"
                @update:model-value="updateConfigValue(item.key, $event)"
              />
              <span class="text-sm text-muted-foreground">{{ configDialogValues[item.key] ? '开启' : '关闭' }}</span>
            </div>

            <!-- select -->
            <Select
              v-else-if="item.type === 'select'"
              :model-value="String(configDialogValues[item.key] ?? '')"
              @update:model-value="updateConfigValue(item.key, $event)"
            >
              <SelectTrigger>
                <SelectValue :placeholder="item.placeholder || '请选择'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in item.options"
                  :key="String(opt.value)"
                  :value="String(opt.value)"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button
            @click="handleSaveConfig(configDialogPluginId)"
            :disabled="configSaving || configLoading"
          >
            {{ configSaving ? '保存中...' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- README dialog -->
    <Dialog v-model:open="readmeDialogOpen">
      <DialogContent class="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{{ readmeDialogName }} - 文档</DialogTitle>
        </DialogHeader>
        <div v-if="readmeLoading" class="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        <div v-else class="overflow-y-auto flex-1 py-4 markdown-body max-w-none" v-html="readmeHtml" />
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.markdown-body {
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  line-height: 1.7;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  color: hsl(var(--foreground));
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

.markdown-body :deep(h1) { font-size: 1.5em; }
.markdown-body :deep(h2) { font-size: 1.25em; }
.markdown-body :deep(h3) { font-size: 1.1em; }

.markdown-body :deep(p) {
  margin: 0.75em 0;
}

.markdown-body :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
}

.markdown-body :deep(strong) {
  color: hsl(var(--foreground));
  font-weight: 600;
}

.markdown-body :deep(code) {
  color: hsl(var(--foreground));
  background: hsl(var(--muted));
  padding: 0.15em 0.4em;
  border-radius: 0.25rem;
  font-size: 0.85em;
}

.markdown-body :deep(pre) {
  background: hsl(var(--muted));
  border-radius: 0.375rem;
  padding: 0.75em 1em;
  overflow-x: auto;
  margin: 0.75em 0;
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid hsl(var(--border));
  padding: 0.4em 0.75em;
  text-align: left;
}

.markdown-body :deep(th) {
  background: hsl(var(--muted));
  font-weight: 600;
  color: hsl(var(--foreground));
}

.markdown-body :deep(td) {
  color: hsl(var(--foreground));
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown-body :deep(li) {
  margin: 0.25em 0;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid hsl(var(--border));
  margin: 1.5em 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid hsl(var(--border));
  padding-left: 1em;
  color: hsl(var(--muted-foreground));
  margin: 0.75em 0;
}
</style>
