import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CacheManager } from "../../../src/cache/manager.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createManager(
  overrides: Partial<{
    enabled: boolean;
    ttlSeconds: number;
    maxEntries: number;
  }> = {},
) {
  return new CacheManager({
    enabled: true,
    ttlSeconds: 300,
    maxEntries: 100,
    ...overrides,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("CacheManager", () => {
  /* ── Disabled cache ──────────────────────────────────────────────── */

  describe("when cache is disabled", () => {
    it("get returns null", () => {
      const mgr = createManager({ enabled: false });
      mgr.set("key", { value: 1 });
      expect(mgr.get("key")).toBeNull();
    });

    it("set does not store anything", () => {
      const mgr = createManager({ enabled: false });
      mgr.set("key", { value: 1 });
      expect(mgr.getStats().size).toBe(0);
    });
  });

  /* ── Basic get / set ─────────────────────────────────────────────── */

  describe("basic operations", () => {
    it("returns cached data with cached=true flag", () => {
      const mgr = createManager();
      mgr.set("k", { hello: "world" });

      const result = mgr.get<{ hello: string }>("k");

      expect(result).not.toBeNull();
      expect(result!.cached).toBe(true);
      expect(result!.data).toEqual({ hello: "world" });
      expect(result!.cachedAt).toBeDefined();
    });

    it("returns null for a missing key", () => {
      const mgr = createManager();
      expect(mgr.get("nonexistent")).toBeNull();
    });
  });

  /* ── TTL expiration ──────────────────────────────────────────────── */

  describe("TTL expiration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns null after TTL expires", () => {
      const mgr = createManager({ ttlSeconds: 10 });
      mgr.set("k", "data");

      // Still valid at 9 999 ms.
      vi.advanceTimersByTime(9_999);
      expect(mgr.get("k")).not.toBeNull();

      // Expired at 10 001 ms.
      vi.advanceTimersByTime(2);
      expect(mgr.get("k")).toBeNull();
    });
  });

  /* ── LRU eviction ───────────────────────────────────────────────── */

  describe("LRU eviction", () => {
    it("evicts the oldest entry when cache is full", () => {
      const mgr = createManager({ maxEntries: 3 });

      mgr.set("a", 1);
      mgr.set("b", 2);
      mgr.set("c", 3);
      // Cache is full — adding 'd' should evict 'a'.
      mgr.set("d", 4);

      expect(mgr.get("a")).toBeNull();
      expect(mgr.get("b")).not.toBeNull();
      expect(mgr.get("d")).not.toBeNull();
    });

    it("accessing an entry moves it to most recent (survives eviction)", () => {
      const mgr = createManager({ maxEntries: 3 });

      mgr.set("a", 1);
      mgr.set("b", 2);
      mgr.set("c", 3);

      // Access 'a' — now 'b' is the least recently used.
      mgr.get("a");

      // Adding 'd' should evict 'b', not 'a'.
      mgr.set("d", 4);

      expect(mgr.get("a")).not.toBeNull();
      expect(mgr.get("b")).toBeNull();
    });
  });

  /* ── clear ───────────────────────────────────────────────────────── */

  describe("clear", () => {
    it("returns the correct count and empties the cache", () => {
      const mgr = createManager();
      mgr.set("x", 1);
      mgr.set("y", 2);
      mgr.set("z", 3);

      const result = mgr.clear();

      expect(result.entriesCleared).toBe(3);
      expect(mgr.getStats().size).toBe(0);
    });
  });

  /* ── generateKey ─────────────────────────────────────────────────── */

  describe("generateKey", () => {
    it("produces the same key regardless of property insertion order", () => {
      const mgr = createManager();
      const key1 = mgr.generateKey("tool", { a: 1, b: 2 });
      const key2 = mgr.generateKey("tool", { b: 2, a: 1 });
      expect(key1).toBe(key2);
    });

    it("produces different keys for different params", () => {
      const mgr = createManager();
      const key1 = mgr.generateKey("tool", { a: 1 });
      const key2 = mgr.generateKey("tool", { a: 2 });
      expect(key1).not.toBe(key2);
    });

    it("produces different keys for different tool names", () => {
      const mgr = createManager();
      const key1 = mgr.generateKey("search", { q: "x" });
      const key2 = mgr.generateKey("get_issue", { q: "x" });
      expect(key1).not.toBe(key2);
    });
  });

  /* ── getStats ────────────────────────────────────────────────────── */

  describe("getStats", () => {
    it("returns current cache statistics", () => {
      const mgr = createManager({ maxEntries: 50 });
      mgr.set("a", 1);

      const stats = mgr.getStats();

      expect(stats).toEqual({
        size: 1,
        maxEntries: 50,
        enabled: true,
      });
    });
  });
});
