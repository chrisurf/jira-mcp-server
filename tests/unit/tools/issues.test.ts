/**
 * Unit tests for the issue tool handlers (get_issue, get_issue_subtasks, search_issues).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetIssue,
  handleGetIssueSubtasks,
  handleSearchIssues,
} from "../../../src/tools/issues.js";
import { JiraApiError } from "../../../src/jira/client.js";
import type { JiraClient } from "../../../src/jira/client.js";
import type { CacheManager } from "../../../src/cache/manager.js";
import type { JiraIssue, JiraSearchResult } from "../../../src/jira/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text from an MCP tool result. */
function parseResult(result: {
  content: [{ type: string; text: string }];
}): unknown {
  return JSON.parse(result.content[0].text);
}

/** Create a minimal JiraIssue for testing. */
function createMockIssue(
  overrides?: Partial<JiraIssue> & {
    fieldsOverrides?: Partial<JiraIssue["fields"]>;
  },
): JiraIssue {
  return {
    id: "10001",
    key: overrides?.key ?? "PROJ-42",
    self: "https://test.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "Test issue summary",
      description: null,
      status: {
        name: "In Progress",
        statusCategory: { name: "In Progress", key: "indeterminate" },
      },
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      assignee: { displayName: "Jane Doe" },
      reporter: { displayName: "John Smith" },
      labels: ["backend"],
      components: [{ name: "API" }],
      fixVersions: [{ name: "1.0" }],
      created: "2026-01-15T10:00:00.000+0000",
      updated: "2026-03-10T14:30:00.000+0000",
      duedate: "2026-04-01",
      parent: null,
      subtasks: [],
      issuelinks: [],
      comment: { total: 3 },
      customfield_10016: 5,
      ...overrides?.fieldsOverrides,
    },
    ...overrides,
  };
}

/** Create a mock JiraClient with vi.fn() stubs. */
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
// Tests: get_issue
// ---------------------------------------------------------------------------

