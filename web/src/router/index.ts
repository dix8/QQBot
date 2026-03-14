import { createRouter, createWebHistory } from 'vue-router'
import { getToken, clearToken } from '@/api/client'
import LoginView from '@/views/LoginView.vue'
import DashboardView from '@/views/DashboardView.vue'

let tokenVerified = false

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    {
      path: '/bots',
      name: 'bots',
      component: () => import('@/views/BotsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/config',
      name: 'config',
      component: () => import('@/views/ConfigView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/groups',
      name: 'groups',
      component: () => import('@/views/GroupsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('@/views/LogsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/plugins',
      name: 'plugins',
      component: () => import('@/views/PluginsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/messages',
      name: 'messages',
      component: () => import('@/views/MessagesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/system',
      name: 'system',
      component: () => import('@/views/SystemSettingsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('@/views/AboutView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to) => {
  const hasToken = !!getToken()

  if (to.meta.requiresAuth && !hasToken) {
    return { name: 'login' }
  }

  // Verify token validity once per session (raw fetch to avoid circular dependency with apiFetch)
  if (to.meta.requiresAuth && hasToken && !tokenVerified) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (res.ok) {
        tokenVerified = true
      } else {
        clearToken()
        tokenVerified = false
        return { name: 'login' }
      }
    } catch {
      clearToken()
      tokenVerified = false
      return { name: 'login' }
    }
  }

  if (to.name === 'login' && hasToken) {
    return { name: 'dashboard' }
  }
})

export default router
