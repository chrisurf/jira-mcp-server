import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleListProjects,
  handleGetProjectSummary,
} from "../../../src/tools/projects.js";
import { CacheManager } from "../../../src/cache/manager.js";
import type { JiraClient } from "../../../src/jira/client.js";
import type {
  JiraSearchResult,
  JiraPaginatedResponse,
  JiraProject,
  JiraBoard,
  JiraSprint,
} from "../../../src/jira/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createCacheManager() {
  return new CacheManager({ enabled: false, ttlSeconds: 300, maxEntries: 100 });
}

function createMockClient(overrides: Partial<JiraClient> = {}): JiraClient {
  return {
    validateConnection: vi.fn(),
    getProjects: vi.fn(),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    getBoards: vi.fn(),
    getBoardSprints: vi.fn(),
    getSprintIssues: vi.fn(),
    ...overrides,
  } as unknown as JiraClient;
}

/** Parse the JSON from a tool result. */
function parseResult(result: { content: [{ text: string }] }): unknown {
  return JSON.parse(result.content[0].text);
}

function makeProject(key: string, name: string): JiraProject {
  return {
    id: `${key}-id`,
    key,
    name,
    projectTypeKey: "software",
    lead: { displayName: "Lead User" },
    description: `Description for ${name}`,
  };
}

function makeIssue(
  key: string,
  opts: {
    status?: string;
    statusCategoryKey?: string;
    issueType?: string;
    updated?: string;
  } = {},
) {
  return {
    id: key,
    key,
    self: `https://jira.example.com/rest/api/3/issue/${key}`,
    fields: {
      summary: `Summary of ${key}`,
      description: null,
      status: {
        name: opts.status ?? "To Do",
        statusCategory: {
          name: opts.status ?? "To Do",
          key: opts.statusCategoryKey ?? "new",
        },
      },
      issuetype: { name: opts.issueType ?? "Story" },
      priority: { name: "Medium" },
      assignee: null,
      reporter: null,
      labels: [],
      components: [],
      fixVersions: [],
      created: "2026-01-01T00:00:00.000Z",
      updated: opts.updated ?? "2026-03-01T00:00:00.000Z",
      duedate: null,
      parent: null,
      subtasks: [],
      issuelinks: [],
      comment: { total: 0 },
      customfield_10016: null,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  list_projects                                                      */
/* ------------------------------------------------------------------ */

describe("handleListProjects", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = createCacheManager();
  });

  it("returns projects from the Jira API", async () => {
    const client = createMockClient({
      getProjects: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 2,
        values: [
          makeProject("PROJ", "My Project"),
          makeProject("OTHER", "Other"),
        ],
      } satisfies JiraPaginatedResponse<JiraProject>),
    });

    const result = await handleListProjects(client, cache, [], {});
    const data = parseResult(result) as { projects: unknown[] };

    expect(data.projects).toHaveLength(2);
    expect(data.projects[0]).toEqual(
      expect.objectContaining({ key: "PROJ", name: "My Project" }),
    );
  });

  it("filters by project allowlist", async () => {
    const client = createMockClient({
      getProjects: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 2,
        values: [
          makeProject("PROJ", "My Project"),
          makeProject("OTHER", "Other"),
        ],
      }),
    });

    const result = await handleListProjects(client, cache, ["PROJ"], {});
    const data = parseResult(result) as { projects: unknown[] };

    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]).toEqual(expect.objectContaining({ key: "PROJ" }));
  });

  it("returns empty array with message when no projects found", async () => {
    const client = createMockClient({
      getProjects: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        values: [],
      }),
    });

    const result = await handleListProjects(client, cache, [], {});
    const data = parseResult(result) as {
      projects: unknown[];
      message: string;
    };

    expect(data.projects).toEqual([]);
    expect(data.message).toBe("No projects found.");
  });

  it("passes pagination params to the API", async () => {
    const getProjectsFn = vi.fn().mockResolvedValue({
      startAt: 10,
      maxResults: 25,
      total: 50,
      values: [],
    });
    const client = createMockClient({ getProjects: getProjectsFn });

    await handleListProjects(client, cache, [], {
      startAt: 10,
      maxResults: 25,
    });

    expect(getProjectsFn).toHaveBeenCalledWith(10, 25);
  });

  it("returns error on API failure", async () => {
    const client = createMockClient({
      getProjects: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });

    const result = await handleListProjects(client, cache, [], {});

    expect(result).toHaveProperty("isError", true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Connection refused");
  });
});

/* ------------------------------------------------------------------ */
/*  get_project_summary                                                */
/* ------------------------------------------------------------------ */

