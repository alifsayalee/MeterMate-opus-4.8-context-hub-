import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { adminGuard } from '../../src/auth.js';

// vitest env sets no ADMIN_USER/PASSWORD, so config defaults apply: admin/changeme.
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('adminGuard', () => {
  it('rejects with 401 when no Authorization header is present (AC-14)', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    adminGuard(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 401 on wrong credentials', () => {
    const req = { headers: { authorization: basic('admin', 'wrong') } } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    adminGuard(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() on valid admin credentials', () => {
    const req = { headers: { authorization: basic('admin', 'changeme') } } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    adminGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
