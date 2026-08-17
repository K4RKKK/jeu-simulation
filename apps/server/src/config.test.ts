import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadServerConfig } from './config.js';

const ENV_KEYS = ['CIV_PORT', 'CIV_TRUSTED_ORIGINS', 'NODE_ENV'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe('loadServerConfig — trustedOrigins', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('inclut toujours 127.0.0.1 et localhost sur le port configuré', () => {
    process.env.CIV_PORT = '9001';
    delete process.env.CIV_TRUSTED_ORIGINS;
    const config = loadServerConfig();
    expect(config.trustedOrigins).toContain('http://127.0.0.1:9001');
    expect(config.trustedOrigins).toContain('http://localhost:9001');
  });

  it('ajoute les origines explicites à la liste plutôt que de les remplacer', () => {
    process.env.CIV_PORT = '9001';
    process.env.CIV_TRUSTED_ORIGINS = 'https://example.test';
    const config = loadServerConfig();
    expect(config.trustedOrigins).toContain('http://127.0.0.1:9001');
    expect(config.trustedOrigins).toContain('https://example.test');
  });

  it('en production sans liste explicite, ne fait confiance qu’à soi-même', () => {
    process.env.CIV_PORT = '9001';
    process.env.NODE_ENV = 'production';
    delete process.env.CIV_TRUSTED_ORIGINS;
    const config = loadServerConfig();
    expect(config.trustedOrigins).toEqual(['http://127.0.0.1:9001', 'http://localhost:9001']);
  });
});
