import { ProceduralGenerator } from '@civ/procedural';
import { checkPerformanceBudgets, DEFAULT_PERFORMANCE_BUDGETS } from '../config/performanceBudgets.js';
import { concludeStress, heapUsedMb, parseNumericFlags } from './stressArgs.js';

/**
 * `pnpm stress:worldgen` — génération procédurale sous charge.
 *
 * Vise, pour chaque seed et chaque chunk généré :
 * - déterminisme bit-à-bit : deux générateurs indépendants sur la même seed produisent
 *   des grilles de terrain identiques (le protocole réseau compare les octets encodés) ;
 * - aucune valeur `NaN`/`Infinity` dans les hauteurs (hors sentinelle `NaN` volontaire
 *   de `waterHeights` là où il n'y a pas d'eau) ;
 * - aucun identifiant de ressource dupliqué à l'intérieur d'un chunk ;
 * - `localId` de chaque ressource unique et dans `[0, count)`.
 *
 * Cahier des charges : 100 seeds. Par défaut ce script en fait beaucoup moins pour
 * rester rapide en usage courant — monter `--seeds 100 --chunks 96` pour la charge
 * complète (plusieurs minutes).
 */
const DEFAULTS = { seeds: 20, chunks: 24, seedOffset: 0 };

function main(argv: readonly string[]): number {
  let options;
  try {
    options = parseNumericFlags(argv, DEFAULTS);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (options.help) {
    console.log(
      'stress:worldgen — [--seeds n] [--chunks n] [--seedOffset n]\n' +
        `  défauts: seeds=${DEFAULTS.seeds} chunks=${DEFAULTS.chunks}`,
    );
    return 0;
  }

  const anomalies: string[] = [];
  let chunksChecked = 0;
  let resourcesChecked = 0;
  const generationMsSamples: number[] = [];
  const startedAt = performance.now();
  const startHeap = heapUsedMb();

  for (let s = 0; s < options.seeds; s++) {
    const seed = `stress-worldgen-${options.seedOffset + s}`;
    const generatorA = new ProceduralGenerator({ seed });
    const generatorB = new ProceduralGenerator({ seed });
    const coordinates = generatorA.bounds.allChunks().slice(0, options.chunks);

    for (const coordinate of coordinates) {
      const chunkA = generatorA.generateChunk(coordinate);
      const chunkB = generatorB.generateChunk(coordinate);
      chunksChecked++;
      generationMsSamples.push(chunkA.generationMs);

      // Déterminisme : deux instances indépendantes de la même seed doivent produire
      // des octets identiques pour ce chunk.
      if (!terrainBytesEqual(chunkA, chunkB)) {
        anomalies.push(`${seed} ${chunkA.key}: terrain non déterministe entre deux générateurs`);
      }
      if (chunkA.resources.length !== chunkB.resources.length) {
        anomalies.push(`${seed} ${chunkA.key}: nombre de ressources différent entre deux générateurs`);
      }

      // NaN / Infinity dans les hauteurs.
      for (let i = 0; i < chunkA.terrain.heights.length; i++) {
        const height = chunkA.terrain.heights[i] as number;
        if (!Number.isFinite(height)) {
          anomalies.push(`${seed} ${chunkA.key}: heights[${i}] non fini (${height})`);
          break;
        }
        const water = chunkA.terrain.waterHeights[i] as number;
        if (!Number.isNaN(water) && !Number.isFinite(water)) {
          anomalies.push(`${seed} ${chunkA.key}: waterHeights[${i}] non fini (${water})`);
          break;
        }
      }

      // Identifiants de ressources : uniques, et localId = 0..count-1 sans trou.
      const seenIds = new Set<string>();
      const seenLocalIds = new Set<number>();
      for (const spawn of chunkA.resources) {
        resourcesChecked++;
        if (seenIds.has(spawn.id)) {
          anomalies.push(`${seed} ${chunkA.key}: id de ressource dupliqué "${spawn.id}"`);
        }
        seenIds.add(spawn.id);
        if (seenLocalIds.has(spawn.localId)) {
          anomalies.push(`${seed} ${chunkA.key}: localId dupliqué ${spawn.localId}`);
        }
        seenLocalIds.add(spawn.localId);
        if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y) || !Number.isFinite(spawn.z)) {
          anomalies.push(`${seed} ${chunkA.key}: position non finie pour ${spawn.id}`);
        }
      }
      const expectedLocalIds = new Set(Array.from({ length: chunkA.resources.length }, (_, i) => i));
      if (
        seenLocalIds.size !== expectedLocalIds.size ||
        [...expectedLocalIds].some((id) => !seenLocalIds.has(id))
      ) {
        anomalies.push(`${seed} ${chunkA.key}: localId hors de [0, count) ou avec trous`);
      }
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const generationP95 = percentile(generationMsSamples, 0.95);
  const violations = checkPerformanceBudgets({ chunkGenerationMsP95: generationP95 });
  for (const v of violations) {
    anomalies.push(
      `budget dépassé: ${v.metric} = ${v.measured.toFixed(2)}ms > ${v.budget}ms (voir performanceBudgets.ts)`,
    );
  }

  return concludeStress(
    'stress:worldgen',
    { anomalies },
    [
      `seeds=${options.seeds} chunks/seed=${options.chunks} chunks_total=${chunksChecked} resources_total=${resourcesChecked}`,
      `durée: ${(elapsedMs / 1000).toFixed(1)} s (${(elapsedMs / chunksChecked).toFixed(2)} ms/chunk moyenne, p95=${generationP95.toFixed(2)} ms)`,
      `budget: chunkGenerationMsP95≤${DEFAULT_PERFORMANCE_BUDGETS.chunkGenerationMsP95}ms`,
      `tas JS: ${startHeap} Mo → ${heapUsedMb()} Mo`,
    ],
  );
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function terrainBytesEqual(
  a: ReturnType<ProceduralGenerator['generateChunk']>,
  b: ReturnType<ProceduralGenerator['generateChunk']>,
): boolean {
  if (a.terrain.heights.length !== b.terrain.heights.length) return false;
  for (let i = 0; i < a.terrain.heights.length; i++) {
    if (a.terrain.heights[i] !== b.terrain.heights[i]) return false;
  }
  for (let i = 0; i < a.terrain.colors.length; i++) {
    if (a.terrain.colors[i] !== b.terrain.colors[i]) return false;
  }
  return true;
}

process.exitCode = main(process.argv.slice(2));
