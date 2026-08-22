import type { CreateWorldRequest } from '@civ/shared';
import {
  WorldsApiError,
  activateWorld,
  createWorld,
  deleteWorld,
  duplicateWorld,
  getSaveRecoveryNotice,
  listWorlds,
  renameWorld,
} from '../net/worldsApi.js';
import type { AppDialog } from './appDialog.js';
import { OptionsPanel } from './optionsPanel.js';
import { MainMenuScreen } from './mainMenuScreen.js';
import { WorldCreateScreen } from './worldCreateScreen.js';
import { WorldSelectScreen } from './worldSelectScreen.js';

/** Orchestre tout le CRUD des mondes ; `main.ts` ne garde que le démarrage du jeu. */
export class WorldMenuController {
  private readonly mainMenuScreen: MainMenuScreen;
  private readonly selectScreen: WorldSelectScreen;
  private readonly createScreen: WorldCreateScreen;
  private readonly mainMenuOptionsPanel: OptionsPanel;
  private currentWorldName: string | null = null;
  private createReturnTarget: 'menu' | 'worlds' = 'menu';

  constructor(
    private readonly mainMenuRoot: HTMLElement,
    private readonly mainMenuOptionsRoot: HTMLElement,
    private readonly mainMenuOptionsContent: HTMLElement,
    private readonly selectRoot: HTMLElement,
    private readonly createRoot: HTMLElement,
    private readonly dialog: AppDialog,
    private readonly onStartGame: () => void,
  ) {
    this.mainMenuScreen = new MainMenuScreen(mainMenuRoot, {
      onContinue: () => this.continueGame(),
      onLoadWorlds: () => void this.showWorlds(),
      onCreateNew: () => this.openCreate('menu'),
      onOptions: () => this.toggleMainMenuOptions(),
    });
    this.mainMenuOptionsPanel = new OptionsPanel(
      this.mainMenuOptionsRoot,
      this.mainMenuOptionsContent,
      () => {},
    );
    this.selectScreen = new WorldSelectScreen(selectRoot, {
      onContinue: () => this.continueGame(),
      onActivate: (name) => void this.activate(name),
      onCreateNew: () => this.openCreate('worlds'),
      onBack: () => void this.showMainMenu(),
      onRename: (name, label) => void this.rename(name, label),
      onDuplicate: (name, label) => void this.duplicate(name, label),
      onDelete: (name, label) => void this.delete(name, label),
    });
    this.createScreen = new WorldCreateScreen(createRoot, {
      onSubmit: (request) => void this.create(request),
      onBack: () => void this.returnFromCreate(),
    });

    requiredElement<HTMLButtonElement>(
      this.mainMenuOptionsRoot,
      '[data-main-options-close]',
    ).addEventListener('click', () => this.closeMainMenuOptions());
    this.mainMenuOptionsRoot.addEventListener('click', (event) => {
      if (event.target === this.mainMenuOptionsRoot) this.closeMainMenuOptions();
    });
  }

  get activeWorldName(): string | null {
    return this.currentWorldName;
  }

  get isOpen(): boolean {
    return (
      !this.mainMenuRoot.classList.contains('is-hidden') ||
      !this.selectRoot.classList.contains('is-hidden') ||
      !this.createRoot.classList.contains('is-hidden')
    );
  }

  async initialize(): Promise<void> {
    try {
      await this.refreshMainMenu();
    } catch (error) {
      console.error('[worlds] impossible de préparer le menu principal au démarrage:', error);
      this.currentWorldName = null;
      this.mainMenuScreen.show({
        canContinue: false,
        status: 'Le menu principal est prêt, mais les mondes n’ont pas pu être chargés.',
      });
    }
  }

  hide(): void {
    this.mainMenuScreen.hide();
    this.selectScreen.hide();
    this.createScreen.hide();
    this.closeMainMenuOptions();
  }

  async showWorlds(): Promise<void> {
    this.mainMenuScreen.hide();
    this.createScreen.hide();
    this.closeMainMenuOptions();
    try {
      this.selectScreen.show(await listWorlds());
    } catch (error) {
      console.error('[worlds] échec du chargement de la liste des mondes:', error);
      await this.dialog.alert(
        'Mondes indisponibles',
        describeWorldsError(error, 'Impossible de charger la liste des mondes.'),
      );
      await this.refreshMainMenu();
    }
  }

  private continueGame(): void {
    this.hide();
    this.onStartGame();
  }

  private openCreate(returnTo: 'menu' | 'worlds'): void {
    this.createReturnTarget = returnTo;
    this.mainMenuScreen.hide();
    this.selectScreen.hide();
    this.closeMainMenuOptions();
    this.createScreen.show({ canGoBack: true });
  }

