import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PluginInfo } from '@/types/plugin'
import * as pluginsApi from '@/api/plugins'
import { toast } from 'vue-sonner'

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginInfo[]>([])
  const loading = ref(false)

  async function fetchPlugins() {
    loading.value = true
    try {
      const result = await pluginsApi.fetchPlugins()
      plugins.value = result.plugins
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载插件列表失败')
    } finally {
      loading.value = false
    }
  }

  async function upload(file: File): Promise<PluginInfo> {
    const info = await pluginsApi.uploadPlugin(file)
    await fetchPlugins()
    return info
  }

  async function enable(id: string) {
    await pluginsApi.enablePlugin(id)
    await fetchPlugins()
  }

  async function disable(id: string) {
    await pluginsApi.disablePlugin(id)
    await fetchPlugins()
  }

  async function updatePriority(id: string, priority: number) {
    await pluginsApi.updatePluginPriority(id, priority)
    await fetchPlugins()
  }

  async function remove(id: string) {
    await pluginsApi.deletePlugin(id)
    await fetchPlugins()
  }

  async function reloadAll() {
    const result = await pluginsApi.reloadAllPlugins()
    await fetchPlugins()
    return result
  }

  return { plugins, loading, fetchPlugins, upload, enable, disable, updatePriority, remove, reloadAll }
})
