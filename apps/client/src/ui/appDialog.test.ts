// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDialog } from './appDialog.js';
import { PauseMenu } from './pauseMenu.js';

function dialogFixture(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = (returnValue = '') => {
    dialog.returnValue = returnValue;
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  };
  document.body.append(dialog);
  return dialog;
}

describe('AppDialog', () => {
  beforeEach(() => document.body.replaceChildren());

  it('renvoie le texte validé sans utiliser window.prompt', async () => {
    const root = dialogFixture();
    const dialog = new AppDialog(root);
    const result = dialog.prompt({ title: 'Renommer', initialValue: 'Ancien nom' });
    const input = root.querySelector('input')!;
    input.value = 'La vallée de Nara';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await expect(result).resolves.toBe('La vallée de Nara');
  });

  it('renvoie false quand une confirmation dangereuse est annulée', async () => {
    const root = dialogFixture();
    const dialog = new AppDialog(root);
    const result = dialog.confirm({ title: 'Supprimer ?', message: 'Irréversible', danger: true });
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    buttons[0]!.click();
    await expect(result).resolves.toBe(false);
  });
});

describe('PauseMenu', () => {
  it('ouvre, reprend et donne accès aux options', () => {
    document.body.innerHTML = `
      <div class="is-hidden" aria-hidden="true">
        <button data-pause-resume>Reprendre</button>
        <button data-pause-options>Options</button>
        <button data-pause-worlds>Mondes</button>
      </div>`;
    const root = document.body.firstElementChild as HTMLElement;
    const onOptions = vi.fn();
    const menu = new PauseMenu(root, { onOptions, onWorlds: vi.fn() });
    menu.open();
    expect(menu.isOpen).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-pause-options]')!.click();
    expect(menu.isOpen).toBe(false);
    expect(onOptions).toHaveBeenCalledOnce();
  });
});
