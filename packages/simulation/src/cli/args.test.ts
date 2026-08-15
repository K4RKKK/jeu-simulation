import { describe, expect, it } from 'vitest';
import { CLI_DEFAULTS, parseCliArgs } from './args.js';

describe('parseCliArgs — options de sauvegarde', () => {
  it('utilise les valeurs par défaut sans flags', () => {
    const options = parseCliArgs([]);
    expect(options.saveDir).toBe(CLI_DEFAULTS.saveDir);
    expect(options.saveTo).toBeNull();
    expect(options.loadFrom).toBeNull();
  });

  it('lit --save-to, --load-from et --save-dir', () => {
    const options = parseCliArgs([
      '--save-to',
      'world-1',
      '--load-from',
      'world-0',
      '--save-dir',
      '/tmp/saves',
    ]);
    expect(options.saveTo).toBe('world-1');
    expect(options.loadFrom).toBe('world-0');
    expect(options.saveDir).toBe('/tmp/saves');
  });

  it('accepte la forme --flag=valeur', () => {
    const options = parseCliArgs(['--save-to=autosave', '--save-dir=./saves']);
    expect(options.saveTo).toBe('autosave');
    expect(options.saveDir).toBe('./saves');
  });

  it('rejette une option inconnue', () => {
    expect(() => parseCliArgs(['--not-a-real-flag'])).toThrow(/Unknown option/);
  });
});
