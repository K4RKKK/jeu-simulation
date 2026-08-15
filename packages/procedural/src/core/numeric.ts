export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}

/**
 * Appartenance à une valeur idéale, dans [0, 1].
 * 1 exactement sur l'idéal, 0 au-delà de la tolérance.
 */
export function bellAround(value: number, ideal: number, tolerance: number): number {
  if (tolerance <= 0) return value === ideal ? 1 : 0;
  return clamp01(1 - Math.abs(value - ideal) / tolerance);
}

/**
 * Toute valeur sortant du moteur procédural passe par cette garde.
 * Un `NaN` silencieux se propagerait jusqu'à une géométrie invalide côté client, où il
 * serait beaucoup plus coûteux à diagnostiquer.
 */
export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Procedural generation produced a non-finite value for "${label}": ${value}`);
  }
  return value;
}
