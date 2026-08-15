import type { AppDialog } from './ui/appDialog.js';
import type { WorldMenuController } from './ui/worldMenuController.js';

export interface BootstrapContext {
  readonly appDialog: AppDialog;
  readonly worldMenu: WorldMenuController;
}

let context: BootstrapContext | null = null;

export function setBootstrapContext(next: BootstrapContext): void {
  context = next;
}

export function getBootstrapContext(): BootstrapContext {
  if (context === null) throw new Error('Le menu initial du jeu n’est pas encore prêt.');
  return context;
}
