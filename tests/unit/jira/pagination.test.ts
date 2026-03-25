import { describe, it, expect } from "vitest";
import { paginateAll } from "../../../src/jira/pagination.js";

describe("paginateAll", () => {
  it("yields all items across multiple pages", async () => {
    const pages = [
      { startAt: 0, total: 5, items: ["a", "b", "c"] },
      { startAt: 3, total: 5, items: ["d", "e"] },
    ];

    let callIndex = 0;
    const fetchPage = async (_startAt: number, _maxResults: number) => {
      const page = pages[callIndex++];
      return { startAt: page.startAt, total: page.total, items: page.items };
    };

    const results: string[] = [];
    for await (const item of paginateAll(fetchPage, 3)) {
      results.push(item);
    }

    expect(results).toEqual(["a", "b", "c", "d", "e"]);
    expect(callIndex).toBe(2);
  });

  it("handles a single page", async () => {
    const fetchPage = async () => ({
      startAt: 0,
      total: 2,
      items: [1, 2],
    });

    const results: number[] = [];
    for await (const item of paginateAll(fetchPage, 50)) {
      results.push(item);
    }

    expect(results).toEqual([1, 2]);
  });

  it("handles empty results", async () => {
    const fetchPage = async () => ({
      startAt: 0,
      total: 0,
      items: [] as string[],
    });

    const results: string[] = [];
    for await (const item of paginateAll(fetchPage, 50)) {
      results.push(item);
    }

    expect(results).toEqual([]);
  });
});
