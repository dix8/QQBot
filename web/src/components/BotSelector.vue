<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBotsStore } from '@/stores/bots'
import { displayBotName } from '@/utils/bot'
import type { AcceptableValue } from 'reka-ui'

const props = defineProps<{
  modelValue: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const botsStore = useBotsStore()

function onChange(val: AcceptableValue) {
  emit('update:modelValue', Number(val))
}
</script>

<template>
  <Select
    :model-value="modelValue != null ? String(modelValue) : undefined"
    @update:model-value="onChange"
  >
    <SelectTrigger class="w-full sm:w-56">
      <SelectValue :placeholder="botsStore.bots.length ? '选择机器人' : '暂无机器人'" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="bot in botsStore.bots" :key="bot.id" :value="String(bot.id)">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full shrink-0"
            :class="bot.online ? 'bg-green-500' : bot.enabled ? 'bg-yellow-500' : 'bg-gray-400'" />
          {{ displayBotName(bot) }}
        </div>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
