<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { setNeedsPasswordChange } from '@/api/client'
import { toast } from 'vue-sonner'

const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const loading = ref(false)
const usernameError = ref(false)
const passwordError = ref(false)

async function handleLogin() {
  usernameError.value = username.value.trim().length < 2
  passwordError.value = password.value.length < 8

  if (usernameError.value) {
    toast.error('用户名至少 2 个字符')
    return
  }
  if (passwordError.value) {
    toast.error('密码至少 8 个字符')
    return
  }
  loading.value = true

  try {
    const res = await auth.login(username.value, password.value)
    setNeedsPasswordChange(!!res.changePasswordHint)
    toast.success('登录成功')
    router.push('/dashboard')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <Card class="w-[400px]">
      <CardHeader>
        <CardTitle>QQBot 管理面板</CardTitle>
        <CardDescription>请登录以继续</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="space-y-4" @submit.prevent="handleLogin">
          <div class="space-y-2">
            <Label for="username">用户名</Label>
            <Input
              id="username"
              v-model="username"
              type="text"
              placeholder="请输入用户名"
              :disabled="loading"
              :class="usernameError ? 'border-red-500 focus-visible:ring-red-500' : ''"
              @input="usernameError = false"
            />
          </div>
          <div class="space-y-2">
            <Label for="password">密码</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              placeholder="请输入密码"
              :disabled="loading"
              :class="passwordError ? 'border-red-500 focus-visible:ring-red-500' : ''"
              @input="passwordError = false"
            />
          </div>
          <Button type="submit" class="w-full" :disabled="loading">
            {{ loading ? '登录中...' : '登录' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
