import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleListEpics,
  handleGetEpicChildren,
} from "../../../src/tools/epics.js";
import { handleGetIssueSubtasks } from "../../../src/tools/issues.js";
import { CacheManager } from "../../../src/cache/manager.js";
import type { JiraClient } from "../../../src/jira/client.js";
import { JiraApiError } from "../../../src/jira/client.js";
import type { JiraSearchResult, JiraIssue } from "../../../src/jira/types.js";

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

function parseResult(result: { content: [{ text: string }] }): unknown {
  return JSON.parse(result.content[0].text);
}

function makeIssue(
  key: string,
  opts: {
    summary?: string;
    status?: string;
    statusCategoryKey?: string;
    statusCategoryName?: string;
    issueType?: string;
    priority?: string;
    updated?: string;
    subtasks?: Array<{ key: string; summary: string; status: string }>;
    parent?: string | null;
    storyPoints?: number | null;
  } = {},
): JiraIssue {
  return {
    id: key,
    key,
    self: `https://jira.example.com/rest/api/3/issue/${key}`,
    fields: {
      summary: opts.summary ?? `Summary of ${key}`,
      description: null,
      status: {
        name: opts.status ?? "To Do",
        statusCategory: {
          name: opts.statusCategoryName ?? opts.status ?? "To Do",
          key: opts.statusCategoryKey ?? "new",
        },
      },
      issuetype: { name: opts.issueType ?? "Story" },
      priority: { name: opts.priority ?? "Medium" },
      assignee: null,
      reporter: null,
      labels: [],
      components: [],
      fixVersions: [],
      created: "2026-01-01T00:00:00.000Z",
      updated: opts.updated ?? "2026-03-01T00:00:00.000Z",
      duedate: null,
      parent: opts.parent ? { key: opts.parent } : null,
      subtasks: (opts.subtasks ?? []).map((st) => ({
        key: st.key,
        fields: { summary: st.summary, status: { name: st.status } },
      })),
      issuelinks: [],
      comment: { total: 0 },
      customfield_10016: opts.storyPoints ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  list_epics                                                         */
/* ------------------------------------------------------------------ */

describe("handleListEpics", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = createCacheManager();
  });

  it("returns epics with child story counts", async () => {
    const epicIssue = makeIssue("PROJ-1", {
      issueType: "Epic",
      summary: "My Epic",
    });

    const childIssues = [
      makeIssue("PROJ-10", { statusCategoryKey: "new" }),
      makeIssue("PROJ-11", { statusCategoryKey: "done" }),
    ];

    const searchFn = vi
      .fn()
      // First call: search for epics.
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 50,
        total: 1,
        issues: [epicIssue],
      } satisfies JiraSearchResult)
      // Second call: children of PROJ-1.
      .mockResolvedValueOnce({
        startAt: 0,
        maxResults: 100,
        total: 2,
        issues: childIssues,
      } satisfies JiraSearchResult);

    const client = createMockClient({ searchIssues: searchFn });

    const result = await handleListEpics(client, cache, [], {
      projectKey: "PROJ",
    });
    const data = parseResult(result) as {
      epics: Array<Record<string, unknown>>;
    };

    expect(data.epics).toHaveLength(1);
    expect(data.epics[0].key).toBe("PROJ-1");
    expect(data.epics[0].childIssueCount).toBe(2);
    expect(data.epics[0].childStoriesByStatus).toEqual({
      toDo: 1,
      inProgress: 0,
      done: 1,
    });
  });

  it("filters by status when provided", async () => {
    const searchFn = vi.fn().mockResolvedValueOnce({
      startAt: 0,
      maxResults: 50,
      total: 0,
      issues: [],
    });

    const client = createMockClient({ searchIssues: searchFn });

    await handleListEpics(client, cache, [], {
      projectKey: "PROJ",
      status: ["In Progress"],
    });

    const jql = searchFn.mock.calls[0][0] as string;
    expect(jql).toContain('status IN ("In Progress")');
  });

  it("rejects projects not in allowlist", async () => {
    const client = createMockClient();

    const result = await handleListEpics(client, cache, ["ALLOWED"], {
      projectKey: "BLOCKED",
    });

    expect(result).toHaveProperty("isError", true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not in the allowed project list");
  });

  it("returns empty array with message when no epics found", async () => {
    const client = createMockClient({
      searchIssues: vi.fn().mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        issues: [],
      }),
    });

    const result = await handleListEpics(client, cache, [], {
      projectKey: "PROJ",
    });
    const data = parseResult(result) as { epics: unknown[]; message: string };

    expect(data.epics).toEqual([]);
    expect(data.message).toBe("No epics found.");
  });

  it("returns error on API failure", async () => {
    const client = createMockClient({
      searchIssues: vi.fn().mockRejectedValue(new Error("Server error")),
    });

    const result = await handleListEpics(client, cache, [], {
      projectKey: "PROJ",
    });
    expect(result).toHaveProperty("isError", true);
  });
});

