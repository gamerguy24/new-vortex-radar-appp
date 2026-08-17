/**
 * In-memory attempt throttling. Keyed per identity and per source IP so neither
 * a targeted attack on one account nor a spray from one host runs unbounded.
 */

interface Bucket {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

export interface ThrottleState {
  blocked: boolean;
  retryAfterSeconds: number;
}

export interface ThrottleOptions {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

export interface Throttle {
  check(keys: string[]): ThrottleState;
  recordFailure(keys: string[]): void;
  clear(keys: string[]): void;
}

export function createThrottle(options: ThrottleOptions): Throttle {
  const buckets = new Map<string, Bucket>();

  const getBucket = (key: string): Bucket => {
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || (now - existing.firstAttemptAt > options.windowMs && now >= existing.lockedUntil)) {
      const fresh: Bucket = { attempts: 0, firstAttemptAt: now, lockedUntil: 0 };
      buckets.set(key, fresh);
      return fresh;
    }

    return existing;
  };

  // Bounded cleanup so the map cannot grow without limit on a long-lived process.
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.lockedUntil < now && now - bucket.firstAttemptAt > options.windowMs) {
        buckets.delete(key);
      }
    }
  }, options.windowMs).unref();

  return {
    check(keys) {
      const now = Date.now();
      let retryAfter = 0;

      for (const key of keys) {
        const bucket = getBucket(key);
        if (bucket.lockedUntil > now) {
          retryAfter = Math.max(retryAfter, Math.ceil((bucket.lockedUntil - now) / 1000));
        }
      }

      return { blocked: retryAfter > 0, retryAfterSeconds: retryAfter };
    },

    recordFailure(keys) {
      const now = Date.now();
      for (const key of keys) {
        const bucket = getBucket(key);
        bucket.attempts += 1;
        if (bucket.attempts >= options.maxAttempts) {
          bucket.lockedUntil = now + options.lockoutMs;
          bucket.attempts = 0;
          bucket.firstAttemptAt = now;
        }
      }
    },

    clear(keys) {
      for (const key of keys) buckets.delete(key);
    },
  };
}

/** Failed sign-in attempts. */
export const loginThrottle = createThrottle({
  maxAttempts: 8,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
});

/**
 * Password reset requests, per target account. Tight, because each successful
 * request invalidates that account's current password — an attacker who could
 * spam this endpoint could keep one user permanently locked out.
 */
export const resetIdentityThrottle = createThrottle({
  maxAttempts: 3,
  windowMs: 60 * 60 * 1000,
  lockoutMs: 60 * 60 * 1000,
});

/**
 * Password reset requests, per source IP. Deliberately looser than the per-account
 * limit: several unrelated users can share one address behind NAT, so a tight cap
 * here would let one person's resets lock out everyone else on their network.
 * This exists to stop bulk scripted abuse, not to police individual users.
 */
export const resetIpThrottle = createThrottle({
  maxAttempts: 20,
  windowMs: 60 * 60 * 1000,
  lockoutMs: 30 * 60 * 1000,
});
