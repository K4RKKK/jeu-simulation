import type { NetworkEvent } from '@civ/shared';

const MAX_HISTORY_ENTRIES = 240;
const MAX_VISIBLE_TOASTS = 3;
const MAX_TOASTS_PER_BATCH = 2;
const TOAST_LIFETIME_MS = 5_200;
const TOAST_EXIT_MS = 180;

type ChronicleKind = 'world' | 'arrival' | 'death';

interface EventPresentation {
  readonly kind: ChronicleKind;
  readonly notify: boolean;
  readonly priority: number;
}

interface ChronicleEntry {
  readonly key: string;
  readonly event: NetworkEvent;
  readonly kind: ChronicleKind;
  readonly notify: boolean;
  readonly priority: number;
  readonly year: number | null;
  readonly day: number | null;
  readonly hour: number | null;
  readonly minute: number | null;
  readonly order: number;
}

const EVENT_PRESENTATIONS: Readonly<Record<string, EventPresentation>> = {
  SimulationStarted: { kind: 'world', notify: true, priority: 1 },
  HumanBorn: { kind: 'arrival', notify: true, priority: 2 },
  HumanDied: { kind: 'death', notify: true, priority: 3 },
};

/**
 * Chronique strictement dérivée du flux réseau : elle ne déduit ni découverte, ni
 * maladie, ni progrès qui ne serait pas explicitement émis par la simulation.
 */
export class WorldChronicle {
  private readonly history: ChronicleEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly toasts = new Set<HTMLElement>();
  private readonly timers = new Set<ReturnType<typeof globalThis.setTimeout>>();
  private readonly toastTimers = new Map<HTMLElement, ReturnType<typeof globalThis.setTimeout>>();
  private nextOrder = 0;
  private disposed = false;
  private worldId: string | null = null;

  constructor(
    private readonly panel: HTMLElement,
    private readonly list: HTMLElement,
    private readonly toastContainer: HTMLElement,
  ) {
    panel.classList.add('world-chronicle');
    list.classList.add('world-chronicle__list');
    toastContainer.classList.add('world-toasts');
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'false');
    toastContainer.setAttribute('aria-relevant', 'additions');

