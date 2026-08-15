import fastifyWebsocket from '@fastify/websocket';
import {
  WS_PATH,
  createWorldRequestSchema,
  duplicateWorldRequestSchema,
  renameWorldRequestSchema,
  uploadThumbnailRequestSchema,
  type WorldSummary,
} from '@civ/shared';
import type { SaveMetadata } from '@civ/simulation';
import Fastify, { type FastifyReply } from 'fastify';
import type { WebSocket } from 'ws';
import { loadServerConfig } from './config.js';
import {
  ActiveWorldConflictError,
  PersistenceDisabledError,
  SimulationHost,
  WorldNotFoundError,
} from './simulationHost.js';

function toWorldSummary(metadata: SaveMetadata, activeWorldName: string): WorldSummary {
  return {
    name: metadata.name,
    seed: metadata.seed,
    tick: metadata.tick,
    humanCount: metadata.humanCount,
    savedAtIso: metadata.savedAtIso,
    isActive: metadata.name === activeWorldName,
    ...(metadata.label === undefined ? {} : { label: metadata.label }),
  };
}

/**
 * Traduit les erreurs connues de `SimulationHost` en réponse HTTP — jamais une trace de
 * pile brute renvoyée au client (`WorldsApiError` de `@civ/shared`).
 */
function respondWithError(reply: FastifyReply, error: unknown): void {
  if (error instanceof WorldNotFoundError) {
    reply.code(404).send({ error: error.message });
    return;
  }
  if (error instanceof ActiveWorldConflictError) {
    reply.code(409).send({ error: error.message });
    return;
  }
  if (error instanceof PersistenceDisabledError) {
    reply.code(400).send({ error: error.message });
    return;
  }
  if (error instanceof Error) {
    // Erreurs de validation venant de `FilePersistenceAdapter` (nom invalide, cible
    // déjà existante, source introuvable) — toutes des erreurs de requête, pas des
    // pannes serveur.
    reply.code(400).send({ error: error.message });
    return;
  }
  reply.code(500).send({ error: 'Erreur interne du serveur.' });
}

