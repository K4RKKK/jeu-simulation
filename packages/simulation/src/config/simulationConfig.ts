/**
 * Configuration d'équilibrage (CLAUDE.md règle 5).
 *
 * Toute constante numérique qui influence le comportement du monde vit ici. Un système
 * ne doit jamais contenir de littéral d'équilibrage : il lit `ctx.config`.
 */

export type SystemFrequency = 'fast' | 'medium' | 'slow' | 'verySlow';

export interface TimeConfig {
  /** Ticks de simulation exécutés par seconde réelle à `timeScale = 1`. */
  tickRateHz: number;
  /** Secondes de jeu écoulées par tick. Découple le rythme réel du rythme du monde. */
  gameSecondsPerTick: number;
  hoursPerDay: number;
  daysPerYear: number;
  /**
   * Heure du premier jour à laquelle un monde neuf commence. Découplé du tick 0 : le
   * compteur de ticks reste l'origine technique, l'heure de départ est un choix de monde.
   */
  startHourOfDay: number;
}

/**
 * La taille du monde, celle des chunks et tout le reste de la géographie appartiennent
 * désormais à `WorldGenerationConfig` (`@civ/procedural`). Les dupliquer ici rendrait
 * possible un désaccord entre le monde généré et le monde simulé.
 */

export interface EnvironmentConfig {
  /** Température moyenne annuelle au niveau du sol. */
  baseTemperatureC: number;
  /** Amplitude jour/nuit (crête à moyenne). */
  dailyAmplitudeC: number;
  /** Amplitude saisonnière (crête à moyenne). */
  seasonalAmplitudeC: number;
  /**
   * Amplitude spatiale de la température, en °C : le climat procédural (latitude simulée,
   * altitude via le lapse rate) module la température ambiante autour de sa moyenne.
   */
  spatialTemperatureAmplitudeC: number;
  /** Heure de jeu du lever et du coucher du soleil. */
  sunriseHour: number;
  sunsetHour: number;
}

/** Météo régionale observable, dérivée du temps et de la seed. */
export interface WeatherConfig {
  /** Durée d'un régime météorologique avant le suivant. */
  periodHours: number;
  /** Fin de période consacrée à la transition vers le régime suivant. */
  transitionHours: number;
  precipitationBaseChance01: number;
  moistureInfluence01: number;
  maxTemperatureDropC: number;
  maxWindMps: number;
  snowThresholdC: number;
  fogHumidityThreshold01: number;
}

export interface EcologyConfig {
  /** Délai déterministe minimal/maximal avant qu'une ressource épuisée puisse repousser. */
  minRegrowthDays: number;
  maxRegrowthDays: number;
  /** Une région trop sèche ou trop perturbée attend une meilleure période. */
  minGrowthPotential01: number;
  /** Garde-fou : nombre maximal de repousses lors d'une passe très lente. */
  maxRegrowthPerUpdate: number;
}

export interface HumanGenerationConfig {
  initialPopulation: number;
  minAgeYears: number;
  maxAgeYears: number;
  meanAgeYears: number;
  ageStdDevYears: number;
  /** Taille adulte de référence par sexe, en mètres. */
  adultHeightMaleM: number;
  adultHeightFemaleM: number;
  heightStdDevM: number;
  /** Indice de masse corporelle utilisé pour dériver la masse de la taille. */
  meanBmi: number;
  bmiStdDev: number;
  /** Vitesse de marche de référence pour un adulte de taille moyenne. */
  baseWalkSpeedMps: number;
  /** Multiplicateur de vitesse aux âges extrêmes (enfant / vieillard). */
  youngSpeedFactor: number;
  elderSpeedFactor: number;
  /** Âges de bascule utilisés pour interpoler le facteur de vitesse. */
  adultAgeYears: number;
  elderAgeYears: number;
  /** Rayon d'éparpillement autour du point d'apparition du groupe initial. */
  spawnClusterRadiusMeters: number;
  /** Distance maximale du centre du monde où le groupe initial peut apparaître. */
  spawnAreaRadiusMeters: number;
}

