import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { ClientSession } from './clientSession.js';
import { sendToSessionsHoldingChunk } from './chunkScopedBroadcast.js';

function fakeSession(): { session: ClientSession; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  const socket = { readyState: 1, OPEN: 1, send } as unknown as WebSocket;
  return { session: new ClientSession(socket), send };
}

describe('sendToSessionsHoldingChunk', () => {
  /**
   * Bug corrigé : `resource:removed`/`trail:updated` partaient vers TOUS les clients
   * connectés, quelle que soit leur zone d'intérêt — un client qui regarde le coin
   * nord-est du monde recevait quand même une usure de sentier à l'autre bout de la
   * carte. Ce test verrouille : seule une session qui possède DÉJÀ le chunk reçoit
   * le message.
   */
  it('envoie uniquement aux sessions qui possèdent déjà le chunk', () => {
    const holder = fakeSession();
    holder.session.rememberChunk('0:0');
    const elsewhere = fakeSession();
    elsewhere.session.rememberChunk('9:9'); // regarde une tout autre région

    sendToSessionsHoldingChunk([holder.session, elsewhere.session], '0:0', {
      t: 'trail:updated',
      chunkKey: '0:0',
      resolution: 4,
      cells: [{ index: 0, wear: 200 }],
    });

    expect(holder.send).toHaveBeenCalledTimes(1);
    expect(elsewhere.send).not.toHaveBeenCalled();
  });

  it("n'envoie à personne quand aucune session ne détient le chunk", () => {
    const a = fakeSession();
    const b = fakeSession();

    sendToSessionsHoldingChunk([a.session, b.session], '0:0', {
      t: 'resource:removed',
      chunkKey: '0:0',
      localId: 3,
      sequenceNumber: 0,
    });

    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).not.toHaveBeenCalled();
  });

  it('envoie à plusieurs sessions qui détiennent toutes le chunk', () => {
    const a = fakeSession();
    a.session.rememberChunk('2:-1');
    const b = fakeSession();
    b.session.rememberChunk('2:-1');

    sendToSessionsHoldingChunk([a.session, b.session], '2:-1', {
      t: 'resource:removed',
      chunkKey: '2:-1',
      localId: 7,
      sequenceNumber: 0,
    });

    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledTimes(1);
  });
});
