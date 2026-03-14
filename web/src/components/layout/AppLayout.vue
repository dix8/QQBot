<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useNotificationsStore, type Notification } from '@/stores/notifications'
import { useAdminWs } from '@/composables/useAdminWs'
import { getNeedsPasswordChange, setNeedsPasswordChange } from '@/api/client'
import { toast } from 'vue-sonner'
import {
  LayoutDashboard,
  Bot,
  Settings,
  ScrollText,
  Puzzle,
  Info,
  Menu,
  X,
  LogOut,
  KeyRound,
  UserCog,
  Sun,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeft,
  Shield,
  Users,
  Bell,
  MessageSquare,
} from 'lucide-vue-next'
import { useSidebarStore } from '@/stores/sidebar'

const auth = useAuthStore()
const themeStore = useThemeStore()
const sidebarStore = useSidebarStore()
const notifStore = useNotificationsStore()
const { on: wsOn, off: wsOff } = useAdminWs()
const route = useRoute()
const sidebarOpen = ref(false)
const notifOpenDesktop = ref(false)
const notifOpenMobile = ref(false)
const displayUsername = ref('管理员')

function onNotification(data: unknown) {
  const n = data as Notification
  notifStore.push(n)
  if (n.severity === 'warning' || n.severity === 'error') {
    toast[n.severity === 'error' ? 'error' : 'warning'](n.title, { description: n.message })
  }
}

function severityColor(severity: string) {
  if (severity === 'error') return 'text-red-500'
  if (severity === 'warning') return 'text-yellow-500'
  return 'text-blue-500'
}

function formatNotifTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString()
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString()
}

const themeIcon = computed(() => {
  if (themeStore.theme === 'light') return Sun
  if (themeStore.theme === 'dark') return Moon
  return Monitor
})

const navItems = [
  { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/bots', label: '机器人', icon: Bot },
  { path: '/groups', label: '群管理', icon: Users },
  { path: '/config', label: 'Bot 配置', icon: Settings },
  { path: '/messages', label: '消息记录', icon: MessageSquare },
  { path: '/logs', label: '日志', icon: ScrollText },
  { path: '/plugins', label: '插件', icon: Puzzle },
  { path: '/system', label: '系统设置', icon: Shield },
  { path: '/about', label: '关于', icon: Info },
]

function isActive(path: string) {
  return route.path === path
}

// Change password dialog
const showChangePwd = ref(false)
const forcedPwdChange = ref(false)
const currentPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const changingPwd = ref(false)
const currentPwdError = ref(false)
const newPwdError = ref(false)
const confirmPwdError = ref(false)

function openChangePwd() {
  currentPwd.value = ''
  newPwd.value = ''
  confirmPwd.value = ''
  currentPwdError.value = false
  newPwdError.value = false
  confirmPwdError.value = false
  forcedPwdChange.value = false
  showChangePwd.value = true
}

async function handleChangePwd() {
  currentPwdError.value = !currentPwd.value
  newPwdError.value = !newPwd.value || newPwd.value.length < 8 || currentPwd.value === newPwd.value
  confirmPwdError.value = !confirmPwd.value || newPwd.value !== confirmPwd.value

  if (!currentPwd.value || !newPwd.value || !confirmPwd.value) {
    toast.error('请填写所有字段')
    return
  }
  if (newPwd.value.length < 8) {
    toast.error('新密码至少 8 个字符')
    return
  }
  if (currentPwd.value === newPwd.value) {
    toast.error('新密码不能与当前密码相同')
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    toast.error('两次输入的新密码不一致')
    return
  }
  changingPwd.value = true
  try {
    await auth.changePassword(currentPwd.value, newPwd.value)
    showChangePwd.value = false
    forcedPwdChange.value = false
    setNeedsPasswordChange(false)
    toast.success('密码修改成功，请重新登录')
    auth.logout()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '密码修改失败')
  } finally {
    changingPwd.value = false
  }
}

// Change username dialog
const showChangeUsername = ref(false)
const newUsername = ref('')
const changingUsername = ref(false)
const newUsernameError = ref(false)

function openChangeUsername() {
  newUsername.value = ''
  newUsernameError.value = false
  showChangeUsername.value = true
}

async function handleChangeUsername() {
  newUsernameError.value = !newUsername.value || newUsername.value.trim().length < 2
  if (newUsernameError.value) {
    toast.error('用户名至少 2 个字符')
    return
  }
  changingUsername.value = true
  try {
    await auth.changeUsername(newUsername.value.trim())
    showChangeUsername.value = false
    toast.success('用户名修改成功，请重新登录')
    auth.logout()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '用户名修改失败')
  } finally {
    changingUsername.value = false
  }
}

// Fetch current username & check forced password change
onMounted(async () => {
  try {
    const me = await auth.checkAuth()
    displayUsername.value = me.username
  } catch {
    // ignore
  }
  notifStore.fetchRecent()
  wsOn('notification', onNotification)
  if (getNeedsPasswordChange()) {
    currentPwd.value = ''
    newPwd.value = ''
    confirmPwd.value = ''
    currentPwdError.value = false
    newPwdError.value = false
    confirmPwdError.value = false
    forcedPwdChange.value = true
    showChangePwd.value = true
  }
})

