import { defineComponent } from '../core/componentType.js';

export type SkillKind = 'resource.gathering';

export interface SkillState {
  readonly kind: SkillKind;
  proficiency01: number;
  practiceCount: number;
  lastPracticedTick: number;
}

export interface HumanSkillsComponent {
  skills: SkillState[];
}

export const HumanSkills = defineComponent<HumanSkillsComponent>('HumanSkills');

export function createEmptyHumanSkills(): HumanSkillsComponent {
  return { skills: [] };
}