export interface MovementConfig {
  /** Distance à laquelle une destination est considérée atteinte. */
  arrivalRadiusMeters: number;
  /** Vitesse de rotation maximale, en radians par seconde de jeu. */
  turnRateRadPerSecond: number;
  trailCellMeters: number;
  trailWearPerMeter: number;
  /**
   * Distance minimale parcourue (en ligne droite depuis le dernier échantillon) avant
   * de ré-échantillonner l'usure du sentier. Sans ce seuil, un pas de quelques
   * centimètres à 20 Hz redéclenchait un ré-échantillonnage complet à chaque tick —
   * un coût significatif à plusieurs centaines d'humains pour une usure imperceptible.
   */
  trailSampleThresholdMeters: number;
}

export interface WanderConfig {
  /** Durées d'immobilité entre deux déplacements (modulées par la patience). */
  minIdleSeconds: number;
  maxIdleSeconds: number;
  /** Distance de déplacement (modulée par la curiosité). */
  minDistanceMeters: number;
  maxDistanceMeters: number;
  /** Marge conservée par rapport au bord du monde. */
  worldMarginMeters: number;
  /**
   * Nombre d'essais pour trouver une destination praticable avant de renoncer.
   * Renoncer est un résultat valable : l'individu reste où il est et réessaiera.
   */
  maxTargetAttempts: number;
  /**
   * Les essais de destination sont modulés par la persévérance : un persévérant
   * multiplie `maxTargetAttempts` par `attemptScaleMax`, un résigné par `attemptScaleMin`.
   */
  attemptScaleMin: number;
  attemptScaleMax: number;
  /**
   * Courage au-delà duquel un individu continue de se déplacer après le coucher du
   * soleil ; en dessous, il se repose jusqu'à l'aube.
   */
  nightMovementCourageThreshold: number;
  /** Pente maximale (slope01) tolérée par un individu parfaitement audacieux. */
  audaciousMaxSlope01: number;
  /** Pente maximale (slope01) tolérée par un individu parfaitement prudent. */
  cautiousMaxSlope01: number;
}

/**
 * Métabolisme et besoins vitaux (soif, faim, énergie).
 *
 * Toutes les valeurs sont exprimées **par seconde de jeu** : un système `medium` applique
 * `rate × deltaGameSeconds`, donc l'équilibrage ne dépend ni du tick rate ni du mode
 * headless. Les durées (survie, recharge) sont celles d'un adulte moyen au repos.
 */
