/**
 * Empreinte canonique de la configuration d'une simulation.
 *
 * Problème résolu : le modèle de persistance annoncé est « état = seed + version de
 * génération + configuration ». Mais avant ce module, la configuration n'entrait dans
 * le snapshot que par son EFFET (les valeurs déjà écrites dans les composants), jamais
 * par sa propre identité. Charger une sauvegarde faite avec `walkSpeedMps = 1.4` dans
 * un serveur reconfiguré à `1.8` — même seed, même `generationVersion` si on a oublié
 * de la bumper — était accepté silencieusement : le monde rechargé aurait des règles
 * différentes de celui qui a produit la sauvegarde.
 *
 * `generationVersion` (déjà existant, côté `@civ/procedural`) reste la référence pour
 * un changement de l'ALGORITHME de génération (terrain, biomes, ressources) — un humain
 * qui touche à ce code doit continuer à la bumper à la main, la convention ne change
 * pas. `computeConfigFingerprint` complète : il couvre AUTOMATIQUEMENT toute la
 * `SimulationConfig` pertinente (vitesse de marche, taille de tuile de pathfinding,
 * seuils de besoins, usure des sentiers…) ET, depuis la v6 du snapshot, les PARAMÈTRES
 * de génération procédurale (`WorldGenerationConfig`) et le contenu déclaratif qui les
 * accompagne (biomes, ressources, profils d'eau) — sans exiger qu'un humain se souvienne
 * de bumper quoi que ce soit pour ces données-là non plus : un hash ne peut pas oublier.
 * Cette fonction reste agnostique de la source : `Simulation.currentConfigFingerprint`
 * décide quoi lui passer.
 */

/** Stringification déterministe : clés triées récursivement, insensible à l'ordre de
 * construction de l'objet (contrairement à `JSON.stringify` brut). */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`,
  );
  return `{${parts.join(',')}}`;
}

/** FNV-1a 32 bits — même algorithme que `hashWorldState`, pour rester cohérent et sans
 * dépendance externe (pas besoin d'une vraie primitive cryptographique ici : on détecte
 * une dérive de configuration, pas une attaque). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Empreinte d'une configuration de simulation, complétée par les grandeurs de monde
 * qui ne vivent pas dans `SimulationConfig` (taille du monde en chunks/mètres).
 */
export function computeConfigFingerprint(
  config: unknown,
  worldShape: { readonly sizeMeters: number; readonly chunkSizeMeters: number },
): string {
  return fnv1a(canonicalStringify({ config, worldShape }));
}
