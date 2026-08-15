import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { ClientSession } from './clientSession.js';

function fakeSocket(): WebSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    OPEN: 1,
    send: () => {},
  } as unknown as WebSocket;
}

/**
 * Bug corrigé : l'hôte incrémentait un compteur de séquence GLOBAL à chaque tour de
 * diffusion, même pour les clients auxquels rien n'était envoyé ce tour-ci (aucun
 * delta). Un futur détecteur de désync (« seq attendu N+1, reçu N+3 ») aurait alors
 * déclenché des faux positifs en continu, puisque le saut ne correspondait à aucun
 * paquet réellement perdu. `nextStateSequence()` vit maintenant par session et
 * n'avance que lorsqu'un état est réellement envoyé à CETTE session précise.
 */
describe('ClientSession.nextStateSequence', () => {
  it('starts at 1 and increments by exactly 1 per call', () => {
    const session = new ClientSession(fakeSocket());
    expect(session.nextStateSequence()).toBe(1);
    expect(session.nextStateSequence()).toBe(2);
    expect(session.nextStateSequence()).toBe(3);
  });

  it('is independent per session — one client’s quiet round never skips another’s sequence', () => {
    const a = new ClientSession(fakeSocket());
    const b = new ClientSession(fakeSocket());

    // Simule 3 tours de diffusion où seul `a` reçoit un état à chaque fois (b n'a
    // rien de nouveau à ce tour) : la séquence de `b` ne doit JAMAIS bouger tant
    // qu'on n'appelle pas nextStateSequence() sur elle.
    expect(a.nextStateSequence()).toBe(1);
    expect(a.nextStateSequence()).toBe(2);
    expect(a.nextStateSequence()).toBe(3);

    // `b` reçoit son premier état seulement maintenant : sa séquence démarre à 1,
    // pas à 4 — elle n'a jamais "raté" de paquets, elle n'en avait simplement pas
    // reçu avant. Un compteur global aurait ici produit un faux saut.
    expect(b.nextStateSequence()).toBe(1);
  });
});

describe('ClientSession — resync', () => {
  it('needsFullSnapshot est faux par défaut, et jusqu’à une demande explicite', () => {
    const session = new ClientSession(fakeSocket());
    expect(session.consumeNeedsFullSnapshot()).toBe(false);
  });

  it('requestResync arme la demande, consumeNeedsFullSnapshot la lit ET l’efface', () => {
    const session = new ClientSession(fakeSocket());
    session.requestResync();

    expect(session.consumeNeedsFullSnapshot()).toBe(true);
    // Une fois consommée, la demande ne doit pas se redéclencher au tour suivant.
    expect(session.consumeNeedsFullSnapshot()).toBe(false);
  });

  it('une demande répétée avant consommation reste une simple demande unique', () => {
    const session = new ClientSession(fakeSocket());
    session.requestResync();
    session.requestResync();

    expect(session.consumeNeedsFullSnapshot()).toBe(true);
    expect(session.consumeNeedsFullSnapshot()).toBe(false);
  });
});
