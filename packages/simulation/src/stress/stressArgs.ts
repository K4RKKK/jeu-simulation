/**
 * Analyse d'arguments minimale, partagée par les scripts `stress:*`.
 *
 * Ces scripts ne font pas partie de l'API du package (pas exportés depuis `index.ts`,
 * comme `cli/`) : ce sont des outils d'exécution manuelle, jamais importés par la
 * simulation elle-même.
 */
export function parseNumericFlags<K extends string>(
  argv: readonly string[],
  defaults: Record<K, number>,
  aliases: Partial<Record<string, K>> = {},
): Record<K, number> & { help: boolean } {
  const numeric: Record<K, number> = { ...defaults };
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === undefined) continue;
    if (raw === '--help' || raw === '-h') {
      help = true;
      continue;
    }
    const equals = raw.indexOf('=');
    const flag = equals === -1 ? raw : raw.slice(0, equals);
    const inline = equals === -1 ? undefined : raw.slice(equals + 1);
    const key = (aliases[flag] ?? flag.replace(/^--/, '')) as K;
    if (!(key in defaults)) throw new Error(`Unknown option "${flag}".`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Option "${flag}" expects a value.`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Option "${flag}" expects a non-negative number, received "${value}".`);
    }
    numeric[key] = parsed;
  }

  return { ...numeric, help };
}

export function heapUsedMb(): number {
  return Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10;
}

export interface StressReport {
  anomalies: string[];
}

/** Résumé pass/fail terminal, avec code de sortie cohérent pour un usage en CI. */
export function concludeStress(title: string, report: StressReport, extra: string[] = []): number {
  console.log(`\n=== ${title} ===`);
  for (const line of extra) console.log(`  ${line}`);
  if (report.anomalies.length === 0) {
    console.log(`\n✓ Aucune anomalie détectée.`);
    return 0;
  }
  console.log(`\n✗ ${report.anomalies.length} anomalie(s) détectée(s) :`);
  for (const anomaly of report.anomalies.slice(0, 50)) console.log(`  - ${anomaly}`);
  if (report.anomalies.length > 50) console.log(`  … et ${report.anomalies.length - 50} autres.`);
  return 1;
}

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
