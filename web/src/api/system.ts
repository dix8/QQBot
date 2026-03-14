import { apiFetch } from './client'

export async function getSuperAdmins(): Promise<number[]> {
  const data = await apiFetch<{ list: number[] }>('/api/system/super-admins')
  return data.list
}

export async function setSuperAdmins(list: number[]): Promise<void> {
  await apiFetch('/api/system/super-admins', {
    method: 'PUT',
    body: JSON.stringify({ list }),
  })
}
