import { analyzeWorld, type WorldGenerationReport } from '../debug/proceduralDebugData.js';
import { ProceduralGenerator } from '../core/proceduralGenerator.js';

/**
 * Outil d'analyse de la génération procédurale.
 *
 * Régler un monde procédural « à l'œil » ne fonctionne pas : une seed peut sembler
 * excellente et masquer que 80 % des mondes sont des déserts rocheux. Cet outil produit des
 * chiffres sur une ou plusieurs seeds, et c'est sur eux que l'équilibrage se décide.
 *
 *   pnpm worldgen:test    --seed test --chunks 120
 *   pnpm worldgen:analyze --seeds 40
 */
interface Options {
  seed: string;
  chunks: number;
  seeds: number;
  help: boolean;
}

const DEFAULTS: Options = { seed: 'prehistory-01', chunks: 96, seeds: 1, help: false };

function parseArgs(argv: readonly string[]): Options {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === undefined) continue;
    const equals = raw.indexOf('=');
    const flag = equals === -1 ? raw : raw.slice(0, equals);
    const inline = equals === -1 ? undefined : raw.slice(equals + 1);

    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Option "${flag}" expects a value.`);

    switch (flag) {
      case '--seed':
      case '-s':
        options.seed = value;
        break;
      case '--chunks':
      case '-c':
        options.chunks = requirePositive(flag, value);
        break;
      case '--seeds':
        options.seeds = requirePositive(flag, value);
        break;
      default:
        throw new Error(`Unknown option "${flag}".`);
    }
  }
  return options;
}

function requirePositive(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Option "${flag}" expects a positive number, received "${value}".`);
  }
  return Math.round(parsed);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function printReport(report: WorldGenerationReport): void {
  console.log(`\nSeed: ${report.seed}   (${report.generationVersion})`);
  console.log(`Chunks analysés: ${report.chunksAnalyzed}`);
  console.log(
    `Altitude: ${report.minHeightM.toFixed(1)} m → ${report.maxHeightM.toFixed(1)} m   ` +
      `praticable: ${percent(report.walkableRatio)}`,
  );

  console.log('\nBiomes:');
  for (const [id, share] of Object.entries(report.biomeShare).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round(share * 40));
    console.log(`  ${id.padEnd(16)} ${percent(share).padStart(7)}  ${bar}`);
  }

  console.log('\nRessources (total sur les chunks analysés):');
  for (const [id, count] of Object.entries(report.resourceCounts).sort((a, b) => b[1] - a[1])) {
    const perChunk = report.chunksAnalyzed === 0 ? 0 : count / report.chunksAnalyzed;
    console.log(`  ${id.padEnd(16)} ${String(count).padStart(7)}   ${perChunk.toFixed(1)} / chunk`);
  }

  console.log('\nEau:');
  console.log(`  Lacs:     ${report.water.lakes}`);
  console.log(`  Étangs:   ${report.water.ponds}`);
  console.log(`  Rivières: ${report.water.rivers}`);
  console.log(`  Sources:  ${report.water.springs}`);
  console.log(
    `  Couverture: ${percent(report.water.coverage)}   ` +
      Object.entries(report.water.coverageByType)
        .map(([type, share]) => `${type} ${percent(share)}`)
        .join('  '),
  );

  console.log('\nCampement initial:');
  console.log(
    `  (${report.spawn.x.toFixed(1)}, ${report.spawn.z.toFixed(1)}) — ${report.spawn.biomeId}, ` +
      `eau à ${report.spawn.distanceToWaterM.toFixed(0)} m`,
  );

  console.log('\nPerformance:');
  console.log(`  Hydrologie (une fois): ${report.hydrologyMs.toFixed(1)} ms`);
  console.log(
    `  Chunk: ${report.averageChunkMs.toFixed(2)} ms en moyenne, ` +
      `${report.maxChunkMs.toFixed(2)} ms au pire`,
  );
}

