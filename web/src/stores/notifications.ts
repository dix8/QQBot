import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiFetch } from '@/api/client'

export interface Notification {
  id: number
  type: string
  severity: 'info' | 'warning' | 'error'
  title: string
  message: string
  timestamp: string
}

const STORAGE_KEY = 'qqbot_notif_read'

function loadReadIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw) as number[])
  } catch (e) { console.warn('[Notifications] loadReadIds failed:', e) }
  return new Set()
}

function saveReadIds(ids: Set<number>) {
  try {
    const arr = [...ids].slice(-500)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch (e) { console.warn('[Notifications] saveReadIds failed:', e) }
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<Notification[]>([])
  const readIdArray = ref<number[]>([...loadReadIds()])

  const readIdSet = computed(() => new Set(readIdArray.value))

  const unreadCount = computed(() => {
    return notifications.value.filter(n => !readIdSet.value.has(n.id)).length
  })

  async function fetchRecent() {
    try {
      const result = await apiFetch<{ notifications: Notification[] }>('/api/notifications?limit=50')
      notifications.value = result.notifications
    } catch (e) { console.warn('[Notifications] fetchRecent failed:', e) }
  }

  function push(notification: Notification) {
    const exists = notifications.value.some(n => n.id === notification.id)
    if (!exists) {
      notifications.value.unshift(notification)
      if (notifications.value.length > 200) {
        notifications.value = notifications.value.slice(0, 200)
      }
    }
  }

  function markAllRead() {
    const ids = new Set(readIdArray.value)
    for (const n of notifications.value) {
      ids.add(n.id)
    }
    readIdArray.value = [...ids]
    saveReadIds(ids)
  }

  function isRead(id: number) {
    return readIdSet.value.has(id)
  }

  return { notifications, unreadCount, fetchRecent, push, markAllRead, isRead }
})
