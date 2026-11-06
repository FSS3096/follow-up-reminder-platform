/**
 * In-memory fixed-window rate limiter (acceptable for v1, Brief B10).
 * Per server instance only: on Vercel each warm lambda has its own window, so this is a
 * brake on runaway clients, not a security boundary. Upgrade path: Upstash Redis free tier.
 */
export interface RateLimiter {
  /** Returns 0 if allowed, else seconds until the window resets. */
  check(key: string, now?: number): number;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  const maxKeys = opts.maxKeys ?? 10_000;
  return {
    check(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (now - v.start >= opts.windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.clear();
        }
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= opts.limit) return 0;
      return Math.max(1, Math.ceil((w.start + opts.windowMs - now) / 1000));
    },
  };
}
