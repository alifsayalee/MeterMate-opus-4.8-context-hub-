/**
 * Minimal structured logger. Centralizing log calls here keeps formatting
 * consistent and gives a single seam to swap in pino/winston later without
 * touching call sites.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] ${level.toUpperCase().padEnd(5)} (${scope})`;
  const line = `${prefix} ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) {
    sink(line, meta);
  } else {
    sink(line);
  }
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
  };
}
