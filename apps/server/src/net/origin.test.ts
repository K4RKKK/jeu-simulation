import { describe, expect, it } from 'vitest';
import { isTrustedOrigin } from './origin.js';

describe('isTrustedOrigin', () => {
  it('refuse une origine absente', () => {
    expect(isTrustedOrigin(undefined, new Set())).toBe(false);
  });

  it("n'accepte plus n'importe quelle origine par simple réflexion", () => {
    expect(isTrustedOrigin('https://evil.example', new Set())).toBe(false);
  });

  it('accepte une origine explicitement listée', () => {
    const trusted = new Set(['http://localhost:5173']);
    expect(isTrustedOrigin('http://localhost:5173', trusted)).toBe(true);
  });

  it('refuse une origine absente de la liste', () => {
    const trusted = new Set(['http://127.0.0.1:8787']);
    expect(isTrustedOrigin('http://127.0.0.1:9999', trusted)).toBe(false);
  });

  it(
    "résiste au DNS rebinding : une origine externe n'est jamais acceptée même si elle " +
      "prétend correspondre à l'hôte visé, car aucun en-tête Host n'entre dans la décision",
    () => {
      const trusted = new Set(['http://127.0.0.1:8787']);
      expect(isTrustedOrigin('http://evil.example:8787', trusted)).toBe(false);
    },
  );
});