async function main(): Promise<void> {
  const config = loadServerConfig();
  const host = new SimulationHost(config);

  const app = Fastify({
    logger: { level: process.env.CIV_LOG_LEVEL ?? 'warn' },
  });

  await app.register(fastifyWebsocket);

  // CORS minimal pour les routes `/api/worlds*` : le client de développement (Vite,
  // port 5173) et le serveur (port 8787) sont deux origines distinctes. Fait main
  // plutôt que via `@fastify/cors` pour ne pas ajouter de dépendance à cette étape —
  // reflète simplement l'origine de la requête (pas d'authentification/cookies à
  // protéger ici, ces routes ne font que lister/créer des sauvegardes nommées).
  // `onRequest` global s'exécute pour CHAQUE requête avant le routage, y compris les
  // `OPTIONS` de préflight pour lesquelles aucune route n'est enregistrée — sans quoi
  // elles recevraient un 404 avant même d'atteindre la logique CORS.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'content-type');
      reply.code(204).send();
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    tick: host.currentSimulation.clock.currentTick,
    time: host.currentSimulation.clock.format(),
    clients: host.clientCount,
  }));

  // Inspection du monde sans ouvrir de WebSocket (curl, supervision, debug).
  app.get('/api/world', async () => host.describe());
  app.get('/api/save-status', async () => ({ recoveryNotice: host.consumeSaveRecoveryNotice() }));

  // Gestion des mondes (multi-sauvegardes nommées) — HTTP plutôt que WebSocket : ce
  // sont des opérations CRUD hors de la boucle de simulation temps réel, pas des
  // messages qui ont besoin d'un flux persistant. Un seul monde est actif à la fois
  // (voir la doc de `SimulationHost`) : ces routes changent ce que voient TOUS les
  // observateurs connectés au même moment.
  app.get('/api/worlds', async () => {
    const worlds = await host.listWorlds();
    return worlds.map((metadata) => toWorldSummary(metadata, host.activeWorld));
  });

  app.post('/api/worlds', async (request, reply) => {
    const parsed = createWorldRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    try {
      const metadata = await host.createWorld(parsed.data);
      reply.send(toWorldSummary(metadata, host.activeWorld));
    } catch (error) {
      respondWithError(reply, error);
    }
  });

  app.post<{ Params: { name: string } }>('/api/worlds/:name/activate', async (request, reply) => {
    try {
      const metadata = await host.activateWorld(request.params.name);
      reply.send(toWorldSummary(metadata, host.activeWorld));
    } catch (error) {
      respondWithError(reply, error);
    }
  });

  app.post<{ Params: { name: string } }>('/api/worlds/:name/duplicate', async (request, reply) => {
    const parsed = duplicateWorldRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    try {
      const metadata = await host.duplicateWorld(request.params.name, parsed.data.newName);
      reply.send(toWorldSummary(metadata, host.activeWorld));
    } catch (error) {
      respondWithError(reply, error);
    }
  });

  app.patch<{ Params: { name: string } }>('/api/worlds/:name', async (request, reply) => {
    const parsed = renameWorldRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    try {
      const metadata = await host.renameWorld(request.params.name, parsed.data.newName);
      reply.send(toWorldSummary(metadata, host.activeWorld));
    } catch (error) {
      respondWithError(reply, error);
    }
  });

  app.delete<{ Params: { name: string } }>('/api/worlds/:name', async (request, reply) => {
    try {
      await host.deleteWorld(request.params.name);
      reply.code(204).send();
    } catch (error) {
      respondWithError(reply, error);
    }
  });

  // Miniature d'aperçu — jamais nécessaire à la simulation, seulement à l'affichage
  // dans « Mes mondes ». Le client capture son propre canvas ; ce serveur ne fait que
  // stocker/servir l'image telle quelle.
  app.post<{ Params: { name: string } }>('/api/worlds/:name/thumbnail', async (request, reply) => {
    const parsed = uploadThumbnailRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    try {
      await host.saveWorldThumbnail(request.params.name, parsed.data.image);
      reply.code(204).send();
    } catch (error) {
      respondWithError(reply, error);
    }
  });

  app.get<{ Params: { name: string } }>('/api/worlds/:name/thumbnail', async (request, reply) => {
    const jpeg = await host.loadWorldThumbnail(request.params.name);
    if (jpeg === null) {
      reply.code(404).send({ error: 'Aucune miniature pour ce monde.' });
      return;
    }
    reply.header('content-type', 'image/jpeg');
    // Toujours la plus récente : une miniature qui vient d'être remplacée ne doit
    // jamais rester en cache navigateur sous l'ancienne image.
    reply.header('cache-control', 'no-cache');
    reply.send(jpeg);
  });

  app.get(WS_PATH, { websocket: true }, (socket: WebSocket) => {
    host.addClient(socket);
  });

  // La sauvegarde existante (s'il y en a une) est chargée avant que quoi que ce soit
  // ne tourne : le monde ne doit jamais démarrer deux fois (une fois neuf, une fois
  // rechargé) au vu d'un observateur.
  await host.initialize();

  // La simulation démarre avant l'écoute HTTP : le monde n'attend pas les observateurs.
  host.start();
  await app.listen({ host: config.host, port: config.port });

  console.log(
    `[server] monde "${host.currentSimulation.world.worldId}" en vie — ` +
      `${host.currentSimulation.humanCount} humains, ${config.tickRateHz} Hz`,
  );
  console.log(`[server] http://localhost:${config.port}/health`);
  console.log(`[server] http://localhost:${config.port}/api/world`);
  console.log(`[server] http://localhost:${config.port}/api/worlds`);
  console.log(`[server] ws://localhost:${config.port}${WS_PATH}`);

  const shutdown = (signal: string): void => {
    console.log(`\n[server] ${signal} reçu, arrêt…`);
    void (async () => {
      await host.stop();
      await app.close();
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[server] échec du démarrage:', error);
  process.exit(1);
});
