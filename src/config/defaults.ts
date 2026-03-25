/**
 * Default configuration values for the Jira MCP Server.
 *
 * These defaults are applied when no explicit value is provided
 * via environment variables or the optional config file.
 */

import type { CacheConfig } from "../types/config.js";

/** Default cache configuration. */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  ttlSeconds: 300,
  maxEntries: 1000,
};

/** Default tool allowlist (empty = all tools allowed). */
export const DEFAULT_ALLOWED_TOOLS: string[] = [];

/** Default tool blocklist (empty = no tools blocked). */
export const DEFAULT_BLOCKED_TOOLS: string[] = [];

/** Default project key filter (empty = no restriction). */
export const DEFAULT_PROJECT_KEYS: string[] = [];
