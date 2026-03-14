import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BotConfigData, ConfigSection } from '@/types/config'
import * as configApi from '@/api/config'

export const useConfigStore = defineStore('config', () => {
  const config = ref<BotConfigData | null>(null)
  const loading = ref(false)
  const error = ref('')
  const currentBotId = ref<number | null>(null)

  async function loadConfig(botId: number) {
    loading.value = true
    error.value = ''
    currentBotId.value = botId
    try {
      config.value = await configApi.fetchAllConfig(botId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载配置失败'
    } finally {
      loading.value = false
    }
  }

  async function updateSection(botId: number, section: ConfigSection, value: unknown) {
    error.value = ''
    try {
      await configApi.updateConfigSection(botId, section, value)
      config.value = await configApi.fetchAllConfig(botId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新配置失败'
      throw e
    }
  }

  async function exportConfig(botId: number): Promise<BotConfigData> {
    return configApi.exportConfig(botId)
  }

  async function importConfig(botId: number, data: BotConfigData) {
    error.value = ''
    try {
      await configApi.importConfig(botId, data)
      config.value = await configApi.fetchAllConfig(botId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '导入配置失败'
      throw e
    }
  }

  return { config, loading, error, currentBotId, loadConfig, updateSection, exportConfig, importConfig }
})
