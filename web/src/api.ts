import { getSessionId } from './session';

/**
 * Typed fetch wrappers. Every call automatically carries the sessionId and
 * normalizes errors so components can render a consistent failure state.
 */

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
  maxioConfigured: boolean;
  slackConfigured: boolean;
  demoMode: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed`, res.status, data);
  }
  return data as T;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

/** POST helper that injects the sessionId into the body. */
export function postWithSession<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify({ sessionId: getSessionId(), ...body }),
  });
}
