import type { ClientMessage, ServerMessage } from '@civ/shared';
import { PROTOCOL_VERSION, encodeMessage, parseServerMessage } from '@civ/shared';

export interface ConnectionHandlers {
  onMessage: (message: ServerMessage, receivedAt: number) => void;
  onStatusChange?: (status: ConnectionStatus, detail: string) => void;
  onPing?: (roundTripMs: number) => void;
  /**
   * Une reconnexion automatique vient d'être programmée dans `delayMs` — permet à l'UI
   * d'afficher un vrai compte à rebours (pas une estimation) et un bouton « Réessayer »
   * qui appelle `forceReconnect()` pour ne pas attendre le délai.
   */
  onReconnectScheduled?: (delayMs: number) => void;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

const RECONNECT_BASE_MS = 700;
const RECONNECT_MAX_MS = 8000;
const PING_INTERVAL_MS = 2000;

/**
 * Connexion WebSocket au serveur de simulation.
 *
 * Tout message entrant est validé par Zod avant d'atteindre le reste du client : le
 * contrat réseau est le seul point de contact entre les deux processus, il ne doit jamais
 * être supposé correct.
 */
export class ServerConnection {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private disposed = false;

  latencyMs = 0;
  bytesReceived = 0;
  status: ConnectionStatus = 'closed';
  /**
   * Vrai dès la première connexion réussie, pour le reste de la session. Distingue le
   * chargement initial (couvert par l'écran de génération) d'une perte de connexion en
   * cours de partie (couverte par l'overlay de reconnexion) — le même statut `closed`
   * signifie ces deux choses très différentes pour le joueur.
   */
  hasConnectedOnce = false;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  connect(): void {
    if (this.disposed || this.socket) return;
    this.setStatus('connecting', this.url);

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.hasConnectedOnce = true;
      this.setStatus('open', this.url);
      this.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION });
      this.startPinging();
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const receivedAt = performance.now();
      this.bytesReceived += event.data.length;

      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        console.error('[net] message serveur invalide:', parsed.error);
        return;
      }
      if (parsed.value.t === 'pong') {
        this.latencyMs = Math.round(receivedAt - parsed.value.clientTime);
        this.handlers.onPing?.(this.latencyMs);
      }
      this.handlers.onMessage(parsed.value, receivedAt);
    });

    socket.addEventListener('close', () => this.handleDisconnect('connexion fermée'));
    socket.addEventListener('error', () => this.handleDisconnect('erreur réseau'));
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage(message));
  }

  /**
   * Force une tentative de reconnexion immédiate, sans attendre le recul exponentiel en
   * cours — le bouton « Réessayer » de l'overlay de reconnexion. Sans effet si déjà
   * connecté ou en train de se connecter.
   */
  forceReconnect(): void {
    if (this.status !== 'closed') return;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.stopPinging();
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private handleDisconnect(detail: string): void {
    if (this.socket === null) return;
    this.socket = null;
    this.stopPinging();
    this.setStatus('closed', detail);
    if (this.disposed) return;

    // Recul exponentiel borné : un serveur redémarré doit être retrouvé sans marteler.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.handlers.onReconnectScheduled?.(delay);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private startPinging(): void {
    this.stopPinging();
    this.pingTimer = window.setInterval(() => {
      this.send({ t: 'ping', clientTime: performance.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus, detail: string): void {
    this.status = status;
    this.handlers.onStatusChange?.(status, detail);
  }
}

/** URL du serveur : configurable au build, avec un défaut cohérent en développement. */
export function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8787/ws`;
}

/**
 * Origine HTTP du même serveur — pour les routes REST hors simulation temps réel (ex.
 * `/api/worlds`), qui n'ont pas besoin d'un flux WebSocket persistant. Dérivée de
 * `resolveServerUrl()` (même hôte/port, protocole `ws→http`/`wss→https`, sans `/ws`)
 * pour ne jamais diverger silencieusement de la configuration WebSocket effective.
 */
export function resolveServerHttpUrl(): string {
  const wsUrl = resolveServerUrl();
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws$/, '');
}
