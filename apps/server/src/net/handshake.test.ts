import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { PROTOCOL_VERSION, encodeMessage } from '@civ/shared';
import type { ServerConfig } from '../config.js';
import { SimulationHost } from '../simulationHost.js';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    worldSeed: 'handshake-test-seed',
    worldSizeChunks: 4,
    population: 1,
    tickRateHz: 20,
    netRateHz: 10,
    chunkBudgetMs: 8,
    allowRegenerate: true,
    saveDir: '',
    saveSlot: 'world',
    autosaveIntervalTicks: 0,
    saveOnShutdown: false,
    trustedOrigins: [],
    ...overrides,
  };
}

interface FakeSocket {
  readonly sent: string[];
  closedWith: { code: number; reason: string } | null;
  emit(data: string): void;
}

/** Simule juste assez de l'API `ws` pour piloter `SimulationHost.addClient()` en test. */
function fakeSocket(): { socket: WebSocket; fake: FakeSocket } {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const fake: FakeSocket = {
    sent: [],
    closedWith: null,
    emit: (data: string) => {
      for (const handler of handlers.get('message') ?? []) handler(data);
    },
  };
  const socket = {
    readyState: 1,
    OPEN: 1,
    CONNECTING: 0,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    send: (data: string) => {
      fake.sent.push(data);
    },
    close: (code: number, reason: string) => {
      fake.closedWith = { code, reason };
      for (const handler of handlers.get('close') ?? []) handler();
    },
  } as unknown as WebSocket;
  return { socket, fake };
}

describe('handshake — hello avant init, fermeture sur non-conformité', () => {
  let host: SimulationHost | null = null;

  afterEach(async () => {
    await host?.stop();
    host = null;
  });

  it("n'envoie aucun message avant que le client dise hello", async () => {
    host = new SimulationHost(makeConfig());
    await host.initialize();
    host.start();

    const { socket, fake } = fakeSocket();
    host.addClient(socket);

    expect(fake.sent).toHaveLength(0);
  });

  it('envoie init seulement après un hello à la bonne version de protocole', async () => {
    host = new SimulationHost(makeConfig());
    await host.initialize();
    host.start();

    const { socket, fake } = fakeSocket();
    host.addClient(socket);
    fake.emit(encodeMessage({ t: 'hello', protocolVersion: PROTOCOL_VERSION }));

    expect(fake.sent).toHaveLength(1);
    const message = JSON.parse(fake.sent[0] as string) as { t: string };
    expect(message.t).toBe('init');
    expect(fake.closedWith).toBeNull();
  });

  it('ferme la connexion sur un protocolVersion incompatible', async () => {
    host = new SimulationHost(makeConfig());
    await host.initialize();
    host.start();

    const { socket, fake } = fakeSocket();
    host.addClient(socket);
    fake.emit(encodeMessage({ t: 'hello', protocolVersion: PROTOCOL_VERSION + 999 }));

    expect(fake.closedWith).not.toBeNull();
    expect(fake.closedWith?.code).toBe(1002);
  });

  it('ferme la connexion si un client envoie autre chose que hello en premier', async () => {
    host = new SimulationHost(makeConfig());
    await host.initialize();
    host.start();

    const { socket, fake } = fakeSocket();
    host.addClient(socket);
    fake.emit(encodeMessage({ t: 'ping', clientTime: 0 }));

    expect(fake.closedWith).not.toBeNull();
    expect(fake.closedWith?.code).toBe(1002);
    // Aucun `pong` ne doit être parti avant le handshake.
    expect(fake.sent).toHaveLength(0);
  });
});