function printAggregate(reports: readonly WorldGenerationReport[]): void {
  const average = (pick: (report: WorldGenerationReport) => number): number =>
    reports.reduce((sum, report) => sum + pick(report), 0) / reports.length;

  console.log(`\n=== Moyenne sur ${reports.length} seeds ===\n`);
  console.log('Biomes:');
  const biomeIds = Object.keys(reports[0]?.biomeShare ?? {});
  for (const id of biomeIds) {
    const shares = reports.map((report) => report.biomeShare[id] ?? 0);
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    console.log(
      `  ${id.padEnd(16)} ${percent(mean).padStart(7)}   ` +
        `min ${percent(Math.min(...shares))}  max ${percent(Math.max(...shares))}`,
    );
  }

  console.log('\nRessources par chunk:');
  for (const id of Object.keys(reports[0]?.resourceCounts ?? {})) {
    const mean =
      average((report) => report.resourceCounts[id] ?? 0) / (reports[0]?.chunksAnalyzed ?? 1);
    console.log(`  ${id.padEnd(16)} ${mean.toFixed(1)}`);
  }

  console.log('\nEau:');
  console.log(`  Lacs:     ${average((r) => r.water.lakes).toFixed(1)}`);
  console.log(`  Étangs:   ${average((r) => r.water.ponds).toFixed(1)}`);
  console.log(`  Rivières: ${average((r) => r.water.rivers).toFixed(1)}`);
  console.log(`  Sources:  ${average((r) => r.water.springs).toFixed(1)}`);
  console.log(`  Couverture: ${percent(average((r) => r.water.coverage))}`);
  console.log(`\nPraticable: ${percent(average((r) => r.walkableRatio))}`);

  console.log('\nCampement initial:');
  console.log(`  Eau à ${average((r) => r.spawn.distanceToWaterM).toFixed(0)} m en moyenne`);
  const biomeCounts = new Map<string, number>();
  for (const report of reports) {
    biomeCounts.set(report.spawn.biomeId, (biomeCounts.get(report.spawn.biomeId) ?? 0) + 1);
  }
  const [modalBiome, modalCount] = [...biomeCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
    '—',
    0,
  ];
  console.log(`  Biome le plus fréquent: ${modalBiome} (${modalCount}/${reports.length})`);

  console.log(
    `Chunk moyen: ${average((r) => r.averageChunkMs).toFixed(2)} ms   ` +
      `hydrologie: ${average((r) => r.hydrologyMs).toFixed(0)} ms`,
  );

  const empty = reports.filter((report) =>
    Object.values(report.water).every((value) => value === 0),
  );
  const monotone = reports.filter((report) =>
    Object.values(report.biomeShare).some((share) => share > 0.9),
  );
  console.log(`\nMondes sans eau: ${empty.length}   Mondes monobiome: ${monotone.length}`);
}

function main(argv: readonly string[]): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (options.help) {
    console.log(
      [
        'Analyse de la génération procédurale',
        '',
        '  --seed <string>   Seed à analyser (mode une seule seed)',
        '  --chunks <n>      Nombre de chunks échantillonnés par monde',
        '  --seeds <n>       Analyse n seeds dérivées et agrège les résultats',
        '  --help',
      ].join('\n'),
    );
    return 0;
  }

  if (options.seeds <= 1) {
    const generator = new ProceduralGenerator({ seed: options.seed });
    printReport(analyzeWorld(generator, { maxChunks: options.chunks }));
    return 0;
  }

  const reports: WorldGenerationReport[] = [];
  for (let i = 0; i < options.seeds; i++) {
    const seed = `${options.seed}-${i}`;
    const generator = new ProceduralGenerator({ seed });
    reports.push(analyzeWorld(generator, { maxChunks: options.chunks }));
    process.stdout.write(`\r  ${i + 1}/${options.seeds} seeds analysées…`);
  }
  process.stdout.write('\r');
  printAggregate(reports);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
