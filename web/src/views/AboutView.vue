<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/api/client'
import { checkUpdate, getVersions, getChangelogs, getAnnouncements } from '@/api/proman'
import type { UpdateCheckResult, ProManVersion, ProManChangelog, ProManAnnouncement } from '@/types/proman'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  Info,
  Server,
  Github,
  Code,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  Pin,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
} from 'lucide-vue-next'

function renderMd(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }) as string)
}

// --- About tab ---
interface AboutInfo {
  version: string
  name: string
  author: string
  license: string
  homepage: string
  repository: string
  nodeVersion: string
  platform: string
  arch: string
  uptime: number
  startTime: string
  pluginCount: number
  botCount: number
}

const about = ref<AboutInfo | null>(null)
const loading = ref(true)
const error = ref('')

async function fetchAbout() {
  try {
    about.value = await apiFetch<AboutInfo>('/api/about')
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    loading.value = false
  }
}

const platformLabel = computed(() => {
  if (!about.value) return ''
  const map: Record<string, string> = {
    win32: 'Windows',
    linux: 'Linux',
    darwin: 'macOS',
    freebsd: 'FreeBSD',
  }
  return map[about.value.platform] || about.value.platform
})

const uptimeLabel = computed(() => {
  if (!about.value) return ''
  const s = about.value.uptime
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  parts.push(`${minutes} 分钟`)
  return parts.join(' ')
})

const startTimeLabel = computed(() => {
  if (!about.value) return ''
  try {
    return new Date(about.value.startTime).toLocaleString('zh-CN')
  } catch {
    return about.value.startTime
  }
})

// --- Update check ---
const updateInfo = ref<UpdateCheckResult | null>(null)

async function fetchUpdateCheck() {
  try {
    updateInfo.value = await checkUpdate()
  } catch {
    // silent — banner just won't show
  }
}

// --- Changelog tab ---
const versions = ref<ProManVersion[]>([])
const versionsLoaded = ref(false)
const versionsLoading = ref(false)
const versionsError = ref('')
const expandedVersions = ref<Set<string>>(new Set())
const changelogCache = ref<Record<string, ProManChangelog[]>>({})
const changelogLoading = ref<Set<string>>(new Set())

async function fetchVersions() {
  if (versionsLoaded.value) return
  versionsLoading.value = true
  versionsError.value = ''
  try {
    const res = await getVersions(1, 50)
    versions.value = res.list ?? []
    versionsLoaded.value = true
  } catch (e) {
    versionsError.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    versionsLoading.value = false
  }
}

async function toggleVersion(version: string) {
  if (expandedVersions.value.has(version)) {
    expandedVersions.value.delete(version)
    return
  }
  expandedVersions.value.add(version)
  if (!changelogCache.value[version]) {
    changelogLoading.value.add(version)
    try {
      const res = await getChangelogs(version)
      changelogCache.value[version] = res.data ?? []
    } catch {
      changelogCache.value[version] = []
    } finally {
      changelogLoading.value.delete(version)
    }
  }
}

const changelogTypeLabels: Record<string, string> = {
  added: '新增',
  fixed: '修复',
  changed: '变更',
  removed: '移除',
  deprecated: '废弃',
  security: '安全',
  feature: '新功能',
  fix: '修复',
  improvement: '改进',
  breaking: '破坏性变更',
}

const changelogTypeVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  added: 'default',
  feature: 'default',
  fixed: 'secondary',
  fix: 'secondary',
  changed: 'outline',
  improvement: 'outline',
  removed: 'destructive',
  breaking: 'destructive',
  deprecated: 'outline',
  security: 'destructive',
}

function groupChangelogs(logs: ProManChangelog[]): Record<string, ProManChangelog[]> {
  const groups: Record<string, ProManChangelog[]> = {}
  for (const log of logs) {
    const type = log.type || 'other'
    if (!groups[type]) groups[type] = []
    groups[type].push(log)
  }
  return groups
}

// --- Announcements tab ---
const announcements = ref<ProManAnnouncement[]>([])
const announcementsLoaded = ref(false)
const announcementsLoading = ref(false)
const announcementsError = ref('')

async function fetchAnnouncements() {
  if (announcementsLoaded.value) return
  announcementsLoading.value = true
  announcementsError.value = ''
  try {
    const res = await getAnnouncements()
    announcements.value = res.data ?? []
    announcementsLoaded.value = true
  } catch (e) {
    announcementsError.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    announcementsLoading.value = false
  }
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr || ''
    return d.toLocaleDateString('zh-CN')
  } catch {
    return dateStr || ''
  }
}