export interface NeedsConfig {
  decision: {
    epsilon: number;
    restWeight: number;
    drinkWeight: number;
    eatWeight: number;
    exploreBaseWeight: number;
    /** @deprecated Kept only to verify configuration fingerprints from snapshots v11-v14. */
    noMemoryPenalty: number;
    /** @deprecated Kept only to verify configuration fingerprints from snapshots v11-v14. */
    recentPoisoningWindowSeconds: number;
    /** Ecart relatif requis avant de remplacer un but vital deja choisi. */
    goalSwitchMargin01: number;
    /** Duree minimale pendant laquelle un but vital garde la main. */
    minimumGoalCommitmentSeconds: number;
    /** Ecart d'utilite qui peut interrompre ce commitment lors d'une urgence. */
    urgentGoalOverrideMultiplier: number;
  };
  hydration: {
    /** Perte d'hydratation au repos dans un climat tempéré : ~3 jours de survie. */
    drainPerSecond: number;
    /** Multiplicateur supplémentaire de perte quand le climat est chaud. */
    heatDrainMultiplier: number;
    /** Température (climat spatial 01) au-delà de laquelle la chaleur accélère la perte. */
    heatStartTemperature01: number;
    /** En dessous, l'individu abandonne toute autre occupation pour boire. */
    criticalThreshold: number;
    /** Niveau visé à la fin d'une boisson. */
    drinkTarget: number;
    /** Vitesse de recharge en buvant. */
    drinkRatePerSecond: number;
    /** Bornes de durée d'une boisson. */
    minDrinkSeconds: number;
    maxDrinkSeconds: number;
  };
  hunger: {
    /** Perte de rassasiement au repos : ~20 jours de survie. */
    drainPerSecond: number;
    /** La marche accélère la dépense calorique. */
    walkingDrainMultiplier: number;
    /** En dessous, l'individu part chercher de la nourriture. */
    criticalThreshold: number;
    /** Niveau visé à la fin d'un repas. */
    eatTarget: number;
    /** Quantité de calories qui remplit complètement la faim. */
    kcalPerFullMeal: number;
    /** Vitesse de recharge en mangeant. */
    eatRatePerSecond: number;
    /** Bornes de durée d'un repas. */
    minEatSeconds: number;
    maxEatSeconds: number;
  };
  /**
   * Conséquences de l'ingestion d'une plante toxique. Aucune connaissance ne guide le
   * choix (CLAUDE.md règle 12 / pas d'omniscience) : la toxicité d'une ressource
   * n'apparaît qu'après coup, dans le corps.
   */
  toxicity: {
    /** Au-delà de cette toxicité, l'ingestion déclenche des symptômes. */
    effectThreshold01: number;
    /** Perte d'hydratation supplémentaire par seconde pendant les symptômes. */
    hydrationDrainPerSecond: number;
    /** Durée des symptômes après l'ingestion, en secondes de jeu. */
    durationSeconds: number;
  };
  energy: {
    /** Perte d'énergie en marchant : ~12 h de marche continue pour se vider. */
    drainPerSecond: number;
    /** Fraction du drain consommée quand on est immobile (éveillé). */
    idleDrainRatio: number;
    /** En dessous, l'individu doit se reposer avant toute autre chose. */
    exhaustedThreshold: number;
    /** Niveau visé à la fin d'un repos. */
    restTarget: number;
    /** Récupération en se reposant : ~4 h de repos pour se remplir. */
    recoveryPerSecond: number;
    /** Fraction de la récupération obtenue en dormant (repos nocturne du wander). */
    nightIdleRecoveryRatio: number;
    /** Bornes de durée d'un repos. */
    minRestSeconds: number;
    maxRestSeconds: number;
  };
  search: {
    /** Distance maximale à l'eau depuis laquelle un humain peut boire. */
    drinkShoreDistanceM: number;
  };
}

/**
 * Perception et mémoire spatiale (CLAUDE.md : une connaissance appartient à un individu,
 * jamais au monde). L'humain ne sait que ce qu'il a vu : les souvenirs expirent, sont
 * bornés en nombre, et ne contiennent jamais la toxicité d'une ressource — ce qu'il ne
 * peut pas voir, il ne le sait pas.
 */
export interface PerceptionConfig {
  /** Rayon de vision : au-delà, le monde n'existe pas pour l'individu. */
  visionRangeM: number;
  /** Pas de la spirale de détection d'une rive. */
  waterScanStepM: number;
  /** Déplacement minimal avant de rescanner l'eau autour de soi. */
  waterRescanMoveThresholdM: number;
  /**
   * Déplacement minimal avant de rescanner la nourriture autour de soi.
   *
   * Bug corrigé : le scan était auparavant relancé au CHANGEMENT DE CHUNK, jamais à la
   * distance parcourue — incohérent avec `waterRescanMoveThresholdM`, qui utilise déjà
   * un déplacement. Avec `chunkSizeMeters` (64 m par défaut) le double de `visionRangeM`
   * (32 m), un individu qui entre dans un chunk par un coin ne scanne qu'un disque de
   * 32 m de rayon puis peut traverser jusqu'à ~90 m (la diagonale du chunk) SANS jamais
   * rescanner : de la nourriture entrée dans son rayon de vision entre-temps restait
   * invisible jusqu'au prochain changement de chunk, parfois bien après être passé à
   * côté.
   */
  foodRescanMoveThresholdM: number;
  /** Temps maximal sans nouveau scan, mÃªme immobile. */
  maxRescanSeconds: number;
  /**
   * Champs hérités de Phase 3.1-3.2 : plus lus depuis 3.5 (les souvenirs vivent dans
   * `CognitiveMemory`, dont la capacité est réglée par `cognition.maxSpatialEntries` et
   * la persistance par `cognition.spatialConfidenceHalfLifeSeconds`). Conservés dans la
   * `SimulationConfig` pour ne pas changer le `configFingerprint` de sauvegardes v11
   * existantes — un retrait cassera leur chargement (`restoreSnapshot` vérifie l'empreinte
   * après la migration v11→v12). À supprimer lors d'un prochain bump qui incluera de
   * toute façon un renouvellement d'empreinte.
   */
  foodMemoryTtlSeconds: number;
  waterMemoryTtlSeconds: number;
  maxFoodEntries: number;
  maxWaterEntries: number;
}

