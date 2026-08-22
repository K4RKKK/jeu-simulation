/* Configuration */
export * from './config/simulationConfig.js';
export * from './config/performanceBudgets.js';

/* Cœur */
export * from './core/clock.js';
export * from './core/componentStore.js';
export * from './core/componentType.js';
export * from './core/entityManager.js';
export * from './core/eventBus.js';
export * from './core/eventRecorder.js';
export * from './core/events.js';
export * from './core/math.js';
export * from './core/metrics.js';
export * from './core/rng.js';
export * from './core/scheduler.js';
export * from './core/system.js';

/* Monde */
export * from './world/environment.js';
export * from './world/world.js';
export * from './world/worldDelta.js';
export * from './world/resourceInteraction.js';
export * from './world/regionAggregator.js';
export * from './world/regionalWeather.js';
export * from './world/regionalEcology.js';

/* Persistance */
export * from './persistence/simulationSnapshot.js';
export * from './persistence/persistenceAdapter.js';
export * from './persistence/fileAdapter.js';
export * from './persistence/configFingerprint.js';

/* Composants et entités */
export * from './components/index.js';
export * from './humans/humanFactory.js';
export * from './humans/names.js';
export * from './cognition/experimentModel.js';
export * from './cognition/foodActionIntent.js';
export * from './cognition/skillModel.js';

/* Systèmes */
export * from './systems/movementSystem.js';
export * from './systems/resourceInteractionSystem.js';
export * from './systems/ecologySystem.js';
export * from './systems/temporary/temporaryWanderSystem.js';
export * from './systems/pathfinding/terrainCostProvider.js';

/* Racine, exécution, réseau, debug */
export * from './simulation.js';
export * from './runtime/simulationLoop.js';
export * from './net/snapshotBuilder.js';
export * from './debug/stateHash.js';
export * from './debug/describeHuman.js';
