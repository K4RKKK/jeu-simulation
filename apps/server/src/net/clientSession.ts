import type { EntityId, HumanProfile, HumanState, ServerMessage } from '@civ/shared';
import { encodeMessage } from '@civ/shared';
import { humanStateEquals } from '@civ/simulation';
import type { WebSocket } from 'ws';

let nextSessionId = 1;

/**
 * Un observateur connecté.
 *
 * Chaque session mémorise **ce qu'elle a déjà reçu**. C'est ce qui permet d'envoyer des
 * deltas corrects même quand des clients se connectent à des instants différents : le
 * serveur n'a pas un « dernier état diffusé » global, mais un état par client.
 */
export class ClientSession {
  readonly id = nextSessionId++;
  private readonly knownProfiles = new Set<EntityId>();
  private readonly lastStates = new Map<EntityId, HumanState>();
  /** Chunks déjà transmis à ce client : on ne renvoie jamais ce qu'il possède. */
  private readonly sentChunks = new Set<string>();
  private bytesSent = 0;
  private closed = false;
  /**
   * Numéro de séquence de l'état (`snapshot`/`delta`) **réellement envoyé à CE
   * client**, incrémenté uniquement par `nextStateSequence()`.
   *
   * Bug corrigé : l'hôte incrémentait auparavant un compteur global à CHAQUE tour de
   * diffusion, même quand un client donné ne recevait rien ce tour-ci (aucun delta à
   * envoyer). Un futur détecteur de désync côté client (« seq attendu N+1, reçu N+3 »)
   * aurait alors déclenché de faux positifs en continu — le compteur global sautait
   * des valeurs sans qu'aucun paquet n'ait été perdu. La séquence vit maintenant par
   * session et n'avance que lorsqu'un message réellement séquencé part vers CE client.
   */
  private stateSequence = 0;
  /**
   * Vrai quand ce client a explicitement demandé une resynchronisation (message
   * `resync`, envoyé quand il détecte un saut de séquence). Consommé par le prochain
   * tour de diffusion : ce client-ci reçoit un `snapshot` complet même si aucun n'est
   * dû globalement pour les autres — un désync n'attend pas le prochain snapshot
   * périodique de tout le monde.
   */
  private needsFullSnapshot = false;

  /** Zone du monde déclarée par le client. `null` tant qu'il ne l'a pas annoncée. */
  interestCenter: { x: number; z: number } | null = null;
  interestRadius = 0;

  constructor(private readonly socket: WebSocket) {}

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === this.socket.OPEN;
  }

  get totalBytesSent(): number {
    return this.bytesSent;
  }

  /** Fait avancer et renvoie la séquence d'état de CETTE session — un état par appel. */
  nextStateSequence(): number {
    return ++this.stateSequence;
  }

  /**
   * Valeur actuelle (non consommée) de la séquence — utilisée UNIQUEMENT par `init` pour
   * annoncer au client à partir de quel numéro compter : le premier `snapshot`/`delta`
   * qui suivra portera `currentStateSequence + 1` (via `nextStateSequence()`).
   */
  get currentStateSequence(): number {
    return this.stateSequence;
  }

  /** Marque une resynchronisation demandée par ce client (message `resync`). */
  requestResync(): void {
    this.needsFullSnapshot = true;
  }

  /** Lit ET efface la demande de resynchronisation — un `snapshot` la satisfait une fois. */
  consumeNeedsFullSnapshot(): boolean {
    const requested = this.needsFullSnapshot;
    this.needsFullSnapshot = false;
    return requested;
  }

  send(message: ServerMessage): void {
    if (!this.isOpen) return;
    const payload = encodeMessage(message);
    this.bytesSent += payload.length;
    this.socket.send(payload);
  }

  /** Marque l'état courant comme « connu du client » après un init ou un snapshot complet. */
  rememberFullState(profiles: readonly HumanProfile[], states: readonly HumanState[]): void {
    this.knownProfiles.clear();
    this.lastStates.clear();
    for (const profile of profiles) this.knownProfiles.add(profile.id);
    for (const state of states) this.lastStates.set(state.id, state);
  }

  /**
   * Calcule la différence entre l'état courant et ce que ce client connaît déjà.
   * Met à jour la mémoire de session : appeler cette méthode implique d'envoyer le delta.
   */
  computeDelta(
    profiles: readonly HumanProfile[],
    states: readonly HumanState[],
  ): { profiles: HumanProfile[]; humans: HumanState[]; removed: EntityId[] } {
    const newProfiles: HumanProfile[] = [];
    for (const profile of profiles) {
      if (!this.knownProfiles.has(profile.id)) {
        this.knownProfiles.add(profile.id);
        newProfiles.push(profile);
      }
    }

    const changed: HumanState[] = [];
    const stillPresent = new Set<EntityId>();
    for (const state of states) {
      stillPresent.add(state.id);
      const previous = this.lastStates.get(state.id);
      if (!previous || !humanStateEquals(previous, state)) {
        changed.push(state);
        this.lastStates.set(state.id, state);
      }
    }

    const removed: EntityId[] = [];
    for (const id of this.lastStates.keys()) {
      if (!stillPresent.has(id)) removed.push(id);
    }
    for (const id of removed) {
      this.lastStates.delete(id);
      this.knownProfiles.delete(id);
    }

    return { profiles: newProfiles, humans: changed, removed };
  }

  hasChunk(key: string): boolean {
    return this.sentChunks.has(key);
  }

  rememberChunk(key: string): void {
    this.sentChunks.add(key);
  }

  /** Chunks transmis qui ne sont plus dans la zone d'intérêt du client. */
  chunksToRelease(desired: ReadonlySet<string>): string[] {
    const stale: string[] = [];
    for (const key of this.sentChunks) {
      if (!desired.has(key)) stale.push(key);
    }
    for (const key of stale) this.sentChunks.delete(key);
    return stale;
  }

  forgetAllChunks(): void {
    this.sentChunks.clear();
  }

  close(): void {
    this.closed = true;
  }
}
