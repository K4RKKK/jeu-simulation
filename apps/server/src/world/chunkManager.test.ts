import { describe, expect, it } from 'vitest';
import { Simulation } from '@civ/simulation';
import { ChunkManager } from './chunkManager.js';

function makeSimulation(): Simulation {
  return new Simulation({
    seed: 'chunk-manager-tests',
    population: 0,
    spawnInitialPopulation: false,
    config: { time: { gameSecondsPerTick: 1 } },
    systems: [],
  });
}

describe('ChunkManager', () => {
  /**
   * Bug historique : un chunk demandé Actif alors qu'il n'était pas encore généré
   * restait `Loaded` après la génération, car `setActive` supposait qu'un
   * `activeKeys.has(key)` valait « déjà Actif » et sautait la promotion. Ce test
   * verrouille : après pump(), le chunk doit être `Active`.
   */
  it('promeut un chunk à Active dès sa génération quand il était déjà désiré actif', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000, maxCached: 32 });

    manager.setActive(['0:0']); // désir posé AVANT la génération
    expect(manager.stateOf('0:0')).toBe('Unloaded');

    manager.request({ x: 0, z: 0 });
    manager.pump();

    // Sans le fix : 'Loaded'. Avec : 'Active'.
    expect(manager.stateOf('0:0')).toBe('Active');
    simulation.dispose();
  });

  /**
   * Un chunk qui n'était pas dans la zone active se contente d'être `Loaded` après
   * génération — le contraire du cas précédent, pour ne pas casser le cas nominal.
   */
  it('laisse un chunk généré à Loaded quand il n’est pas désiré actif', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });

    manager.request({ x: 1, z: 1 });
    manager.pump();

    expect(manager.stateOf('1:1')).toBe('Loaded');
    simulation.dispose();
  });

  /**
   * Bug historique : `payloadFor` balayait toutes les ressources du chunk à CHAQUE
   * appel, même sur un chunk non affecté, dès qu'une mutation avait eu lieu ailleurs
   * dans le monde. Après la première réécriture, l'entrée `data` contenait encore la
   * ressource supprimée, donc le balayage continuait à la détecter et à réécrire.
   *
   * Correction : la revision du delta est mémorisée dans l'entrée ; tant qu'elle n'a
   * pas bougé, on renvoie le payload en cache sans balayage.
   */
  it('réutilise le payload en cache tant que le WorldDelta n’a pas changé', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });
    manager.request({ x: 0, z: 0 });
    manager.pump();

    const first = manager.payloadFor('0:0');
    expect(first).not.toBeNull();
    // Deux appels consécutifs sans mutation → même référence de payload.
    expect(manager.payloadFor('0:0')).toBe(first);
    expect(manager.payloadFor('0:0')).toBe(first);
    simulation.dispose();
  });

  /**
   * Une mutation qui NE concerne PAS un chunk ne le touche même pas : sa révision
   * (tenue PAR CHUNK) ne bouge pas, le payload garde la même identité de référence.
   */
  it('ne réencode pas un chunk quand la mutation concerne un autre chunk', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });
    manager.request({ x: 0, z: 0 });
    manager.pump();
    const before = manager.payloadFor('0:0');

    // Mutation sur un id qui n'appartient PAS à ce chunk.
    simulation.world.delta.markDepleted('id-inconnu-hors-chunk', '99:99', 0, 0);

    const after = manager.payloadFor('0:0');
    expect(after).toBe(before); // même référence : pas de réencodage
    simulation.dispose();
  });

  /**
   * Une mutation qui touche une ressource du chunk provoque un réencodage — mais
   * un seul, pas un par appel. Le test suivant vérifie que deux appels consécutifs
   * après la même mutation renvoient le même nouveau payload.
   */
  it('réencode UNE fois quand une ressource du chunk est retirée, puis réutilise', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });
    manager.request({ x: 0, z: 0 });
    manager.pump();

    const initial = manager.payloadFor('0:0')!;
    const originalCount = initial.resources.count;
    if (originalCount === 0) {
      // Chunk sans ressources — cas non pertinent pour ce test, on abandonne poliment.
      simulation.dispose();
      return;
    }

    // On retire une des ressources du chunk (par son id réel, tel qu'il est apparu dans
    // les données procédurales).
    const chunkData = simulation.world.generateChunk({ x: 0, z: 0 });
    const victim = chunkData.resources[0]!;
    simulation.world.delta.markDepleted(victim.id, victim.ownerChunkKey, victim.localId, 0);

    const reencoded = manager.payloadFor('0:0')!;
    expect(reencoded).not.toBe(initial); // référence différente : réencodage
    expect(reencoded.resources.count).toBe(originalCount - 1);

    // Second appel sans nouvelle mutation → même référence, pas de deuxième réencodage.
    expect(manager.payloadFor('0:0')).toBe(reencoded);
    expect(manager.payloadFor('0:0')).toBe(reencoded);
    simulation.dispose();
  });

  /**
   * Hystérésis : un chunk sortant de la zone active ne redevient pas Loaded tant que
   * la période de grâce n'est pas écoulée. S'il rentre à nouveau pendant la grâce, la
   * démotion est annulée sans émettre ChunkLoaded (il ne l'a jamais quitté).
   */
  it('applique une grâce avant de démoter un chunk sortant', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000, activeGraceTicks: 3 });
    manager.request({ x: 0, z: 0 });
    manager.pump();
    manager.setActive(['0:0']);
    expect(manager.stateOf('0:0')).toBe('Active');

    // Sortie de la zone active : la grâce commence, l'état reste Active.
    manager.setActive([]);
    expect(manager.stateOf('0:0')).toBe('Active');

    // Retour dans la zone active avant expiration : la grâce est annulée.
    manager.setActive(['0:0']);
    expect(manager.stateOf('0:0')).toBe('Active');
    simulation.dispose();
  });

  describe('sentiers (trails)', () => {
    it('omet `trails` du payload pour un chunk jamais foulé', () => {
      const simulation = makeSimulation();
      const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });
      manager.request({ x: 0, z: 0 });
      manager.pump();

      const payload = manager.payloadFor('0:0')!;
      expect(payload.trails).toBeUndefined();
      simulation.dispose();
    });

    it('inclut `trails` en représentation creuse dès qu’une cellule a de l’usure visible', () => {
      const simulation = makeSimulation();
      const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });
      manager.request({ x: 0, z: 0 });
      manager.pump();

      const resolution = Math.round(
        simulation.world.chunkSizeMeters / simulation.config.movement.trailCellMeters,
      );
      simulation.world.delta.addTrailWear('0:0', resolution, 5, 1); // usure maximale

      const payload = manager.payloadFor('0:0')!;
      expect(payload.trails).toEqual({ resolution, cells: [{ index: 5, wear: 255 }] });
      simulation.dispose();
    });
  });

  it('démote effectivement après l’expiration de la grâce', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000, activeGraceTicks: 2 });
    manager.request({ x: 0, z: 0 });
    manager.pump();
    manager.setActive(['0:0']);

    // Sortie de la zone active — tick 0 dans la simulation.
    manager.setActive([]);
    expect(manager.stateOf('0:0')).toBe('Active');

    // On avance l'horloge au-delà de la grâce (grace = 2, on avance de 3 ticks).
    simulation.step(3);
    manager.setActive([]); // déclenche expireGracePeriods
    expect(manager.stateOf('0:0')).toBe('Loaded');
    simulation.dispose();
  });

  /**
   * Bug corrigé : `WorldDelta.apply()` filtrait déjà les ressources `depleted`/`removed`
   * d'un chunk fraîchement généré, mais ne réappliquait jamais les `changedFields` d'une
   * ressource `modified` (récolte partielle, voir `World.harvestResource`) — un buisson
   * partiellement récolté redevenait visuellement neuf après une éviction de chunk
   * (`ChunkManager.clear()`, l'équivalent serveur d'une reconnexion côté client).
   */
  it('réinjecte l’état `modified` d’une ressource récoltée partiellement, y compris après éviction du chunk', () => {
    const simulation = makeSimulation();
    const manager = new ChunkManager(simulation, { budgetMsPerPass: 1000 });
    manager.request({ x: 0, z: 0 });
    manager.pump();

    const initial = manager.payloadFor('0:0')!;
    if (initial.resources.count === 0) {
      simulation.dispose();
      return;
    }

    const chunkData = simulation.world.generateChunk({ x: 0, z: 0 });
    const victim = chunkData.resources[0]!;
    simulation.world.harvestResource(
      victim.id,
      victim.ownerChunkKey,
      victim.localId,
      3,
      victim.x,
      victim.z,
      0,
    );

    const afterHarvest = manager.payloadFor('0:0')!;
    expect(afterHarvest.resourceStates).toEqual([
      { localId: victim.localId, changedFields: { remainingFraction01: 2 / 3 } },
    ]);

    // Éviction complète du chunk (comme une reconnexion côté client) : la régénération
    // doit repartir de `WorldDelta`, pas de la génération procédurale brute.
    manager.clear();
    manager.request({ x: 0, z: 0 });
    manager.pump();

    const reloaded = manager.payloadFor('0:0')!;
    expect(reloaded.resourceStates).toEqual([
      { localId: victim.localId, changedFields: { remainingFraction01: 2 / 3 } },
    ]);
    simulation.dispose();
  });
});
