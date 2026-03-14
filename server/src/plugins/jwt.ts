import fastifyJwt from '@fastify/jwt';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; username: string; tokenVersion: number };
    user: { sub: number; username: string; tokenVersion: number };
  }
}

export async function registerJwt(fastify: FastifyInstance): Promise<void> {
  let secret = env.JWT_SECRET;

  if (!secret) {
    try {
      secret = readFileSync(env.JWT_SECRET_FILE, 'utf-8').trim();
      fastify.log.info('JWT secret loaded from file');
    } catch {
      secret = randomBytes(32).toString('hex');
      mkdirSync(dirname(env.JWT_SECRET_FILE), { recursive: true });
      writeFileSync(env.JWT_SECRET_FILE, secret, { mode: 0o600 });
      fastify.log.info('JWT secret generated and saved to file');
    }
  }

  await fastify.register(fastifyJwt, {
    secret,
    sign: { expiresIn: '7d' },
  });
}
