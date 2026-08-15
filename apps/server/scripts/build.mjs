import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/**
 * Les packages du workspace sont publiés en TypeScript source : ils doivent être
 * *inclus* dans le bundle. Toutes les autres dépendances restent externes et sont
 * résolues depuis node_modules à l'exécution.
 */
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@civ/'));

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
