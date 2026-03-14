<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'

const route = useRoute()
</script>

<template>
  <AppLayout v-if="route.meta.requiresAuth">
    <RouterView />
  </AppLayout>
  <RouterView v-else />
  <Teleport to="body">
    <Toaster position="top-right" :expand="true" rich-colors close-button />
  </Teleport>
</template>
