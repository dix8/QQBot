// ==================== Log Types ====================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'system' | 'connection' | 'bot' | 'plugin' | 'config' | 'auth';

export interface LogEntry {
  id: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  details?: string;
  createdAt: string;
}

export interface LogQueryParams {
  level?: LogLevel;
  source?: LogSource;
  search?: string;
  page?: number;
  limit?: number;
  sinceId?: number;
}

export interface LogQueryResult {
  logs: LogEntry[];
  total: number;
  page: number;
  limit: number;
}
