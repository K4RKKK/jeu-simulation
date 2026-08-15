export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolation inverse bornée : où se situe `value` entre `a` et `b`, en 0..1. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function squaredDistance2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Angle (radians) vers un point, avec la convention monde : 0 = +Z, sens horaire. */
export function angleTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** Ramène un angle dans ]-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** Fait tourner `current` vers `target` d'au plus `maxDelta` radians. */
export function rotateTowards(current: number, target: number, maxDelta: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

/**
 * Quantifie une valeur avant émission réseau. Deux rôles : réduire la taille des messages
 * et rendre la comparaison de deltas stable (sinon un bruit de 1e-15 renverrait l'entité
 * à chaque tick).
 */
export function quantize(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
