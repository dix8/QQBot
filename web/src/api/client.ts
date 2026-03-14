import router from '@/router'

const TOKEN_KEY = 'qqbot_token'
const DEFAULT_PWD_KEY = 'qqbot_default_pwd'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(DEFAULT_PWD_KEY)
}

export function getNeedsPasswordChange(): boolean {
  return localStorage.getItem(DEFAULT_PWD_KEY) === '1'
}

export function setNeedsPasswordChange(value: boolean): void {
  if (value) {
    localStorage.setItem(DEFAULT_PWD_KEY, '1')
  } else {
    localStorage.removeItem(DEFAULT_PWD_KEY)
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()

  const isFormData = options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, { ...options, headers })

  if (response.status === 401) {
    const body = await response.json().catch(() => ({}))
    clearToken()
    if (url !== '/api/auth/login') {
      router.push('/login')
    }
    const err = new Error(body.error || 'Unauthorized')
    err.name = 'AuthError'
    throw err
  }

  if (response.status === 403) {
    const body = await response.json().catch(() => ({}))
    if (body.code === 'DEFAULT_PASSWORD') {
      setNeedsPasswordChange(true)
    }
    throw new Error(body.error || 'Forbidden')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

/** Check if an error was caused by authentication failure (401) */
export function isAuthError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AuthError'
}