/**
 * Mémoire spatiale générique (Phase 3.2) — voir `CognitiveMemoryComponent`.
 *
 * `PerceptionSystem` écrit un souvenir « frais » (`freshSpatialConfidence01`/
 * `freshSpatialPrecisionM`) à chaque perception ; `ForgettingSystem` (fréquence
 * `verySlow`) recalcule ensuite `confidence01`/`precisionM` comme une fonction ABSOLUE
 * du temps écoulé depuis `lastSeenTick` — jamais un décrément appliqué passe après
 * passe, pour rester exact indépendamment de la fréquence à laquelle `ForgettingSystem`
 * a effectivement tourné (elle-même liée à `scheduler.intervals.verySlow`, un réglage
 * partagé par d'autres systèmes). Un souvenir revu régulièrement reste net (`rememberSpatial`
 * réinitialise `lastSeenTick`) ; un souvenir ancien s'estompe puis se purge.
 */
export interface CognitionConfig {
  /** Gain de faim perceptible à partir duquel une ingestion est jugée nourrissante. */
  nourishingHungerGainThreshold01: number;
  experimentation: {
    /** Score minimal pour transformer l'exploration en essai volontaire. */
    minimumInterest01: number;
    /** Fenêtre pendant laquelle répéter le même essai est progressivement découragé. */
    recentRepeatSeconds: number;
    /** Échelle spatiale utilisée pour l'accessibilité d'un souvenir expérimental. */
    distanceScaleMeters: number;
  };
  /** Confiance attribuée à un souvenir spatial au moment où il est perçu. */
  freshSpatialConfidence01: number;
  /** Imprécision (mètres) attribuée à un souvenir spatial fraîchement perçu. */
  freshSpatialPrecisionM: number;
  /** Secondes de jeu après lesquelles la confiance d'un souvenir non revu est divisée par deux. */
  spatialConfidenceHalfLifeSeconds: number;
  /** Mètres d'imprécision ajoutés par seconde de jeu écoulée depuis la dernière observation. */
  spatialPrecisionGrowthPerSecondM: number;
  /** Plafond de `precisionM` : au-delà, un souvenir est déjà pratiquement inutilisable. */
  maxSpatialPrecisionM: number;
  /** En dessous de ce seuil, un souvenir spatial est purgé plutôt que conservé flou. */
  minSpatialConfidence01: number;
  /** Nombre maximal de souvenirs spatiaux par humain (le moins fiable est oublié en premier). */
  maxSpatialEntries: number;
  /**
   * Nombre maximal d'événements épisodiques (Phase 3.3) : quand cette limite est atteinte,
   * l'entrée d'intensité émotionnelle la plus basse est évincée en priorité — pas la plus
   * ancienne. Un traumatisme rare (empoisonnement sévère) survit ainsi à des dizaines
   * d'événements ordinaires (un repas de plus, une gorgée de plus).
   */
  maxEpisodicEntries: number;
}

export interface SchedulerConfig {
  /** Nombre de ticks entre deux exécutions, par fréquence. */
  intervals: Record<SystemFrequency, number>;
}

/**
 * Pathfinding (CLAUDE.md : le terrain décide de ce qui est praticable, la simulation
 * décide de ce que ça coûte). Les seuils d'infranchissabilité (pente maximale, eau trop
 * profonde) appartiennent à la génération du monde (`walkability` dans
 * `WorldGenerationConfig`) ; ici vivent les coûts relatifs des terrains franchissables.
 */
