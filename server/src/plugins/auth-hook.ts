import type { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.js';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health']);

/** Path patterns that skip authentication (e.g. plugin icons served via <img src>) */
function isPublicPath(url: string): boolean {
  if (PUBLIC_PATHS.has(url)) return true;
  // Match /api/plugins/:id/icon
  if (url.startsWith('/api/plugins/') && url.endsWith('/icon')) return true;
  return false;
}

/** Paths allowed even when the user still has the default password */
const DEFAULT_PWD_ALLOWED = new Set(['/api/auth/change-password', '/api/auth/me']);

export function registerAuthHook(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]; // strip query string

    // Only protect /api/* routes
    if (!url.startsWith('/api/')) return;

    // Allow public paths
    if (isPublicPath(url)) return;

    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: '未授权，请先登录' });
    }

    // Verify tokenVersion — reject JWTs issued before password change
    const userId = (request.user as { sub: number }).sub;
    const jwtTokenVersion = (request.user as { tokenVersion?: number }).tokenVersion ?? 1;
    const currentVersion = authService.getTokenVersion(userId);
    if (jwtTokenVersion !== currentVersion) {
      return reply.code(401).send({ error: '令牌已失效，请重新登录' });
    }

    // Block most API access when user still has the default password
    if (!DEFAULT_PWD_ALLOWED.has(url)) {
      if (authService.isDefaultPassword(userId)) {
        return reply.code(403).send({ error: '请先修改默认密码', code: 'DEFAULT_PASSWORD' });
      }
    }
  });
}
