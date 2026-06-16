import { ApiError } from '@maxio-com/advanced-billing-sdk';

/**
 * Typed error for the Maxio service layer. Routes catch this to return a
 * `maxio_failed` status with a clean, human-readable summary — without leaking
 * SDK internals or stack traces to the client.
 */
export class MaxioServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly details: string[],
  ) {
    super(message);
    this.name = 'MaxioServiceError';
  }
}

/** Human-readable description for common HTTP status codes. */
function httpStatusText(code: number | undefined): string {
  switch (code) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable Entity';
    case 429:
      return 'Too Many Requests';
    case 500:
      return 'Internal Server Error';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    default:
      return code != null ? `HTTP ${code}` : 'Unknown error';
  }
}

/** Extracts human-readable error strings from a Maxio error response body. */
function extractDetails(body: unknown): string[] {
  if (body == null) return [];
  let parsed: unknown = body;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed === '') return []; // empty body carries no detail
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [trimmed];
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return [];

  const out: string[] = [];
  const errors = (parsed as Record<string, unknown>).errors;
  if (Array.isArray(errors)) {
    for (const e of errors) {
      if (typeof e === 'string') out.push(e);
      else if (e && typeof e === 'object' && 'message' in e) out.push(String((e as { message: unknown }).message));
    }
  } else if (errors && typeof errors === 'object') {
    // Field-keyed map: { field: ["msg", ...] }
    for (const [field, msgs] of Object.entries(errors as Record<string, unknown>)) {
      const list = Array.isArray(msgs) ? msgs : [msgs];
      for (const m of list) out.push(`${field}: ${String(m)}`);
    }
  }
  const single = (parsed as Record<string, unknown>).error;
  if (typeof single === 'string') out.push(single);
  return out.filter((s) => s != null && s.trim() !== '');
}

/**
 * Normalizes any thrown value from a Maxio SDK call into a MaxioServiceError.
 * Recognizes the SDK's ApiError (statusCode + body) and falls back gracefully
 * for network errors and unknown throwables.
 */
export function normalizeMaxioError(err: unknown, operation: string): MaxioServiceError {
  if (err instanceof ApiError) {
    const details = extractDetails(err.body);
    const message = err.message?.trim();
    // Always end up with something meaningful: parsed details, then the SDK
    // message, then the HTTP status description.
    const summary =
      details.length > 0
        ? details.join('; ')
        : message && message.length > 0
          ? message
          : `Maxio returned ${httpStatusText(err.statusCode)}`;
    return new MaxioServiceError(`${operation} failed: ${summary}`, err.statusCode, details);
  }
  if (err instanceof Error) {
    // Network/timeout/DNS errors land here.
    return new MaxioServiceError(`${operation} failed: ${err.message}`, undefined, []);
  }
  return new MaxioServiceError(`${operation} failed: unknown error`, undefined, []);
}
