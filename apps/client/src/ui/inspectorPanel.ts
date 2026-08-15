import type { ActivityKind, NeedsSnapshot, PersonalitySnapshot } from '@civ/shared';
import type { HumanRecord } from '../net/worldStore.js';

const TRAIT_LABELS: Record<keyof PersonalitySnapshot, string> = {
  curiosity: 'Curiosité',
  caution: 'Prudence',
  sociability: 'Sociabilité',
  aggression: 'Agressivité',
  patience: 'Patience',
  altruism: 'Altruisme',
  courage: 'Courage',
  perseverance: 'Persévérance',
};

const NEED_LABELS: Record<keyof NeedsSnapshot, string> = {
  hydration: 'Hydratation',
  // Cette valeur représente le rassasiement (1 = repu), pas l'intensité de la faim.
  hunger: 'Satiété',
  energy: 'Énergie',
};

const NEED_ALERT_LABELS: Record<keyof NeedsSnapshot, string> = {
  hydration: 'Soif',
  hunger: 'Faim',
  energy: 'Fatigue',
};

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  idle: 'reste immobile',
  walking: 'se déplace',
  drink: 'boit',
  eat: 'mange',
  rest: 'se repose',
};

const TECHNICAL_REASON_SUFFIX =
  /\s*\((?:(?:hydratation|faim|énergie|curiosité|courage|patience)\s+\d+(?:[.,]\d+)?(?:,\s*)?)+\)\s*$/iu;

type StateTone = 'stable' | 'warning' | 'critical';

/** Fiche progressive et non technique d'un individu sélectionné. */
export class InspectorPanel {
  constructor(
    private readonly panel: HTMLElement,
    private readonly content: HTMLElement,
  ) {
    this.panel.inert = this.panel.classList.contains('hidden');
  }

  show(record: HumanRecord): void {
    const openSections = openedSections(this.content);
    const focusedSection = focusedDisclosure(this.content);
    const previousScrollTop = this.panel.scrollTop;
    const sheet = characterSheet(record, openSections);

    this.content.replaceChildren(sheet);
    this.panel.scrollTop = previousScrollTop;
    this.panel.classList.remove('hidden');
    this.panel.inert = false;
    this.panel.setAttribute('aria-hidden', 'false');
    restoreDisclosureFocus(this.content, focusedSection);
  }

  hide(): void {
    this.panel.classList.add('hidden');
    this.panel.inert = true;
    this.panel.setAttribute('aria-hidden', 'true');
    this.content.replaceChildren();
  }
}

function characterSheet(record: HumanRecord, openSections: ReadonlySet<string>): HTMLElement {
  const { profile, current } = record;
  const sheet = document.createElement('article');
  sheet.className = 'inspector-profile';

  const identity = document.createElement('header');
  identity.className = 'inspector-profile__identity';

  const name = document.createElement('h3');
  name.className = 'inspector-profile__name';
  name.textContent = profile.name;

  const meta = document.createElement('p');
  meta.className = 'inspector-profile__meta';
  meta.textContent = `${formatAge(profile.ageYears)} · ${profile.sex === 'male' ? 'Homme' : 'Femme'}`;

  const state = summarizeState(current.needs);
  const stateElement = document.createElement('p');
  stateElement.className = `inspector-profile__state inspector-profile__state--${state.tone}`;
  stateElement.textContent = state.label;

  identity.append(name, meta, stateElement);
  sheet.append(
    identity,
    actionCard(profile.name, current.activity, current.reason),
    needsSection(current.needs),
    detailsSection(
      'Physiologie',
      'physiology',
      [
        ['Sexe', profile.sex === 'male' ? 'Homme' : 'Femme'],
        ['Taille', `${profile.heightM.toFixed(2)} m`],
        ['Masse', `${profile.massKg.toFixed(0)} kg`],
        ['Vitesse de marche', `${profile.walkSpeedMps.toFixed(1)} m/s`],
      ],
      openSections.has('physiology'),
    ),
    detailsSection(
      'Personnalité',
      'personality',
      (Object.keys(TRAIT_LABELS) as (keyof PersonalitySnapshot)[]).map((key) => [
        TRAIT_LABELS[key],
        traitQualifier(profile.personality[key]),
      ]),
      openSections.has('personality'),
    ),
  );

  return sheet;
}

function actionCard(name: string, activity: ActivityKind, rawReason: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'inspector-action';
  section.setAttribute('aria-labelledby', 'inspector-current-action');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'inspector-action__eyebrow';
  eyebrow.textContent = 'Action actuelle';

  const title = document.createElement('h4');
  title.id = 'inspector-current-action';
  title.className = 'inspector-action__title';
  title.textContent = actionSentence(name, activity, rawReason);

  const why = document.createElement('div');
  why.className = 'inspector-action__why';

  const whyLabel = document.createElement('span');
  whyLabel.className = 'inspector-action__why-label';
  whyLabel.textContent = 'Pourquoi ?';

  const reason = document.createElement('p');
  reason.className = 'inspector-action__reason reason';
  reason.textContent = playerFacingReason(rawReason);

  why.append(whyLabel, reason);
  section.append(eyebrow, title, why);
  return section;
}

function needsSection(needs: NeedsSnapshot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'inspector-needs';
  section.setAttribute('aria-labelledby', 'inspector-essential-needs');

  const heading = document.createElement('h4');
  heading.id = 'inspector-essential-needs';
  heading.className = 'inspector-needs__title';
  heading.textContent = 'Besoins essentiels';

  const list = document.createElement('div');
  list.className = 'inspector-needs__list';
  for (const key of Object.keys(NEED_LABELS) as (keyof NeedsSnapshot)[]) {
    list.append(needRow(NEED_LABELS[key], needs[key]));
  }

  section.append(heading, list);
  return section;
}