onUnmounted(() => {
  wsOff('notification', onNotification)
})
</script>

<template>
  <div class="min-h-screen flex bg-background">
    <!-- Mobile overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-black/50 lg:hidden"
      @click="sidebarOpen = false"
    />

    <!-- Sidebar -->
    <aside
      :class="[
        'fixed inset-y-0 left-0 z-50 bg-card border-r flex flex-col transition-all duration-200 lg:translate-x-0 lg:static lg:z-auto',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        sidebarStore.collapsed ? 'lg:w-16 w-64' : 'w-64',
      ]"
    >
      <!-- Logo -->
      <div :class="['flex items-center h-16 shrink-0 overflow-hidden', sidebarStore.collapsed ? 'justify-center px-2' : 'gap-2 px-6']">
        <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span class="text-primary-foreground font-bold text-sm">Q</span>
        </div>
        <span v-if="!sidebarStore.collapsed" class="font-semibold text-lg whitespace-nowrap">QQBot 管理</span>
        <div v-if="!sidebarStore.collapsed" class="ml-auto flex items-center gap-1">
          <!-- Desktop notification bell -->
          <DropdownMenu v-model:open="notifOpenDesktop">
            <DropdownMenuTrigger as-child>
              <button class="relative p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors hidden lg:block">
                <Bell class="w-4 h-4" />
                <span v-if="notifStore.unreadCount > 0"
                  class="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {{ notifStore.unreadCount > 9 ? '9+' : notifStore.unreadCount }}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent v-if="notifOpenDesktop" align="start" :side-offset="8" class="w-80 max-h-96 overflow-y-auto">
              <div class="flex items-center justify-between px-3 py-2 border-b">
                <span class="text-sm font-medium">通知</span>
                <button v-if="notifStore.unreadCount > 0" class="text-xs text-primary hover:underline" @click="notifStore.markAllRead()">
                  全部已读
                </button>
              </div>
              <div v-if="notifStore.notifications.length === 0" class="px-3 py-6 text-center text-sm text-muted-foreground">
                暂无通知
              </div>
              <div v-else>
                <DropdownMenuItem v-for="n in notifStore.notifications.slice(0, 20)" :key="n.id" class="flex-col items-start gap-1 py-2 cursor-default"
                  :class="{ 'opacity-50': notifStore.isRead(n.id) }">
                  <div class="flex items-center gap-2 w-full">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="severityColor(n.severity).replace('text-', 'bg-')" />
                    <span class="text-sm font-medium flex-1 truncate">{{ n.title }}</span>
                    <span class="text-[10px] text-muted-foreground shrink-0">{{ formatNotifTime(n.timestamp) }}</span>
                  </div>
                  <span class="text-xs text-muted-foreground pl-3.5 line-clamp-2">{{ n.message }}</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors hidden lg:block">
                <component :is="themeIcon" class="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" :side-offset="8">
              <DropdownMenuItem class="gap-2" @click="themeStore.setTheme('light')">
                <Sun class="w-4 h-4" /> 浅色
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2" @click="themeStore.setTheme('dark')">
                <Moon class="w-4 h-4" /> 深色
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2" @click="themeStore.setTheme('system')">
                <Monitor class="w-4 h-4" /> 跟随系统
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button class="lg:hidden" @click="sidebarOpen = false">
            <X class="w-5 h-5" />
          </button>
        </div>
        <!-- Mobile close button when collapsed (shouldn't happen, but safe) -->
        <button v-if="sidebarStore.collapsed" class="lg:hidden absolute top-4 right-2" @click="sidebarOpen = false">
          <X class="w-5 h-5" />
        </button>
      </div>

      <Separator />

      <!-- Nav links -->
      <nav class="flex-1 px-3 py-4 space-y-1">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          :title="sidebarStore.collapsed ? item.label : undefined"
          :class="[
            'flex items-center py-2 rounded-md text-sm font-medium transition-colors',
            sidebarStore.collapsed ? 'justify-center px-2' : 'gap-3 px-3',
            isActive(item.path)
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ]"
          @click="sidebarOpen = false"
        >
          <component :is="item.icon" class="w-4 h-4 shrink-0" />
          <span v-if="!sidebarStore.collapsed" class="whitespace-nowrap overflow-hidden">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- Collapse toggle (desktop only) -->
      <div class="hidden lg:flex px-3 pb-1 justify-center">
        <button
          @click="sidebarStore.toggle()"
          class="p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          :title="sidebarStore.collapsed ? '展开侧边栏' : '收起侧边栏'"
        >
          <PanelLeft v-if="sidebarStore.collapsed" class="w-4 h-4" />
          <PanelLeftClose v-else class="w-4 h-4" />
        </button>
      </div>

      <!-- Bottom user section -->
      <div class="px-3 py-4 border-t">
        <div :class="['flex items-center', sidebarStore.collapsed ? 'flex-col gap-1' : 'justify-between px-3']">
          <span v-if="!sidebarStore.collapsed" class="text-sm text-muted-foreground truncate">{{ displayUsername }}</span>
          <div :class="['flex shrink-0', sidebarStore.collapsed ? 'flex-col gap-1' : 'gap-1']">
            <Button variant="ghost" size="sm" @click="openChangeUsername" title="修改用户名">
              <UserCog class="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" @click="openChangePwd" title="修改密码">
              <KeyRound class="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" @click="auth.logout()" title="退出登录">
              <LogOut class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Change password dialog -->
    <Dialog v-model:open="showChangePwd">
      <DialogContent :hideClose="forcedPwdChange" @pointerDownOutside="forcedPwdChange ? $event.preventDefault() : undefined" @escapeKeyDown="forcedPwdChange ? $event.preventDefault() : undefined" @interactOutside="forcedPwdChange ? $event.preventDefault() : undefined">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription v-if="forcedPwdChange">
            检测到当前使用默认密码，请先修改密码后再继续使用
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label>当前密码</Label>
            <Input v-model="currentPwd" type="password" placeholder="输入当前密码" :class="currentPwdError ? 'border-red-500 focus-visible:ring-red-500' : ''" @input="currentPwdError = false" />
          </div>
          <div class="space-y-2">
            <Label>新密码</Label>
            <Input v-model="newPwd" type="password" placeholder="输入新密码（至少 8 位）" :class="newPwdError ? 'border-red-500 focus-visible:ring-red-500' : ''" @input="newPwdError = false" />
          </div>
          <div class="space-y-2">
            <Label>确认新密码</Label>
            <Input v-model="confirmPwd" type="password" placeholder="再次输入新密码" :class="confirmPwdError ? 'border-red-500 focus-visible:ring-red-500' : ''" @input="confirmPwdError = false" @keyup.enter="handleChangePwd" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose v-if="!forcedPwdChange" as-child>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button @click="handleChangePwd" :disabled="changingPwd">
            {{ changingPwd ? '修改中...' : '确认修改' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Change username dialog -->
    <Dialog v-model:open="showChangeUsername">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改用户名</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label>新用户名</Label>
            <Input v-model="newUsername" placeholder="输入新用户名（至少 2 个字符）" :class="newUsernameError ? 'border-red-500 focus-visible:ring-red-500' : ''" @input="newUsernameError = false" @keyup.enter="handleChangeUsername" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button @click="handleChangeUsername" :disabled="changingUsername">
            {{ changingUsername ? '修改中...' : '确认修改' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Mobile header -->
      <header class="lg:hidden flex items-center h-14 px-4 border-b bg-card">
        <button @click="sidebarOpen = true">
          <Menu class="w-5 h-5" />
        </button>
        <span class="ml-3 font-semibold">QQBot 管理</span>
        <div class="ml-auto flex items-center gap-1">
          <!-- Mobile notification bell -->
          <DropdownMenu v-model:open="notifOpenMobile">
            <DropdownMenuTrigger as-child>
              <button class="relative p-2">
                <Bell class="w-4 h-4" />
                <span v-if="notifStore.unreadCount > 0"
                  class="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {{ notifStore.unreadCount > 9 ? '9+' : notifStore.unreadCount }}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent v-if="notifOpenMobile" align="end" :side-offset="8" class="w-80 max-h-96 overflow-y-auto">
              <div class="flex items-center justify-between px-3 py-2 border-b">
                <span class="text-sm font-medium">通知</span>
                <button v-if="notifStore.unreadCount > 0" class="text-xs text-primary hover:underline" @click="notifStore.markAllRead()">
                  全部已读
                </button>
              </div>
              <div v-if="notifStore.notifications.length === 0" class="px-3 py-6 text-center text-sm text-muted-foreground">
                暂无通知
              </div>
              <div v-else>
                <DropdownMenuItem v-for="n in notifStore.notifications.slice(0, 20)" :key="n.id" class="flex-col items-start gap-1 py-2 cursor-default"
                  :class="{ 'opacity-50': notifStore.isRead(n.id) }">
                  <div class="flex items-center gap-2 w-full">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="severityColor(n.severity).replace('text-', 'bg-')" />
                    <span class="text-sm font-medium flex-1 truncate">{{ n.title }}</span>
                    <span class="text-[10px] text-muted-foreground shrink-0">{{ formatNotifTime(n.timestamp) }}</span>
                  </div>
                  <span class="text-xs text-muted-foreground pl-3.5 line-clamp-2">{{ n.message }}</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="p-2">
                <component :is="themeIcon" class="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" :side-offset="8">
              <DropdownMenuItem class="gap-2" @click="themeStore.setTheme('light')">
                <Sun class="w-4 h-4" /> 浅色
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2" @click="themeStore.setTheme('dark')">
                <Moon class="w-4 h-4" /> 深色
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2" @click="themeStore.setTheme('system')">
                <Monitor class="w-4 h-4" /> 跟随系统
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