  private async showMainMenu(): Promise<void> {
    this.selectScreen.hide();
    this.createScreen.hide();
    this.closeMainMenuOptions();
    try {
      await this.refreshMainMenu();
    } catch (error) {
      console.error('[worlds] impossible de revenir au menu principal:', error);
      this.currentWorldName = null;
      this.mainMenuScreen.show({
        canContinue: false,
        status: 'Le menu principal est prêt, mais les mondes n’ont pas pu être rechargés.',
      });
    }
  }

  private returnFromCreate(): void {
    if (this.createReturnTarget === 'worlds') {
      void this.showWorlds();
      return;
    }
    void this.showMainMenu();
  }

  private async activate(name: string): Promise<void> {
    try {
      await activateWorld(name);
      this.currentWorldName = name;
      const recoveryNotice = await getSaveRecoveryNotice();
      if (recoveryNotice) await this.dialog.alert('Sauvegarde restaurée', recoveryNotice);
      this.continueGame();
    } catch (error) {
      await this.dialog.alert(
        'Activation impossible',
        describeWorldsError(error, 'Échec de l’activation du monde.'),
      );
      await this.refresh();
    }
  }

  private async create(request: CreateWorldRequest): Promise<void> {
    try {
      const created = await createWorld(request);
      this.currentWorldName = created.name;
      this.continueGame();
    } catch (error) {
      this.createScreen.showError(describeWorldsError(error, 'Échec de la création du monde.'));
    }
  }

  private async refreshMainMenu(): Promise<void> {
    const worlds = await listWorlds();
    const activeWorld = worlds.find((world) => world.isActive) ?? null;
    this.currentWorldName = activeWorld?.name ?? null;
    this.mainMenuScreen.show({
      canContinue: activeWorld !== null,
      worldLabel: activeWorld ? displayWorldLabel(activeWorld.name, activeWorld.label) : null,
      status:
        worlds.length === 0
          ? 'Aucun monde n’a encore été créé. Lancez-en un nouveau pour commencer.'
          : null,
    });
    if (worlds.length === 0) return;
    const recoveryNotice = await getSaveRecoveryNotice();
    if (recoveryNotice) await this.dialog.alert('Sauvegarde restaurée', recoveryNotice);
  }

  private toggleMainMenuOptions(): void {
    if (this.mainMenuOptionsPanel.isOpen) this.closeMainMenuOptions();
    else this.openMainMenuOptions();
  }

  private openMainMenuOptions(): void {
    this.mainMenuOptionsPanel.open();
  }

  private closeMainMenuOptions(): void {
    if (!this.mainMenuOptionsPanel.isOpen) return;
    this.mainMenuOptionsPanel.close();
  }

  private async rename(name: string, label: string): Promise<void> {
    const next = await this.dialog.prompt({
      title: 'Renommer le monde',
      message: `Choisissez le nouveau nom de « ${label} ».`,
      initialValue: label,
      confirmLabel: 'Renommer',
    });
    if (next === null || next === label) return;
    try {
      await renameWorld(name, next);
    } catch (error) {
      await this.dialog.alert(
        'Renommage impossible',
        describeWorldsError(error, 'Échec du renommage.'),
      );
    }
    await this.refresh();
  }

  private async duplicate(name: string, label: string): Promise<void> {
    const next = await this.dialog.prompt({
      title: 'Dupliquer le monde',
      message: `La copie de « ${label} » aura sa propre histoire.`,
      initialValue: `${label} - copie`,
      confirmLabel: 'Dupliquer',
    });
    if (next === null) return;
    try {
      await duplicateWorld(name, next);
    } catch (error) {
      await this.dialog.alert(
        'Duplication impossible',
        describeWorldsError(error, 'Échec de la duplication.'),
      );
    }
    await this.refresh();
  }

  private async delete(name: string, label: string): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Supprimer ce monde ?',
      message: `« ${label} » et ses sauvegardes seront supprimés définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteWorld(name);
    } catch (error) {
      await this.dialog.alert(
        'Suppression impossible',
        describeWorldsError(error, 'Échec de la suppression.'),
      );
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const worlds = await listWorlds();
      const activeWorld = worlds.find((world) => world.isActive) ?? null;
      this.currentWorldName = activeWorld?.name ?? null;
      this.selectScreen.show(worlds);
    } catch (error) {
      console.error('[worlds] échec du chargement de la liste des mondes:', error);
      await this.dialog.alert(
        'Mondes indisponibles',
        describeWorldsError(error, 'Impossible de charger la liste des mondes.'),
      );
      await this.refreshMainMenu();
    }
  }
}

function describeWorldsError(error: unknown, fallback: string): string {
  if (error instanceof WorldsApiError) return error.message;
  if (error instanceof TypeError) {
    return 'Serveur injoignable — vérifiez la connexion et réessayez.';
  }
  return fallback;
}

function displayWorldLabel(name: string, label: string | null | undefined): string {
  return label?.trim().length ? label : name;
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans le menu principal: ${selector}`);
  return element;
}
