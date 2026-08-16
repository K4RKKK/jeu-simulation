import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const standalone = process.argv.includes('--standalone');

/**
 * Les packages du workspace sont publiés en TypeScript source : ils doivent être
 * *inclus* dans le bundle. Toutes les autres dépendances restent externes et sont
 * résolues depuis node_modules à l'exécution.
 */
const external = standalone
  ? []
  : Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@civ/'));

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, `dist/server.${standalone ? 'cjs' : 'mjs'}`),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: standalone ? 'cjs' : 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});

process.stdout.write(`[server-build] ${standalone ? 'bundle autonome' : 'bundle standard'}\n`);