/* ------------------------------------------------------------------ */
/*  get_epic_children                                                  */
/* ------------------------------------------------------------------ */

describe("handleGetEpicChildren", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = createCacheManager();
  });

  it("returns children of an epic with subtask counts", async () => {
    const epicIssue = makeIssue("PROJ-1", {
      issueType: "Epic",
      summary: "My Epic",
    });

    const childWithSubtasks = makeIssue("PROJ-10", {
      issueType: "Story",
      statusCategoryKey: "indeterminate",
      status: "In Progress",
      storyPoints: 5,
      subtasks: [
        { key: "PROJ-100", summary: "Subtask 1", status: "Done" },
        { key: "PROJ-101", summary: "Subtask 2", status: "To Do" },
      ],
    });

    const searchFn = vi.fn().mockResolvedValueOnce({
      startAt: 0,
      maxResults: 50,
      total: 1,
      issues: [childWithSubtasks],
    } satisfies JiraSearchResult);

    const client = createMockClient({
      getIssue: vi.fn().mockResolvedValue(epicIssue),
      searchIssues: searchFn,
    });

    const result = await handleGetEpicChildren(client, cache, [], {
      epicKey: "PROJ-1",
    });
    const data = parseResult(result) as {
      epicKey: string;
      children: Array<Record<string, unknown>>;
    };

    expect(data.epicKey).toBe("PROJ-1");
    expect(data.children).toHaveLength(1);
    expect(data.children[0].key).toBe("PROJ-10");
    expect(data.children[0].storyPoints).toBe(5);
    expect(data.children[0].subtaskCount).toBe(2);
    expect(data.children[0].subtasksByStatus).toEqual({
      toDo: 1,
      inProgress: 0,
      done: 1,
    });
  });

  it("returns error when issue is not found", async () => {
    const client = createMockClient({
      getIssue: vi.fn().mockRejectedValue(new Error("Not found")),
    });

    const result = await handleGetEpicChildren(client, cache, [], {
      epicKey: "PROJ-999",
    });

    expect(result).toHaveProperty("isError", true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not found or is not an Epic");
  });

  it("returns error when issue is not an Epic", async () => {
    const storyIssue = makeIssue("PROJ-5", { issueType: "Story" });

    const client = createMockClient({
      getIssue: vi.fn().mockResolvedValue(storyIssue),
    });

    const result = await handleGetEpicChildren(client, cache, [], {
      epicKey: "PROJ-5",
    });

    expect(result).toHaveProperty("isError", true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("is a Story, not an Epic");
  });

  it("filters children by status and issueType", async () => {
    const epicIssue = makeIssue("PROJ-1", { issueType: "Epic" });

    const searchFn = vi.fn().mockResolvedValueOnce({
      startAt: 0,
      maxResults: 50,
      total: 0,
      issues: [],
    });

    const client = createMockClient({
      getIssue: vi.fn().mockResolvedValue(epicIssue),
      searchIssues: searchFn,
    });

    await handleGetEpicChildren(client, cache, [], {
      epicKey: "PROJ-1",
      status: ["In Progress"],
      issueType: ["Story", "Bug"],
    });

    const jql = searchFn.mock.calls[0][0] as string;
    expect(jql).toContain('status IN ("In Progress")');
    expect(jql).toContain('issuetype IN ("Story", "Bug")');
  });

  it("rejects projects not in allowlist", async () => {
    const client = createMockClient();

    const result = await handleGetEpicChildren(client, cache, ["ALLOWED"], {
      epicKey: "BLOCKED-1",
    });

    expect(result).toHaveProperty("isError", true);
  });
});

