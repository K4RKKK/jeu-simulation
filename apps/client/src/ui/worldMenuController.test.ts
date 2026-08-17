// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDialog } from './appDialog.js';
import { WorldMenuController } from './worldMenuController.js';

const worldsApi = vi.hoisted(() => ({
  listWorlds: vi.fn(),
  getSaveRecoveryNotice: vi.fn(),
  createWorld: vi.fn(),
  activateWorld: vi.fn(),
  deleteWorld: vi.fn(),
  duplicateWorld: vi.fn(),
  renameWorld: vi.fn(),
}));

vi.mock('../net/worldsApi.js', () => worldsApi);

function buildFixture(): {
  mainMenuRoot: HTMLElement;
  mainMenuOptionsRoot: HTMLElement;
  mainMenuOptionsContent: HTMLElement;
  selectRoot: HTMLElement;
  createRoot: HTMLElement;
} {
  document.body.innerHTML = `
    <section id="main-menu-screen" class="is-hidden">
      <button data-main-continue type="button">Continuer</button>
      <button data-main-load-worlds type="button">Charger un monde</button>
      <button data-main-new-world type="button">Nouveau monde</button>
      <button data-main-options type="button">Options</button>
      <p data-main-menu-status></p>
    </section>
    <section id="main-menu-options-screen" class="is-hidden">
      <button data-main-options-close type="button">Fermer</button>
      <div id="main-menu-options-content"></div>
    </section>
    <section id="world-select-screen" class="is-hidden">
      <div data-continue-slot></div>
      <div data-world-list></div>
      <button data-back type="button">Menu principal</button>
      <button data-new-world type="button">Nouveau monde</button>
    </section>
    <section id="world-create-screen" class="is-hidden">
      <form data-create-form>
        <input name="name" />
        <input name="seed" />
        <input name="size" value="medium" />
        <input name="population" value="15" />
        <div data-create-error class="is-hidden"></div>
        <button data-back type="button">Retour</button>
      </form>
    </section>`;

  return {
    mainMenuRoot: document.getElementById('main-menu-screen') as HTMLElement,
    mainMenuOptionsRoot: document.getElementById('main-menu-options-screen') as HTMLElement,
    mainMenuOptionsContent: document.getElementById('main-menu-options-content') as HTMLElement,
    selectRoot: document.getElementById('world-select-screen') as HTMLElement,
    createRoot: document.getElementById('world-create-screen') as HTMLElement,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('WorldMenuController', () => {
  it('affiche le menu principal vide au premier lancement', async () => {
    worldsApi.listWorlds.mockResolvedValue([]);
    worldsApi.getSaveRecoveryNotice.mockResolvedValue(null);
    const dialog = {
      alert: vi.fn(),
      confirm: vi.fn(),
      prompt: vi.fn(),
    } as unknown as AppDialog;
    const { mainMenuRoot, mainMenuOptionsRoot, mainMenuOptionsContent, selectRoot, createRoot } =
      buildFixture();
    const startGame = vi.fn();

    const menu = new WorldMenuController(
      mainMenuRoot,
      mainMenuOptionsRoot,
      mainMenuOptionsContent,
      selectRoot,
      createRoot,
      dialog,
      startGame,
    );
    await menu.initialize();

    expect(worldsApi.listWorlds).toHaveBeenCalledOnce();
    expect(worldsApi.getSaveRecoveryNotice).not.toHaveBeenCalled();
    expect(mainMenuRoot.classList.contains('is-hidden')).toBe(false);
    expect(selectRoot.classList.contains('is-hidden')).toBe(false);
    expect(createRoot.classList.contains('is-hidden')).toBe(true);
    expect(mainMenuRoot.textContent).toContain('Aucun monde n’a encore été créé');
    expect(startGame).not.toHaveBeenCalled();
  });

  it('ouvre le menu principal même lorsqu’un monde actif existe', async () => {
    worldsApi.listWorlds.mockResolvedValue([
      {
        name: 'world',
        label: 'world',
        isActive: true,
        humanCount: 15,
        tick: 957,
        savedAtIso: new Date().toISOString(),
      },
    ]);
    worldsApi.getSaveRecoveryNotice.mockResolvedValue(null);
    const dialog = {
      alert: vi.fn(),
      confirm: vi.fn(),
      prompt: vi.fn(),
    } as unknown as AppDialog;
    const { mainMenuRoot, mainMenuOptionsRoot, mainMenuOptionsContent, selectRoot, createRoot } =
      buildFixture();
    const startGame = vi.fn();

    const menu = new WorldMenuController(
      mainMenuRoot,
      mainMenuOptionsRoot,
      mainMenuOptionsContent,
      selectRoot,
      createRoot,
      dialog,
      startGame,
    );
    await menu.initialize();

    expect(worldsApi.listWorlds).toHaveBeenCalledOnce();
    expect(worldsApi.getSaveRecoveryNotice).not.toHaveBeenCalled();
    expect(mainMenuRoot.classList.contains('is-hidden')).toBe(false);
    expect(mainMenuRoot.textContent).toContain('world');
    expect(selectRoot.classList.contains('is-hidden')).toBe(true);
    expect(createRoot.classList.contains('is-hidden')).toBe(true);
    expect(startGame).not.toHaveBeenCalled();
  });
});