describe("handleGetIssue", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns a mapped issue for a valid key", async () => {
    const mockIssue = createMockIssue();
    jiraClient.getIssue.mockResolvedValue(mockIssue);

    const result = await handleGetIssue(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.key).toBe("PROJ-42");
    expect(data.summary).toBe("Test issue summary");
    expect(data.status).toBe("In Progress");
    expect(data.assignee).toBe("Jane Doe");
    expect(data.storyPoints).toBe(5);
    expect("isError" in result).toBe(false);
  });

  it("returns error for 404", async () => {
    jiraClient.getIssue.mockRejectedValue(
      new JiraApiError("Resource not found", { statusCode: 404 }),
    );

    const result = await handleGetIssue(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-999" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("Issue PROJ-999 not found.");
    expect(result).toHaveProperty("isError", true);
  });

  it("filters fields when fields param is provided", async () => {
    const mockIssue = createMockIssue();
    jiraClient.getIssue.mockResolvedValue(mockIssue);

    const result = await handleGetIssue(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42", fields: ["summary", "status"] },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.key).toBe("PROJ-42");
    expect(data.summary).toBe("Test issue summary");
    expect(data.status).toBe("In Progress");
    // Other fields should be absent.
    expect(data).not.toHaveProperty("assignee");
    expect(data).not.toHaveProperty("labels");
  });

  it("returns error for invalid key format", async () => {
    const result = await handleGetIssue(
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
    const result = await handleGetIssue(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["OTHER"],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
    expect(result).toHaveProperty("isError", true);
  });

  it("serves from cache when available", async () => {
    cacheManager.get.mockReturnValue({
      data: { key: "PROJ-42", summary: "Cached issue" },
      cached: true,
      cachedAt: "2026-03-10T12:00:00.000Z",
    });

    const result = await handleGetIssue(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data._cached).toBe(true);
    expect(jiraClient.getIssue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: search_issues
// ---------------------------------------------------------------------------

describe("handleSearchIssues", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns results for a valid JQL query", async () => {
    const mockSearchResult: JiraSearchResult = {
      startAt: 0,
      maxResults: 50,
      total: 1,
      issues: [createMockIssue()],
    };
    jiraClient.searchIssues.mockResolvedValue(mockSearchResult);

    const result = await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { jql: "project = PROJ" },
    );

    const data = parseResult(result) as { total: number; issues: unknown[] };
    expect(data.total).toBe(1);
    expect(data.issues).toHaveLength(1);
    expect("isError" in result).toBe(false);
  });

  it("returns error for empty JQL", async () => {
    const result = await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { jql: "" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("JQL query cannot be empty.");
    expect(result).toHaveProperty("isError", true);
  });

  it("auto-appends project filter when allowlist is active and JQL has no project clause", async () => {
    const mockSearchResult: JiraSearchResult = {
      startAt: 0,
      maxResults: 50,
      total: 0,
      issues: [],
    };
    jiraClient.searchIssues.mockResolvedValue(mockSearchResult);

    await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["PROJ", "OTHER"],
      { jql: 'status = "In Progress"' },
    );

    // Verify that the JQL was modified to include the project filter.
    const calledJql = jiraClient.searchIssues.mock.calls[0][0] as string;
    expect(calledJql).toContain("AND project IN");
    expect(calledJql).toContain('"PROJ"');
    expect(calledJql).toContain('"OTHER"');
  });

  it("does not append project filter when JQL already contains project clause", async () => {
    const mockSearchResult: JiraSearchResult = {
      startAt: 0,
      maxResults: 50,
      total: 0,
      issues: [],
    };
    jiraClient.searchIssues.mockResolvedValue(mockSearchResult);

    await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["PROJ"],
      { jql: 'project = PROJ AND status = "In Progress"' },
    );

    // Verify the JQL was NOT modified.
    const calledJql = jiraClient.searchIssues.mock.calls[0][0] as string;
    expect(calledJql).toBe('project = PROJ AND status = "In Progress"');
  });

  it("returns empty issues array for zero results", async () => {
    const mockSearchResult: JiraSearchResult = {
      startAt: 0,
      maxResults: 50,
      total: 0,
      issues: [],
    };
    jiraClient.searchIssues.mockResolvedValue(mockSearchResult);

    const result = await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { jql: "project = EMPTY" },
    );

    const data = parseResult(result) as { total: number; issues: unknown[] };
    expect(data.total).toBe(0);
    expect(data.issues).toHaveLength(0);
  });

  it("passes through JQL syntax errors as structured errors", async () => {
    jiraClient.searchIssues.mockRejectedValue(
      new JiraApiError("Jira API error (400): Error in the JQL Query", {
        statusCode: 400,
      }),
    );

    const result = await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { jql: "invalid jql %%%" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("JQL Query");
    expect(result).toHaveProperty("isError", true);
  });

  it("caps maxResults at 100", async () => {
    const mockSearchResult: JiraSearchResult = {
      startAt: 0,
      maxResults: 100,
      total: 0,
      issues: [],
    };
    jiraClient.searchIssues.mockResolvedValue(mockSearchResult);

    await handleSearchIssues(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { jql: "project = PROJ", maxResults: 500 },
    );

    const calledMaxResults = jiraClient.searchIssues.mock.calls[0][3] as number;
    expect(calledMaxResults).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tests: get_issue_subtasks
// ---------------------------------------------------------------------------

describe("handleGetIssueSubtasks", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns subtasks for an issue with subtasks", async () => {
    const mockIssue = createMockIssue({
      fieldsOverrides: {
        subtasks: [
          {
            key: "PROJ-43",
            fields: {
              summary: "Subtask 1",
              status: { name: "To Do" },
            },
          },
          {
            key: "PROJ-44",
            fields: {
              summary: "Subtask 2",
              status: { name: "Done" },
            },
          },
        ],
      },
    });
    jiraClient.getIssue.mockResolvedValue(mockIssue);

    const result = await handleGetIssueSubtasks(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as {
      key: string;
      subtasks: Array<{ key: string; summary: string; status: string }>;
    };
    expect(data.key).toBe("PROJ-42");
    expect(data.subtasks).toHaveLength(2);
    expect(data.subtasks[0].key).toBe("PROJ-43");
    expect(data.subtasks[1].status).toBe("Done");
  });

  it("returns empty subtasks for an issue without subtasks", async () => {
    const mockIssue = createMockIssue({
      fieldsOverrides: {
        subtasks: [],
      },
    });
    jiraClient.getIssue.mockResolvedValue(mockIssue);

    const result = await handleGetIssueSubtasks(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-42" },
    );

    const data = parseResult(result) as { subtasks: unknown[] };
    expect(data.subtasks).toHaveLength(0);
  });

  it("returns empty subtasks array and parentKey when issue is itself a subtask", async () => {
    const mockIssue = createMockIssue({
      key: "PROJ-43",
      fieldsOverrides: {
        issuetype: { name: "Sub-task" },
        parent: { key: "PROJ-42" },
        subtasks: [],
      },
    });
    jiraClient.getIssue.mockResolvedValue(mockIssue);

    const result = await handleGetIssueSubtasks(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-43" },
    );

    const data = parseResult(result) as {
      key: string;
      parentKey: string;
      subtasks: unknown[];
    };
    expect(data.key).toBe("PROJ-43");
    expect(data.parentKey).toBe("PROJ-42");
    expect(data.subtasks).toHaveLength(0);
  });

  it("returns error for 404", async () => {
    jiraClient.getIssue.mockRejectedValue(
      new JiraApiError("Resource not found", { statusCode: 404 }),
    );

    const result = await handleGetIssueSubtasks(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { issueKey: "PROJ-999" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBe("Issue PROJ-999 not found.");
    expect(result).toHaveProperty("isError", true);
  });
});
