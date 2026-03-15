import type { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';
import { promanService } from '../services/proman.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export function promanRoutes(fastify: FastifyInstance): void {
  // GET /api/proman/update-check
  fastify.get('/api/proman/update-check', async (_request, reply) => {
    try {
      return await promanService.checkUpdate(pkg.version);
    } catch (err) {
      fastify.log.warn({ err }, 'ProMan update check failed');
      return reply.code(502).send({ error: 'ProMan 服务不可用' });
    }
  });

  // GET /api/proman/versions
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/proman/versions',
    async (request, reply) => {
      try {
        const page = parseInt(request.query.page ?? '1', 10) || 1;
        const limit = parseInt(request.query.limit ?? '20', 10) || 20;
        return await promanService.getVersions(page, limit);
      } catch (err) {
        fastify.log.warn({ err }, 'ProMan versions fetch failed');
        return reply.code(502).send({ error: 'ProMan 服务不可用' });
      }
    },
  );

  // GET /api/proman/versions/:version/changelogs
  fastify.get<{ Params: { version: string } }>(
    '/api/proman/versions/:version/changelogs',
    async (request, reply) => {
      try {
        const data = await promanService.getChangelogs(request.params.version);
        return { data };
      } catch (err) {
        fastify.log.warn({ err }, 'ProMan changelogs fetch failed');
        return reply.code(502).send({ error: 'ProMan 服务不可用' });
      }
    },
  );

  // GET /api/proman/announcements
  fastify.get('/api/proman/announcements', async (_request, reply) => {
    try {
      const data = await promanService.getAnnouncements();
      return { data };
    } catch (err) {
      fastify.log.warn({ err }, 'ProMan announcements fetch failed');
      return reply.code(502).send({ error: 'ProMan 服务不可用' });
    }
  });
}
