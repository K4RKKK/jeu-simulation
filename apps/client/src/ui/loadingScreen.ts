const STEPS = [
  { key: 'connect', label: 'Connexion au serveur' },
  { key: 'world', label: 'Monde reçu' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'population', label: 'Population' },
  { key: 'ready', label: 'Synchronisation' },
] as const;

export type LoadingStep = (typeof STEPS)[number]['key'];

/**
 * Écran de chargement — étapes RÉELLES, pas une barre qui monte au hasard.
 *
 * Chaque étape ne se coche que lorsqu'un événement réseau concret l'a effectivement
 * produite (voir les appelants dans `main.ts` : ouverture WebSocket, message `init`
 * traité, premier `chunk` reçu, première frame rendue). Le pourcentage affiché est une
 * fonction pure du nombre d'étapes réellement cochées — jamais un minuteur déguisé en
 * progression.
 */
export class LoadingScreen {
  private readonly listElement: HTMLElement;
  private readonly barElement: HTMLElement;
  private readonly percentElement: HTMLElement;
  private readonly completed = new Set<LoadingStep>();
  private visible = false;

  constructor(private readonly root: HTMLElement) {
    this.listElement = requiredElement(root, '[data-loading-steps]');
    this.barElement = requiredElement(root, '[data-loading-bar]');
    this.percentElement = requiredElement(root, '[data-loading-percent]');
    this.render();
  }

  markComplete(step: LoadingStep): void {
    if (this.completed.has(step)) return;
    this.completed.add(step);
    this.render();
  }

  get isComplete(): boolean {
    return this.completed.size === STEPS.length;
  }

  /**
   * Affiche l'écran depuis son état initial (aucune étape cochée) — appelé au début de
   * `startGame()`, jamais au chargement de la page : un écran « Mes mondes »/« Nouveau
   * monde » le précède désormais (voir `main.ts`).
   */
  show(): void {
    this.completed.clear();
    this.render();
    this.visible = true;
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('is-hidden');
  }

  private render(): void {
    this.listElement.innerHTML = STEPS.map((step) => {
      const done = this.completed.has(step.key);
      return `<li class="${done ? 'is-done' : ''}"><span class="loading-check">${done ? '✓' : '···'}</span>${step.label}</li>`;
    }).join('');

    const percent = Math.round((this.completed.size / STEPS.length) * 100);
    this.barElement.style.width = `${percent}%`;
    this.percentElement.textContent = `${percent}%`;
  }
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans l'écran de chargement: ${selector}`);
  return element;
}
