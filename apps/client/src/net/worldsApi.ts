import {
  worldSummaryListSchema,
  worldSummarySchema,
  type CreateWorldRequest,
  type WorldSummary,
} from '@civ/shared';
import { resolveServerHttpUrl } from './connection.js';

/**
 * Gestion des mondes — HTTP, pas WebSocket : ces opérations (lister/créer/activer/
 * renommer/dupliquer/supprimer) sont des actions ponctuelles hors de la boucle de
 * simulation temps réel, elles n'ont pas besoin d'un flux persistant. Chaque appel
 * revalide la réponse avec les schémas Zod de `@civ/shared` — le serveur reste la seule
 * source de vérité, ce module ne fait jamais confiance à une réponse non validée.
 */
export class WorldsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WorldsApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (json: unknown) => T,
): Promise<T> {
  // `content-type: application/json` sans corps (activate/delete n'en envoient pas) fait
  // échouer le parseur JSON strict de Fastify avec un 400 « body cannot be empty » —
  // l'en-tête n'est donc posé QUE quand il y a effectivement un corps à interpréter.
  const headers =
    init.body === undefined
      ? init.headers
      : { 'content-type': 'application/json', ...init.headers };
  const response = await fetch(`${resolveServerHttpUrl()}${path}`, { ...init, headers });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Erreur serveur (${response.status}).`;
    throw new WorldsApiError(response.status, message);
  }

  if (response.status === 204) return parse(undefined);
  return parse(await response.json());
}

function parseWorldSummary(json: unknown): WorldSummary {
  return worldSummarySchema.parse(json);
}

export async function listWorlds(): Promise<WorldSummary[]> {
  return request('/api/worlds', { method: 'GET' }, (json) => worldSummaryListSchema.parse(json));
}

export async function getSaveRecoveryNotice(): Promise<string | null> {
  return request('/api/save-status', { method: 'GET' }, (json) => {
    if (!json || typeof json !== 'object' || !('recoveryNotice' in json)) return null;
    return typeof json.recoveryNotice === 'string' ? json.recoveryNotice : null;
  });
}

export async function createWorld(options: CreateWorldRequest): Promise<WorldSummary> {
  return request(
    '/api/worlds',
    { method: 'POST', body: JSON.stringify(options) },
    parseWorldSummary,
  );
}

export async function activateWorld(name: string): Promise<WorldSummary> {
  return request(
    `/api/worlds/${encodeURIComponent(name)}/activate`,
    { method: 'POST' },
    parseWorldSummary,
  );
}

export async function renameWorld(name: string, newName: string): Promise<WorldSummary> {
  return request(
    `/api/worlds/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: JSON.stringify({ newName }) },
    parseWorldSummary,
  );
}

export async function duplicateWorld(name: string, newName: string): Promise<WorldSummary> {
  return request(
    `/api/worlds/${encodeURIComponent(name)}/duplicate`,
    { method: 'POST', body: JSON.stringify({ newName }) },
    parseWorldSummary,
  );
}

export async function deleteWorld(name: string): Promise<void> {
  await request(`/api/worlds/${encodeURIComponent(name)}`, { method: 'DELETE' }, () => undefined);
}

/** `jpegBase64` sans le préfixe `data:image/jpeg;base64,` (voir `Application.captureThumbnail`). */
export async function uploadThumbnail(name: string, jpegBase64: string): Promise<void> {
  await request(
    `/api/worlds/${encodeURIComponent(name)}/thumbnail`,
    { method: 'POST', body: JSON.stringify({ image: jpegBase64 }) },
    () => undefined,
  );
}

/**
 * URL directe de la miniature — pas de fonction `fetch` dédiée : le composant d'affichage
 * pose simplement cette URL en `src` d'une balise `<img>` et laisse le navigateur gérer
 * le chargement/cache, avec un `onerror` pour retomber sur un espace réservé si ce monde
 * n'a encore aucune miniature (404, cas normal).
 */
export function resolveThumbnailUrl(name: string): string {
  return `${resolveServerHttpUrl()}/api/worlds/${encodeURIComponent(name)}/thumbnail`;
}
