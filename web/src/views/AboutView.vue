<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/api/client'
import {
  Info,
  Server,
  Github,
  Code,
} from 'lucide-vue-next'

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

onMounted(fetchAbout)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">关于</h1>

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
  </div>
</template>
