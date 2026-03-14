import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeMode>(readStorage())
  let mediaQuery: MediaQueryList | null = null
  let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null

  function readStorage(): ThemeMode {
    const val = localStorage.getItem(STORAGE_KEY)
    if (val === 'light' || val === 'dark') return val
    return 'system'
  }

  const resolvedDark = computed(() => {
    if (theme.value === 'dark') return true
    if (theme.value === 'light') return false
    return mediaQuery?.matches ?? false
  })

  function applyClass() {
    const el = document.documentElement
    if (resolvedDark.value) {
      el.classList.add('dark')
    } else {
      el.classList.remove('dark')
    }
  }

  function setTheme(val: ThemeMode) {
    theme.value = val
    if (val === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, val)
    }
    applyClass()
  }

  function initTheme() {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaHandler = () => {
      if (theme.value === 'system') applyClass()
    }
    mediaQuery.addEventListener('change', mediaHandler)
    applyClass()
  }

  return { theme, resolvedDark, setTheme, initTheme }
})
