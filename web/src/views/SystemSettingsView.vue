<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'vue-sonner'
import { Shield, Plus, X, Download, Upload, ClipboardList, AlertTriangle } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSuperAdmins, setSuperAdmins } from '@/api/system'
import { apiFetch } from '@/api/client'

const superAdmins = ref<number[]>([])
const newQQ = ref('')
const loading = ref(true)
const saving = ref(false)

interface AuditEntry {
  id: number
  action: string
  target: string | null
  detail: string | null
  username: string | null
  ip: string | null
  createdAt: string
}

const auditLogs = ref<AuditEntry[]>([])
const auditLoading = ref(false)
const auditTotal = ref(0)
const auditPage = ref(1)

const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  password_change: '修改密码',
  username_change: '修改用户名',
  config_update: '修改配置',
  config_import: '导入配置',
  superadmin_update: '修改超管',
  bot_create: '创建 Bot',
  bot_update: '修改 Bot',
  bot_delete: '删除 Bot',
  plugin_install: '安装插件',
  plugin_enable: '启用插件',
  plugin_disable: '禁用插件',
  plugin_delete: '删除插件',
  plugin_reload: '重载插件',
  plugin_reload_all: '重载全部插件',
  plugin_config_update: '修改插件配置',
  backup_restore: '还原备份',
}

onMounted(async () => {
  try {
    superAdmins.value = await getSuperAdmins()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '加载超级管理员列表失败')
  } finally {
    loading.value = false
  }
  loadAuditLogs()
})

async function addSuperAdmin() {
  const qq = parseInt(newQQ.value.trim(), 10)
  if (!qq || isNaN(qq) || qq <= 0) {
    toast.error('请输入有效的 QQ 号')
    return
  }
  if (superAdmins.value.includes(qq)) {
    toast.error(`QQ ${qq} 已在列表中`)
    return
  }
  const updated = [...superAdmins.value, qq]
  saving.value = true
  try {
    await setSuperAdmins(updated)
    superAdmins.value = updated
    newQQ.value = ''
    toast.success(`已添加超级管理员: ${qq}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '添加失败')
  } finally {
    saving.value = false
  }
}

async function removeSuperAdmin(qq: number) {
  const updated = superAdmins.value.filter(q => q !== qq)
  saving.value = true
  try {
    await setSuperAdmins(updated)
    superAdmins.value = updated
    toast.success(`已移除超级管理员: ${qq}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '移除失败')
  } finally {
    saving.value = false
  }
}

async function loadAuditLogs() {
  auditLoading.value = true
  try {
    const result = await apiFetch<{ logs: AuditEntry[]; total: number }>(`/api/audit-logs?page=${auditPage.value}&limit=20`)
    auditLogs.value = result.logs
    auditTotal.value = result.total
  } catch { toast.error('加载审计日志失败') }
  finally { auditLoading.value = false }
}

function auditPagePrev() {
  if (auditPage.value > 1) { auditPage.value--; loadAuditLogs() }
}
function auditPageNext() {
  if (auditPage.value * 20 < auditTotal.value) { auditPage.value++; loadAuditLogs() }
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString()
}

async function exportBackup() {
  try {
    const data = await apiFetch<Record<string, unknown>>('/api/backup')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qqbot-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('备份文件已下载')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '导出失败')
  }
}

const restoreInput = ref<HTMLInputElement | null>(null)
const showRestoreConfirm = ref(false)
let pendingRestoreData: unknown = null

async function handleRestore(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    pendingRestoreData = JSON.parse(text)
    showRestoreConfirm.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '文件解析失败')
  }
  if (restoreInput.value) restoreInput.value.value = ''
}

