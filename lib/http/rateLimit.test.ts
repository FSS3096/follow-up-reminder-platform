import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit per window, then returns seconds to wait', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 10_000 });
    expect(rl.check('u', 0)).toBe(0);
    expect(rl.check('u', 1000)).toBe(0);
    expect(rl.check('u', 2000)).toBe(8);
    expect(rl.check('other', 2000)).toBe(0);
    expect(rl.check('u', 10_000)).toBe(0);
  });
  it('bounds memory', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    for (let i = 0; i < 100; i++) expect(rl.check(`k${i}`, 0)).toBe(0);
  });
});