describe("handleGetProjectSummary", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = createCacheManager();
  });

  it("returns aggregated summary for a project", async () => {
    const issues = [
      makeIssue("PROJ-1", { statusCategoryKey: "new", issueType: "Story" }),
      makeIssue("PROJ-2", {
        statusCategoryKey: "indeterminate",
        issueType: "Bug",
      }),
      makeIssue("PROJ-3", { statusCategoryKey: "done", issueType: "Story" }),
      makeIssue("PROJ-4", { statusCategoryKey: "done", issueType: "Epic" }),
    ];

    const searchFn = vi
      .fn()
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 100,
        total: 4,
        issues,
      } satisfies JiraSearchResult)
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 5,
        total: 4,
        issues: issues.slice(0, 2),
      } satisfies JiraSearchResult);

    const client = createMockClient({
      searchIssues: searchFn,
      getBoards: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        values: [],
      }),
    });

    const result = await handleGetProjectSummary(client, cache, [], {
      projectKey: "PROJ",
    });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data.totalIssues).toBe(4);
    expect(data.issuesByStatusCategory).toEqual({
      toDo: 1,
      inProgress: 1,
      done: 2,
    });
    expect(data.issuesByType).toEqual({ Story: 2, Bug: 1, Epic: 1 });
    expect(data.epicCount).toBe(1);
    expect(data.activeSprint).toBeNull();
  });

  it("rejects projects not in the allowlist", async () => {
    const client = createMockClient();

    const result = await handleGetProjectSummary(client, cache, ["ALLOWED"], {
      projectKey: "BLOCKED",
    });

    expect(result).toHaveProperty("isError", true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
  });

  it("includes active sprint info when available", async () => {
    const searchFn = vi
      .fn()
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 100,
        total: 0,
        issues: [],
      })
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 5,
        total: 0,
        issues: [],
      });

    const client = createMockClient({
      searchIssues: searchFn,
      getBoards: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 1,
        values: [{ id: 1, name: "Board 1", type: "scrum" }],
      } satisfies JiraPaginatedResponse<JiraBoard>),
      getBoardSprints: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 1,
        values: [
          {
            id: 10,
            name: "Sprint 1",
            goal: "Ship it",
            state: "active",
            startDate: "2026-03-01",
            endDate: "2026-03-15",
          },
        ],
      } satisfies JiraPaginatedResponse<JiraSprint>),
      getSprintIssues: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 1,
        total: 7,
        issues: [],
      } satisfies JiraSearchResult),
    });

    const result = await handleGetProjectSummary(client, cache, [], {
      projectKey: "PROJ",
    });
    const data = parseResult(result) as {
      activeSprint: Record<string, unknown>;
    };

    expect(data.activeSprint).not.toBeNull();
    expect(data.activeSprint!.name).toBe("Sprint 1");
    expect(data.activeSprint!.issueCount).toBe(7);
  });

  it("paginates through all issues for counting", async () => {
    // 150 issues: first page returns 100, second returns 50.
    const page1Issues = Array.from({ length: 100 }, (_, i) =>
      makeIssue(`PROJ-${i + 1}`, {
        statusCategoryKey: "new",
        issueType: "Task",
      }),
    );
    const page2Issues = Array.from({ length: 50 }, (_, i) =>
      makeIssue(`PROJ-${i + 101}`, {
        statusCategoryKey: "done",
        issueType: "Task",
      }),
    );

    const searchFn = vi
      .fn()
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 100,
        total: 150,
        issues: page1Issues,
      })
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 5,
        total: 150,
        issues: [],
      })
      .mockResolvedValueOnce({
        startAt: 100,
        maxResults: 100,
        total: 150,
        issues: page2Issues,
      });

    const client = createMockClient({
      searchIssues: searchFn,
      getBoards: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        values: [],
      }),
    });

    const result = await handleGetProjectSummary(client, cache, [], {
      projectKey: "PROJ",
    });
    const data = parseResult(result) as {
      totalIssues: number;
      issuesByStatusCategory: Record<string, number>;
    };

    expect(data.totalIssues).toBe(150);
    expect(data.issuesByStatusCategory.toDo).toBe(100);
    expect(data.issuesByStatusCategory.done).toBe(50);
  });

  it("returns error on API failure", async () => {
    const client = createMockClient({
      searchIssues: vi.fn().mockRejectedValue(new Error("Timeout")),
    });

    const result = await handleGetProjectSummary(client, cache, [], {
      projectKey: "PROJ",
    });

    expect(result).toHaveProperty("isError", true);
  });
});