export interface PathfindingConfig {
  /** Taille d'une tuile de la grille de navigation, en mètres. */
  tileSizeMeters: number;
  /** Nœuds de recherche consommables par traitement du `PathfindingSystem`. */
  maxNodesPerTick: number;
  /** Plafond de nœuds d'une seule requête avant abandon. */
  maxNodesPerRequest: number;
  /** Essais supplémentaires d'une requête tronquée avant abandon. */
  /** @deprecated Compatibilité de configuration ; une recherche incrémentale ne recommence plus. */
  maxRetries: number;
  /** Taille du cache LRU des chemins calculés. */
  pathCacheCapacity: number;
  /** Nombre de tuiles de terrain dont le coût peut être partagé entre les recherches. */
  terrainCostCacheCapacity: number;
  /** Rayon (en tuiles) du repli d'une cible sur la tuile praticable la plus proche. */
  snapRadiusTiles: number;
  /** Pause (en ticks) avant de retenter un chemin impossible. */
  failureRetryTicks: number;
  costs: {
    flatCost: number;
    gentleCost: number;
    steepCost: number;
    /** Franchir une eau assez basse pour être guéable. */
    waterWalkCost: number;
    /** Pente au-delà de laquelle le coût passe de plat à facile. */
    gentleSlopeThreshold01: number;
    /** Pente au-delà de laquelle le coût passe de facile à difficile. */
    steepSlopeThreshold01: number;
  };
}

export interface NetworkConfig {
  /** Messages réseau par seconde réelle. */
  netRateHz: number;
  /** Un snapshot complet est renvoyé périodiquement pour resynchroniser les clients. */
  fullSnapshotEveryTicks: number;
  /** Décimales conservées pour les positions transmises. */
  positionDecimals: number;
  /** Décimales conservées pour les angles transmis. */
  angleDecimals: number;
}

