import type { HumanRecord, WorldStore } from '../net/worldStore.js';

export class PopulationPanel {
  private static readonly PAGE_SIZE = 250;
  private query = '';
  private readonly favorites = new Set<number>();
  private recentIds: number[] = [];
  private worldId: string | null = null;
  private renderLimit = PopulationPanel.PAGE_SIZE;
  private refreshTimer: number | null = null;

  constructor(
    private readonly panel: HTMLElement,
    private readonly list: HTMLElement,
    search: HTMLInputElement,
    private readonly store: WorldStore,
    private readonly onSelect: (id: number) => void,
  ) {
    this.panel.inert = !this.isOpen;
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLocaleLowerCase('fr');
      this.renderLimit = PopulationPanel.PAGE_SIZE;
      this.render();
    });
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('is-open');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.panel.classList.add('is-open');
    this.panel.inert = false;
    this.panel.setAttribute('aria-hidden', 'false');
    this.render();
  }

  close(): void {
    this.panel.classList.remove('is-open');
    this.panel.inert = true;
    this.panel.setAttribute('aria-hidden', 'true');
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  refreshIfOpen(): void {
    if (!this.isOpen || this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.isOpen) this.render();
    }, 250);
  }

  setWorld(worldId: string, forceReset = false): void {
    if (!forceReset && this.worldId === worldId) return;
    this.worldId = worldId;
    this.favorites.clear();
    this.recentIds = [];
    this.restoreFavorites();
    this.restoreRecent();
    this.refreshIfOpen();
  }

  noteSelection(id: number): void {
    this.recentIds = [id, ...this.recentIds.filter((candidate) => candidate !== id)].slice(0, 6);
    try {
      const key = this.storageKey('recent-people');
      if (key) localStorage.setItem(key, JSON.stringify(this.recentIds));
    } catch {
      // L'historique reste disponible pour la session si le stockage local est refusé.
    }
    this.refreshIfOpen();
  }

  render(): void {
    const focus = this.captureListFocus();
    const scrollTop = this.list.scrollTop;
    const records = [...this.store.values()]
      .filter((record) => record.profile.name.toLocaleLowerCase('fr').includes(this.query))
      .sort((a, b) => {
        const favorite =
          Number(this.favorites.has(b.profile.id)) - Number(this.favorites.has(a.profile.id));
        return favorite || a.profile.name.localeCompare(b.profile.name, 'fr');
      });

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = this.query
        ? 'Aucune personne ne correspond à cette recherche.'
        : 'Les personnes présentes dans la zone observée apparaîtront ici.';
      this.list.replaceChildren(empty);
      this.list.scrollTop = scrollTop;
      return;
    }

    const fragment = document.createDocumentFragment();
    const visibleRecords = records.slice(0, this.renderLimit);
    if (this.query) {
      this.appendGroup(fragment, 'Résultats', visibleRecords);
    } else {
      const favoriteRecords = visibleRecords.filter((record) =>
        this.favorites.has(record.profile.id),
      );
      const favoriteIds = new Set(favoriteRecords.map((record) => record.profile.id));
      const recentRecords = this.recentIds
        .map((id) => this.store.get(id))
        .filter(
          (record): record is HumanRecord =>
            record !== undefined && !favoriteIds.has(record.profile.id),
        );
      const recentIds = new Set(recentRecords.map((record) => record.profile.id));
      const otherRecords = visibleRecords.filter(
        (record) => !favoriteIds.has(record.profile.id) && !recentIds.has(record.profile.id),
      );

      this.appendGroup(fragment, 'Favoris', favoriteRecords);
      this.appendGroup(fragment, 'Récemment observés', recentRecords);
      this.appendGroup(fragment, 'Tous les habitants', otherRecords);
    }
    if (records.length > visibleRecords.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'population-load-more';
      more.textContent = `Afficher ${Math.min(PopulationPanel.PAGE_SIZE, records.length - visibleRecords.length)} habitants de plus (${visibleRecords.length}/${records.length})`;
      more.addEventListener('click', () => {
        this.renderLimit += PopulationPanel.PAGE_SIZE;
        this.render();
      });
      fragment.append(more);
    }
    this.list.replaceChildren(fragment);
    this.list.scrollTop = scrollTop;
    this.restoreListFocus(focus);
  }

  private appendGroup(
    fragment: DocumentFragment,
    label: string,
    records: readonly HumanRecord[],
  ): void {
    if (records.length === 0) return;

    const heading = document.createElement('h3');
    heading.className = 'population-section-title';
    heading.textContent = label;
    fragment.append(heading);

    for (const record of records) {
      const row = document.createElement('div');
      row.className = 'population-row';
      row.dataset.entityId = String(record.profile.id);

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'population-row__select';
      select.setAttribute('aria-label', `Observer ${record.profile.name}`);
      select.addEventListener('click', () => this.onSelect(record.profile.id));

      const identity = document.createElement('span');
      identity.className = 'population-row__identity';
      const name = document.createElement('strong');
      name.textContent = record.profile.name;
      const activity = document.createElement('small');
      activity.textContent = activityLabel(record.current.activity);
      identity.append(name, activity);

      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'favorite-button';
      favorite.title = this.favorites.has(record.profile.id)
        ? 'Retirer des favoris'
        : 'Ajouter aux favoris';
      favorite.setAttribute('aria-label', favorite.title);
      favorite.textContent = this.favorites.has(record.profile.id) ? '★' : '☆';
      favorite.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleFavorite(record.profile.id);
      });
      select.append(identity);
      row.append(select, favorite);
      fragment.append(row);
    }
  }

  private toggleFavorite(id: number): void {
    if (this.favorites.has(id)) this.favorites.delete(id);
    else this.favorites.add(id);
    try {
      const key = this.storageKey('favorites');
      if (key) localStorage.setItem(key, JSON.stringify([...this.favorites]));
    } catch {
      // Le mode privé peut refuser localStorage : les favoris restent valides pour la session.
    }
    this.render();
  }

  private restoreFavorites(): void {
    try {
      const key = this.storageKey('favorites');
      const value: unknown = JSON.parse((key && localStorage.getItem(key)) || '[]');
      if (Array.isArray(value)) {
        for (const id of value) if (typeof id === 'number') this.favorites.add(id);
      }
    } catch {
      // Une valeur locale corrompue ne doit jamais empêcher l'ouverture de l'interface.
    }
  }

  private restoreRecent(): void {
    try {
      const key = this.storageKey('recent-people');
      const value: unknown = JSON.parse((key && localStorage.getItem(key)) || '[]');
      if (Array.isArray(value)) {
        this.recentIds = value.filter((id): id is number => typeof id === 'number').slice(0, 6);
      }
    } catch {
      this.recentIds = [];
    }
  }

  private storageKey(kind: 'favorites' | 'recent-people'): string | null {
    return this.worldId === null ? null : `civ:${encodeURIComponent(this.worldId)}:${kind}`;
  }

  private captureListFocus(): { id: string; control: 'select' | 'favorite' } | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.list.contains(active)) return null;
    const row = active.closest<HTMLElement>('.population-row[data-entity-id]');
    const id = row?.dataset.entityId;
    if (!id) return null;
    return { id, control: active.classList.contains('favorite-button') ? 'favorite' : 'select' };
  }

  private restoreListFocus(focus: { id: string; control: 'select' | 'favorite' } | null): void {
    if (!focus) return;
    const row = [
      ...this.list.querySelectorAll<HTMLElement>('.population-row[data-entity-id]'),
    ].find((candidate) => candidate.dataset.entityId === focus.id);
    row
      ?.querySelector<HTMLButtonElement>(
        focus.control === 'favorite' ? '.favorite-button' : '.population-row__select',
      )
      ?.focus({ preventScroll: true });
  }
}

function activityLabel(activity: string): string {
  switch (activity) {
    case 'walking':
      return 'En déplacement';
    case 'drink':
      return 'Boit';
    case 'eat':
      return 'Mange';
    case 'rest':
      return 'Se repose';
    default:
      return 'Observe';
  }
}
