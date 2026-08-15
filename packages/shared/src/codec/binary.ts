/**
 * Encodage compact des grilles de chunk.
 *
 * Un chunk transporte plusieurs milliers de valeurs : hauteurs, huit champs de terrain,
 * positions de ressources. En JSON brut, un seul chunk pèse plusieurs dizaines de kilooctets
 * et le rayon de rendu en demande une centaine. Ces tableaux sont donc quantifiés puis
 * encodés en base64 — environ six fois plus compact, pour une précision (centimètre pour
 * les hauteurs, 1/255 pour les champs normalisés) très au-delà de ce que l'affichage exige.
 *
 * Implémentation manuelle plutôt que `Buffer` ou `atob` : le même code doit fonctionner
 * dans Node et dans le navigateur, et c'est le seul module du protocole partagé par les
 * deux.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE_TABLE = /* @__PURE__ */ (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const triple =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    output +=
      ALPHABET[(triple >> 18) & 63]! +
      ALPHABET[(triple >> 12) & 63]! +
      ALPHABET[(triple >> 6) & 63]! +
      ALPHABET[triple & 63]!;
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const value = (bytes[i] as number) << 16;
    output += `${ALPHABET[(value >> 18) & 63]!}${ALPHABET[(value >> 12) & 63]!}==`;
  } else if (remaining === 2) {
    const value = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    output += `${ALPHABET[(value >> 18) & 63]!}${ALPHABET[(value >> 12) & 63]!}${ALPHABET[(value >> 6) & 63]!}=`;
  }
  return output;
}

export function decodeBase64(text: string): Uint8Array {
  let length = text.length;
  while (length > 0 && text.charCodeAt(length - 1) === 61) length--; // '='

  const byteLength = Math.floor((length * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let outputIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? (DECODE_TABLE[code] as number) : -1;
    if (value < 0) throw new Error(`Invalid base64 character at index ${i}`);

    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[outputIndex++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Tableaux typés                                                      */
/* ------------------------------------------------------------------ */

export function encodeUint8Array(values: Uint8Array): string {
  return encodeBase64(values);
}

export function decodeUint8Array(text: string): Uint8Array {
  return decodeBase64(text);
}

export function encodeInt16Array(values: Int16Array): string {
  return encodeBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

export function decodeInt16Array(text: string): Int16Array {
  const bytes = decodeBase64(text);
  // Recopie plutôt que vue directe : `bytes.buffer` n'est pas garanti aligné sur 2 octets.
  const output = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < output.length; i++) {
    output[i] = (((bytes[i * 2] as number) | ((bytes[i * 2 + 1] as number) << 8)) << 16) >> 16;
  }
  return output;
}

export function encodeUint16Array(values: Uint16Array): string {
  return encodeBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

export function decodeUint16Array(text: string): Uint16Array {
  const bytes = decodeBase64(text);
  const output = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < output.length; i++) {
    output[i] = (bytes[i * 2] as number) | ((bytes[i * 2 + 1] as number) << 8);
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* Quantification                                                      */
/* ------------------------------------------------------------------ */

/** Sentinelle « pas de valeur » pour les hauteurs quantifiées (par exemple : pas d'eau). */
export const HEIGHT_NONE = -32768;

/**
 * Décalage appliqué aux coordonnées locales des ressources, en mètres.
 *
 * Une ressource appartient au chunk qui contient le centre de sa cellule de candidature,
 * mais le décalage aléatoire peut la placer un ou deux mètres au-delà de la bordure. Sans
 * ce décalage, une coordonnée locale négative serait tronquée à zéro et l'individu sauterait
 * visiblement sur le bord du chunk.
 */
export const RESOURCE_LOCAL_OFFSET_METERS = 8;

/**
 * Hauteurs en mètres → centimètres sur 16 bits signés.
 * Plage utile : ±327 m, largement au-delà de l'amplitude du relief.
 */
export function encodeHeights(heights: Float32Array): string {
  const encoded = new Int16Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    const value = heights[i] as number;
    encoded[i] = Number.isFinite(value) ? clampInt16(Math.round(value * 100)) : HEIGHT_NONE;
  }
  return encodeInt16Array(encoded);
}

/** Décode des hauteurs ; la sentinelle redevient `NaN`. */
export function decodeHeights(text: string): Float32Array {
  const raw = decodeInt16Array(text);
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i] as number;
    heights[i] = value === HEIGHT_NONE ? Number.NaN : value / 100;
  }
  return heights;
}

function clampInt16(value: number): number {
  return value < -32767 ? -32767 : value > 32767 ? 32767 : value;
}
