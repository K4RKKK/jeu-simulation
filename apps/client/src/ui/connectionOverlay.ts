import type { ServerConnection } from '../net/connection.js';

/**
 * Overlay de reconnexion — distinct de l'écran de chargement initial.
 *
 * `ServerConnection` reconnecte déjà automatiquement (recul exponentiel) : ce composant
 * ne fait qu'exposer cet état au joueur, avec un vrai compte à rebours dérivé du délai
 * effectivement programmé (`onReconnectScheduled`), pas une estimation, et un bouton qui
 * appelle `forceReconnect()` pour ne pas attendre.
 */
export class ConnectionOverlay {
  private readonly messageElement: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private countdownTimer: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly connection: ServerConnection,
  ) {
    this.messageElement = requiredElement(root, '[data-reconnect-message]');
    this.retryButton = requiredElement(root, '[data-reconnect-retry]');
    this.retryButton.addEventListener('click', () => {
      this.stopCountdown();
      this.messageElement.textContent = 'Nouvelle tentative…';
      this.connection.forceReconnect();
    });
  }

  /** Perte de connexion APRÈS qu'un monde a déjà été chargé — pas le chargement initial. */
  showLost(): void {
    this.root.classList.remove('is-hidden');
    this.messageElement.textContent = 'Connexion au monde perdue.';
  }

  /**
   * Le serveur reste injoignable dès la toute première tentative — avant qu'aucun monde
   * n'ait été chargé. Sans ceci, l'écran de génération restait figé sur « Connexion au
   * serveur » indéfiniment (l'étape se cochait déjà à la simple ouverture de la socket,
   * pas à sa réussite) : `ServerConnection` retentait bien en coulisses, mais rien ne le
   * montrait ni ne proposait de réessayer.
   */
  showConnecting(): void {
    this.root.classList.remove('is-hidden');
    this.messageElement.textContent = 'Impossible de joindre le serveur.';
  }

  hide(): void {
    this.stopCountdown();
    this.root.classList.add('is-hidden');
  }

  /** Un vrai compte à rebours vers la prochaine tentative automatique, pas un habillage. */
  startCountdown(delayMs: number): void {
    if (this.root.classList.contains('is-hidden')) return;
    this.stopCountdown();
    let remainingMs = delayMs;

    const tick = (): void => {
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      this.messageElement.textContent = `Tentative de reconnexion… ${seconds} s`;
      remainingMs -= 1000;
      if (remainingMs < -1000) this.stopCountdown();
    };
    tick();
    this.countdownTimer = window.setInterval(tick, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans l'overlay de reconnexion: ${selector}`);
  return element;
}
