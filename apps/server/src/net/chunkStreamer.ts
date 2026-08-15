import { chunkKey, chunksInRadius, type ChunkCoordinate } from '@civ/procedural';
import type { WorldBounds } from '@civ/procedural';
import type { ChunkManager } from '../world/chunkManager.js';
import type { ClientSession } from './clientSession.js';

export interface ChunkStreamerOptions {
  /** Rayon maximal accepté, quoi que demande le client. */
  maxRadius?: number;
  /** Chunks transmis à un client par passe : borne la taille d'un message réseau. */
  maxSendsPerSessionPerPass?: number;
}

/**
 * Diffusion des chunks selon la zone d'intérêt.
 *
 * Le client déclare **où il regarde**, jamais quels chunks il veut : c'est le serveur qui
 * décide de ce qui est pertinent et qui reste maître de ce qu'il divulgue. Un client ne
 * peut donc pas réclamer le monde entier, ni des zones hors limites.
 *
 * Le débit est borné des deux côtés : la génération par un budget de temps
 * (`ChunkManager`), l'émission par un nombre de chunks par passe. Un observateur qui se
 * téléporte reçoit sa région en quelques dixièmes de seconde plutôt qu'en un message de
 * plusieurs mégaoctets.
 */
export class ChunkStreamer {
  private readonly maxRadius: number;
  private readonly maxSendsPerSessionPerPass: number;

  constructor(
    private readonly chunks: ChunkManager,
    private readonly bounds: WorldBounds,
    options: ChunkStreamerOptions = {},
  ) {
    this.maxRadius = options.maxRadius ?? 7;
    this.maxSendsPerSessionPerPass = options.maxSendsPerSessionPerPass ?? 6;
  }

  /** Une passe complète : collecte des besoins, génération bornée, émission. */
  run(sessions: Iterable<ClientSession>): void {
    const desiredBySession = new Map<ClientSession, ChunkCoordinate[]>();
    const activeKeys = new Set<string>();

    for (const session of sessions) {
      const desired = this.desiredChunks(session);
      desiredBySession.set(session, desired);
      for (const coordinate of desired) activeKeys.add(chunkKey(coordinate));
    }

    // La demande est enregistrée avant la génération : l'ordre des chunks (du plus proche
    // au plus lointain) détermine ce qui apparaît en premier à l'écran.
    for (const desired of desiredBySession.values()) {
      for (const coordinate of desired) this.chunks.request(coordinate);
    }

    this.chunks.pump();
    this.chunks.setActive(activeKeys);

    for (const [session, desired] of desiredBySession) {
      this.sendToSession(session, desired);
    }
  }

  private desiredChunks(session: ClientSession): ChunkCoordinate[] {
    if (!session.interestCenter) return [];
    const radius = Math.min(this.maxRadius, session.interestRadius);
    return chunksInRadius(
      { x: session.interestCenter.x, z: session.interestCenter.z },
      radius,
    ).filter((coordinate) => this.bounds.containsChunk(coordinate));
  }

  private sendToSession(session: ClientSession, desired: readonly ChunkCoordinate[]): void {
    if (!session.isOpen) return;

    const desiredKeys = new Set(desired.map(chunkKey));
    const released = session.chunksToRelease(desiredKeys);
    if (released.length > 0) session.send({ t: 'chunkUnload', keys: released });

    let sent = 0;
    for (const coordinate of desired) {
      if (sent >= this.maxSendsPerSessionPerPass) break;
      const key = chunkKey(coordinate);
      if (session.hasChunk(key)) continue;

      const payload = this.chunks.payloadFor(key);
      if (!payload) continue; // Pas encore généré : il partira à la prochaine passe.

      session.send({ t: 'chunk', chunk: payload });
      session.rememberChunk(key);
      sent++;
    }
  }
}
