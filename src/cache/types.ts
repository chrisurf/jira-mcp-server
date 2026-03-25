/**
 * Cache type definitions for the Jira MCP Server.
 *
 * These interfaces describe the shape of cached data entries
 * and the result objects returned when reading from the cache.
 */

/** A single entry stored in the cache. */
export interface CacheEntry<T> {
  /** The cached payload. */
  data: T;
  /** Timestamp (Date.now()) when the entry was stored. */
  cachedAt: number;
  /** Timestamp (Date.now()) after which the entry is considered stale. */
  expiresAt: number;
}

/** Result returned by a cache lookup. */
export interface CacheResult<T> {
  /** The payload (from cache or freshly fetched). */
  data: T;
  /** Whether the data was served from cache. */
  cached: boolean;
  /** ISO 8601 string of the time the data was cached, if served from cache. */
  cachedAt?: string;
}
