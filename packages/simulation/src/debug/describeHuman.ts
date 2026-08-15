import type { EntityId } from '@civ/shared';
import { Activity, Human, Movement, Needs, Personality, Transform } from '../components/index.js';
import { distance2D } from '../core/math.js';
import type { Simulation } from '../simulation.js';

/**
 * Description lisible d'un individu (CLAUDE.md règle 12 : toute décision doit être
 * explicable). Utilisée par le CLI headless ; le client reçoit les mêmes informations via
 * le snapshot et les affiche dans son inspecteur.
 */
export function describeHuman(simulation: Simulation, entity: EntityId): string {
  const human = simulation.entities.getComponent(entity, Human);
  const transform = simulation.entities.getComponent(entity, Transform);
  const movement = simulation.entities.getComponent(entity, Movement);
  const activity = simulation.entities.getComponent(entity, Activity);
  const personality = simulation.entities.getComponent(entity, Personality);
  const needs = simulation.entities.getComponent(entity, Needs);

  if (!human || !transform || !movement || !activity || !personality || !needs) {
    return `#${entity} (entité incomplète)`;
  }

  const position = `(${transform.x.toFixed(1)}, ${transform.z.toFixed(1)})`;
  const destination =
    movement.targetX !== null && movement.targetZ !== null
      ? ` → (${movement.targetX.toFixed(1)}, ${movement.targetZ.toFixed(1)}) ` +
        `à ${distance2D(transform.x, transform.z, movement.targetX, movement.targetZ).toFixed(1)} m`
      : '';

  // Température ressentie sur place : le climat procédural module la température globale
  // selon l'altitude et la latitude simulée du lieu.
  const felt = simulation.world.environment.sample(simulation.clock, transform.x, transform.z);

  return (
    `#${entity} ${human.name} — ${human.sex === 'male' ? 'H' : 'F'} ${human.ageYears} ans, ` +
    `${human.heightM.toFixed(2)} m / ${human.massKg.toFixed(0)} kg\n` +
    `    position ${position}${destination}\n` +
    `    ambiance : ${felt.ambientTemperatureC.toFixed(1)} °C (${felt.season})\n` +
    `    besoins : hydratation ${needs.hydration.toFixed(2)}, faim ${needs.hunger.toFixed(2)}, ` +
    `énergie ${needs.energy.toFixed(2)}\n` +
    `    activité : ${activity.kind} — ${activity.reason}\n` +
    `    personnalité : curiosité ${personality.curiosity.toFixed(2)}, ` +
    `prudence ${personality.caution.toFixed(2)}, patience ${personality.patience.toFixed(2)}, ` +
    `sociabilité ${personality.sociability.toFixed(2)}`
  );
}
