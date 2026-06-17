import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { createLogger } from './logger.js';

/**
 * Hardcoded admin gate (plan §4.4) — a placeholder for real auth. Admin routes
 * (UC5 invoices, UC6 digest) require HTTP Basic credentials matching
 * ADMIN_USER / ADMIN_PASSWORD. A clean seam: swap this middleware for JWT/OAuth
 * later without touching the routes.
 */
const log = createLogger('auth');

/** Constant-time string compare that also resists length leakage. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Compare against self to keep timing roughly constant, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function unauthorized(res: Response, message: string): Response {
  res.setHeader('WWW-Authenticate', 'Basic realm="MeterMate Admin"');
  return res.status(401).json({ status: 'unauthorized', error: message });
}

export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    unauthorized(res, 'Admin credentials required');
    return;
  }
  let user = '';
  let pass = '';
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep === -1) {
      unauthorized(res, 'Malformed credentials');
      return;
    }
    user = decoded.slice(0, sep);
    pass = decoded.slice(sep + 1);
  } catch {
    unauthorized(res, 'Malformed credentials');
    return;
  }

  const ok = safeEqual(user, config.admin.user) && safeEqual(pass, config.admin.password);
  if (!ok) {
    log.warn(`Admin auth failed for user "${user}"`);
    unauthorized(res, 'Invalid admin credentials');
    return;
  }
  next();
}
