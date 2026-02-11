import { markStartup } from './startupTelemetry.js';

function normalizeError(err) {
  if (!err) return { message: 'unknown', name: 'Error', code: null };
  if (typeof err === 'string') return { message: err, name: 'Error', code: null };
  return {
    message: err.message || String(err),
    name: err.name || 'Error',
    code: err.code || null,
  };
}

export function reportAsyncError(context, err, extra = {}) {
  const normalized = normalizeError(err);
  markStartup('async_error', {
    context,
    message: normalized.message,
    name: normalized.name,
    code: normalized.code,
    ...extra,
  });
  console.warn(`[AsyncError] ${context}:`, normalized.message, {
    name: normalized.name,
    code: normalized.code,
    ...extra,
  });
}

