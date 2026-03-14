export interface BotRecord {
  id: number;
  selfId: number | null;
  wsHost: string;
  wsPort: number;
  wsToken: string;
  enabled: number;
  remark: string;
  description: string;
  avatarUrl: string;
  createdAt: string;
  updatedAt: string;
}

// API 返回的合并类型：连接实时数据 + 持久化自定义数据
export interface BotDetail {
  id: number;
  selfId: number | null;
  nickname: string;        // 来自 NapCat 的昵称
  remark: string;          // 用户自定义备注
  description: string;     // 用户自定义描述
  avatarUrl: string;       // 自定义头像
  wsHost: string;
  wsPort: number;
  hasToken: boolean;       // 是否设置了 wsToken（不返回明文）
  enabled: boolean;
  // 连接状态（可能无连接）
  online: boolean;
  connectionId?: string;
  state?: string;
  connectedAt?: string;
  lastHeartbeat?: string;
  remoteAddress?: string;
  error?: string;
}

export interface BotCreatePayload {
  wsHost: string;
  wsPort: number;
  wsToken?: string;
}

export interface BotUpdatePayload {
  remark?: string;
  description?: string;
  avatarUrl?: string;
  wsHost?: string;
  wsPort?: number;
  wsToken?: string;
}
