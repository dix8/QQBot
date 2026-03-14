import { ref, readonly } from 'vue'
import { getToken, apiFetch } from '@/api/client'

type EventCallback = (data: unknown) => void

const connected = ref(false)
const reconnecting = ref(false)

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
const MAX_RECONNECT_DELAY = 30_000
const listeners = new Map<string, Set<EventCallback>>()
let started = false

async function fetchWsTicket(): Promise<string | null> {
  try {
    const res = await apiFetch<{ ticket: string }>('/api/auth/ws-ticket', { method: 'POST' })
    return res.ticket
  } catch {
    return null
  }
}

function handleMessage(ev: MessageEvent) {
  try {
    const { event, data } = JSON.parse(ev.data)
    const cbs = listeners.get(event)
    if (cbs) {
      for (const cb of cbs) cb(data)
    }
  } catch (e) { console.warn('[AdminWs] malformed message:', e) }
}

async function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  const token = getToken()
  if (!token) return

  const ticket = await fetchWsTicket()
  if (!ticket) {
    scheduleReconnect()
    return
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/ws/admin?ticket=${encodeURIComponent(ticket)}`

  try {
    socket = new WebSocket(url)
  } catch (e) {
    console.warn('[AdminWs] connect failed:', e)
    scheduleReconnect()
    return
  }

  socket.onopen = () => {
    connected.value = true
    reconnecting.value = false
    reconnectDelay = 1000
  }

  socket.onmessage = handleMessage

  socket.onclose = (ev) => {
    connected.value = false
    socket = null
    if (ev.code !== 4003) {
      scheduleReconnect()
    }
  }

  socket.onerror = () => {
    // onclose will fire next
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnecting.value = true
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
    connect()
  }, reconnectDelay)
}

export function startAdminWs() {
  if (started) return
  started = true
  connect()
}

export function stopAdminWs() {
  started = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    socket.close(1000)
    socket = null
  }
  connected.value = false
  reconnecting.value = false
}

export function onAdminWsEvent(event: string, callback: EventCallback) {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(callback)
}

export function offAdminWsEvent(event: string, callback: EventCallback) {
  const set = listeners.get(event)
  if (set) {
    set.delete(callback)
    if (set.size === 0) listeners.delete(event)
  }
}

export function useAdminWs() {
  return {
    connected: readonly(connected),
    reconnecting: readonly(reconnecting),
    on: onAdminWsEvent,
    off: offAdminWsEvent,
    start: startAdminWs,
    stop: stopAdminWs,
  }
}
