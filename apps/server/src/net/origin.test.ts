import { describe, expect, it } from 'vitest';
import { isTrustedOrigin } from './origin.js';

describe('isTrustedOrigin', () => {
  it('refuse une origine absente', () => {
    expect(isTrustedOrigin(undefined, '127.0.0.1:8787', new Set())).toBe(false);
  });

  it("n'accepte plus n'importe quelle origine par simple réflexion", () => {
    expect(isTrustedOrigin('https://evil.example', '127.0.0.1:8787', new Set())).toBe(false);
  });

  it('accepte une origine explicitement listée', () => {
    const trusted = new Set(['http://localhost:5173']);
    expect(isTrustedOrigin('http://localhost:5173', '127.0.0.1:8787', trusted)).toBe(true);
  });

  it("accepte le client servi par le serveur lui-même (même hôte) sans liste explicite", () => {
    expect(isTrustedOrigin('http://127.0.0.1:8787', '127.0.0.1:8787', new Set())).toBe(true);
  });

  it('refuse une origine dont le host ne correspond ni à la liste ni à la requête', () => {
    expect(isTrustedOrigin('http://127.0.0.1:9999', '127.0.0.1:8787', new Set())).toBe(false);
  });

  it('ne plante pas sur une origine malformée', () => {
    expect(isTrustedOrigin('not-a-url', '127.0.0.1:8787', new Set())).toBe(false);
  });
});
