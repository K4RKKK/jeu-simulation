/**
 * Configuration d'hébergement.
 *
 * À ne pas confondre avec `SimulationConfig` : ici on ne règle rien du monde, seulement la
 * façon de le servir (port, seed de départ, cadence réseau).
 */
export interface ServerConfig {
  host: string;
  port: number;
  worldSeed: string;
  worldSizeChunks: number;
  population: number;
  tickRateHz: number;
  netRateHz: number;
  /** Temps consacré à la génération de chunks à chaque passe réseau, en millisecondes. */
  chunkBudgetMs: number;
  /**
   * Autorise un client à demander la régénération complète du monde.
   * Désactivé hors développement : c'est une opération destructrice.
   */
  allowRegenerate: boolean;
  /** Dossier de sauvegardes. Vide = persistance désactivée (monde éphémère). */
  saveDir: string;
  /** Nom de la sauvegarde unique de ce monde — chargée au démarrage, réécrite en continu. */
  saveSlot: string;
  /** Ticks de simulation entre deux sauvegardes automatiques. 0 = désactivée. */
  autosaveIntervalTicks: number;
  /** Sauvegarde avant l'arrêt (SIGINT/SIGTERM) : un monde qui tourne 24/24 ne doit rien perdre. */
  saveOnShutdown: boolean;
  /**
   * Origines HTTP/WebSocket autorisées à appeler ce serveur — CORS et connexion WS
   * refusent tout `Origin` absent de cette liste. Comprend toujours `127.0.0.1`/
   * `localhost` sur le port d'écoute (le client de production s'y sert lui-même) — une
   * liste FIXE, jamais dérivée de l'en-tête `Host` de la requête reçue : ce dernier est
   * choisi par le navigateur à partir de l'URL visitée, donc falsifiable par l'attaquant
   * dans un DNS rebinding (un domaine externe dont le DNS pointe soudain vers 127.0.0.1
   * enverrait un `Host` qui « correspondrait » à sa propre `Origin` sans jamais être
   * réellement ce serveur). Le reste ne sert qu'au client de développement (Vite, autre
   * port) et à toute intégration explicitement autorisée via `CIV_TRUSTED_ORIGINS`.
   */
  trustedOrigins: readonly string[];
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number (received "${raw}")`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function loadServerConfig(): ServerConfig {
  const port = readNumber('CIV_PORT', 8787);
  return {
    host: process.env.CIV_HOST ?? '0.0.0.0',
    port,
    worldSeed: process.env.CIV_WORLD_SEED ?? 'prehistory-01',
    worldSizeChunks: Math.round(readNumber('CIV_WORLD_SIZE_CHUNKS', 24)),
    population: Math.round(readNumber('CIV_POPULATION', 15)),
    tickRateHz: readNumber('CIV_TICK_RATE_HZ', 20),
    netRateHz: readNumber('CIV_NET_RATE_HZ', 10),
    chunkBudgetMs: readNumber('CIV_CHUNK_BUDGET_MS', 8),
    allowRegenerate: readBoolean('CIV_ALLOW_REGENERATE', process.env.NODE_ENV !== 'production'),
    saveDir: process.env.CIV_SAVE_DIR ?? '.saves',
    saveSlot: process.env.CIV_SAVE_SLOT ?? 'world',
    // Par défaut 20 Hz × 60 s × 5 min = 6000 ticks : une sauvegarde toutes les cinq
    // minutes réelles à la cadence par défaut. `readNumber` refuse 0, donc on lit la
    // variable d'environnement directement pour permettre la désactivation explicite.
    autosaveIntervalTicks: readOptionalNumber('CIV_AUTOSAVE_INTERVAL_TICKS', 6000),
    saveOnShutdown: readBoolean('CIV_SAVE_ON_SHUTDOWN', true),
    trustedOrigins: readOrigins('CIV_TRUSTED_ORIGINS', port),
  };
}

function readOrigins(name: string, port: number): readonly string[] {
  // Toujours confiance en soi-même — un ensemble FIXE, jamais dérivé d'un en-tête de
  // requête (voir la doc de `ServerConfig.trustedOrigins`).
  const selfOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  const raw = process.env[name];
  if (raw !== undefined && raw.trim() !== '') {
    const configured = raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    return [...selfOrigins, ...configured];
  }
  // Origine de développement supplémentaire seulement hors production : le serveur de
  // production sert le client depuis sa propre origine (déjà couverte par `selfOrigins`)
  // et n'a besoin d'autoriser personne d'autre par défaut.
  if (process.env.NODE_ENV === 'production') return selfOrigins;
  return [...selfOrigins, 'http://localhost:5173', 'http://127.0.0.1:5173'];
}

function readOptionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Environment variable ${name} must be a non-negative number (received "${raw}")`,
    );
  }
  return value;
}
