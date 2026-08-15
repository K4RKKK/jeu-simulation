import type { WorldSummary } from '@civ/shared';
import { resolveThumbnailUrl } from '../net/worldsApi.js';

export interface WorldSelectScreenCallbacks {
  /** Le monde déjà actif sur le serveur convient tel quel — pas d'appel HTTP, juste jouer. */
  onContinue: () => void;
  onActivate: (name: string) => void;
  onCreateNew: () => void;
  onRename: (name: string, label: string) => void;
  onDuplicate: (name: string, label: string) => void;
  onDelete: (name: string, label: string) => void;
}

/**
 * Écran « Mes mondes » — liste des sauvegardes, monde actif mis en avant.
 *
 * Un seul monde est actif à la fois côté serveur (voir `SimulationHost`) : l'activer
 * depuis ici change ce que voient TOUS les observateurs déjà connectés. Ce composant
 * n'appelle jamais l'API lui-même — il ne fait qu'émettre des intentions via
 * `callbacks`, à charge de l'appelant (`main.ts`) d'orchestrer l'appel réseau et de
 * rafraîchir l'écran ensuite (même séparation que `PopulationPanel.onSelect`).
 */
export class WorldSelectScreen {
  private readonly listElement: HTMLElement;
  private readonly continueSlot: HTMLElement;
  private openMenuName: string | null = null;
  /** Mémorisé uniquement pour ré-afficher la liste après un toggle de menu ⋮. */
  private currentWorlds: readonly WorldSummary[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: WorldSelectScreenCallbacks,
  ) {
    this.listElement = requiredElement(root, '[data-world-list]');
    this.continueSlot = requiredElement(root, '[data-continue-slot]');
    requiredElement<HTMLButtonElement>(root, '[data-new-world]').addEventListener('click', () =>
      callbacks.onCreateNew(),
    );
    // Un clic n'importe où ailleurs referme un menu ⋮ resté ouvert — les boutons du
    // menu lui-même appellent déjà `event.stopPropagation()`.
    root.addEventListener('click', () => {
      if (this.openMenuName === null) return;
      this.openMenuName = null;
      this.render(this.currentWorlds);
    });
  }

  show(worlds: readonly WorldSummary[]): void {
    this.root.classList.remove('is-hidden');
    this.render(worlds);
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  private render(worlds: readonly WorldSummary[]): void {
    this.currentWorlds = worlds;
    const active = worlds.find((w) => w.isActive) ?? null;
    this.renderContinueCard(active);

    if (worlds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Aucun monde encore sauvegardé.';
      this.listElement.replaceChildren(empty);
      return;
    }

    const sorted = [...worlds].sort((a, b) => b.savedAtIso.localeCompare(a.savedAtIso));
    const fragment = document.createDocumentFragment();
    for (const world of sorted) fragment.append(this.buildRow(world));
    this.listElement.replaceChildren(fragment);
  }

  private renderContinueCard(active: WorldSummary | null): void {
    if (!active) {
      this.continueSlot.replaceChildren();
      return;
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'world-continue-card';
    card.innerHTML = `
      <div class="world-continue-card__thumb" style="background-image:url('${escapeHtml(resolveThumbnailUrl(active.name))}')"></div>
      <div class="world-continue-card__body">
        <span class="world-continue-card__label">Continuer</span>
        <strong>${escapeHtml(displayName(active))}</strong>
        <span class="world-continue-card__meta">${describeWorld(active)}</span>
      </div>
    `;
    card.addEventListener('click', () => this.callbacks.onContinue());
    this.continueSlot.replaceChildren(card);
  }

  private buildRow(world: WorldSummary): HTMLElement {
    const row = document.createElement('div');
    row.className = 'world-row' + (world.isActive ? ' is-active' : '');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'world-row__main';
    main.innerHTML = `
      <div class="world-row__thumb" style="background-image:url('${escapeHtml(resolveThumbnailUrl(world.name))}')"></div>
      <div class="world-row__body">
        <span class="world-row__name">${escapeHtml(displayName(world))}${world.isActive ? ' <em>· actif</em>' : ''}</span>
        <span class="world-row__meta">${describeWorld(world)}</span>
      </div>
    `;
    main.addEventListener('click', () => {
      if (world.isActive) this.callbacks.onContinue();
      else this.callbacks.onActivate(world.name);
    });

    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'world-row__menu-toggle';
    menuButton.setAttribute('aria-label', `Actions pour ${displayName(world)}`);
    menuButton.textContent = '⋮';
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openMenuName = this.openMenuName === world.name ? null : world.name;
      this.render(this.currentWorlds);
    });

    row.append(main, menuButton);

    if (this.openMenuName === world.name) {
      row.append(this.buildMenu(world));
    }
    return row;
  }

  private buildMenu(world: WorldSummary): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'world-row__menu';

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'Renommer';
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openMenuName = null;
      this.callbacks.onRename(world.name, displayName(world));
    });

    const duplicate = document.createElement('button');
    duplicate.type = 'button';
    duplicate.textContent = 'Dupliquer';
    duplicate.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openMenuName = null;
      this.callbacks.onDuplicate(world.name, displayName(world));
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'world-row__menu-danger';
    del.textContent = 'Supprimer';
    del.disabled = world.isActive;
    del.title = world.isActive ? 'Impossible de supprimer le monde actif' : '';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openMenuName = null;
      this.callbacks.onDelete(world.name, displayName(world));
    });

    menu.append(rename, duplicate, del);
    return menu;
  }
}

function displayName(world: WorldSummary): string {
  return world.label ?? world.name;
}

function describeWorld(world: WorldSummary): string {
  const relative = formatRelativeTime(world.savedAtIso);
  return `${world.humanCount} habitants · tick ${world.tick.toLocaleString('fr-FR')} · ${relative}`;
}

function formatRelativeTime(iso: string): string {
  const savedAt = new Date(iso).getTime();
  if (Number.isNaN(savedAt)) return iso;
  const diffMs = Date.now() - savedAt;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Élément introuvable dans l'écran des mondes: ${selector}`);
  return element;
}
