export interface CliOptions {
  seed: string;
  population: number;
  days: number;
  /** Secondes de jeu par tick. Voir `run.ts` pour la raison du défaut headless. */
  tickSeconds: number;
  /** Nombre d'individus détaillés en fin de run. */
  inspect: number;
  quiet: boolean;
  help: boolean;
  /** Dossier de sauvegardes — requis pour `--save-to`/`--load-from`. */
  saveDir: string;
  /** Nom de sauvegarde à écrire en fin de run, s'il est défini. */
  saveTo: string | null;
  /** Nom de sauvegarde à charger avant de reprendre la simulation. */
  loadFrom: string | null;
}

export const CLI_DEFAULTS: CliOptions = {
  seed: 'prehistory-01',
  population: 15,
  days: 1,
  tickSeconds: 1,
  inspect: 3,
  quiet: false,
  help: false,
  saveDir: '.saves',
  saveTo: null,
  loadFrom: null,
};

const NUMERIC_FLAGS = ['population', 'days', 'tickSeconds', 'inspect'] as const;
type NumericFlag = (typeof NUMERIC_FLAGS)[number];

const STRING_FLAGS = ['saveDir', 'saveTo', 'loadFrom'] as const;
type StringFlag = (typeof STRING_FLAGS)[number];

const FLAG_ALIASES: Record<string, keyof CliOptions> = {
  '--seed': 'seed',
  '-s': 'seed',
  '--population': 'population',
  '-p': 'population',
  '--days': 'days',
  '-d': 'days',
  '--tick-seconds': 'tickSeconds',
  '--inspect': 'inspect',
  '--quiet': 'quiet',
  '-q': 'quiet',
  '--help': 'help',
  '-h': 'help',
  '--save-dir': 'saveDir',
  '--save-to': 'saveTo',
  '--load-from': 'loadFrom',
};

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { ...CLI_DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === undefined) continue;

    // Accepte `--seed=test` autant que `--seed test`.
    const equalsIndex = raw.indexOf('=');
    const flag = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);

    const key = FLAG_ALIASES[flag];
    if (!key) throw new Error(`Unknown option "${flag}". Use --help to list available options.`);

    if (key === 'quiet' || key === 'help') {
      options[key] = true;
      continue;
    }

    const value = inlineValue ?? argv[++i];
    if (value === undefined) throw new Error(`Option "${flag}" expects a value.`);

    if (key === 'seed') {
      options.seed = value;
      continue;
    }

    if ((STRING_FLAGS as readonly string[]).includes(key)) {
      options[key as StringFlag] = value;
      continue;
    }

    // `--inspect 0` est un choix légitime (« n'affiche aucun individu ») ; les autres
    // options numériques décrivent des quantités qui n'ont pas de sens à zéro.
    const allowsZero = key === 'inspect';
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || (!allowsZero && numeric === 0)) {
      throw new Error(
        `Option "${flag}" expects a ${allowsZero ? 'non-negative' : 'positive'} number, received "${value}".`,
      );
    }
    assignNumeric(options, key, numeric);
  }

  return options;
}

function assignNumeric(options: CliOptions, key: keyof CliOptions, value: number): void {
  if (!(NUMERIC_FLAGS as readonly string[]).includes(key)) {
    throw new Error(`Option "${key}" is not numeric.`);
  }
  options[key as NumericFlag] = key === 'tickSeconds' ? value : Math.round(value);
}

export const CLI_HELP = `
Simulation headless — moteur de civilisation émergente

Usage:
  pnpm sim:run [options]

Options:
  -s, --seed <string>       Seed du monde              (défaut: ${CLI_DEFAULTS.seed})
  -p, --population <n>      Population initiale        (défaut: ${CLI_DEFAULTS.population})
  -d, --days <n>            Jours de jeu à simuler     (défaut: ${CLI_DEFAULTS.days})
      --tick-seconds <n>    Secondes de jeu par tick   (défaut: ${CLI_DEFAULTS.tickSeconds})
      --inspect <n>         Individus détaillés en fin de run (défaut: ${CLI_DEFAULTS.inspect})
      --save-dir <path>     Dossier de sauvegardes         (défaut: ${CLI_DEFAULTS.saveDir})
      --save-to <name>      Sauvegarde le monde sous ce nom en fin de run
      --load-from <name>    Reprend une sauvegarde avant de simuler
  -q, --quiet               N'affiche que le rapport final
  -h, --help                Affiche cette aide

Exemple:
  pnpm sim:run --seed test --population 20 --days 10
  pnpm sim:run --load-from world-1 --days 5 --save-to world-1
`.trim();
