import { ref } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'sidebar_collapsed'

export const useSidebarStore = defineStore('sidebar', () => {
  const collapsed = ref(localStorage.getItem(STORAGE_KEY) === 'true')

  function toggle() {
    collapsed.value = !collapsed.value
    localStorage.setItem(STORAGE_KEY, String(collapsed.value))
  }

  return { collapsed, toggle }
})
