/**
 * Unit tests for the issue-details tool handlers
 * (get_issue_comments, get_issue_transitions, get_issue_changelog, get_issue_watchers).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetIssueComments,
  handleGetIssueTransitions,
  handleGetIssueChangelog,
  handleGetIssueWatchers,
} from "../../../src/tools/issue-details.js";
import { JiraApiError } from "../../../src/jira/client.js";
import type { JiraClient } from "../../../src/jira/client.js";
import type { CacheManager } from "../../../src/cache/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text from an MCP tool result. */
function parseResult(result: {
  content: [{ type: string; text: string }];
}): unknown {
  return JSON.parse(result.content[0].text);
}

/** Create a mock JiraClient with vi.fn() stubs for issue-detail methods. */
function createMockJiraClient(): {
  [K in keyof JiraClient]: ReturnType<typeof vi.fn>;
} {
  return {
    validateConnection: vi.fn(),
    getProjects: vi.fn(),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    getBoards: vi.fn(),
    getBoardSprints: vi.fn(),
    getSprintIssues: vi.fn(),
    getIssueComments: vi.fn(),
    getIssueTransitions: vi.fn(),
    getIssueChangelog: vi.fn(),
    getIssueWatchers: vi.fn(),
  };
}

/** Create a mock CacheManager with vi.fn() stubs. */
function createMockCacheManager(): {
  [K in keyof CacheManager]: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn(),
    generateKey: vi.fn(
      (toolName: string, params: Record<string, unknown>) =>
        `${toolName}:${JSON.stringify(params)}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Mock response factories
// ---------------------------------------------------------------------------

function createMockCommentsResponse() {
  return {
    startAt: 0,
    maxResults: 20,
    total: 1,
    comments: [
      {
        id: "1",
        author: { accountId: "abc", displayName: "Alice" },
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Test comment" }],
            },
          ],
        },
        created: "2026-03-01T10:00:00.000+0000",
        updated: "2026-03-01T10:00:00.000+0000",
      },
    ],
  };
}

function createMockTransitionsResponse() {
  return {
    transitions: [
      {
        id: "1",
        name: "Start Progress",
        to: {
          name: "In Progress",
          statusCategory: { name: "In Progress", key: "indeterminate" },
        },
      },
    ],
  };
}

function createMockChangelogResponse() {
  return {
    startAt: 0,
    maxResults: 20,
    total: 1,
    values: [
      {
        id: "1",
        author: { accountId: "abc", displayName: "Alice" },
        created: "2026-03-01T10:00:00.000+0000",
        items: [
          {
            field: "status",
            fieldtype: "jira",
            fromString: "To Do",
            toString: "In Progress",
          },
        ],
      },
    ],
  };
}

function createMockWatchersResponse() {
  return {
    watchCount: 2,
    isWatching: true,
    watchers: [
      { accountId: "abc", displayName: "Alice" },
      { accountId: "def", displayName: "Bob" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: get_issue_comments
// ---------------------------------------------------------------------------

describe("handleGetIssueComments", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns comments with ADF-to-text conversion", async () => {
    jiraClient.getIssueComments.mockResolvedValue(createMockCommentsResponse());

    const result = await handleGetIssueComments(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.issueKey).toBe("PROJ-42");
    expect(data.total).toBe(1);
    expect(data.startAt).toBe(0);
    expect(data.maxResults).toBe(20);
    const comments = data.comments as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("1");
    expect(comments[0].author).toBe("Alice");
    expect(comments[0].body).toBe("Test comment");
    expect(comments[0].created).toBe("2026-03-01T10:00:00.000+0000");
    expect("isError" in result).toBe(false);
  });

  it("passes pagination params to client", async () => {
    jiraClient.getIssueComments.mockResolvedValue(createMockCommentsResponse());

    await handleGetIssueComments(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42", maxResults: 10, startAt: 5 },
    );

    expect(jiraClient.getIssueComments).toHaveBeenCalledWith("PROJ-42", 5, 10);
  });

  it("serves from cache when available", async () => {
    cacheManager.get.mockReturnValue({
      data: { issueKey: "PROJ-42", total: 1, comments: [] },
      cached: true,
      cachedAt: "2026-03-10T12:00:00.000Z",
    });

    const result = await handleGetIssueComments(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data._cached).toBe(true);
    expect(jiraClient.getIssueComments).not.toHaveBeenCalled();
  });

  it("returns error for 404", async () => {
    jiraClient.getIssueComments.mockRejectedValue(
      new JiraApiError("Resource not found", { statusCode: 404 }),
    );

    const result = await handleGetIssueComments(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-999" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("Issue PROJ-999 not found.");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for invalid issue key format", async () => {
    const result = await handleGetIssueComments(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "invalid-key" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Invalid issue key format");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when project is not in allowlist", async () => {
    const result = await handleGetIssueComments(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["OTHER"],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
    expect(result).toHaveProperty("isError", true);
  });
});

// ---------------------------------------------------------------------------
// Tests: get_issue_transitions
// ---------------------------------------------------------------------------

describe("handleGetIssueTransitions", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns mapped transitions for a valid issue key", async () => {
    jiraClient.getIssueTransitions.mockResolvedValue(
      createMockTransitionsResponse(),
    );

    const result = await handleGetIssueTransitions(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.issueKey).toBe("PROJ-42");
    const transitions = data.transitions as Array<Record<string, unknown>>;
    expect(transitions).toHaveLength(1);
    expect(transitions[0].id).toBe("1");
    expect(transitions[0].name).toBe("Start Progress");
    expect(transitions[0].toStatus).toBe("In Progress");
    expect(transitions[0].toStatusCategory).toBe("In Progress");
    expect("isError" in result).toBe(false);
  });

  it("serves from cache when available", async () => {
    cacheManager.get.mockReturnValue({
      data: { issueKey: "PROJ-42", transitions: [] },
      cached: true,
      cachedAt: "2026-03-10T12:00:00.000Z",
    });

    const result = await handleGetIssueTransitions(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data._cached).toBe(true);
    expect(jiraClient.getIssueTransitions).not.toHaveBeenCalled();
  });

  it("returns error for 404", async () => {
    jiraClient.getIssueTransitions.mockRejectedValue(
      new JiraApiError("Resource not found", { statusCode: 404 }),
    );

    const result = await handleGetIssueTransitions(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-999" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("Issue PROJ-999 not found.");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for invalid issue key format", async () => {
    const result = await handleGetIssueTransitions(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "bad" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Invalid issue key format");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when project is not in allowlist", async () => {
    const result = await handleGetIssueTransitions(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["OTHER"],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
    expect(result).toHaveProperty("isError", true);
  });
});

// ---------------------------------------------------------------------------
// Tests: get_issue_changelog
// ---------------------------------------------------------------------------

describe("handleGetIssueChangelog", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns mapped changelog entries with change items", async () => {
    jiraClient.getIssueChangelog.mockResolvedValue(
      createMockChangelogResponse(),
    );

    const result = await handleGetIssueChangelog(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.issueKey).toBe("PROJ-42");
    expect(data.total).toBe(1);
    expect(data.startAt).toBe(0);
    expect(data.maxResults).toBe(20);
    const entries = data.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("1");
    expect(entries[0].author).toBe("Alice");
    expect(entries[0].created).toBe("2026-03-01T10:00:00.000+0000");
    const changes = entries[0].changes as Array<Record<string, unknown>>;
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("status");
    expect(changes[0].from).toBe("To Do");
    expect(changes[0].to).toBe("In Progress");
    expect("isError" in result).toBe(false);
  });

  it("passes pagination params to client", async () => {
    jiraClient.getIssueChangelog.mockResolvedValue(
      createMockChangelogResponse(),
    );

    await handleGetIssueChangelog(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42", maxResults: 10, startAt: 5 },
    );

    expect(jiraClient.getIssueChangelog).toHaveBeenCalledWith("PROJ-42", 5, 10);
  });

  it("serves from cache when available", async () => {
    cacheManager.get.mockReturnValue({
      data: { issueKey: "PROJ-42", total: 0, entries: [] },
      cached: true,
      cachedAt: "2026-03-10T12:00:00.000Z",
    });

    const result = await handleGetIssueChangelog(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data._cached).toBe(true);
    expect(jiraClient.getIssueChangelog).not.toHaveBeenCalled();
  });

  it("returns error for 404", async () => {
    jiraClient.getIssueChangelog.mockRejectedValue(
      new JiraApiError("Resource not found", { statusCode: 404 }),
    );

    const result = await handleGetIssueChangelog(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-999" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("Issue PROJ-999 not found.");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for invalid issue key format", async () => {
    const result = await handleGetIssueChangelog(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "nope" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Invalid issue key format");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when project is not in allowlist", async () => {
    const result = await handleGetIssueChangelog(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["OTHER"],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
    expect(result).toHaveProperty("isError", true);
  });
});

// ---------------------------------------------------------------------------
// Tests: get_issue_watchers
// ---------------------------------------------------------------------------

describe("handleGetIssueWatchers", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns watchers for a valid issue key", async () => {
    jiraClient.getIssueWatchers.mockResolvedValue(createMockWatchersResponse());

    const result = await handleGetIssueWatchers(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.issueKey).toBe("PROJ-42");
    expect(data.watchCount).toBe(2);
    expect(data.isWatching).toBe(true);
    const watchers = data.watchers as Array<Record<string, unknown>>;
    expect(watchers).toHaveLength(2);
    expect(watchers[0].accountId).toBe("abc");
    expect(watchers[0].displayName).toBe("Alice");
    expect(watchers[1].accountId).toBe("def");
    expect(watchers[1].displayName).toBe("Bob");
    expect("isError" in result).toBe(false);
  });

  it("serves from cache when available", async () => {
    cacheManager.get.mockReturnValue({
      data: { issueKey: "PROJ-42", watchCount: 0, watchers: [] },
      cached: true,
      cachedAt: "2026-03-10T12:00:00.000Z",
    });

    const result = await handleGetIssueWatchers(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data._cached).toBe(true);
    expect(jiraClient.getIssueWatchers).not.toHaveBeenCalled();
  });

  it("returns error for 404", async () => {
    jiraClient.getIssueWatchers.mockRejectedValue(
      new JiraApiError("Resource not found", { statusCode: 404 }),
    );

    const result = await handleGetIssueWatchers(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-999" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("Issue PROJ-999 not found.");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for invalid issue key format", async () => {
    const result = await handleGetIssueWatchers(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "123" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Invalid issue key format");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when project is not in allowlist", async () => {
    const result = await handleGetIssueWatchers(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["OTHER"],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
    expect(result).toHaveProperty("isError", true);
  });
});
