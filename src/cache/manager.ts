/**
 * LRU Cache Manager for the Jira MCP Server.
 *
 * Uses a plain Map to maintain insertion order. Entries are evicted
 * in least-recently-used order when the cache reaches its capacity.
 */

import type { CacheEntry, CacheResult } from "./types.js";

/** Configuration accepted by the CacheManager constructor. */
interface CacheManagerConfig {
  /** Whether caching is enabled. */
  enabled: boolean;
  /** Time-to-live for cache entries in seconds. */
  ttlSeconds: number;
  /** Maximum number of entries the cache can hold. */
  maxEntries: number;
}

/**
 * An in-memory LRU cache backed by a JS Map.
 *
 * Map preserves insertion order, so the *first* key returned by
 * `map.keys()` is always the least-recently-used entry.  Accessing
 * or inserting an entry deletes and re-inserts it to move it to
 * the "most recently used" position.
 */
export class CacheManager {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly config: CacheManagerConfig;

  constructor(config: CacheManagerConfig) {
    this.config = config;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Retrieve a cached value by key.
   *
   * @returns The cached result, or `null` when the cache is disabled,
   *          the key is missing, or the entry has expired.
   */
  get<T>(key: string): CacheResult<T> | null {
    if (!this.config.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    // Expired — remove and report miss.
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to most-recently-used position.
    this.cache.delete(key);
    this.cache.set(key, entry);

    return {
      data: entry.data as T,
      cached: true,
      cachedAt: new Date(entry.cachedAt).toISOString(),
    };
  }

  /**
   * Store a value in the cache.
   *
   * If the cache is at capacity the least-recently-used entry is evicted
   * before the new entry is inserted.  Does nothing when caching is disabled.
   */
  set<T>(key: string, data: T): void {
    if (!this.config.enabled) return;

    // If the key already exists, delete first so reinsertion moves it to the end.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entry when at capacity.
    if (this.cache.size >= this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string;
      this.cache.delete(oldestKey);
    }

    const now = Date.now();
    this.cache.set(key, {
      data,
      cachedAt: now,
      expiresAt: now + this.config.ttlSeconds * 1000,
    });
  }

  /**
   * Remove all entries from the cache.
   *
   * @returns The number of entries that were cleared.
   */
  clear(): { entriesCleared: number } {
    const count = this.cache.size;
    this.cache.clear();
    return { entriesCleared: count };
  }

  /** Return basic cache statistics. */
  getStats(): { size: number; maxEntries: number; enabled: boolean } {
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      enabled: this.config.enabled,
    };
  }

  /**
   * Generate a deterministic cache key from a tool name and its parameters.
   *
   * Parameters are sorted by key to ensure the same logical request always
   * produces the same cache key regardless of property insertion order.
   */
  generateKey(toolName: string, params: Record<string, unknown>): string {
    const sortedParams = JSON.stringify(params, Object.keys(params).sort());
    return `${toolName}:${sortedParams}`;
  }
}
