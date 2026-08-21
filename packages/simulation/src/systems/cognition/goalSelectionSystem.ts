import {
  CognitiveKnowledge,
  CognitiveMemory,
  HumanCognition,
  Needs,
  NeedsState,
  Personality,
} from '../../components/index.js';
import type { HumanCognitionComponent, NeedsComponent } from '../../components/index.js';
import { goalForNeedsAction } from '../../cognition/goalModel.js';
import {
  buildGoalCandidates,
  candidateForKind,
  pickBestGoal,
} from '../../cognition/utilityScorer.js';
import type { GoalCandidate, GoalKind } from '../../cognition/goalModel.js';
import type { SystemFrequency } from '../../config/simulationConfig.js';
import type { SimulationSystem, SystemUpdateContext } from '../../core/system.js';

/** Choisit une intention a partir du corps et de la cognition, sans executer d'action. */
export class GoalSelectionSystem implements SimulationSystem {
  readonly name = 'GoalSelectionSystem';
  readonly frequency: SystemFrequency = 'medium';

  update(ctx: SystemUpdateContext): void {
    ctx.entities.each(
      [Needs, CognitiveMemory, CognitiveKnowledge, HumanCognition, Personality],
      (entity, needs, _memory, _knowledge, cognition, personality) => {
        const candidates = buildGoalCandidates(needs, personality, ctx.config.needs);
        const executingGoal = goalForNeedsAction(
          ctx.entities.getComponent(entity, NeedsState)?.action ?? 'none',
        );
        const winner = this.select(candidates, needs, cognition, executingGoal, ctx.tick, ctx);
        if (cognition.activeGoal === null || cognition.activeGoal.kind !== winner.kind) {
          cognition.activeGoal = { kind: winner.kind, startedAtTick: ctx.tick };
        }
        cognition.decisionReason = {
          code: `goal.select.${winner.kind}`,
          factors: [{ code: 'goal.utility', value: winner.utility }, ...winner.factors],
        };
      },
    );
  }

  private select(
    candidates: readonly GoalCandidate[],
    needs: NeedsComponent,
    cognition: HumanCognitionComponent,
    executingGoal: GoalKind | null,
    tick: number,
    ctx: SystemUpdateContext,
  ): GoalCandidate {
    const best = pickBestGoal(candidates);
    const active = cognition.activeGoal;
    if (executingGoal !== null && executingGoal === active?.kind) {
      return candidateForKind(candidates, executingGoal) ?? best;
    }
    if (active === null || active.kind === 'explore') return best;
    const current = candidateForKind(candidates, active.kind);
    if (current === null || this.isSatisfied(active.kind, needs, ctx) || best.kind === active.kind)
      return best;
    if (current.utility === 0) return best.kind === 'explore' ? current : best;

    const decision = ctx.config.needs.decision;
    const commitmentTicks = Math.ceil(
      decision.minimumGoalCommitmentSeconds / ctx.config.time.gameSecondsPerTick,
    );
    const normalThreshold = current.utility * (1 + decision.goalSwitchMargin01);
    const overrideThreshold = current.utility * decision.urgentGoalOverrideMultiplier;
    if (tick - active.startedAtTick < commitmentTicks && best.utility < overrideThreshold)
      return current;
    return best.utility > normalThreshold ? best : current;
  }

  private isSatisfied(kind: GoalKind, needs: NeedsComponent, ctx: SystemUpdateContext): boolean {
    switch (kind) {
      case 'survive.hydrate':
        return needs.hydration >= ctx.config.needs.hydration.drinkTarget;
      case 'survive.nourish':
        return needs.hunger >= ctx.config.needs.hunger.eatTarget;
      case 'survive.rest':
        return needs.energy >= ctx.config.needs.energy.restTarget;
      case 'explore':
        return true;
    }
  }
}
