/**
 * Unit tests for the admin tool handlers.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CacheManager } from "../../../src/cache/manager.js";
import {
  createListAvailableToolsHandler,
  createClearCacheHandler,
  type ToolDescription,
} from "../../../src/tools/admin.js";

// ---------------------------------------------------------------------------
// Tests: list_available_tools handler
// ---------------------------------------------------------------------------

describe("list_available_tools handler", () => {
  it("should return tool descriptions as JSON content", async () => {
    const descriptions: ToolDescription[] = [
      { name: "tool_a", description: "Does A" },
      { name: "tool_b", description: "Does B" },
    ];

    const handler = createListAvailableToolsHandler(descriptions);
    const result = await handler();

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.count).toBe(2);
    expect(parsed.tools).toEqual(descriptions);
  });

  it("should return empty list when no tools are provided", async () => {
    const handler = createListAvailableToolsHandler([]);
    const result = await handler();

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.count).toBe(0);
    expect(parsed.tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: clear_cache handler
// ---------------------------------------------------------------------------

describe("clear_cache handler", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({
      enabled: true,
      ttlSeconds: 300,
      maxEntries: 100,
    });
  });

  it("should clear the cache and report entries removed", async () => {
    // Populate cache with some entries.
    cache.set("key1", { value: 1 });
    cache.set("key2", { value: 2 });
    cache.set("key3", { value: 3 });

    const handler = createClearCacheHandler(cache);
    const result = await handler();

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.success).toBe(true);
    expect(parsed.entriesCleared).toBe(3);
    expect(parsed.message).toContain("3");
  });

  it("should report 0 entries when cache is already empty", async () => {
    const handler = createClearCacheHandler(cache);
    const result = await handler();

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.success).toBe(true);
    expect(parsed.entriesCleared).toBe(0);
  });

  it("should leave the cache empty after clearing", async () => {
    cache.set("key1", "data");

    const handler = createClearCacheHandler(cache);
    await handler();

    const stats = cache.getStats();
    expect(stats.size).toBe(0);
  });
});
