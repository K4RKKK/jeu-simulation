export interface MainMenuScreenCallbacks {
  onContinue: () => void;
  onLoadWorlds: () => void;
  onCreateNew: () => void;
  onOptions: () => void;
}

export interface MainMenuScreenState {
  canContinue: boolean;
  worldLabel?: string | null;
  status?: string | null;
}

/**
 * Écran d'accueil principal. Il ne prend aucune décision métier : il affiche juste les
 * gros boutons d'entrée et renvoie les intentions au contrôleur.
 */
export class MainMenuScreen {
  private readonly continueButton: HTMLButtonElement;
  private readonly statusElement: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    callbacks: MainMenuScreenCallbacks,
  ) {
    this.continueButton = requiredElement<HTMLButtonElement>(root, '[data-main-continue]');
    const loadButton = requiredElement<HTMLButtonElement>(root, '[data-main-load-worlds]');
    const createButton = requiredElement<HTMLButtonElement>(root, '[data-main-new-world]');
    const optionsButton = requiredElement<HTMLButtonElement>(root, '[data-main-options]');
    this.statusElement = requiredElement(root, '[data-main-menu-status]');

    this.continueButton.addEventListener('click', () => callbacks.onContinue());
    loadButton.addEventListener('click', () => callbacks.onLoadWorlds());
    createButton.addEventListener('click', () => callbacks.onCreateNew());
    optionsButton.addEventListener('click', () => callbacks.onOptions());
  }

  show(state: MainMenuScreenState): void {
    this.root.classList.remove('is-hidden');
    this.continueButton.hidden = !state.canContinue;

    if (state.status && state.status.length > 0) {
      this.statusElement.textContent = state.status;
      this.statusElement.classList.remove('is-hidden');
      return;
    }

    if (state.canContinue && state.worldLabel) {
      this.statusElement.textContent = `Dernier monde actif : ${state.worldLabel}`;
    } else if (state.canContinue) {
      this.statusElement.textContent = 'Un monde actif est prêt à être repris.';
    } else {
      this.statusElement.textContent = 'Aucun monde actif pour l’instant.';
    }
    this.statusElement.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans le menu principal: ${selector}`);
  return element;
}
