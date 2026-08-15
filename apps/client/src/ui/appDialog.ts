export interface DialogPromptOptions {
  title: string;
  message?: string;
  initialValue?: string;
  confirmLabel?: string;
}

export interface DialogConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

type InternalDialogOptions = Omit<DialogConfirmOptions, 'message'> & {
  message?: string;
  input?: HTMLInputElement;
};

/** Fenêtre modale native, stylée comme le jeu et utilisable entièrement au clavier. */
export class AppDialog {
  constructor(private readonly dialog: HTMLDialogElement) {}

  get isOpen(): boolean {
    return this.dialog.open;
  }

  prompt(options: DialogPromptOptions): Promise<string | null> {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 64;
    input.required = true;
    input.value = options.initialValue ?? '';
    input.setAttribute('aria-label', options.title);
    return this.open<string>({ ...options, input }, () => input.value.trim() || null);
  }

  confirm(options: DialogConfirmOptions): Promise<boolean> {
    return this.open<boolean>(options, () => true, false).then((value) => value === true);
  }

  async alert(title: string, message: string): Promise<void> {
    await this.open<boolean>({ title, message, confirmLabel: 'Fermer' }, () => true, true);
  }

  close(): void {
    if (this.dialog.open) this.dialog.close('cancel');
  }

  private open<T>(
    options: InternalDialogOptions,
    readValue: () => T | null,
    confirmOnly = false,
  ): Promise<T | null> {
    this.close();
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'app-dialog__form';
    const title = document.createElement('h2');
    title.id = 'app-dialog-title';
    title.textContent = options.title;
    form.append(title);
    if (options.message) {
      const message = document.createElement('p');
      message.textContent = options.message;
      form.append(message);
    }
    if (options.input) form.append(options.input);
    const actions = document.createElement('div');
    actions.className = 'app-dialog__actions';
    if (!confirmOnly) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', () => this.dialog.close('cancel'));
      actions.append(cancel);
    }
    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.textContent = options.confirmLabel ?? 'Confirmer';
    confirm.classList.toggle('is-danger', options.danger === true);
    actions.append(confirm);
    form.append(actions);
    this.dialog.replaceChildren(form);

    return new Promise<T | null>((resolve) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = readValue();
        if (value === null) return;
        this.dialog.close('confirm');
        resolve(value);
      });
      this.dialog.addEventListener(
        'close',
        () => {
          if (this.dialog.returnValue !== 'confirm') resolve(null);
        },
        { once: true },
      );
      this.dialog.showModal();
      window.setTimeout(() => options.input?.select(), 0);
    });
  }
}