/* ------------------------------------------------------------------ */
/*  get_issue_subtasks                                                 */
/* ------------------------------------------------------------------ */

describe("handleGetIssueSubtasks", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = createCacheManager();
  });

  it("returns subtasks for a parent issue", async () => {
    const parentIssue = makeIssue("PROJ-10", {
      issueType: "Story",
      subtasks: [
        { key: "PROJ-100", summary: "Sub 1", status: "Done" },
        { key: "PROJ-101", summary: "Sub 2", status: "In Progress" },
        { key: "PROJ-102", summary: "Sub 3", status: "To Do" },
      ],
    });

    const client = createMockClient({
      getIssue: vi.fn().mockResolvedValue(parentIssue),
    });

    const result = await handleGetIssueSubtasks(client, cache, [], {
      issueKey: "PROJ-10",
    });
    const data = parseResult(result) as {
      key: string;
      parentKey: string | null;
      subtasks: Array<Record<string, unknown>>;
    };

    expect(data.key).toBe("PROJ-10");
    expect(data.parentKey).toBeNull();
    expect(data.subtasks).toHaveLength(3);
    expect(data.subtasks[0]).toEqual(
      expect.objectContaining({
        key: "PROJ-100",
        status: "Done",
      }),
    );
    expect(data.subtasks[1]).toEqual(
      expect.objectContaining({
        key: "PROJ-101",
        status: "In Progress",
      }),
    );
    expect(data.subtasks[2]).toEqual(
      expect.objectContaining({
        key: "PROJ-102",
        status: "To Do",
      }),
    );
  });

  it("returns info when issue is itself a subtask", async () => {
    const subtaskIssue = makeIssue("PROJ-100", {
      issueType: "Sub-task",
      parent: "PROJ-10",
    });

    const client = createMockClient({
      getIssue: vi.fn().mockResolvedValue(subtaskIssue),
    });

    const result = await handleGetIssueSubtasks(client, cache, [], {
      issueKey: "PROJ-100",
    });
    const data = parseResult(result) as {
      key: string;
      parentKey: string;
      subtasks: unknown[];
    };

    expect(data.key).toBe("PROJ-100");
    expect(data.parentKey).toBe("PROJ-10");
    expect(data.subtasks).toEqual([]);
  });

  it("returns error when issue not found", async () => {
    const client = createMockClient({
      getIssue: vi
        .fn()
        .mockRejectedValue(new JiraApiError("Not found", { statusCode: 404 })),
    });

    const result = await handleGetIssueSubtasks(client, cache, [], {
      issueKey: "PROJ-999",
    });

    expect(result).toHaveProperty("isError", true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("rejects projects not in allowlist", async () => {
    const client = createMockClient();

    const result = await handleGetIssueSubtasks(client, cache, ["ALLOWED"], {
      issueKey: "BLOCKED-1",
    });

    expect(result).toHaveProperty("isError", true);
  });

  it("returns empty subtasks for issue with no subtasks", async () => {
    const issue = makeIssue("PROJ-10", { issueType: "Story" });

    const client = createMockClient({
      getIssue: vi.fn().mockResolvedValue(issue),
    });

    const result = await handleGetIssueSubtasks(client, cache, [], {
      issueKey: "PROJ-10",
    });
    const data = parseResult(result) as { subtasks: unknown[] };

    expect(data.subtasks).toEqual([]);
  });
});
