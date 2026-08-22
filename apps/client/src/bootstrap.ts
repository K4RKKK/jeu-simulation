import './styles.css';
import { setBootstrapContext } from './bootstrapContext.js';
import { applyInterfaceSettings } from './settings/interfaceSettings.js';
import { controlCode, keyLabel } from './settings/controlSettings.js';
import { AppDialog } from './ui/appDialog.js';
import { LoadingScreen } from './ui/loadingScreen.js';
import { WorldMenuController } from './ui/worldMenuController.js';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans le document: ${selector}`);
  return element;
}

const loadingScreen = new LoadingScreen(requireElement<HTMLElement>('#loading-screen'));
applyInterfaceSettings();
updateHelp();
window.addEventListener('civ:controls-changed', updateHelp);
const appDialog = new AppDialog(requireElement<HTMLDialogElement>('#app-dialog'));
let runtimePromise: Promise<{ startGame(): void }> | null = null;

const worldMenu = new WorldMenuController(
  requireElement<HTMLElement>('#main-menu-screen'),
  requireElement<HTMLElement>('#main-menu-options-screen'),
  requireElement<HTMLElement>('#main-menu-options-content'),
  requireElement<HTMLElement>('#world-select-screen'),
  requireElement<HTMLElement>('#world-create-screen'),
  appDialog,
  () => void startRuntime(),
);

setBootstrapContext({ appDialog, worldMenu });
void worldMenu.initialize();

async function startRuntime(): Promise<void> {
  worldMenu.hide();
  loadingScreen.show();

  try {
    runtimePromise ??= import('./main.js');
    const runtime = await runtimePromise;
    runtime.startGame();
  } catch (error) {
    runtimePromise = null;
    loadingScreen.hide();
    console.error('[client] impossible de charger le moteur du jeu:', error);
    await appDialog.alert(
      'Chargement impossible',
      'Le moteur du jeu n’a pas pu être chargé. Vérifiez la connexion puis réessayez.',
    );
    await worldMenu.showWorlds();
  }
}

function updateHelp(): void {
  const set = (name: string, value: string) => {
    const target = document.querySelector<HTMLElement>(`[data-help="${name}"]`);
    if (target) target.textContent = value;
  };
  set(
    'move',
    [controlCode('forward'), controlCode('left'), controlCode('backward'), controlCode('right')]
      .map(keyLabel)
      .join(''),
  );
  set('rotate', `${keyLabel(controlCode('rotateLeft'))} / ${keyLabel(controlCode('rotateRight'))}`);
  set('follow', keyLabel(controlCode('follow')));
  set('cinematic', keyLabel(controlCode('cinematic')));
  set('interface', keyLabel(controlCode('interface')));
}
