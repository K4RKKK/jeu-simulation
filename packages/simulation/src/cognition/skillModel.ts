import type { HumanSkillsComponent, SkillKind, SkillState } from '../components/humanSkills.js';

export function getSkillProficiency01(component: HumanSkillsComponent, kind: SkillKind): number {
  return component.skills.find((skill) => skill.kind === kind)?.proficiency01 ?? 0;
}

/** Pure procedural learning with continuous diminishing returns and no levels. */
export function applySkillPractice(
  current: SkillState | undefined,
  kind: SkillKind,
  practiceQuality01: number,
  learningRate: number,
  practicedAtTick: number,
): SkillState {
  const proficiency01 = clamp01(current?.proficiency01 ?? 0);
  const gain = clamp01(learningRate) * clamp01(practiceQuality01) * (1 - proficiency01);
  return {
    kind,
    proficiency01: clamp01(proficiency01 + gain),
    practiceCount: (current?.practiceCount ?? 0) + 1,
    lastPracticedTick: practicedAtTick,
  };
}

export function consolidateSkillPractice(
  component: HumanSkillsComponent,
  kind: SkillKind,
  practiceQuality01: number,
  learningRate: number,
  practicedAtTick: number,
): void {
  const index = component.skills.findIndex((skill) => skill.kind === kind);
  const next = applySkillPractice(
    index < 0 ? undefined : component.skills[index],
    kind,
    practiceQuality01,
    learningRate,
    practicedAtTick,
  );
  if (index < 0) {
    component.skills.push(next);
    component.skills.sort((a, b) => a.kind.localeCompare(b.kind));
  } else {
    component.skills[index] = next;
  }
}

export function resourceGatheringDurationSeconds(
  proficiency01: number,
  config: { noviceDurationSeconds: number; expertDurationSeconds: number },
): number {
  const proficiency = clamp01(proficiency01);
  return (
    config.noviceDurationSeconds +
    (config.expertDurationSeconds - config.noviceDurationSeconds) * proficiency
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
