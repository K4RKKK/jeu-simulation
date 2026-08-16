import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sendFile(reply: FastifyReply, path: string): FastifyReply {
  const extension = extname(path).toLowerCase();
  reply.type(CONTENT_TYPES[extension] ?? 'application/octet-stream');
  reply.header(
    'cache-control',
    extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  );
  return reply.send(createReadStream(path));
}

/**
 * Héberge le client compilé depuis le même processus que la simulation. Cette route
 * n'existe que lorsque `CIV_CLIENT_DIR` est fourni : le développement Vite reste donc
 * inchangé, tandis que la distribution Windows n'a besoin que d'un seul serveur.
 */
export async function registerStaticClient(
  app: FastifyInstance,
  configuredDirectory: string | undefined,
): Promise<void> {
  if (!configuredDirectory) return;

  const root = resolve(configuredDirectory);
  const indexPath = resolve(root, 'index.html');
  if (!(await isFile(indexPath))) {
    throw new Error(`Client compilé introuvable : ${indexPath}`);
  }

  app.get('/*', async (request, reply) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(request.url.split('?', 1)[0] ?? '/');
    } catch {
      return reply.code(400).send('Adresse invalide.');
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = resolve(root, relativePath);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return reply.code(404).send('Introuvable.');
    }

    if (await isFile(candidate)) return sendFile(reply, candidate);
    if (extname(candidate) !== '') return reply.code(404).send('Introuvable.');
    return sendFile(reply, indexPath);
  });
}
