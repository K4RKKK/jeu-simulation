import { describe, expect, it } from 'vitest';
import {
  HEIGHT_NONE,
  decodeBase64,
  decodeHeights,
  decodeInt16Array,
  decodeUint16Array,
  decodeUint8Array,
  encodeBase64,
  encodeHeights,
  encodeInt16Array,
  encodeUint16Array,
  encodeUint8Array,
} from './binary.js';

describe('base64', () => {
  it('fait un aller-retour sur des tailles quelconques', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + length) & 255;
      expect([...decodeBase64(encodeBase64(bytes))]).toEqual([...bytes]);
    }
  });

  it('couvre les 256 valeurs d’octet', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect([...decodeUint8Array(encodeUint8Array(bytes))]).toEqual([...bytes]);
  });

  it('produit une chaîne compacte', () => {
    const bytes = new Uint8Array(300);
    // Environ 4 caractères pour 3 octets, très loin des ~4 caractères par octet du JSON.
    expect(encodeBase64(bytes).length).toBeLessThan(bytes.length * 1.4);
  });

  it('rejette une chaîne invalide', () => {
    expect(() => decodeBase64('***')).toThrow(/Invalid base64/);
  });
});

describe('tableaux typés', () => {
  it('fait un aller-retour sur des entiers 16 bits signés', () => {
    const values = Int16Array.from([0, 1, -1, 32767, -32767, 1234, -4321]);
    expect([...decodeInt16Array(encodeInt16Array(values))]).toEqual([...values]);
  });

  it('fait un aller-retour sur des entiers 16 bits non signés', () => {
    const values = Uint16Array.from([0, 1, 65535, 6400, 32768]);
    expect([...decodeUint16Array(encodeUint16Array(values))]).toEqual([...values]);
  });
});

describe('hauteurs quantifiées', () => {
  it('conserve le centimètre', () => {
    const heights = Float32Array.from([0, 12.34, -30, 65.99, -7.05]);
    const decoded = decodeHeights(encodeHeights(heights));
    for (let i = 0; i < heights.length; i++) {
      expect(decoded[i] as number).toBeCloseTo(heights[i] as number, 2);
    }
  });

  it('transporte l’absence d’eau sans la confondre avec une altitude', () => {
    const heights = Float32Array.from([Number.NaN, 3.5, Number.NaN]);
    const decoded = decodeHeights(encodeHeights(heights));

    expect(Number.isNaN(decoded[0] as number)).toBe(true);
    expect(decoded[1] as number).toBeCloseTo(3.5, 2);
    expect(Number.isNaN(decoded[2] as number)).toBe(true);
    // La sentinelle est hors de toute altitude plausible : aucune confusion possible.
    expect(HEIGHT_NONE / 100).toBeLessThan(-300);
  });

  it('borne les valeurs extravagantes plutôt que de déborder', () => {
    const decoded = decodeHeights(encodeHeights(Float32Array.from([1e6, -1e6])));
    expect(decoded[0] as number).toBeCloseTo(327.67, 2);
    expect(decoded[1] as number).toBeCloseTo(-327.67, 2);
  });

  it('supporte une grille complète de chunk', () => {
    const heights = new Float32Array(17 * 17);
    for (let i = 0; i < heights.length; i++) heights[i] = Math.sin(i) * 40;

    const encoded = encodeHeights(heights);
    const decoded = decodeHeights(encoded);
    expect(decoded).toHaveLength(heights.length);
    for (let i = 0; i < heights.length; i++) {
      expect(decoded[i] as number).toBeCloseTo(heights[i] as number, 2);
    }
  });
});