export interface SimulationConfig {
  time: TimeConfig;
  environment: EnvironmentConfig;
  weather: WeatherConfig;
  ecology: EcologyConfig;
  humans: HumanGenerationConfig;
  movement: MovementConfig;
  wander: WanderConfig;
  needs: NeedsConfig;
  perception: PerceptionConfig;
  cognition: CognitionConfig;
  pathfinding: PathfindingConfig;
  scheduler: SchedulerConfig;
  network: NetworkConfig;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  time: {
    tickRateHz: 20,
    // 0.05 s de jeu par tick à 20 Hz => le monde tourne en temps réel à `timeScale = 1`.
    // C'est cohérent avec un monde vivant 24 h/24, et cela rend les vitesses de marche
    // physiquement lisibles (1,25 m/s se voit comme 1,25 m/s). L'observateur accélère avec
    // `timeScale` quand il veut voir passer des journées.
    gameSecondsPerTick: 0.05,
    hoursPerDay: 24,
    daysPerYear: 360,
    startHourOfDay: 8,
  },
  environment: {
    baseTemperatureC: 14,
    dailyAmplitudeC: 7,
    seasonalAmplitudeC: 10,
    spatialTemperatureAmplitudeC: 16,
    sunriseHour: 6,
    sunsetHour: 20,
  },
  weather: {
    periodHours: 6,
    transitionHours: 1.5,
    precipitationBaseChance01: 0.16,
    moistureInfluence01: 0.58,
    maxTemperatureDropC: 6,
    maxWindMps: 18,
    snowThresholdC: 1,
    fogHumidityThreshold01: 0.82,
  },
  ecology: {
    minRegrowthDays: 3,
    maxRegrowthDays: 12,
    minGrowthPotential01: 0.42,
    maxRegrowthPerUpdate: 4,
  },
  humans: {
    initialPopulation: 15,
    minAgeYears: 4,
    maxAgeYears: 62,
    meanAgeYears: 26,
    ageStdDevYears: 12,
    adultHeightMaleM: 1.68,
    adultHeightFemaleM: 1.57,
    heightStdDevM: 0.07,
    meanBmi: 21,
    bmiStdDev: 1.8,
    baseWalkSpeedMps: 1.25,
    youngSpeedFactor: 0.72,
    elderSpeedFactor: 0.68,
    adultAgeYears: 18,
    elderAgeYears: 50,
    spawnClusterRadiusMeters: 22,
    spawnAreaRadiusMeters: 60,
  },
  movement: {
    arrivalRadiusMeters: 0.4,
    turnRateRadPerSecond: 2.4,
    trailCellMeters: 2,
    trailWearPerMeter: 0.00125,
    trailSampleThresholdMeters: 0.5,
  },
  wander: {
    minIdleSeconds: 20,
    maxIdleSeconds: 240,
    minDistanceMeters: 8,
    maxDistanceMeters: 70,
    worldMarginMeters: 8,
    maxTargetAttempts: 6,
    attemptScaleMin: 0.5,
    attemptScaleMax: 1.8,
    // Entre la pente du campement (0.16) et la limite de marche (0.55) : les audacieux
    // affrontent des côtes franches, les prudents cherchent le plat.
    nightMovementCourageThreshold: 0.65,
    audaciousMaxSlope01: 0.35,
    cautiousMaxSlope01: 0.12,
  },
  needs: {
    decision: {
      epsilon: 0.05,
      restWeight: 4.5,
      drinkWeight: 1.4,
      eatWeight: 0.8,
      exploreBaseWeight: 0.5,
      noMemoryPenalty: 0.15,
      recentPoisoningWindowSeconds: 1800,
      goalSwitchMargin01: 0.2,
      minimumGoalCommitmentSeconds: 20,
      urgentGoalOverrideMultiplier: 3,
    },
    hydration: {
      drainPerSecond: 1 / 259200,
      heatDrainMultiplier: 1.5,
      heatStartTemperature01: 0.45,
      criticalThreshold: 0.2,
      drinkTarget: 0.85,
      drinkRatePerSecond: 0.008,
      minDrinkSeconds: 15,
      maxDrinkSeconds: 90,
    },
    hunger: {
      drainPerSecond: 1 / 1728000,
      walkingDrainMultiplier: 1.6,
      criticalThreshold: 0.25,
      eatTarget: 0.85,
      kcalPerFullMeal: 600,
      eatRatePerSecond: 0.007,
      minEatSeconds: 20,
      maxEatSeconds: 180,
    },
    toxicity: {
      // Une amanite phalloïde (0.95) coûte ~0.4 d'hydratation sur la durée des symptômes ;
      // un champignon simplement douteux (0.45) coûte deux fois moins. Rien n'est mortel
      // en soi : la santé n'existe pas encore, c'est la soif déclenchée qui devient critique.
      effectThreshold01: 0.05,
      hydrationDrainPerSecond: 1 / 18000,
      durationSeconds: 7200,
    },
    energy: {
      drainPerSecond: 1 / 43200,
      idleDrainRatio: 0.35,
      exhaustedThreshold: 0.12,
      restTarget: 0.95,
      recoveryPerSecond: 1 / 14400,
      nightIdleRecoveryRatio: 0.8,
      minRestSeconds: 60,
      maxRestSeconds: 14400,
    },
    search: {
      drinkShoreDistanceM: 2.5,
    },
  },
  perception: {
    // 32 m : l'échelle d'un chunk. L'humain sait ce qui est autour de lui, rien de plus.
    visionRangeM: 32,
    waterScanStepM: 12,
    waterRescanMoveThresholdM: 15,
    foodRescanMoveThresholdM: 15,
    maxRescanSeconds: 60,
    // Legacy Phase 3.1-3.2, non lus depuis 3.5 (voir le champ ci-dessus).
    foodMemoryTtlSeconds: 3600,
    waterMemoryTtlSeconds: 7200,
    maxFoodEntries: 16,
    maxWaterEntries: 4,
  },
  cognition: {
    nourishingHungerGainThreshold01: 0.01,
    experimentation: {
      minimumInterest01: 0.1,
      recentRepeatSeconds: 600,
      distanceScaleMeters: 32,
    },
    freshSpatialConfidence01: 1,
    freshSpatialPrecisionM: 1,
    // 30 min de jeu pour tomber à confiance moitié sans être revu ; à ce rythme, un
    // souvenir jamais renforcé passe sous `minSpatialConfidence01` (purge) en un peu
    // plus de 2h de jeu — le même ordre de grandeur que les anciens TTL nourriture/eau
    // (1h/2h), sans le couperet net d'un TTL : la dégradation est progressive.
    spatialConfidenceHalfLifeSeconds: 1800,
    // (50 m - 1 m) réparti sur ~2h30 de jeu (9000 s) : à l'approche de la purge, un
    // souvenir non revu est déjà quasiment inexploitable en position, pas seulement en
    // confiance.
    spatialPrecisionGrowthPerSecondM: 0.0054,
    maxSpatialPrecisionM: 50,
    minSpatialConfidence01: 0.05,
    // Bug corrigé après mesure (Phase 3.2, correction immédiate) : la mémoire cognitive
    // couvre maintenant TOUTE ressource visible, pas seulement l'alimentaire (voir la
    // doc de `PerceptionSystem`) — une seule passe de perception près d'une forêt dense
    // produit facilement 20 à 40 observations. À 24, l'éviction (à confiance égale, la
    // plus ancienne part en premier) purgeait le souvenir d'eau AVANT MÊME la fin de la
    // passe qui venait de le créer — mesuré : un souvenir d'eau créé en tout début de
    // scan disparaissait avant le 25ᵉ arbre observé dans le MÊME tick. Ce plafond doit
    // dépasser largement ce qu'une seule passe peut produire, tout en restant borné.
    maxSpatialEntries: 80,
    // Ordre de grandeur similaire à la mémoire spatiale : un humain n'est pas un journal.
    // Un repas + une gorgée + un repos = 3 événements toutes les ~5-10 min de jeu, soit
    // ~5h de souvenirs récents avant éviction. Les traumatismes (empoisonnements) résistent
    // plus longtemps grâce à leur `emotionalStrength01` élevé, par construction de l'évincement.
    maxEpisodicEntries: 64,
  },
  pathfinding: {
    // 2 m de tuile : un humain fait ~1,6 pas par tuile, la résolution suit la géographie
    // sans la suréchantillonner (un chunk de 32 m fait 16×16 tuiles).
    tileSizeMeters: 2,
    // Une rafale de réveils (toute la population demande un chemin au même tick) doit
    // tenir en une passe : population par défaut × ~800 nœuds par chemin ≈ 12 000. Un
    // budget trop juste étalerait les derniers chemins sur plusieurs passes, et la
    // latence grandirait avec la longueur du chemin — l'errance lointaine paierait
    // chaque randonnée d'une attente proportionnelle, ce qui fausserait la décision.
    maxNodesPerTick: 12000,
    maxNodesPerRequest: 6000,
    maxRetries: 4,
    pathCacheCapacity: 512,
    // Le terrain et l'hydrologie sont immuables : partager ces coûts évite que des
    // centaines de recherches voisines ré-échantillonnent les mêmes tuiles. Cache borné
    // pour rester prévisible sur les mondes beaucoup plus grands que celui par défaut.
    terrainCostCacheCapacity: 65_536,
    snapRadiusTiles: 3,
    // 600 ticks ≈ 30 s de jeu : après un chemin introuvable, on laisse l'errance et la
    // perception explorer avant de retenter le même trajet impossible.
    failureRetryTicks: 600,
    costs: {
      // Plat = 1 (référence), pente facile = 1,5, pente difficile = 2,5, gué = 3 : l'A*
      // contourne une côte raide ou une rivière dès qu'un détour moins coûteux existe.
      flatCost: 1,
      gentleCost: 1.5,
      steepCost: 2.5,
      waterWalkCost: 3,
      // En dessous de 0.2 le terrain est plat ; au-delà de 0.45 il est franchement raide.
      // Tout ce qui dépasse la pente maximale du monde (0.55) est infranchissable — cette
      // limite vit dans la génération, pas ici.
      gentleSlopeThreshold01: 0.2,
      steepSlopeThreshold01: 0.45,
    },
  },
  scheduler: {
    intervals: {
      fast: 1,
      medium: 5,
      slow: 25,
      verySlow: 200,
    },
  },
  network: {
    netRateHz: 10,
    fullSnapshotEveryTicks: 600,
    positionDecimals: 2,
    angleDecimals: 3,
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type SimulationConfigOverrides = DeepPartial<SimulationConfig>;

function mergeSection<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return { ...base };
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const value = override[key];
    if (value === undefined) continue;
    const current = base[key];
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      result[key] = mergeSection(
        current as unknown as object,
        value as DeepPartial<object>,
      ) as T[keyof T];
    } else {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}

/** Construit une configuration complète à partir de surcharges partielles. */
export function createSimulationConfig(
  overrides: SimulationConfigOverrides = {},
): SimulationConfig {
  return mergeSection(DEFAULT_SIMULATION_CONFIG, overrides);
}
