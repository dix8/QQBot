import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BotDetail, BotCreatePayload, BotUpdatePayload } from '@/types/bot'
import * as botsApi from '@/api/bots'

export const useBotsStore = defineStore('bots', () => {
  const bots = ref<BotDetail[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchBots() {
    loading.value = true
    error.value = ''
    try {
      const result = await botsApi.fetchBots()
      bots.value = result.bots
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载机器人列表失败'
    } finally {
      loading.value = false
    }
  }

  async function createBot(data: BotCreatePayload) {
    error.value = ''
    try {
      const result = await botsApi.createBot(data)
      await fetchBots()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '添加机器人失败'
      throw e
    }
  }

  async function updateBot(id: number, data: BotUpdatePayload) {
    error.value = ''
    try {
      await botsApi.updateBot(id, data)
      await fetchBots()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新机器人信息失败'
      throw e
    }
  }

  async function deleteBot(id: number) {
    error.value = ''
    try {
      await botsApi.deleteBot(id)
      await fetchBots()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除机器人记录失败'
      throw e
    }
  }

  async function enableBot(id: number) {
    error.value = ''
    try {
      await botsApi.enableBot(id)
      await fetchBots()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '启用机器人失败'
      throw e
    }
  }

  async function disableBot(id: number) {
    error.value = ''
    try {
      await botsApi.disableBot(id)
      await fetchBots()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '禁用机器人失败'
      throw e
    }
  }

  return { bots, loading, error, fetchBots, createBot, updateBot, deleteBot, enableBot, disableBot }
})
