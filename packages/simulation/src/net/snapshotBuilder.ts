import type { EntityId, HumanProfile, HumanState } from '@civ/shared';
import { Activity, Human, Movement, Needs, Personality, Transform } from '../components/index.js';
import type { NetworkConfig } from '../config/simulationConfig.js';
import { quantize } from '../core/math.js';
import type { Simulation } from '../simulation.js';

/**
 * Traduction état interne → contrat réseau.
 *
 * Ce module est la frontière : au-dessus, des composants ECS mutables ; en dessous, des
 * objets figés et quantifiés. Le client ne voit jamais la représentation interne, ce qui
 * permet de la refondre (tableaux typés, SoA) sans casser le protocole.
 */

export function buildHumanProfile(simulation: Simulation, entity: EntityId): HumanProfile | null {
  const human = simulation.entities.getComponent(entity, Human);
  const movement = simulation.entities.getComponent(entity, Movement);
  const personality = simulation.entities.getComponent(entity, Personality);
  if (!human || !movement || !personality) return null;

  return {
    id: entity,
    name: human.name,
    sex: human.sex,
    ageYears: human.ageYears,
    heightM: human.heightM,
    massKg: human.massKg,
    tint: human.tint,
    walkSpeedMps: movement.walkSpeedMps,
    personality: { ...personality },
    bornAtTick: human.bornAtTick,
  };
}

export function buildHumanProfiles(simulation: Simulation): HumanProfile[] {
  const profiles: HumanProfile[] = [];
  for (const entity of simulation.entities.query(Human)) {
    const profile = buildHumanProfile(simulation, entity);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

export function buildHumanState(
  simulation: Simulation,
  entity: EntityId,
  network: NetworkConfig,
): HumanState | null {
  const transform = simulation.entities.getComponent(entity, Transform);
  const movement = simulation.entities.getComponent(entity, Movement);
  const activity = simulation.entities.getComponent(entity, Activity);
  const needs = simulation.entities.getComponent(entity, Needs);
  if (!transform || !movement || !activity || !needs) return null;

  const { positionDecimals, angleDecimals } = network;
  return {
    id: entity,
    x: quantize(transform.x, positionDecimals),
    y: quantize(transform.y, positionDecimals),
    z: quantize(transform.z, positionDecimals),
    yaw: quantize(transform.yaw, angleDecimals),
    speed: quantize(movement.currentSpeedMps, 2),
    activity: activity.kind,
    reason: activity.reason,
    targetX: movement.targetX === null ? null : quantize(movement.targetX, positionDecimals),
    targetZ: movement.targetZ === null ? null : quantize(movement.targetZ, positionDecimals),
    needs: {
      hydration: quantize(needs.hydration, 2),
      hunger: quantize(needs.hunger, 2),
      energy: quantize(needs.energy, 2),
    },
  };
}

export function buildHumanStates(simulation: Simulation): HumanState[] {
  const network = simulation.config.network;
  const states: HumanState[] = [];
  for (const entity of simulation.entities.query(Human)) {
    const state = buildHumanState(simulation, entity, network);
    if (state) states.push(state);
  }
  return states;
}

/** Comparaison structurelle utilisée pour n'envoyer que ce qui a réellement changé. */
export function humanStateEquals(a: HumanState, b: HumanState): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.yaw === b.yaw &&
    a.speed === b.speed &&
    a.activity === b.activity &&
    a.reason === b.reason &&
    a.targetX === b.targetX &&
    a.targetZ === b.targetZ &&
    a.needs.hydration === b.needs.hydration &&
    a.needs.hunger === b.needs.hunger &&
    a.needs.energy === b.needs.energy
  );
}
