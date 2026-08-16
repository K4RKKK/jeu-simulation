import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The architectural rules of CLAUDE.md are not documentation-only: the ones that can be
 * mechanically checked are enforced here so that a violation fails `pnpm lint`.
 */
const DETERMINISM_RULES = [
  'error',
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'CLAUDE.md rule 4: the world must be deterministic. Use a WorldRng stream or a hashed domain instead of Math.random().',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      'CLAUDE.md rule 4: simulation rules must never read wall-clock time. Use SimulationClock instead of Date.now().',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message:
      'CLAUDE.md rule 4: simulation rules must never read wall-clock time. Use SimulationClock instead of new Date().',
  },
];

const NO_RENDERING_IMPORTS = [
  'error',
  {
    patterns: [
      {
        group: ['three', 'three/*'],
        message: 'CLAUDE.md rule 2: engine packages must never depend on a rendering engine.',
      },
      {
        group: ['@civ/client', '@civ/server'],
        message: 'CLAUDE.md rule 2: engine packages must not depend on their hosts.',
      },
    ],
  },
];

const SIMULATION_DETERMINISM_RULES = {
  'no-restricted-syntax': DETERMINISM_RULES,
  'no-restricted-imports': NO_RENDERING_IMPORTS,
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '.codex-tools/**',
      'release/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: [
      'packages/simulation/**/*.ts',
      'packages/procedural/**/*.ts',
      'packages/content/**/*.ts',
    ],
    rules: SIMULATION_DETERMINISM_RULES,
  },
  {
    // Wall-clock time is allowed only where it measures or paces, never where it decides:
    // the real-time loop, the CLIs, and the instrumentation of generation cost.
    files: [
      'packages/simulation/src/cli/**/*.ts',
      'packages/simulation/src/runtime/**/*.ts',
      'packages/simulation/src/core/metrics.ts',
      'packages/procedural/src/cli/**/*.ts',
      'packages/procedural/src/chunks/chunkGenerator.ts',
      'packages/procedural/src/core/proceduralGenerator.ts',
      'packages/procedural/src/debug/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // The chunk cache measures generation time; it must not invent world state.
    files: ['apps/server/src/world/**/*.ts'],
    rules: {
      'no-restricted-imports': NO_RENDERING_IMPORTS,
    },
  },
  {
    files: ['apps/client/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@civ/simulation', '@civ/simulation/*'],
              message:
                'CLAUDE.md rule 1: the client is a viewer. It may only depend on @civ/shared (network contract).',
            },
          ],
        },
      ],
    },
  },
  {
    // The simulation receives only projections of content (e.g. foodKcal on resource
    // spawns), never the definitions themselves (CLAUDE.md rule 2).
    files: ['packages/simulation/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@civ/content', '@civ/content/*'],
              message:
                'CLAUDE.md rule 2: the simulation only receives content projections (e.g. foodKcal on resource spawns), never the definitions.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/**/*.ts', 'packages/**/*.ts', '*.js', '*.mjs', '**/*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
