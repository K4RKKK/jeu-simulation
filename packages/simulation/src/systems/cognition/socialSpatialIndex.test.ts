import { describe, expect, it } from 'vitest';
import { SocialSpatialIndex } from './socialSpatialIndex.js';

describe('SocialSpatialIndex', () => {
  it("n'inspecte que les acteurs des cellules voisines, jamais toutes les paires", () => {
    // Damier régulier : 100 acteurs sur une grille 10×10, écart 50 m entre acteurs.
    // Avec cellSize = 32 m et un query radius = 32 m, chaque observateur inspecte au
    // plus les 3×3 cellules autour de lui, chacune contenant au plus 1 acteur.
    const index = new SocialSpatialIndex(32);
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        index.add(i * 10 + j + 1, i * 50, j * 50);
      }
    }
    // Simule un observateur au centre.
    index.forEachNear(250, 250, 32, () => undefined);
    // Preuve structurelle : les 100 acteurs n'ont PAS tous été inspectés — au plus 9
    // cellules × 1 acteur = 9 inspections, indépendamment de N.
    expect(index.candidateChecks).toBeLessThanOrEqual(9);
    expect(index.candidateChecks).toBeLessThan(100);
  });

  it('scale linéairement avec la densité locale, pas avec la population globale', () => {
    // Deux runs : 100 acteurs dispersés, puis 1000 acteurs tout aussi dispersés (grille
    // plus large mais même densité). Un même observateur au centre doit inspecter
    // à peu près le même nombre de candidats — pas 10× plus.
    const build = (side: number, spacingM: number): SocialSpatialIndex => {
      const idx = new SocialSpatialIndex(32);
      for (let i = 0; i < side; i++) {
        for (let j = 0; j < side; j++) {
          idx.add(i * side + j + 1, i * spacingM, j * spacingM);
        }
      }
      return idx;
    };
    const small = build(10, 50); // 100 acteurs
    const large = build(32, 50); // 1024 acteurs, MÊME densité
    small.forEachNear(250, 250, 32, () => undefined);
    large.forEachNear(800, 800, 32, () => undefined);
    // Les deux voient à peu près la même chose : entre 0 et ~9 candidats. Le seuil
    // haut est laxe, ce qui compte est qu'il ne dépende PAS de la population globale.
    expect(large.candidateChecks).toBeLessThanOrEqual(small.candidateChecks + 3);
  });

  it('visite uniquement les acteurs strictement dans le disque', () => {
    const index = new SocialSpatialIndex(32);
    index.add(1, 0, 0); // à distance 0
    index.add(2, 30, 0); // à distance 30 — dans le rayon 32
    index.add(3, 40, 0); // à distance 40 — hors du rayon 32
    const visited: number[] = [];
    index.forEachNear(0, 0, 32, (entity) => visited.push(entity));
    expect(visited).toEqual([1, 2]);
    // Le candidat 3 est dans une cellule voisine, il est INSPECTÉ mais pas visité.
    expect(index.candidateChecks).toBe(3);
  });

  it('est déterministe : deux insertions dans le même ordre produisent la même séquence de visites', () => {
    const build = (): SocialSpatialIndex => {
      const idx = new SocialSpatialIndex(16);
      for (let i = 1; i <= 20; i++) idx.add(i, i * 2, i * 2);
      return idx;
    };
    const a: number[] = [];
    const b: number[] = [];
    build().forEachNear(20, 20, 40, (entity) => a.push(entity));
    build().forEachNear(20, 20, 40, (entity) => b.push(entity));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('refuse une taille de cellule invalide', () => {
    expect(() => new SocialSpatialIndex(0)).toThrow();
    expect(() => new SocialSpatialIndex(-5)).toThrow();
  });

  it('ne fait rien pour un rayon négatif', () => {
    const index = new SocialSpatialIndex(32);
    index.add(1, 0, 0);
    let visits = 0;
    index.forEachNear(0, 0, -1, () => visits++);
    expect(visits).toBe(0);
    expect(index.candidateChecks).toBe(0);
  });
});
