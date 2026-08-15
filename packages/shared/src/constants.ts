/**
 * Version du protocole réseau. Toute modification incompatible de `messages.ts` doit
 * l'incrémenter : le serveur refuse les clients qui n'annoncent pas la même version.
 */
export const PROTOCOL_VERSION = 4;

export const WS_PATH = '/ws';
