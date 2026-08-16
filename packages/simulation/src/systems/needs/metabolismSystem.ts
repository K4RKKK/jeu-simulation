import type { ActivityKind } from '@civ/shared';
import { Activity, Needs, NeedsState, Transform } from '../../components/index.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import { clamp01, inverseLerp } from '../../core/math.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';

/**
 * Fait évoluer les besoins vitaux au fil du temps (CLAUDE.md règle 7 : une responsabilité).
 *
 * Ce système ne décide **rien** : il applique la physiologie. Les drains sont des taux par
 * seconde de jeu multipliés par `deltaGameSeconds`, donc indépendants de la fréquence
 * d'exécution. L'activité courante est lue (marcher coûte, se reposer récupère) ; le
 * `NeedSatisfactionSystem`, lui, décide de l'activité.
 */
export class MetabolismSystem implements SimulationSystem {
  readonly name = 'MetabolismSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    const dt = ctx.deltaGameSeconds;
    if (dt <= 0) return;
    const needs = ctx.config.needs;

    ctx.entities.each([Needs, Activity, Transform], (_entity, body, activity, transform) => {
      const rate = body.metabolismRate;
      const state = ctx.entities.getComponent(_entity, NeedsState);

      // La chaleur du lieu (climat procédural) accélère la perte d'eau : un corps au
      // soleil transpire, un corps sous la pluie des hauteurs, non.
      const heat = clamp01(
        inverseLerp(
          needs.hydration.heatStartTemperature01,
          1,
          ctx.world.terrain.sampleTemperature(transform.x, transform.z),
        ),
      );
      body.hydration = clamp01(
        body.hydration -
          needs.hydration.drainPerSecond *
            rate *
            (1 + heat * needs.hydration.heatDrainMultiplier) *
            dt,
      );

      // Symptômes d'une ingestion toxique : ce qui a été mangé ne peut plus être
      // désavoué — le corps paie (vomissements, déshydratation). Proportionnel à la
      // toxicité absorbée, borné à la durée prescrite par la configuration.
      if (state && ctx.tick <= state.poisoningUntilTick && state.poisoningToxicity01 > 0) {
        body.hydration = clamp01(
          body.hydration - needs.toxicity.hydrationDrainPerSecond * state.poisoningToxicity01 * dt,
        );
      }

      const walking = activity.kind === 'walking';
      body.hunger = clamp01(
        body.hunger -
          needs.hunger.drainPerSecond *
            rate *
            (walking ? needs.hunger.walkingDrainMultiplier : 1) *
            dt,
      );

      this.applyEnergy(ctx, body, activity.kind, rate, dt);

      // Recharges actives : boire et manger remplissent leur besoin.
      if (activity.kind === 'drink') {
        body.hydration = clamp01(body.hydration + needs.hydration.drinkRatePerSecond * rate * dt);
      } else if (activity.kind === 'eat') {
        const rawGain = needs.hunger.eatRatePerSecond * rate * dt;
        // Bug corrigé : sans ce plafond, `eatRatePerSecond` seul décidait du gain —
        // une baie de 40 kcal et un repas de 600 kcal remplissaient la faim presque
        // pareil, tant que l'activité durait assez longtemps. `mealMaxGain` (posé par
        // `NeedSatisfactionSystem` depuis `foodKcal / kcalPerFullMeal` au moment de
        // commencer à manger) borne strictement ce qu'UNE ressource donnée peut
        // apporter, quelle que soit la durée de l'activité — y compris quand
        // `minEatSeconds` forcerait autrement une activité plus longue que ce que la
        // ressource justifie.
        const gain = state ? Math.min(rawGain, Math.max(0, state.mealMaxGain)) : rawGain;
        body.hunger = clamp01(body.hunger + gain);
        if (state) state.mealMaxGain -= gain;
      }
    });
  }

  private applyEnergy(
    ctx: SystemUpdateContext,
    body: { energy: number },
    kind: ActivityKind,
    rate: number,
    dt: number,
  ): void {
    const energy = ctx.config.needs.energy;
    switch (kind) {
      case 'rest':
        body.energy = clamp01(body.energy + energy.recoveryPerSecond * rate * dt);
        return;
      case 'walking':
        body.energy = clamp01(body.energy - energy.drainPerSecond * rate * dt);
        return;
      default: {
        // Immobile la nuit, un humain dort : la récupération est la raison d'être du repos
        // nocturne que le wander impose aux prudents.
        const isNight = !ctx.world.environment.sample(ctx.clock).isDaytime;
        if (kind === 'idle' && isNight) {
          body.energy = clamp01(
            body.energy + energy.recoveryPerSecond * energy.nightIdleRecoveryRatio * rate * dt,
          );
          return;
        }
        body.energy = clamp01(
          body.energy - energy.drainPerSecond * energy.idleDrainRatio * rate * dt,
        );
      }
    }
  }
}