function onTabChange(value: string | number | boolean) {
  const tab = String(value)
  if (tab === 'changelog') fetchVersions()
  else if (tab === 'announcements') fetchAnnouncements()
}

onMounted(() => {
  fetchAbout()
  fetchUpdateCheck()
})
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">关于</h1>

    <Tabs default-value="about" @update:model-value="onTabChange">
      <TabsList>
        <TabsTrigger value="about">关于</TabsTrigger>
        <TabsTrigger value="changelog">更新日志</TabsTrigger>
        <TabsTrigger value="announcements">公告</TabsTrigger>
      </TabsList>

      <!-- 关于 -->
      <TabsContent value="about" class="space-y-6 mt-4">
        <!-- Update banner -->
        <div
          v-if="updateInfo?.hasUpdate"
          class="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
        >
          <ArrowUpCircle class="w-5 h-5 text-primary shrink-0" />
          <div class="flex-1 text-sm">
            <span class="font-medium">有新版本可用：</span>
            <span>v{{ updateInfo.latestVersion }}</span>
            <span class="text-muted-foreground ml-2">（当前 v{{ updateInfo.currentVersion }}）</span>
          </div>
          <a
            v-if="updateInfo.latestUrl"
            :href="updateInfo.latestUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" class="gap-1">
              前往下载 <ExternalLink class="w-3.5 h-3.5" />
            </Button>
          </a>
        </div>

        <div v-if="loading" class="text-muted-foreground">加载中...</div>
        <div v-else-if="error" class="text-destructive">{{ error }}</div>

        <div v-else class="grid gap-6 md:grid-cols-2">
          <!-- 项目信息 -->
          <Card>
            <CardHeader class="flex flex-row items-center gap-2 space-y-0 pb-2">
              <Info class="w-5 h-5 text-primary" />
              <CardTitle class="text-base">项目信息</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex justify-between">
                <span class="text-muted-foreground">项目名称</span>
                <span class="font-medium">{{ about?.name }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">版本</span>
                <span class="font-medium">v{{ about?.version }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">前端技术栈</span>
                <span class="font-medium">Vue 3 + TypeScript</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">后端技术栈</span>
                <span class="font-medium">Fastify + SQLite</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">通信协议</span>
                <span class="font-medium">OneBot V11</span>
              </div>
            </CardContent>
          </Card>

          <!-- 系统运行信息 -->
          <Card>
            <CardHeader class="flex flex-row items-center gap-2 space-y-0 pb-2">
              <Server class="w-5 h-5 text-primary" />
              <CardTitle class="text-base">系统运行信息</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Node.js</span>
                <span class="font-medium">{{ about?.nodeVersion }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">操作系统</span>
                <span class="font-medium">{{ platformLabel }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">CPU 架构</span>
                <span class="font-medium">{{ about?.arch }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">运行时长</span>
                <span class="font-medium">{{ uptimeLabel }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">启动时间</span>
                <span class="font-medium">{{ startTimeLabel }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">已安装插件</span>
                <span class="font-medium">{{ about?.pluginCount }} 个</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">已注册 Bot</span>
                <span class="font-medium">{{ about?.botCount }} 个</span>
              </div>
            </CardContent>
          </Card>

          <!-- 开源链接 -->
          <Card>
            <CardHeader class="flex flex-row items-center gap-2 space-y-0 pb-2">
              <Github class="w-5 h-5 text-primary" />
              <CardTitle class="text-base">开源链接</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-muted-foreground">GitHub 仓库</span>
                <a
                  v-if="about?.repository"
                  :href="about.repository"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline text-sm"
                >
                  {{ about.repository.replace('https://', '') }}
                </a>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-muted-foreground">文档地址</span>
                <a
                  v-if="about?.repository"
                  :href="about.repository + '/wiki'"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline text-sm"
                >
                  查看文档
                </a>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-muted-foreground">问题反馈</span>
                <a
                  v-if="about?.repository"
                  :href="about.repository + '/issues'"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline text-sm"
                >
                  提交 Issue
                </a>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-muted-foreground">开源协议</span>
                <a
                  v-if="about?.repository"
                  :href="about.repository + '/blob/master/LICENSE'"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline text-sm"
                >
                  {{ about?.license }}
                </a>
              </div>
            </CardContent>
          </Card>

          <!-- 开发者信息 -->
          <Card>
            <CardHeader class="flex flex-row items-center gap-2 space-y-0 pb-2">
              <Code class="w-5 h-5 text-primary" />
              <CardTitle class="text-base">开发者信息</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex justify-between">
                <span class="text-muted-foreground">作者</span>
                <span class="font-medium">{{ about?.author }}</span>
              </div>
              <div v-if="about?.homepage" class="flex justify-between items-center">
                <span class="text-muted-foreground">联系方式</span>
                <a
                  :href="about.homepage"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline text-sm"
                >
                  个人网站
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <!-- 更新日志 -->
      <TabsContent value="changelog" class="mt-4">
        <div v-if="versionsLoading" class="text-muted-foreground">加载中...</div>
        <div v-else-if="versionsError" class="flex flex-col items-center gap-3 py-8">
          <AlertTriangle class="w-8 h-8 text-destructive" />
          <p class="text-destructive text-sm">{{ versionsError }}</p>
          <Button variant="outline" size="sm" @click="versionsLoaded = false; fetchVersions()">
            <RefreshCw class="w-4 h-4 mr-1" />
            重试
          </Button>
        </div>
        <div v-else-if="versions.length === 0" class="text-muted-foreground py-8 text-center">
          暂无版本信息
        </div>
        <div v-else class="space-y-3">
          <Card v-for="ver in versions" :key="ver.version">
            <div
              class="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/50 rounded-lg transition-colors"
              @click="toggleVersion(ver.version)"
            >
              <component
                :is="expandedVersions.has(ver.version) ? ChevronDown : ChevronRight"
                class="w-4 h-4 text-muted-foreground shrink-0"
              />
              <span class="font-medium">v{{ ver.version }}</span>
              <span class="text-muted-foreground text-sm">{{ formatDate(ver.published_at) }}</span>
              <Badge v-if="about && ver.version === about.version" variant="secondary" class="text-xs ml-auto shrink-0">当前版本</Badge>
              <a
                v-if="ver.url"
                :href="ver.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-muted-foreground hover:text-primary transition-colors shrink-0"
                :class="{ 'ml-auto': !(about && ver.version === about.version) }"
                @click.stop
                title="查看发布页"
              >
                <ExternalLink class="w-4 h-4" />
              </a>
            </div>
            <div v-if="expandedVersions.has(ver.version)" class="px-4 pb-4">
              <Separator class="mb-3" />
              <div v-if="changelogLoading.has(ver.version)" class="text-muted-foreground text-sm">
                加载中...
              </div>
              <div v-else-if="!changelogCache[ver.version]?.length" class="text-muted-foreground text-sm">
                暂无更新记录
              </div>
              <div v-else class="space-y-3">
                <div
                  v-for="(logs, type) in groupChangelogs(changelogCache[ver.version] ?? [])"
                  :key="type"
                >
                  <div class="flex items-center gap-2 mb-1.5">
                    <Badge :variant="changelogTypeVariants[type] ?? 'outline'" class="text-xs">
                      {{ changelogTypeLabels[type] ?? type }}
                    </Badge>
                  </div>
                  <ul class="space-y-1 ml-4">
                    <li v-for="(log, idx) in logs" :key="idx" class="text-sm prose prose-sm dark:prose-invert max-w-none" v-html="renderMd(log.content)" />
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </TabsContent>

      <!-- 公告 -->
      <TabsContent value="announcements" class="mt-4">
        <div v-if="announcementsLoading" class="text-muted-foreground">加载中...</div>
        <div v-else-if="announcementsError" class="flex flex-col items-center gap-3 py-8">
          <AlertTriangle class="w-8 h-8 text-destructive" />
          <p class="text-destructive text-sm">{{ announcementsError }}</p>
          <Button variant="outline" size="sm" @click="announcementsLoaded = false; fetchAnnouncements()">
            <RefreshCw class="w-4 h-4 mr-1" />
            重试
          </Button>
        </div>
        <div v-else-if="announcements.length === 0" class="text-muted-foreground py-8 text-center">
          暂无公告
        </div>
        <div v-else class="space-y-3">
          <Card
            v-for="(ann, idx) in announcements"
            :key="idx"
            :class="{ 'border-primary/40 bg-primary/5': ann.is_pinned }"
          >
            <CardContent class="p-4">
              <div class="flex items-start gap-2">
                <Pin v-if="ann.is_pinned" class="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-base">{{ ann.title }}</span>
                    <Badge v-if="ann.is_pinned" variant="default" class="text-xs">置顶</Badge>
                    <span class="text-xs text-muted-foreground ml-auto shrink-0">{{ formatDate(ann.published_at) }}</span>
                  </div>
                  <Separator class="mb-2" />
                  <div class="text-sm prose prose-sm dark:prose-invert max-w-none" v-html="renderMd(ann.content)" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