async function confirmRestore() {
  if (!pendingRestoreData) return
  showRestoreConfirm.value = false
  try {
    await apiFetch('/api/backup/restore', { method: 'POST', body: JSON.stringify(pendingRestoreData), headers: { 'Content-Type': 'application/json' } })
    toast.success('备份已还原，部分设置可能需要重启生效')
    loadAuditLogs()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '还原失败')
  } finally {
    pendingRestoreData = null
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold">系统设置</h1>
      <p class="text-sm text-muted-foreground mt-1">管理系统级别的配置</p>
    </div>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Shield class="w-5 h-5" />
          <CardTitle>超级管理员</CardTitle>
        </div>
        <CardDescription>
          超级管理员拥有最高权限，可执行所有指令（包括添加/删除主人、管理插件等）。权限层级：超级管理员 &gt; 主人 &gt; 所有人
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="text-sm text-muted-foreground">加载中...</div>
        <div v-else class="space-y-4">
          <div class="flex items-center gap-2">
            <Input
              v-model="newQQ"
              placeholder="输入 QQ 号"
              class="max-w-xs"
              @keyup.enter="addSuperAdmin"
            />
            <Button size="sm" :disabled="saving || !newQQ.trim()" @click="addSuperAdmin">
              <Plus class="w-4 h-4 mr-1" />
              添加
            </Button>
          </div>
          <div v-if="superAdmins.length === 0" class="text-sm text-muted-foreground py-4 text-center">
            暂未设置超级管理员
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="qq in superAdmins"
              :key="qq"
              class="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50"
            >
              <span class="text-sm font-mono">{{ qq }}</span>
              <Button variant="ghost" size="sm" :disabled="saving" @click="removeSuperAdmin(qq)">
                <X class="w-4 h-4 text-red-500" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Backup & Restore -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Download class="w-5 h-5" />
          <CardTitle>备份与还原</CardTitle>
        </div>
        <CardDescription>
          导出或还原完整系统备份，包括所有 Bot 配置、插件配置、插件启用状态和超级管理员设置
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Button variant="outline" @click="exportBackup">
            <Download class="w-4 h-4 mr-1" />
            导出备份
          </Button>
          <Button variant="outline" @click="restoreInput?.click()">
            <Upload class="w-4 h-4 mr-1" />
            还原备份
          </Button>
          <input ref="restoreInput" type="file" accept=".json" class="hidden" @change="handleRestore" />
        </div>
      </CardContent>
    </Card>

    <!-- Audit Logs -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <ClipboardList class="w-5 h-5" />
          <CardTitle>操作审计日志</CardTitle>
        </div>
        <CardDescription>记录所有 Web 端管理操作，便于追踪和排查</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="auditLoading" class="text-sm text-muted-foreground py-4 text-center">加载中...</div>
        <div v-else-if="auditLogs.length === 0" class="text-sm text-muted-foreground py-4 text-center">暂无审计记录</div>
        <div v-else>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-32">时间</TableHead>
                <TableHead class="w-28">操作</TableHead>
                <TableHead>详情</TableHead>
                <TableHead class="w-24">用户</TableHead>
                <TableHead class="w-28">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="entry in auditLogs" :key="entry.id">
                <TableCell class="text-xs text-muted-foreground whitespace-nowrap">{{ formatTime(entry.createdAt) }}</TableCell>
                <TableCell>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-muted font-medium">{{ ACTION_LABELS[entry.action] || entry.action }}</span>
                </TableCell>
                <TableCell class="text-sm">{{ entry.detail }}</TableCell>
                <TableCell class="text-sm">{{ entry.username || '-' }}</TableCell>
                <TableCell class="text-xs font-mono text-muted-foreground">{{ entry.ip || '-' }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div class="flex items-center justify-between mt-3">
            <span class="text-xs text-muted-foreground">共 {{ auditTotal }} 条</span>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" :disabled="auditPage <= 1" @click="auditPagePrev">上一页</Button>
              <Button variant="outline" size="sm" :disabled="auditPage * 20 >= auditTotal" @click="auditPageNext">下一页</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>

  <!-- Restore confirm dialog -->
  <Dialog v-model:open="showRestoreConfirm">
    <DialogContent>
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <AlertTriangle class="w-5 h-5 text-yellow-500" />
          确认还原备份
        </DialogTitle>
        <DialogDescription>
          还原操作将覆盖当前所有 Bot 配置、插件配置和系统设置。此操作不可撤销，确定要继续吗？
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="showRestoreConfirm = false">取消</Button>
        <Button variant="destructive" @click="confirmRestore">确认还原</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
