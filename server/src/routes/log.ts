import type { FastifyInstance } from 'fastify';
import { logService } from '../services/log.js';
import type { LogLevel, LogSource } from '../types/log.js';

export function logRoutes(fastify: FastifyInstance): void {
  // GET /api/logs — query logs with filtering and pagination
  fastify.get<{
    Querystring: {
      level?: LogLevel;
      source?: LogSource;
      search?: string;
      page?: string;
      limit?: string;
    };
  }>('/api/logs', async (request) => {
    const { level, source, search, page, limit } = request.query;
    return logService.queryLogs({
      level,
      source,
      search: search?.slice(0, 200),
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  });

  // GET /api/logs/since/:id — incremental polling
  fastify.get<{ Params: { id: string }; Querystring: { level?: LogLevel } }>('/api/logs/since/:id', async (request) => {
    const sinceId = parseInt(request.params.id, 10);
    const logs = logService.getLogsSince(sinceId, request.query.level);
    return { logs };
  });

  // GET /api/logs/export — export logs as JSON (with current filters)
  fastify.get<{
    Querystring: {
      level?: LogLevel;
      source?: LogSource;
      search?: string;
      format?: 'json' | 'csv';
    };
  }>('/api/logs/export', async (request, reply) => {
    const { level, source, search, format } = request.query;
    const result = logService.queryLogs({
      level,
      source,
      search: search?.slice(0, 200),
      page: 1,
      limit: 10000,
    });

    if (format === 'csv') {
      const header = 'ID,级别,来源,内容,详情,时间';
      const csvEscape = (s: string | null | undefined) => {
        if (!s) return '';
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const rows = result.logs.map(l =>
        [l.id, l.level, l.source, csvEscape(l.message), csvEscape(l.details ?? ''), l.createdAt].join(',')
      );
      const csv = [header, ...rows].join('\n');
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="logs.csv"')
        .send('\uFEFF' + csv);
      return;
    }

    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="logs.json"')
      .send(JSON.stringify(result.logs, null, 2));
  });

  // DELETE /api/logs — clear all logs
  fastify.delete('/api/logs', async () => {
    logService.clearLogs();
    return { success: true };
  });
}
