/**
 * Unit tests for the sprint tool handler (get_active_sprint).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetActiveSprint,
  handleListSprints,
} from "../../../src/tools/sprints.js";
import type { JiraClient } from "../../../src/jira/client.js";
import type { CacheManager } from "../../../src/cache/manager.js";
import type {
  JiraBoard,
  JiraIssue,
  JiraPaginatedResponse,
  JiraSearchResult,
  JiraSprint,
} from "../../../src/jira/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text from an MCP tool result. */
function parseResult(result: {
  content: [{ type: string; text: string }];
}): unknown {
  return JSON.parse(result.content[0].text);
}

/** Create a minimal JiraIssue for sprint testing. */
function createSprintIssue(
  key: string,
  statusCategoryKey: string,
  storyPoints: number | null = null,
): JiraIssue {
  return {
    id: key.replace("-", ""),
    key,
    self: `https://test.atlassian.net/rest/api/3/issue/${key}`,
    fields: {
      summary: `Issue ${key}`,
      description: null,
      status: {
        name:
          statusCategoryKey === "done"
            ? "Done"
            : statusCategoryKey === "indeterminate"
              ? "In Progress"
              : "To Do",
        statusCategory: {
          name:
            statusCategoryKey === "done"
              ? "Done"
              : statusCategoryKey === "indeterminate"
                ? "In Progress"
                : "To Do",
          key: statusCategoryKey,
        },
      },
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      assignee: { displayName: "Jane Doe" },
      reporter: { displayName: "John Smith" },
      labels: [],
      components: [],
      fixVersions: [],
      created: "2026-01-15T10:00:00.000+0000",
      updated: "2026-03-10T14:30:00.000+0000",
      duedate: null,
      parent: null,
      subtasks: [],
      issuelinks: [],
      comment: { total: 0 },
      customfield_10016: storyPoints,
    },
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

/** Standard mock setup: Scrum board + active sprint + issues. */
function setupStandardMocks(
  jiraClient: ReturnType<typeof createMockJiraClient>,
  issues: JiraIssue[] = [],
) {
  const boards: JiraPaginatedResponse<JiraBoard> = {
    startAt: 0,
    maxResults: 50,
    total: 1,
    values: [{ id: 1, name: "PROJ Board", type: "scrum" }],
  };

  const sprints: JiraPaginatedResponse<JiraSprint> = {
    startAt: 0,
    maxResults: 50,
    total: 1,
    values: [
      {
        id: 101,
        name: "Sprint 5",
        goal: "Deliver feature X",
        state: "active",
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-03-15T00:00:00.000Z",
      },
    ],
  };

  const sprintIssues: JiraSearchResult = {
    startAt: 0,
    maxResults: 50,
    total: issues.length,
    issues,
  };

  jiraClient.getBoards.mockResolvedValue(boards);
  jiraClient.getBoardSprints.mockResolvedValue(sprints);
  jiraClient.getSprintIssues.mockResolvedValue(sprintIssues);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleGetActiveSprint", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns grouped sprint issues for a valid project key", async () => {
    const issues = [
      createSprintIssue("PROJ-1", "new", 3),
      createSprintIssue("PROJ-2", "indeterminate", 5),
      createSprintIssue("PROJ-3", "done", 8),
    ];
    setupStandardMocks(jiraClient, issues);

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.totalIssues).toBe(3);
    expect((data.toDo as unknown[]).length).toBe(1);
    expect((data.inProgress as unknown[]).length).toBe(1);
    expect((data.done as unknown[]).length).toBe(1);
    expect((data.sprint as Record<string, unknown>).name).toBe("Sprint 5");
    expect(data.boardName).toBe("PROJ Board");
    expect("isError" in result).toBe(false);
  });

  it("returns error when no Scrum board is found", async () => {
    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 0,
      values: [],
    });

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("No Scrum board found");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when only a Kanban board is found", async () => {
    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [{ id: 1, name: "PROJ Kanban", type: "kanban" }],
    });

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Kanban board");
    expect(data.error).toContain("does not use sprints");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error when no active sprint exists", async () => {
    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [{ id: 1, name: "PROJ Board", type: "scrum" }],
    });
    jiraClient.getBoardSprints.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 0,
      values: [],
    });

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("No active sprint found");
    expect(result).toHaveProperty("isError", true);
  });

  it("accepts a numeric board ID as input", async () => {
    const sprints: JiraPaginatedResponse<JiraSprint> = {
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [
        {
          id: 101,
          name: "Sprint 5",
          goal: null,
          state: "active",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-03-15T00:00:00.000Z",
        },
      ],
    };
    const sprintIssues: JiraSearchResult = {
      startAt: 0,
      maxResults: 50,
      total: 0,
      issues: [],
    };

    jiraClient.getBoardSprints.mockResolvedValue(sprints);
    jiraClient.getSprintIssues.mockResolvedValue(sprintIssues);

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "42" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.boardId).toBe(42);
    expect(data.boardName).toBe("Board 42");
    // getBoards should NOT be called when using a numeric board ID.
    expect(jiraClient.getBoards).not.toHaveBeenCalled();
    // getBoardSprints should be called with the numeric board ID.
    expect(jiraClient.getBoardSprints).toHaveBeenCalledWith(42, "active");
  });

  it("aggregates story points correctly", async () => {
    const issues = [
      createSprintIssue("PROJ-1", "new", 3),
      createSprintIssue("PROJ-2", "indeterminate", 5),
      createSprintIssue("PROJ-3", "done", 8),
      createSprintIssue("PROJ-4", "done", 2),
      createSprintIssue("PROJ-5", "new", null), // no story points
    ];
    setupStandardMocks(jiraClient, issues);

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.totalStoryPoints).toBe(18); // 3 + 5 + 8 + 2
    expect(data.completedStoryPoints).toBe(10); // 8 + 2
    expect(data.totalIssues).toBe(5);
  });

  it("returns error when project is not in allowlist", async () => {
    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["OTHER"],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
    expect(result).toHaveProperty("isError", true);
  });

  it("paginates through all sprint issues", async () => {
    // First page returns 50 issues, second page returns 10 more.
    const page1Issues = Array.from({ length: 50 }, (_, i) =>
      createSprintIssue(`PROJ-${i + 1}`, "new", 1),
    );
    const page2Issues = Array.from({ length: 10 }, (_, i) =>
      createSprintIssue(`PROJ-${i + 51}`, "done", 2),
    );

    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [{ id: 1, name: "PROJ Board", type: "scrum" }],
    });
    jiraClient.getBoardSprints.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [
        {
          id: 101,
          name: "Sprint 5",
          goal: null,
          state: "active",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-03-15T00:00:00.000Z",
        },
      ],
    });

    jiraClient.getSprintIssues
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 50,
        total: 60,
        issues: page1Issues,
      })
      .mockResolvedValueOnce({
        startAt: 50,
        maxResults: 50,
        total: 60,
        issues: page2Issues,
      });

    const result = await handleGetActiveSprint(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as Record<string, unknown>;
    expect(data.totalIssues).toBe(60);
    expect(jiraClient.getSprintIssues).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// handleListSprints
// ---------------------------------------------------------------------------

describe("handleListSprints", () => {
  let jiraClient: ReturnType<typeof createMockJiraClient>;
  let cacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    jiraClient = createMockJiraClient();
    cacheManager = createMockCacheManager();
  });

  it("returns sprints for a valid project key", async () => {
    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [{ id: 1, name: "PROJ Board", type: "scrum" }],
    });
    jiraClient.getBoardSprints.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 2,
      values: [
        {
          id: 10,
          name: "Sprint 1",
          state: "closed",
          goal: null,
          startDate: "2026-02-01",
          endDate: "2026-02-14",
        },
        {
          id: 11,
          name: "Sprint 2",
          state: "active",
          goal: "Ship it",
          startDate: "2026-03-01",
          endDate: "2026-03-14",
        },
      ],
    });

    const result = await handleListSprints(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as {
      sprints: Array<{ id: number; name: string; state: string }>;
      total: number;
    };
    expect(data.sprints).toHaveLength(2);
    expect(data.sprints[0].name).toBe("Sprint 1");
    expect(data.sprints[1].state).toBe("active");
    expect(data.total).toBe(2);
  });

  it("accepts a numeric board ID", async () => {
    jiraClient.getBoardSprints.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [
        {
          id: 10,
          name: "Sprint 1",
          state: "active",
          goal: null,
          startDate: null,
          endDate: null,
        },
      ],
    });

    const result = await handleListSprints(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "42" },
    );

    const data = parseResult(result) as { boardId: number };
    expect(data.boardId).toBe(42);
    expect(jiraClient.getBoards).not.toHaveBeenCalled();
  });

  it("filters by sprint state", async () => {
    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      values: [{ id: 1, name: "Board", type: "scrum" }],
    });
    jiraClient.getBoardSprints.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 0,
      values: [],
    });

    await handleListSprints(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ", state: "active" },
    );

    expect(jiraClient.getBoardSprints).toHaveBeenCalledWith(1, "active");
  });

  it("returns error when no scrum board found", async () => {
    jiraClient.getBoards.mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 0,
      values: [],
    });

    const result = await handleListSprints(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      [],
      { projectKeyOrBoardId: "PROJ" },
    );

    const data = parseResult(result) as { error: string };
    expect(result).toHaveProperty("isError", true);
    expect(data.error).toContain("No Scrum board found");
  });

  it("rejects disallowed project", async () => {
    const result = await handleListSprints(
      jiraClient as unknown as JiraClient,
      cacheManager as unknown as CacheManager,
      ["ALLOWED"],
      { projectKeyOrBoardId: "BLOCKED" },
    );

    const data = parseResult(result) as { error: string };
    expect(result).toHaveProperty("isError", true);
    expect(data.error).toContain("not in the allowed project list");
  });
});
