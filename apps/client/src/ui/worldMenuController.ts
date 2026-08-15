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
import { WorldCreateScreen } from './worldCreateScreen.js';
import { WorldSelectScreen } from './worldSelectScreen.js';

/** Orchestre tout le CRUD des mondes ; `main.ts` ne garde que le démarrage du jeu. */
export class WorldMenuController {
  private readonly selectScreen: WorldSelectScreen;
  private readonly createScreen: WorldCreateScreen;
  private currentWorldName: string | null = null;

  constructor(
    private readonly selectRoot: HTMLElement,
    private readonly createRoot: HTMLElement,
    private readonly dialog: AppDialog,
    private readonly onStartGame: () => void,
  ) {
    this.selectScreen = new WorldSelectScreen(selectRoot, {
      onContinue: () => this.continueGame(),
      onActivate: (name) => void this.activate(name),
      onCreateNew: () => this.showCreate(),
      onRename: (name, label) => void this.rename(name, label),
      onDuplicate: (name, label) => void this.duplicate(name, label),
      onDelete: (name, label) => void this.delete(name, label),
    });
    this.createScreen = new WorldCreateScreen(createRoot, {
      onSubmit: (request) => void this.create(request),
      onBack: () => void this.showWorlds(),
    });
  }

  get activeWorldName(): string | null {
    return this.currentWorldName;
  }

  get isOpen(): boolean {
    return (
      !this.selectRoot.classList.contains('is-hidden') ||
      !this.createRoot.classList.contains('is-hidden')
    );
  }

  async initialize(): Promise<void> {
    try {
      const worlds = await listWorlds();
      if (worlds.length === 0) {
        this.createScreen.show({ canGoBack: false });
        return;
      }
      this.currentWorldName = worlds.find((world) => world.isActive)?.name ?? null;
      this.selectScreen.show(worlds);
      const recoveryNotice = await getSaveRecoveryNotice();
      if (recoveryNotice) await this.dialog.alert('Sauvegarde restaurée', recoveryNotice);
    } catch (error) {
      console.error('[worlds] impossible de lister les mondes au démarrage:', error);
      this.onStartGame();
    }
  }

  hide(): void {
    this.selectScreen.hide();
    this.createScreen.hide();
  }

  async showWorlds(): Promise<void> {
    this.createScreen.hide();
    await this.refresh();
  }

  private continueGame(): void {
    this.hide();
    this.onStartGame();
  }

  private showCreate(): void {
    this.selectScreen.hide();
    this.createScreen.show({ canGoBack: true });
  }

  private async refresh(): Promise<void> {
    try {
      this.selectScreen.show(await listWorlds());
    } catch (error) {
      console.error('[worlds] échec du chargement de la liste des mondes:', error);
      await this.dialog.alert(
        'Mondes indisponibles',
        describeWorldsError(error, 'Impossible de charger la liste des mondes.'),
      );
    }
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
}

function describeWorldsError(error: unknown, fallback: string): string {
  if (error instanceof WorldsApiError) return error.message;
  if (error instanceof TypeError) {
    return 'Serveur injoignable — vérifiez la connexion et réessayez.';
  }
  return fallback;
}
