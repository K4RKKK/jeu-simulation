export interface DrawerController {
  readonly isOpen: boolean;
  toggle(): void;
  close(): void;
}

export class DrawerManager<Name extends string> {
  constructor(private readonly drawers: Record<Name, DrawerController>) {}

  bind(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-panel]')) {
      button.addEventListener('click', () => {
        const name = button.dataset.panel as Name | undefined;
        if (!name || !this.drawers[name]) return;
        const shouldOpen = !this.drawers[name].isOpen;
        this.closeAll();
        if (shouldOpen) this.drawers[name].toggle();
        this.updateNavigation();
      });
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.drawer')) {
      panel
        .querySelector<HTMLButtonElement>('[data-close-panel]')
        ?.addEventListener('click', () => {
          this.closeAll();
          this.updateNavigation();
        });
    }
    this.closeAll();
    this.updateNavigation();
  }

  closeAll(except?: Name): void {
    for (const [name, drawer] of Object.entries(this.drawers) as [Name, DrawerController][]) {
      if (name !== except) drawer.close();
    }
  }

  get anyOpen(): boolean {
    return Object.values<DrawerController>(this.drawers).some((drawer) => drawer.isOpen);
  }

  updateNavigation(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-panel]')) {
      const name = button.dataset.panel as Name | undefined;
      const active = name !== undefined && this.drawers[name]?.isOpen === true;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-expanded', String(active));
    }
  }
}
