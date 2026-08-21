import { describe, it, expect } from 'vitest';
import { assertConfigCompatibleWithMode } from './node';

describe('assertConfigCompatibleWithMode', () => {
  it('throws when --config and --local-network are combined', () => {
    expect(() =>
      assertConfigCompatibleWithMode({ config: 'my-rippled.cfg', localNetwork: true })
    ).toThrow(/--config and --local-network cannot be used together/);
  });

  it('allows --config with standalone mode (no --local-network)', () => {
    expect(() =>
      assertConfigCompatibleWithMode({ config: 'my-rippled.cfg' })
    ).not.toThrow();
  });

  it('allows --local-network without --config', () => {
    expect(() => assertConfigCompatibleWithMode({ localNetwork: true })).not.toThrow();
  });

  it('allows neither flag', () => {
    expect(() => assertConfigCompatibleWithMode({})).not.toThrow();
  });
});
