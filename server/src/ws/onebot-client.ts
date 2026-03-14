import type { FastifyBaseLogger } from 'fastify';
import type {
  OneBotActionResponse,
  BotInfo,
  MessageSegment,
} from '../types/onebot.js';
import type { ConnectionManager } from './connection-manager.js';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  connectionId: string;
}

export class OneBotClient {
  private pendingRequests = new Map<string, PendingRequest>();
  private echoCounter = 0;
  private apiCallHook?: (connectionId: string, action: string, params: Record<string, unknown>, source?: string) => void;

  constructor(
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
    private timeoutMs: number = 30000,
  ) {}

  /** Hook called after every successful API call dispatch (before response) */
  setApiCallHook(hook: (connectionId: string, action: string, params: Record<string, unknown>, source?: string) => void): void {
    this.apiCallHook = hook;
  }

  async callApi(
    connectionId: string,
    action: string,
    params: Record<string, unknown> = {},
    source?: string,
  ): Promise<unknown> {
    const connection = this.connectionManager.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    if (connection.socket.readyState !== connection.socket.OPEN) {
      throw new Error(`Connection ${connectionId} is not open`);
    }

    const echo = `${Date.now()}-${++this.echoCounter}`;
    const request = JSON.stringify({ action, params, echo });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`API call '${action}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(echo, { resolve, reject, timer, connectionId });
      connection.socket.send(request);
      this.apiCallHook?.(connectionId, action, params, source);
    });
  }

  handleResponse(response: OneBotActionResponse): void {
    if (!response.echo) return;

    const pending = this.pendingRequests.get(response.echo);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.echo);

    if (response.retcode === 0) {
      pending.resolve(response.data);
    } else {
      pending.reject(
        new Error(`API error: status=${response.status}, retcode=${response.retcode}`),
      );
    }
  }

  handleConnectionRemoved(connectionId: string): void {
    for (const [echo, pending] of this.pendingRequests) {
      if (pending.connectionId === connectionId) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(echo);
        pending.reject(new Error(`Connection ${connectionId} closed`));
      }
    }
  }

  cleanup(): void {
    for (const [echo, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client shutting down'));
      this.pendingRequests.delete(echo);
    }
  }

  // ==================== Convenience methods ====================

  async getLoginInfo(connectionId: string): Promise<BotInfo> {
    const data = await this.callApi(connectionId, 'get_login_info');
    return data as BotInfo;
  }

  async getGroupList(connectionId: string): Promise<unknown[]> {
    const data = await this.callApi(connectionId, 'get_group_list');
    return data as unknown[];
  }

  async getFriendList(connectionId: string): Promise<unknown[]> {
    const data = await this.callApi(connectionId, 'get_friend_list');
    return data as unknown[];
  }

  async sendPrivateMsg(
    connectionId: string,
    userId: number,
    message: string | MessageSegment[],
    source?: string,
  ): Promise<{ message_id: number }> {
    const data = await this.callApi(connectionId, 'send_private_msg', {
      user_id: userId,
      message,
    }, source);
    return data as { message_id: number };
  }

  async sendGroupMsg(
    connectionId: string,
    groupId: number,
    message: string | MessageSegment[],
    source?: string,
  ): Promise<{ message_id: number }> {
    const data = await this.callApi(connectionId, 'send_group_msg', {
      group_id: groupId,
      message,
    }, source);
    return data as { message_id: number };
  }

  async sendMsg(
    connectionId: string,
    params: {
      message_type?: 'private' | 'group';
      user_id?: number;
      group_id?: number;
      message: string | MessageSegment[];
    },
  ): Promise<{ message_id: number }> {
    const data = await this.callApi(connectionId, 'send_msg', params);
    return data as { message_id: number };
  }

  async setGroupBan(
    connectionId: string,
    groupId: number,
    userId: number,
    duration: number = 1800,
  ): Promise<void> {
    await this.callApi(connectionId, 'set_group_ban', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
  }

  async setGroupKick(
    connectionId: string,
    groupId: number,
    userId: number,
    rejectAddRequest: boolean = false,
  ): Promise<void> {
    await this.callApi(connectionId, 'set_group_kick', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
  }

  async getGroupMemberList(connectionId: string, groupId: number): Promise<unknown[]> {
    const data = await this.callApi(connectionId, 'get_group_member_list', {
      group_id: groupId,
    });
    return data as unknown[];
  }

  async getGroupMemberInfo(
    connectionId: string,
    groupId: number,
    userId: number,
    noCache: boolean = false,
  ): Promise<unknown> {
    return this.callApi(connectionId, 'get_group_member_info', {
      group_id: groupId,
      user_id: userId,
      no_cache: noCache,
    });
  }
}
