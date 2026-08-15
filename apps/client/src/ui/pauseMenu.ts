export interface PauseMenuCallbacks {
  onOptions: () => void;
  onWorlds: () => void;
}

export class PauseMenu {
  constructor(
    private readonly root: HTMLElement,
    callbacks: PauseMenuCallbacks,
  ) {
    requiredButton(root, '[data-pause-resume]').addEventListener('click', () => this.close());
    requiredButton(root, '[data-pause-options]').addEventListener('click', () => {
      this.close();
      callbacks.onOptions();
    });
    requiredButton(root, '[data-pause-worlds]').addEventListener('click', () => {
      this.close();
      callbacks.onWorlds();
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.root.classList.remove('is-hidden');
    this.root.setAttribute('aria-hidden', 'false');
    requiredButton(this.root, '[data-pause-resume]').focus();
  }

  close(): void {
    this.root.classList.add('is-hidden');
    this.root.setAttribute('aria-hidden', 'true');
  }
}

function requiredButton(root: HTMLElement, selector: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Bouton du menu introuvable: ${selector}`);
  return button;
}
