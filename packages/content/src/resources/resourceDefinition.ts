import { rangeMembership, type SuitabilityRange } from '../range.js';

export type ResourceCategory = 'tree' | 'shrub' | 'stone' | 'debris' | 'ground_cover';

/**
 * Politique de repousse d'une ressource, appliquée par `EcologySystem` (simulation).
 *
 * - `none` : ne repousse jamais (un minerai extrait, un arbre abattu — la ressource ne
 *   doit pas revenir parce que l'écologie locale est bonne).
 * - `replenishPartial` : ne se restaure que depuis une récolte partielle
 *   (`remainingFraction01 < 1`), jamais depuis un épuisement complet.
 * - `regrowWhenDepleted` : se restaure aussi bien depuis une récolte partielle qu'un
 *   épuisement complet — comportement d'origine, adapté aux ressources alimentaires
 *   vivantes (baies, champignons, plantes).
 *
 * Absent = `regrowWhenDepleted`, pour préserver le comportement existant de toutes les
 * ressources actuelles sans migration nécessaire.
 */
export type ResourceRenewalMode = 'none' | 'replenishPartial' | 'regrowWhenDepleted';

/**
 * Formes de rendu connues du client.
 *
 * Le client sait construire ces formes ; il ne connaît aucun identifiant de ressource.
 * Ajouter `berry_bush_black` réutilisant la forme `bush` n'exige donc **aucune modification
 * du client** : la définition voyage dans les métadonnées du monde.
 */
export type ResourceShape =
  | 'broadleaf_tree'
  | 'conifer_tree'
  | 'bush'
  | 'boulder'
  | 'shard'
  | 'tuft'
  | 'mushroom'
  | 'branch'
  | 'reed';

export interface ResourceVisual {
  readonly shape: ResourceShape;
  readonly primaryColor: string;
  readonly secondaryColor?: string;
  readonly heightM: number;
  readonly radiusM: number;
  /** Variation relative de taille entre individus, dans [0, 1]. */
  readonly scaleVariance: number;
  /** Masqué au-delà de la distance de détail du client (LOD). */
  readonly detailOnly: boolean;
  /**
   * Perd ses feuilles en hiver : le client module sa teinte selon la saison (printemps
   * clair, été plein, automne roux, hiver dépouillé). Absent ou faux = feuillage persistant.
   */
  readonly deciduous?: boolean;
}

/**
 * Propriétés alimentaires.
 *
 * Elles sont **descriptives** : elles disent ce qu'est objectivement la ressource, pas ce
 * qu'un humain en sait. Aucun système de survie ne les consomme aujourd'hui ; elles sont
 * affichées dans l'inspecteur du client et serviront de vérité de terrain quand la
 * nutrition et l'empoisonnement existeront.
 */
export interface FoodProperties {
  readonly nutritionKcal: number;
  readonly waterContent01: number;
  readonly toxicity01: number;
}

export interface ResourceDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly category: ResourceCategory;
  readonly visual: ResourceVisual;

  /** Probabilité de base qu'une cellule candidate favorable porte cette ressource. */
  readonly density: number;
  /** Multiplicateur global de rareté ; 1 = commun, 0.05 = rare. */
  readonly rarity: number;
  /**
   * Côté de la cellule de candidature, en mètres. C'est aussi l'espacement minimal garanti
   * entre deux individus de cette ressource : une cellule ne produit qu'un individu.
   */
  readonly spacingMeters: number;
  /** Force du regroupement, dans [0, 1] : 0 = réparti, 1 = fortement groupé. */
  readonly clustering: number;
  /** Échelle des bosquets et des clairières, en mètres. */
  readonly clusterScaleMeters: number;

  /** Poids par biome. Un biome absent de cette table vaut 0 : la ressource n'y pousse pas. */
  readonly biomeWeights: Readonly<Record<string, number>>;

  readonly elevation?: SuitabilityRange;
  readonly moisture?: SuitabilityRange;
  readonly temperature?: SuitabilityRange;
  readonly fertility?: SuitabilityRange;
  readonly slope?: SuitabilityRange;
  readonly rockiness?: SuitabilityRange;
  readonly vegetation?: SuitabilityRange;
  readonly waterProximity?: SuitabilityRange;

  /**
   * `false` = élément de décor : il est généré et rendu, mais aucune mécanique ne le
   * manipulera. Cette distinction évite de promettre une interaction qui n'existe pas.
   */
  readonly interactive: boolean;

  readonly food?: FoodProperties;

  /**
   * Nombre de récoltes qu'un individu de cette ressource peut fournir avant de
   * disparaître complètement. Absent ou `1` = comportement d'origine : une seule
   * visite épuise entièrement la ressource. `> 1` = récolte progressive : chaque
   * visite ne prélève qu'une portion (voir `World.harvestResource`), la ressource
   * reste cueillable par d'autres tant qu'il en reste, et ne disparaît qu'à la
   * dernière portion.
   */
  readonly harvestServings?: number;

  /** Voir la doc de `ResourceRenewalMode`. Absent = `regrowWhenDepleted`. */
  readonly renewalMode?: ResourceRenewalMode;

  /**
   * Ce à quoi cette ressource RESSEMBLE pour un observateur — distinct de `id`, qui est
   * la vérité moteur. Absent = `id` (comportement par défaut : chaque définition a sa
   * propre apparence). Le renseigner explicitement permet à PLUSIEURS définitions de
   * partager la même apparence perçue — deux champignons visuellement proches mais de
   * toxicité différente porteraient le même `perceptualConceptId` tout en restant deux
   * `ResourceDefinition` distinctes : un humain qui n'a jamais goûté ni l'un ni l'autre
   * ne peut pas les distinguer avant expérience (sous-phase 3.3+).
   *
   * Projeté sur `ResourceSpawn.perceptualConceptId` (`@civ/procedural`) — la simulation
   * ne lit jamais `definitionId` comme connaissance sémantique, seulement cette
   * projection (CLAUDE.md règle 2 : la simulation n'importe jamais `content`).
   */
  readonly perceptualConceptId?: string;
}

export interface ResourceSuitabilityInput {
  elevation: number;
  moisture: number;
  temperature: number;
  fertility: number;
  slope: number;
  rockiness: number;
  vegetation: number;
  waterProximity: number;
  biomeId: string;
}

/**
 * Aptitude d'un point à porter cette ressource, dans [0, 1].
 *
 * Produit des appartenances (et non moyenne, contrairement aux biomes) : une ressource qui
 * exige un sol plat ne doit pas apparaître sur une falaise sous prétexte que l'humidité
 * lui convient. Un seul critère rédhibitoire suffit à annuler l'aptitude.
 */
export function scoreResourceSuitability(
  definition: ResourceDefinition,
  input: ResourceSuitabilityInput,
): number {
  const biomeWeight = definition.biomeWeights[input.biomeId] ?? 0;
  if (biomeWeight <= 0) return 0;

  let suitability = biomeWeight;
  const axis = (range: SuitabilityRange | undefined, value: number): void => {
    if (!range || suitability <= 0) return;
    suitability *= rangeMembership(value, range);
  };

  axis(definition.elevation, input.elevation);
  axis(definition.moisture, input.moisture);
  axis(definition.temperature, input.temperature);
  axis(definition.fertility, input.fertility);
  axis(definition.slope, input.slope);
  axis(definition.rockiness, input.rockiness);
  axis(definition.vegetation, input.vegetation);
  axis(definition.waterProximity, input.waterProximity);

  return suitability;
}
