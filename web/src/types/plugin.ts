export type PluginPermission = 'sendMessage' | 'callApi' | 'getConfig' | 'setConfig'

export interface PluginConfigItem {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  default?: unknown
  description?: string
  options?: { label: string; value: string | number }[]
  required?: boolean
  placeholder?: string
  editor?: string
}

export interface PluginCommand {
  command: string
  description: string
  usage?: string
  permission: 'all' | 'master' | 'super_admin'
  aliases?: string[]
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
  repo: string | null
  enabled: boolean
  priority: number
  loaded: boolean
  errorCount: number
  installedAt: string
  updatedAt: string
  builtin: boolean
  hasIcon: boolean
  hasReadme: boolean
  commands: PluginCommand[]
  permissions: PluginPermission[]
  configSchema: PluginConfigItem[]
}
