// Debug mode — gated behind VITE_DEBUG_MODE env var (set in local .env, not deployed)
export const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true';

// Mutable debug state toggled by DebugOverlay
export const debugState = {
  invincible: false,
};
