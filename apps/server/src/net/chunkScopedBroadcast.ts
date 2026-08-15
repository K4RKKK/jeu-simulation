import type { ServerMessage } from '@civ/shared';
import type { ClientSession } from './clientSession.js';

/**
 * Envoie un message à une session UNIQUEMENT si elle possède déjà le chunk concerné.
 *
 * Bug corrigé : `resource:removed` et `trail:updated` partaient vers TOUS les clients
 * connectés, quelle que soit leur zone d'intérêt — un client qui regarde le coin
 * nord-est du monde recevait quand même l'usure d'un sentier ou la cueillette d'une
 * baie à l'autre bout de la carte. Le client ignore silencieusement ce qu'il ne
 * connaît pas (`ChunkStore`/`WorldView` renvoient `false` sans effet), donc ce n'était
 * jamais un bug de correction — seulement du réseau gaspillé, proportionnel au nombre
 * de clients connectés fois l'activité du monde ENTIER plutôt que de leur seule zone
 * visible. `ClientSession.hasChunk` (déjà la source de vérité de `ChunkStreamer` pour
 * savoir ce qu'un client détient) suffit à filtrer correctement.
 */
export function sendToSessionsHoldingChunk(
  sessions: Iterable<ClientSession>,
  chunkKey: string,
  message: ServerMessage,
): void {
  for (const session of sessions) {
    if (session.hasChunk(chunkKey)) session.send(message);
  }
}
