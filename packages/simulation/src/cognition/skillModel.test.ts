import { describe, expect, it } from 'vitest';
import { createEmptyHumanSkills } from '../components/humanSkills.js';
import {
  applySkillPractice,
  consolidateSkillPractice,
  getSkillProficiency01,
  resourceGatheringDurationSeconds,
} from './skillModel.js';

describe('procedural skill model', () => {
  it('treats an absent skill as novice without preventing execution', () => {
    expect(getSkillProficiency01(createEmptyHumanSkills(), 'resource.gathering')).toBe(0);
  });

  it('learns continuously with diminishing returns', () => {
    const first = applySkillPractice(undefined, 'resource.gathering', 1, 0.04, 1);
    const advanced = applySkillPractice(
      {
        kind: 'resource.gathering',
        proficiency01: 0.9,
        practiceCount: 20,
        lastPracticedTick: 20,
      },
      'resource.gathering',
      1,
      0.04,
      21,
    );
    expect(first.proficiency01).toBe(0.04);
    expect(advanced.proficiency01 - 0.9).toBeLessThan(first.proficiency01);
  });

  it('stays clamped after extensive practice', () => {
    const skills = createEmptyHumanSkills();
    for (let tick = 0; tick < 10_000; tick++) {
      consolidateSkillPractice(skills, 'resource.gathering', 1, 0.04, tick);
    }
    expect(getSkillProficiency01(skills, 'resource.gathering')).toBeLessThanOrEqual(1);
    expect(skills.skills[0]?.practiceCount).toBe(10_000);
  });

  it('makes experts faster but never instantaneous', () => {
    const config = { noviceDurationSeconds: 8, expertDurationSeconds: 2 };
    expect(resourceGatheringDurationSeconds(0, config)).toBe(8);
    expect(resourceGatheringDurationSeconds(1, config)).toBe(2);
    expect(resourceGatheringDurationSeconds(1, config)).toBeGreaterThan(0);
  });
});
