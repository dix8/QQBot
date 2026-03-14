// ==================== Message Segments ====================

export interface TextSegment {
  type: 'text';
  data: { text: string };
}

export interface FaceSegment {
  type: 'face';
  data: { id: string };
}

export interface ImageSegment {
  type: 'image';
  data: { file: string; url?: string; type?: string };
}

export interface RecordSegment {
  type: 'record';
  data: { file: string; url?: string };
}

export interface AtSegment {
  type: 'at';
  data: { qq: string | 'all' };
}

export interface ReplySegment {
  type: 'reply';
  data: { id: string };
}

export interface ForwardSegment {
  type: 'forward';
  data: { id: string };
}

export interface NodeSegment {
  type: 'node';
  data:
    | { id: string }
    | { user_id: string; nickname: string; content: MessageSegment[] };
}

export interface JsonSegment {
  type: 'json';
  data: { data: string };
}

export interface XmlSegment {
  type: 'xml';
  data: { data: string };
}

export type MessageSegment =
  | TextSegment
  | FaceSegment
  | ImageSegment
  | RecordSegment
  | AtSegment
  | ReplySegment
  | ForwardSegment
  | NodeSegment
  | JsonSegment
  | XmlSegment;

// ==================== Sender ====================

export interface OneBotSender {
  user_id: number;
  nickname: string;
  card?: string;
  sex?: 'male' | 'female' | 'unknown';
  age?: number;
  role?: 'owner' | 'admin' | 'member';
  level?: string;
  title?: string;
}

// ==================== Events ====================

interface BaseEvent {
  time: number;
  self_id: number;
}

// Message events
export interface PrivateMessageEvent extends BaseEvent {
  post_type: 'message';
  message_type: 'private';
  sub_type: 'friend' | 'group' | 'other';
  message_id: number;
  user_id: number;
  message: MessageSegment[] | string;
  raw_message: string;
  font: number;
  sender: OneBotSender;
}

export interface GroupMessageEvent extends BaseEvent {
  post_type: 'message';
  message_type: 'group';
  sub_type: 'normal' | 'anonymous' | 'notice';
  message_id: number;
  group_id: number;
  user_id: number;
  anonymous?: { id: number; name: string; flag: string } | null;
  message: MessageSegment[] | string;
  raw_message: string;
  font: number;
  sender: OneBotSender;
}

export type MessageEvent = PrivateMessageEvent | GroupMessageEvent;

// Message sent events (bot's own messages sent from QQ client)
export interface PrivateMessageSentEvent extends BaseEvent {
  post_type: 'message_sent';
  message_type: 'private';
  sub_type: string;
  message_id: number;
  user_id: number;
  message: MessageSegment[] | string;
  raw_message: string;
  font: number;
  sender: OneBotSender;
}

export interface GroupMessageSentEvent extends BaseEvent {
  post_type: 'message_sent';
  message_type: 'group';
  sub_type: string;
  message_id: number;
  group_id: number;
  user_id: number;
  message: MessageSegment[] | string;
  raw_message: string;
  font: number;
  sender: OneBotSender;
}

export type MessageSentEvent = PrivateMessageSentEvent | GroupMessageSentEvent;

// Notice events
export interface NoticeEvent extends BaseEvent {
  post_type: 'notice';
  notice_type: string;
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  target_id?: number;
  duration?: number;
  message_id?: number;
  honor_type?: string;
  file?: { id?: string; name?: string; size?: number; busid?: number };
  [key: string]: unknown;
}

// Request events
export interface FriendRequestEvent extends BaseEvent {
  post_type: 'request';
  request_type: 'friend';
  user_id: number;
  comment: string;
  flag: string;
}

export interface GroupRequestEvent extends BaseEvent {
  post_type: 'request';
  request_type: 'group';
  sub_type: 'add' | 'invite';
  group_id: number;
  user_id: number;
  comment: string;
  flag: string;
}

export type RequestEvent = FriendRequestEvent | GroupRequestEvent;

// Meta events
export interface HeartbeatEvent extends BaseEvent {
  post_type: 'meta_event';
  meta_event_type: 'heartbeat';
  status: {
    online: boolean;
    good: boolean;
    [key: string]: unknown;
  };
  interval: number;
}

export interface LifecycleEvent extends BaseEvent {
  post_type: 'meta_event';
  meta_event_type: 'lifecycle';
  sub_type: 'enable' | 'disable' | 'connect';
}

export type MetaEvent = HeartbeatEvent | LifecycleEvent;

// Union of all events
export type OneBotEvent = MessageEvent | MessageSentEvent | NoticeEvent | RequestEvent | MetaEvent;

// ==================== API Request / Response ====================

export interface OneBotActionRequest {
  action: string;
  params: Record<string, unknown>;
  echo: string;
}

export interface OneBotActionResponse {
  status: 'ok' | 'async' | 'failed';
  retcode: number;
  data: unknown;
  echo?: string;
}

// ==================== Connection ====================

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  ERROR = 'error',
}

export interface BotInfo {
  user_id: number;
  nickname: string;
}

export interface NapCatConnectionInfo {
  id: string;
  selfId?: number;
  state: ConnectionState;
  connectedAt: string;
  lastHeartbeat?: string;
  remoteAddress: string;
  botInfo?: BotInfo;
  error?: string;
}
