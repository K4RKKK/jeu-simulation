import { createSaveEnvelope, type FilePersistenceAdapter, type Simulation } from '@civ/simulation';

interface SaveContext {
  readonly simulation: Simulation;
  readonly name: string;
  readonly label: string | undefined;
}

/** Sérialise les sauvegardes runtime sans mêler cette mécanique au cycle de vie du monde. */
export class WorldSaveCoordinator {
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly persistence: FilePersistenceAdapter | null,
    private readonly context: () => SaveContext,
  ) {}

  async save(reason: string): Promise<boolean> {
    if (this.persistence === null) return false;
    const current = this.context();
    if (this.inFlight !== null) {
      console.warn(
        `[server] sauvegarde "${current.name}" (${reason}) ignorée — une écriture précédente est encore en vol.`,
      );
      return false;
    }
    const run = this.perform(reason);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  async saveStrict(): Promise<void> {
    if (this.persistence === null) return;
    if (this.inFlight !== null) await this.inFlight;
    const current = this.context();
    const envelope = createSaveEnvelope(
      current.simulation,
      current.name,
      new Date().toISOString(),
      current.label,
    );
    await this.persistence.save(current.name, envelope);
  }

  async waitForIdle(): Promise<void> {
    if (this.inFlight !== null) await this.inFlight;
  }

  private async perform(reason: string): Promise<boolean> {
    if (this.persistence === null) return false;
    const current = this.context();
    try {
      const envelope = createSaveEnvelope(
        current.simulation,
        current.name,
        new Date().toISOString(),
        current.label,
      );
      await this.persistence.save(current.name, envelope);
      console.log(
        `[server] sauvegarde "${current.name}" écrite (${reason}) — tick ${current.simulation.clock.currentTick.toLocaleString('fr-FR')}`,
      );
      return true;
    } catch (error) {
      console.error(
        `[server] échec de la sauvegarde "${current.name}" (${reason}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
