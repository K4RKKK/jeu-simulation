import type { CreateWorldRequest } from '@civ/shared';

export interface WorldCreateScreenCallbacks {
  onSubmit: (request: CreateWorldRequest) => void;
  /** Absent quand l'écran n'a nulle part où revenir (tout premier lancement). */
  onBack?: () => void;
}

const SIZE_PRESETS = { small: 12, medium: 24, large: 36 } as const;

/** Écran « Nouveau monde » — ne fait qu'émettre une intention, jamais l'appel réseau lui-même. */
export class WorldCreateScreen {
  private readonly form: HTMLFormElement;
  private readonly errorElement: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly backButton: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: WorldCreateScreenCallbacks,
  ) {
    this.form = requiredElement<HTMLFormElement>(root, '[data-create-form]');
    this.errorElement = requiredElement(root, '[data-create-error]');
    this.seedInput = requiredElement<HTMLInputElement>(root, 'input[name="seed"]');
    this.backButton = requiredElement<HTMLButtonElement>(root, '[data-back]');

    requiredElement<HTMLButtonElement>(root, '[data-random-seed]').addEventListener('click', () => {
      this.seedInput.value = randomSeedLabel();
    });

    this.backButton.addEventListener('click', () => this.callbacks.onBack?.());

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
  }

  show(options: { canGoBack: boolean } = { canGoBack: true }): void {
    this.root.classList.remove('is-hidden');
    this.clearError();
    this.backButton.classList.toggle('is-hidden', !options.canGoBack);
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  showError(message: string): void {
    this.errorElement.textContent = message;
    this.errorElement.classList.remove('is-hidden');
  }

  private clearError(): void {
    this.errorElement.textContent = '';
    this.errorElement.classList.add('is-hidden');
  }

  private submit(): void {
    this.clearError();
    const data = new FormData(this.form);
    const name = String(data.get('name') ?? '').trim();
    if (name.length === 0) {
      this.showError('Le monde a besoin d’un nom.');
      return;
    }
    const seed = String(data.get('seed') ?? '').trim();
    const sizeChunks = SIZE_PRESETS[(data.get('size') as keyof typeof SIZE_PRESETS) ?? 'medium'];
    const populationRaw = Number(data.get('population'));
    const population =
      Number.isFinite(populationRaw) && populationRaw > 0 ? Math.round(populationRaw) : undefined;

    this.callbacks.onSubmit({
      name,
      ...(seed.length > 0 ? { seed } : {}),
      sizeChunks,
      ...(population === undefined ? {} : { population }),
    });
  }
}

/**
 * Purement cosmétique : le serveur choisit sa propre seed si aucune n'est envoyée (voir
 * `createWorldRequestSchema` — `seed` optionnel). Ceci ne fait que préremplir le champ
 * pour donner au joueur quelque chose de concret à éditer ou garder tel quel.
 */
function randomSeedLabel(): string {
  const suffix = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');
  return `PREHISTORY-${suffix}`;
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans l'écran de création: ${selector}`);
  return element;
}