    const initiallyOpen = panel.classList.contains('is-open');
    panel.inert = !initiallyOpen;
    panel.classList.toggle('world-chronicle--open', initiallyOpen);
    panel.setAttribute('aria-hidden', initiallyOpen ? 'false' : 'true');
    this.render();
  }

  /** Ajoute les événements majeurs inconnus et ignore silencieusement le bruit courant. */
  ingest(events: readonly NetworkEvent[]): void {
    if (this.disposed) return;

    const added: ChronicleEntry[] = [];
    for (const event of events) {
      const presentation = EVENT_PRESENTATIONS[event.type];
      if (!presentation) continue;

      const key = eventKey(event);
      if (this.seen.has(key)) continue;

      const entry: ChronicleEntry = {
        key,
        event,
        ...presentation,
        year: event.year,
        day: event.day,
        hour: event.hour,
        minute: event.minute,
        order: this.nextOrder++,
      };
      this.history.push(entry);
      this.seen.add(key);
      added.push(entry);
    }

    if (added.length === 0) return;
    this.trimHistory();
    this.render();

    // La population initiale est créée au tick 0 : la notifier individu par individu
    // produirait précisément le déluge que cette UI doit éviter. Elle reste consultable
    // dans la chronique, sans être présentée comme une série de naissances vécues.
    const notifications = added
      .filter((entry) => entry.notify && !(entry.kind === 'arrival' && entry.event.tick === 0))
      .sort((left, right) => right.priority - left.priority || right.order - left.order)
      .slice(0, MAX_TOASTS_PER_BATCH)
      .reverse();

    for (const entry of notifications) this.showToast(entry);
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('world-chronicle--open');
  }

  get size(): number {
    return this.history.length;
  }

  setWorld(worldId: string, forceReset = false): void {
    if (!forceReset && this.worldId === worldId) return;
    this.worldId = worldId;
    this.reset();
  }

  reset(): void {
    if (this.disposed) return;
    this.history.length = 0;
    this.seen.clear();
    this.nextOrder = 0;
    this.clearNotifications();
    this.render();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.disposed) return;
    this.panel.hidden = false;
    this.panel.classList.remove('hidden');
    this.panel.classList.add('world-chronicle--open');
    this.panel.classList.add('is-open');
    this.panel.inert = false;
    this.panel.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    if (this.disposed) return;
    this.panel.classList.remove('world-chronicle--open');
    this.panel.classList.remove('is-open');
    this.panel.inert = true;
    this.panel.setAttribute('aria-hidden', 'true');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.clearNotifications();
  }

  private trimHistory(): void {
    const overflow = this.history.length - MAX_HISTORY_ENTRIES;
    if (overflow <= 0) return;

    const removed = this.history.splice(0, overflow);
    for (const entry of removed) this.seen.delete(entry.key);
  }

  private render(): void {
    if (this.history.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'world-chronicle__empty';
      empty.textContent = 'Aucun événement majeur pour le moment.';
      this.list.replaceChildren(empty);
      return;
    }

    const groups = groupByDay([...this.history].reverse());
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const section = document.createElement('section');
      section.className = 'world-chronicle__day';

      const heading = document.createElement('h3');
      heading.className = 'world-chronicle__day-heading';
      heading.textContent = formatDay(group.year, group.day);

      const entries = document.createElement('ol');
      entries.className = 'world-chronicle__entries';
      for (const entry of group.entries) entries.append(this.renderEntry(entry));

      section.append(heading, entries);
      fragment.append(section);
    }
    this.list.replaceChildren(fragment);
  }

  private renderEntry(entry: ChronicleEntry): HTMLElement {
    const item = document.createElement('li');
    item.className = `world-chronicle__entry world-chronicle__entry--${entry.kind}`;

    const time = document.createElement('time');
    time.className = 'world-chronicle__time';
    time.textContent = formatTime(entry);

    const message = document.createElement('span');
    message.className = 'world-chronicle__message';
    message.textContent = entry.event.message;

    item.append(time, message);
    return item;
  }

  private showToast(entry: ChronicleEntry): void {
    while (this.toasts.size >= MAX_VISIBLE_TOASTS) {
      const oldest = this.toasts.values().next().value;
      if (oldest) this.removeToast(oldest);
      else break;
    }

    const toast = document.createElement('div');
    toast.className = `world-toast world-toast--${entry.kind}`;

    const marker = document.createElement('span');
    marker.className = 'world-toast__marker';
    marker.setAttribute('aria-hidden', 'true');

    const message = document.createElement('span');
    message.className = 'world-toast__message';
    message.textContent = entry.event.message;

    const date = document.createElement('span');
    date.className = 'world-toast__date';
    date.textContent = `${formatDay(entry.year, entry.day)} · ${formatTime(entry)}`;

    toast.append(marker, message, date);
    this.toastContainer.append(toast);
    this.toasts.add(toast);

    const timer = this.schedule(() => this.dismissToast(toast), TOAST_LIFETIME_MS);
    this.toastTimers.set(toast, timer);
  }

  private dismissToast(toast: HTMLElement): void {
    if (!this.toasts.has(toast)) return;
    this.toastTimers.delete(toast);
    toast.classList.add('world-toast--leaving');
    this.schedule(() => this.removeToast(toast), TOAST_EXIT_MS);
  }

  private removeToast(toast: HTMLElement): void {
    const timer = this.toastTimers.get(toast);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      this.timers.delete(timer);
      this.toastTimers.delete(toast);
    }
    toast.remove();
    this.toasts.delete(toast);
  }

  private clearNotifications(): void {
    for (const timer of this.timers) globalThis.clearTimeout(timer);
    this.timers.clear();
    this.toastTimers.clear();
    for (const toast of this.toasts) toast.remove();
    this.toasts.clear();
  }

  private schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof globalThis.setTimeout> {
    const timer = globalThis.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delayMs);
    this.timers.add(timer);
    return timer;
  }
}

interface DayGroup {
  readonly year: number | null;
  readonly day: number | null;
  readonly entries: ChronicleEntry[];
}

function groupByDay(entries: readonly ChronicleEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (previous && previous.year === entry.year && previous.day === entry.day) {
      previous.entries.push(entry);
    } else {
      groups.push({ year: entry.year, day: entry.day, entries: [entry] });
    }
  }
  return groups;
}

function eventKey(event: NetworkEvent): string {
  return `${event.type}\u0000${event.tick}\u0000${event.entityId ?? ''}\u0000${event.message}`;
}

function formatDay(year: number | null, day: number | null): string {
  return year === null || day === null ? 'Date inconnue' : `Année ${year} · Jour ${day}`;
}

function formatTime(entry: ChronicleEntry): string {
  if (entry.hour === null || entry.minute === null) return `Tick ${entry.event.tick}`;
  return `${pad(entry.hour)}:${pad(entry.minute)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
