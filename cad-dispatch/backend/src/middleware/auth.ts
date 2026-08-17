import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppUser, getUserStore, UserRole } from '../services/userStore';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AppUser;
    }
  }
}

export interface TokenClaims {
  sub: string;
  role: UserRole;
  department: string;
  /** Password version at issue time; a credential change invalidates the token. */
  pv: number;
}

export function issueToken(user: AppUser): string {
  const claims: TokenClaims = {
    sub: user.id,
    role: user.role,
    department: user.department,
    pv: user.passwordVersion,
  };
  return jwt.sign(claims, env.jwtSecret, { expiresIn: env.tokenTtl } as jwt.SignOptions);
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Verifies the bearer token and loads the live user record. Rejects tokens whose
 * password version is stale, so a password reset or suspension takes effect
 * immediately rather than when the token happens to expire.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, env.jwtSecret) as TokenClaims;
  } catch {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  const user = await getUserStore().findById(claims.sub);
  if (!user) {
    res.status(401).json({ error: 'Account no longer exists.' });
    return;
  }

  if (user.passwordVersion !== claims.pv) {
    res.status(401).json({ error: 'Your credentials changed. Please sign in again.' });
    return;
  }

  if (user.status !== 'active') {
    res.status(403).json({ error: statusMessage(user.status), status: user.status });
    return;
  }

  req.authUser = user;
  next();
}

export function statusMessage(status: AppUser['status']): string {
  switch (status) {
    case 'pending':
      return 'Your account is awaiting administrator approval.';
    case 'suspended':
      return 'Your account has been suspended. Contact an administrator.';
    case 'denied':
      return 'Your access request was denied.';
    default:
      return 'Your account is not active.';
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: 'You do not have permission to do that.' });
      return;
    }
    next();
  };
}

/**
 * Blocks normal application access while a forced password change is pending.
 * Applied after requireAuth on feature routes, never on the change-password route.
 */
export function requireCurrentPassword(req: Request, res: Response, next: NextFunction): void {
  if (req.authUser?.mustChangePassword) {
    res.status(403).json({ error: 'You must change your password before continuing.', mustChangePassword: true });
    return;
  }
  next();
}

/** Wraps an async handler so a rejected promise becomes a 500 instead of a crash. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
