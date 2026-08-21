import type { ChunkId } from '@civ/shared';
import type { ChunkCoordinate } from './chunkCoordinate.js';

/**
 * Un individu de ressource généré.
 *
 * `id` est **stable et indépendant du chunk** : il dérive de la cellule de candidature en
 * coordonnées monde. C'est ce qui permettra plus tard d'enregistrer « cet arbre a été
 * abattu » sans stocker le monde entier — il suffira de mémoriser l'identifiant retiré.
 *
 * `ownerChunkKey` — bug corrigé : une ressource appartient au chunk qui contient le
 * *centre de sa cellule*, mais le jitter peut décaler sa position physique dans un chunk
 * voisin. Rechercher la ressource via `chunkAt(x, z)` interrogeait alors le mauvais
 * chunk (celui de la position physique, pas celui du propriétaire). Cette clé, écrite
 * une fois pour toutes par le spawner, tranche sans ambiguïté.
 */
export interface ResourceSpawn {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionIndex: number;
  /**
   * Clé du chunk propriétaire (contenant le centre de la cellule qui a produit ce
   * spawn). Peut différer du chunk contenant `(x, z)` en présence de jitter.
   */
  readonly ownerChunkKey: ChunkId;
  /**
   * Identifiant local du spawn dans son chunk propriétaire, 0..count-1, attribué par le
   * `ResourceSpawner` **après** le tri par id complet. Stable pour une même
   * (seed, generationVersion, coordonnée de chunk) : c'est donc une adresse compacte
   * réseau — `(chunkKey, localId)` désigne exactement une ressource, sans transmettre
   * la chaîne `id` (potentiellement longue) à chaque delta.
   */
  readonly localId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
  /**
   * Projection des propriétés alimentaires de la définition (`content`), embarquée avec
   * l'individu : la simulation ne peut pas importer `content` (CLAUDE.md règle 2) et n'a
   * besoin que de ces deux grandeurs pour décider quoi cueillir.
   */
  readonly foodKcal: number;
  readonly foodToxicity01: number;
  /**
   * Projection de `ResourceDefinition.harvestServings` (`content`), garantie `≥ 1` par le
   * spawner — même raison que `foodKcal`/`foodToxicity01` : la simulation ne peut pas
   * importer `content`, elle n'a besoin que de cette grandeur pour savoir combien de
   * récoltes cette ressource peut encore fournir.
   */
  readonly harvestServings: number;
  /**
   * Projection de `ResourceDefinition.renewalMode` (`content`), résolue par le spawner
   * (`regrowWhenDepleted` si absent) — même raison que `harvestServings` : la simulation
   * ne peut pas importer `content`, `EcologySystem` a besoin de cette seule information
   * pour savoir si/comment cette ressource repousse.
   */
  readonly renewalMode: 'none' | 'replenishPartial' | 'regrowWhenDepleted';
  /**
   * Projection de `ResourceDefinition.perceptualConceptId` (`content`), résolue par le
   * spawner (`definitionId` si absent). Ce qu'un observateur RECONNAÎT, pas la vérité
   * moteur : la perception cognitive (`PerceptionSystem`) doit lire CE champ, jamais
   * `definitionId` directement — deux définitions différentes peuvent projeter le même
   * `perceptualConceptId` si elles se ressemblent (voir la doc de `perceptualConceptId`
   * dans `content`).
   */
  readonly perceptualConceptId: string;
  /**
   * Projection de `ResourceDefinition.interactive` (`content`) — indique si cet individu
   * vaut la peine d'être mémorisé durablement. Un décor pur (`interactive: false`, ex.
   * herbe sèche, fougère, roseau) peut être perçu et affiché, mais n'a pas sa place dans
   * `CognitiveMemory.spatial` où chaque entrée a un coût. Seuls les individus
   * « mémorables » (pierre, buisson à baies, arbre tombé…) entrent en mémoire durable.
   */
  readonly rememberable: boolean;
  /** Affordance perceptive, distincte de `foodKcal` : un humain peut l'essayer sans connaître le résultat. */
  readonly foodCandidate: boolean;
}

/**
 * Champs du terrain échantillonnés aux sommets du maillage, quantifiés sur un octet.
 *
 * Un octet suffit largement : ces valeurs servent au rendu, aux calques de debug et à
 * l'inspecteur, jamais à la simulation — laquelle réinterroge le `TerrainSampler` en pleine
 * précision. Les transmettre en flottants multiplierait la taille d'un chunk par huit pour
 * une précision dont personne n'a l'usage.
 */
export interface TerrainFieldGrids {
  readonly elevation: Uint8Array;
  readonly slope: Uint8Array;
  readonly temperature: Uint8Array;
  readonly moisture: Uint8Array;
  readonly fertility: Uint8Array;
  readonly rockiness: Uint8Array;
  readonly vegetation: Uint8Array;
  /** Indice de biome dominant par sommet. */
  readonly biome: Uint8Array;
  /**
   * Octet de coloration de la région macroscopique contenant ce sommet (voir
   * `regions/regionGrid.ts`, `regionColorByte`) — PAS un identifiant unique : deux
   * régions distantes peuvent y collisionner (256 valeurs seulement). Sert uniquement
   * au calque de debug « Régions » côté client ; l'identité vraie d'une région est
   * `RegionCoordinate`, calculable indépendamment côté client comme côté serveur.
   */
  readonly region: Uint8Array;
  /**
   * Praticabilité réelle par sommet (0 ou 1) — exactement le résultat de
   * `TerrainSampler.isWalkableFrom` (pente + profondeur d'eau guéable), jamais une
   * approximation recalculée ailleurs. Sert l'inspecteur de terrain du client : avant
   * ce champ, l'outil de debug affichait sa propre estimation (`pente < 0.5`) qui
   * pouvait annoncer « marchable » là où le moteur de simulation refusait le passage.
   */
  readonly walkable: Uint8Array;
}

export interface TerrainChunkData {
  readonly resolution: number;
  /** `(resolution + 1)²` hauteurs en mètres, rangées par z croissant puis x croissant. */
  readonly heights: Float32Array;
  /** Hauteur de la surface d'eau par sommet ; `NaN` là où il n'y a pas d'eau. */
  readonly waterHeights: Float32Array;
  /** Couleur du sol par sommet, RGB sur trois octets consécutifs. */
  readonly colors: Uint8Array;
  readonly fields: TerrainFieldGrids;
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly hasWater: boolean;
}

export interface ChunkBiomeStats {
  /** Nombre de sommets par indice de biome. */
  readonly counts: Uint16Array;
  readonly dominantIndex: number;
  readonly walkableRatio: number;
}

export interface ChunkData {
  readonly coordinate: ChunkCoordinate;
  readonly key: ChunkId;
  readonly generationVersion: string;
  readonly terrain: TerrainChunkData;
  readonly resources: readonly ResourceSpawn[];
  /** Indices des étendues d'eau présentes dans le chunk. */
  readonly waterBodyIndices: readonly number[];
  readonly biomeStats: ChunkBiomeStats;
  /** Durée de génération en millisecondes — mesurée, pas estimée. */
  readonly generationMs: number;
}

export function vertexCount(resolution: number): number {
  return (resolution + 1) * (resolution + 1);
}

/** Quantifie une valeur de [0, 1] sur un octet. */
export function quantize01(value: number): number {
  const scaled = Math.round(value * 255);
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
}
