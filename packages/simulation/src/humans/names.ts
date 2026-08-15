import type { RandomStream } from '../core/rng.js';

/**
 * Génération procédurale de noms.
 *
 * Aucun fichier de noms n'est importé : un monde préhistorique n'a pas de langue commune
 * préexistante. Ces chaînes ne sont que des **étiquettes de lecture** pour l'observateur ;
 * elles ne préjugent pas du lexique que les individus construiront quand le système de
 * langage existera.
 */

const ONSETS = [
  'k',
  'm',
  't',
  'n',
  's',
  'r',
  'l',
  'th',
  'br',
  'gr',
  'dr',
  'kh',
  'v',
  'z',
  'h',
  'p',
] as const;

const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou', 'oa'] as const;

const CODAS = ['', '', '', 'n', 'r', 'k', 's', 'l', 'm', 'th'] as const;

function syllable(rng: RandomStream): string {
  return `${rng.pick(ONSETS)}${rng.pick(NUCLEI)}${rng.pick(CODAS)}`;
}

export function generateName(rng: RandomStream): string {
  const syllableCount = rng.bool(0.6) ? 2 : 3;
  let name = '';
  for (let i = 0; i < syllableCount; i++) name += syllable(rng);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Génère `count` noms distincts. L'unicité n'est pas une règle du monde (deux individus
 * peuvent parfaitement porter le même nom) mais elle rend l'observation utilisable.
 */
export function generateDistinctNames(rng: RandomStream, count: number): string[] {
  const names = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 40;
  while (names.size < count && attempts < maxAttempts) {
    names.add(generateName(rng));
    attempts++;
  }
  // Si la génération sature, on suffixe : le déterminisme est préservé.
  let index = 1;
  while (names.size < count) names.add(`${generateName(rng)}${index++}`);
  return [...names];
}