function needRow(label: string, rawValue: number): HTMLElement {
  const value = clamp01(rawValue);
  const percentage = Math.round(value * 100);
  const tone = needTone(value);
  const row = document.createElement('div');
  row.className = `inspector-need inspector-need--${tone}`;

  const header = document.createElement('div');
  header.className = 'inspector-need__header';

  const labelElement = document.createElement('span');
  labelElement.className = 'inspector-need__label';
  labelElement.textContent = label;

  const valueElement = document.createElement('span');
  valueElement.className = 'inspector-need__value';
  valueElement.textContent = `${percentage} %`;

  const qualifier = document.createElement('span');
  qualifier.className = 'inspector-need__qualifier';
  qualifier.textContent = needQualifier(value);

  const track = document.createElement('div');
  track.className = 'inspector-need__track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(percentage));
  track.setAttribute('aria-valuetext', `${percentage} %, ${needQualifier(value).toLowerCase()}`);

  const fill = document.createElement('div');
  fill.className = 'inspector-need__fill';
  fill.style.width = `${percentage}%`;

  header.append(labelElement, valueElement);
  track.append(fill);
  row.append(header, track, qualifier);
  return row;
}

function detailsSection(
  label: string,
  key: string,
  entries: readonly (readonly [string, string])[],
  open: boolean,
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'inspector-disclosure';
  details.dataset.section = key;
  details.open = open;

  const summary = document.createElement('summary');
  summary.className = 'inspector-disclosure__summary';
  summary.textContent = label;

  const content = document.createElement('div');
  content.className = 'inspector-disclosure__content';
  content.append(definitionList(entries));

  details.append(summary, content);
  return details;
}

function definitionList(entries: readonly (readonly [string, string])[]): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'inspector-facts';
  for (const [label, value] of entries) {
    const term = document.createElement('dt');
    term.className = 'inspector-facts__label';
    term.textContent = label;

    const definition = document.createElement('dd');
    definition.className = 'inspector-facts__value';
    definition.textContent = value;
    list.append(term, definition);
  }
  return list;
}

function openedSections(content: HTMLElement): ReadonlySet<string> {
  const open = new Set<string>();
  for (const details of content.querySelectorAll<HTMLDetailsElement>('details[data-section]')) {
    if (details.open && details.dataset.section) open.add(details.dataset.section);
  }
  return open;
}

function focusedDisclosure(content: HTMLElement): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !content.contains(active)) return null;
  if (!active.matches('summary')) return null;
  return active.closest<HTMLDetailsElement>('details[data-section]')?.dataset.section ?? null;
}

function restoreDisclosureFocus(content: HTMLElement, section: string | null): void {
  if (!section) return;
  const details = [...content.querySelectorAll<HTMLDetailsElement>('details[data-section]')].find(
    (candidate) => candidate.dataset.section === section,
  );
  details?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
}

function actionSentence(name: string, activity: ActivityKind, reason: string): string {
  if (activity === 'walking' && /^part boire\b/iu.test(reason)) {
    return `${name} cherche de l’eau`;
  }
  if (activity === 'walking' && /^part chercher de la nourriture\b/iu.test(reason)) {
    return `${name} cherche de la nourriture`;
  }
  return `${name} ${ACTIVITY_LABELS[activity]}`;
}

/** Retire les scores internes tout en conservant les souvenirs réellement transmis. */
function playerFacingReason(reason: string): string {
  const readable = reason.trim().replace(TECHNICAL_REASON_SUFFIX, '').trim();
  return readable.length > 0 ? readable : 'Motif non communiqué';
}

function summarizeState(needs: NeedsSnapshot): { label: string; tone: StateTone } {
  const entries = (Object.keys(NEED_ALERT_LABELS) as (keyof NeedsSnapshot)[]).map((key) => ({
    key,
    value: clamp01(needs[key]),
  }));
  const lowest = entries.reduce((current, candidate) =>
    candidate.value < current.value ? candidate : current,
  );

  if (lowest.value >= 0.65) return { label: 'État stable', tone: 'stable' };
  if (lowest.value >= 0.4) return { label: 'Besoins à surveiller', tone: 'warning' };
  if (lowest.value >= 0.2) {
    return { label: `${NEED_ALERT_LABELS[lowest.key]} importante`, tone: 'warning' };
  }
  return { label: `${NEED_ALERT_LABELS[lowest.key]} critique`, tone: 'critical' };
}

function needQualifier(value: number): string {
  if (value >= 0.75) return 'Niveau satisfaisant';
  if (value >= 0.5) return 'Niveau correct';
  if (value >= 0.3) return 'Niveau faible';
  return 'Niveau critique';
}

function needTone(value: number): StateTone {
  if (value >= 0.5) return 'stable';
  if (value >= 0.25) return 'warning';
  return 'critical';
}

function traitQualifier(value: number): string {
  const normalized = clamp01(value);
  if (normalized >= 0.8) return 'Niveau très élevé';
  if (normalized >= 0.6) return 'Niveau élevé';
  if (normalized >= 0.4) return 'Niveau modéré';
  if (normalized >= 0.2) return 'Niveau faible';
  return 'Niveau très faible';
}

function formatAge(ageYears: number): string {
  const age = Math.max(0, Math.floor(ageYears));
  return age === 1 ? '1 an' : `${age} ans`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
