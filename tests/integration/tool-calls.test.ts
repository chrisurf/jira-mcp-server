/**
 * Integration tests for the Jira MCP Server tool handlers.
 *
 * Tests the full pipeline: tool handler -> mocked JiraClient -> response
 * transformation. Uses a real CacheManager and mocked JiraClient methods.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JiraClient } from "../../src/jira/client.js";
import { JiraApiError } from "../../src/jira/client.js";
import { CacheManager } from "../../src/cache/manager.js";
import {
  handleListProjects,
  handleGetProjectSummary,
} from "../../src/tools/projects.js";
import {
  handleListEpics,
  handleGetEpicChildren,
} from "../../src/tools/epics.js";
import { handleGetIssue, handleSearchIssues } from "../../src/tools/issues.js";
import { handleGetActiveSprint } from "../../src/tools/sprints.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraIssue, JiraIssueFields } from "../../src/jira/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text from an MCP tool response. */
function parseResponse(result: {
  content: Array<{ type: string; text: string }>;
}): unknown {
  return JSON.parse(result.content[0].text);
}

/** Build a minimal JiraIssue fixture. */
function makeIssue(overrides: {
  key: string;
  summary?: string;
  statusName?: string;
  statusCategoryKey?: string;
  statusCategoryName?: string;
  issueTypeName?: string;
  priorityName?: string;
  assignee?: string | null;
  description?: Record<string, unknown> | null;
  subtasks?: JiraIssue["fields"]["subtasks"];
  parent?: { key: string } | null;
  storyPoints?: number | null;
  labels?: string[];
  components?: { name: string }[];
  fixVersions?: { name: string }[];
  issuelinks?: JiraIssueFields["issuelinks"];
  updated?: string;
  created?: string;
}): JiraIssue {
  return {
    id: overrides.key.replace("-", ""),
    key: overrides.key,
    self: `https://test.atlassian.net/rest/api/3/issue/${overrides.key}`,
    fields: {
      summary: overrides.summary ?? `Summary for ${overrides.key}`,
      description: overrides.description ?? null,
      status: {
        name: overrides.statusName ?? "To Do",
        statusCategory: {
          name: overrides.statusCategoryName ?? "To Do",
          key: overrides.statusCategoryKey ?? "new",
        },
      },
      issuetype: { name: overrides.issueTypeName ?? "Story" },
      priority: { name: overrides.priorityName ?? "Medium" },
      assignee: overrides.assignee ? { displayName: overrides.assignee } : null,
      reporter: null,
      labels: overrides.labels ?? [],
      components: overrides.components ?? [],
      fixVersions: overrides.fixVersions ?? [],
      created: overrides.created ?? "2026-03-01T10:00:00.000+0000",
      updated: overrides.updated ?? "2026-03-10T15:00:00.000+0000",
      duedate: null,
      parent: overrides.parent ?? null,
      subtasks: overrides.subtasks ?? [],
      issuelinks: overrides.issuelinks ?? [],
      comment: { total: 0 },
      customfield_10016: overrides.storyPoints ?? null,
    },
  };
}

/** Create a mocked JiraClient with vi.fn() for all public methods. */
function createMockClient(): JiraClient {
  return {
    validateConnection: vi.fn(),
    getProjects: vi.fn(),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    getBoards: vi.fn(),
    getBoardSprints: vi.fn(),
    getSprintIssues: vi.fn(),
  } as unknown as JiraClient;
}

/** Create a real CacheManager with caching enabled. */
function createCacheManager(): CacheManager {
  return new CacheManager({ enabled: true, ttlSeconds: 300, maxEntries: 100 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: tool-calls", () => {
  let client: JiraClient;
  let cache: CacheManager;

  beforeEach(() => {
    client = createMockClient();
    cache = createCacheManager();
  });

  // -------------------------------------------------------------------------
  // 1. list_projects -> returns projects filtered by allowlist
  // -------------------------------------------------------------------------

  describe("list_projects", () => {
    it("returns projects filtered by allowlist", async () => {
      vi.mocked(client.getProjects).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 3,
        values: [
          {
            id: "1",
            key: "PROJ",
            name: "Project One",
            projectTypeKey: "software",
            lead: { displayName: "Alice" },
            description: "Desc A",
          },
          {
            id: "2",
            key: "OTHER",
            name: "Other Project",
            projectTypeKey: "business",
            lead: { displayName: "Bob" },
            description: "Desc B",
          },
          {
            id: "3",
            key: "ALLOWED",
            name: "Allowed Project",
            projectTypeKey: "software",
            lead: { displayName: "Eve" },
            description: "Desc C",
          },
        ],
      });

      const result = await handleListProjects(
        client,
        cache,
        ["PROJ", "ALLOWED"],
        {},
      );
      const data = parseResponse(result) as {
        projects: Array<{ key: string }>;
      };

      expect(data.projects).toHaveLength(2);
      expect(data.projects.map((p) => p.key)).toEqual(["PROJ", "ALLOWED"]);
    });

    it("returns all projects when allowlist is empty", async () => {
      vi.mocked(client.getProjects).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 2,
        values: [
          {
            id: "1",
            key: "A",
            name: "A",
            projectTypeKey: "software",
            lead: { displayName: "X" },
            description: "",
          },
          {
            id: "2",
            key: "B",
            name: "B",
            projectTypeKey: "software",
            lead: { displayName: "Y" },
            description: "",
          },
        ],
      });

      const result = await handleListProjects(client, cache, [], {});
      const data = parseResponse(result) as {
        projects: Array<{ key: string }>;
      };

      expect(data.projects).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // 2. get_project_summary -> aggregates counts correctly
  // -------------------------------------------------------------------------

  describe("get_project_summary", () => {
    it("aggregates issue counts correctly from search results", async () => {
      const issues: JiraIssue[] = [
        makeIssue({
          key: "PROJ-1",
          statusCategoryKey: "new",
          issueTypeName: "Story",
        }),
        makeIssue({
          key: "PROJ-2",
          statusCategoryKey: "indeterminate",
          issueTypeName: "Bug",
        }),
        makeIssue({
          key: "PROJ-3",
          statusCategoryKey: "done",
          issueTypeName: "Story",
        }),
        makeIssue({
          key: "PROJ-4",
          statusCategoryKey: "done",
          issueTypeName: "Epic",
        }),
      ];

      // First call: count issues; second call: recently updated.
      vi.mocked(client.searchIssues)
        .mockResolvedValueOnce({
          startAt: 0,
          maxResults: 100,
          total: 4,
          issues,
        })
        .mockResolvedValueOnce({
          startAt: 0,
          maxResults: 5,
          total: 4,
          issues: issues.slice(0, 2),
        });

      // Boards — no board found (best-effort sprint info).
      vi.mocked(client.getBoards).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        values: [],
      });

      const result = await handleGetProjectSummary(client, cache, ["PROJ"], {
        projectKey: "PROJ",
      });
      const data = parseResponse(result) as {
        totalIssues: number;
        issuesByStatusCategory: {
          toDo: number;
          inProgress: number;
          done: number;
        };
        issuesByType: Record<string, number>;
        epicCount: number;
        activeSprint: unknown;
      };

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
  });

  // -------------------------------------------------------------------------
  // 3. list_epics -> returns epics with child counts
  // -------------------------------------------------------------------------

  describe("list_epics", () => {
    it("returns epics with child issue counts", async () => {
      const epic = makeIssue({
        key: "PROJ-10",
        issueTypeName: "Epic",
        summary: "Epic One",
        statusCategoryKey: "indeterminate",
        statusCategoryName: "In Progress",
        assignee: "Alice",
      });

      // Epic search result.
      vi.mocked(client.searchIssues)
        .mockResolvedValueOnce({
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [epic],
        })
        // Child issues of PROJ-10.
        .mockResolvedValueOnce({
          startAt: 0,
          maxResults: 100,
          total: 3,
          issues: [
            makeIssue({ key: "PROJ-11", statusCategoryKey: "new" }),
            makeIssue({ key: "PROJ-12", statusCategoryKey: "done" }),
            makeIssue({ key: "PROJ-13", statusCategoryKey: "done" }),
          ],
        });

      const result = await handleListEpics(client, cache, ["PROJ"], {
        projectKey: "PROJ",
      });
      const data = parseResponse(result) as {
        epics: Array<{
          key: string;
          childIssueCount: number;
          childStoriesByStatus: { toDo: number; done: number };
        }>;
      };

      expect(data.epics).toHaveLength(1);
      expect(data.epics[0].key).toBe("PROJ-10");
      expect(data.epics[0].childIssueCount).toBe(3);
      expect(data.epics[0].childStoriesByStatus.toDo).toBe(1);
      expect(data.epics[0].childStoriesByStatus.done).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. get_epic_children -> validates epic type, returns children with subtask counts
  // -------------------------------------------------------------------------

  describe("get_epic_children", () => {
    it("validates epic type and returns children with subtask counts", async () => {
      const epicIssue = makeIssue({
        key: "PROJ-10",
        issueTypeName: "Epic",
        summary: "My Epic",
      });
      vi.mocked(client.getIssue).mockResolvedValue(epicIssue);

      const childWithSubtasks = makeIssue({
        key: "PROJ-20",
        issueTypeName: "Story",
        statusCategoryKey: "indeterminate",
        statusCategoryName: "In Progress",
        storyPoints: 5,
        subtasks: [
          {
            key: "PROJ-21",
            fields: { summary: "Sub 1", status: { name: "Done" } },
          },
          {
            key: "PROJ-22",
            fields: { summary: "Sub 2", status: { name: "To Do" } },
          },
        ],
      });

      vi.mocked(client.searchIssues).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 1,
        issues: [childWithSubtasks],
      });

      const result = await handleGetEpicChildren(client, cache, ["PROJ"], {
        epicKey: "PROJ-10",
      });
      const data = parseResponse(result) as {
        epicKey: string;
        epicSummary: string;
        children: Array<{
          key: string;
          subtaskCount: number;
          subtasksByStatus: { toDo: number; inProgress: number; done: number };
          storyPoints: number | null;
        }>;
      };

      expect(data.epicKey).toBe("PROJ-10");
      expect(data.epicSummary).toBe("My Epic");
      expect(data.children).toHaveLength(1);
      expect(data.children[0].subtaskCount).toBe(2);
      expect(data.children[0].subtasksByStatus.done).toBe(1);
      expect(data.children[0].subtasksByStatus.toDo).toBe(1);
      expect(data.children[0].storyPoints).toBe(5);
    });

    it("rejects non-Epic issue type", async () => {
      vi.mocked(client.getIssue).mockResolvedValue(
        makeIssue({ key: "PROJ-10", issueTypeName: "Story" }),
      );

      const result = await handleGetEpicChildren(client, cache, ["PROJ"], {
        epicKey: "PROJ-10",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("not an Epic");
    });
  });

  // -------------------------------------------------------------------------
  // 5. get_issue -> returns full mapped issue with ADF->text conversion
  // -------------------------------------------------------------------------

  describe("get_issue", () => {
    it("returns full mapped issue with ADF-to-text conversion", async () => {
      const adfDescription = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      };

      const issue = makeIssue({
        key: "PROJ-42",
        summary: "Test Issue",
        statusName: "In Progress",
        statusCategoryKey: "indeterminate",
        statusCategoryName: "In Progress",
        issueTypeName: "Story",
        priorityName: "High",
        assignee: "Alice",
        description: adfDescription,
        labels: ["backend"],
        storyPoints: 3,
      });

      vi.mocked(client.getIssue).mockResolvedValue(issue);

      const result = await handleGetIssue(client, cache, ["PROJ"], {
        issueKey: "PROJ-42",
      });
      const data = parseResponse(result) as {
        key: string;
        summary: string;
        description: string;
        status: string;
        issueType: string;
        priority: string;
        assignee: string;
        labels: string[];
        storyPoints: number;
      };

      expect(result.isError).toBeUndefined();
      expect(data.key).toBe("PROJ-42");
      expect(data.summary).toBe("Test Issue");
      expect(data.description).toContain("Hello world");
      expect(data.status).toBe("In Progress");
      expect(data.issueType).toBe("Story");
      expect(data.priority).toBe("High");
      expect(data.assignee).toBe("Alice");
      expect(data.labels).toEqual(["backend"]);
      expect(data.storyPoints).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 6. search_issues -> auto-appends project filter when allowlist active
  // -------------------------------------------------------------------------

  describe("search_issues", () => {
    it("auto-appends project filter when allowlist is active", async () => {
      vi.mocked(client.searchIssues).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        issues: [],
      });

      await handleSearchIssues(client, cache, ["PROJ", "OTHER"], {
        jql: 'status = "In Progress"',
      });

      const calledJql = vi.mocked(client.searchIssues).mock.calls[0][0];
      expect(calledJql).toContain('AND project IN ("PROJ", "OTHER")');
    });

    // -----------------------------------------------------------------------
    // 7. search_issues -> does NOT append when JQL already has "project"
    // -----------------------------------------------------------------------

    it("does NOT append project filter when JQL already contains project clause", async () => {
      vi.mocked(client.searchIssues).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 0,
        issues: [],
      });

      await handleSearchIssues(client, cache, ["PROJ"], {
        jql: 'project = PROJ AND status = "Done"',
      });

      const calledJql = vi.mocked(client.searchIssues).mock.calls[0][0];
      // Should be the original JQL, unchanged.
      expect(calledJql).toBe('project = PROJ AND status = "Done"');
    });
  });

  // -------------------------------------------------------------------------
  // 8. get_active_sprint -> resolves board from project, groups by status
  // -------------------------------------------------------------------------

  describe("get_active_sprint", () => {
    it("resolves board from project key and groups issues by status", async () => {
      vi.mocked(client.getBoards).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 1,
        values: [{ id: 42, name: "PROJ Board", type: "scrum" }],
      });

      vi.mocked(client.getBoardSprints).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 1,
        values: [
          {
            id: 100,
            name: "Sprint 5",
            goal: "Ship it",
            state: "active",
            startDate: "2026-03-01",
            endDate: "2026-03-14",
          },
        ],
      });

      vi.mocked(client.getSprintIssues).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 3,
        issues: [
          makeIssue({
            key: "PROJ-1",
            statusCategoryKey: "new",
            storyPoints: 2,
          }),
          makeIssue({
            key: "PROJ-2",
            statusCategoryKey: "indeterminate",
            storyPoints: 3,
          }),
          makeIssue({
            key: "PROJ-3",
            statusCategoryKey: "done",
            storyPoints: 5,
          }),
        ],
      });

      const result = await handleGetActiveSprint(client, cache, ["PROJ"], {
        projectKeyOrBoardId: "PROJ",
      });
      const data = parseResponse(result) as {
        sprint: { id: number; name: string; goal: string };
        toDo: Array<{ key: string }>;
        inProgress: Array<{ key: string }>;
        done: Array<{ key: string }>;
        totalIssues: number;
        totalStoryPoints: number;
        completedStoryPoints: number;
      };

      expect(data.sprint.name).toBe("Sprint 5");
      expect(data.sprint.goal).toBe("Ship it");
      expect(data.toDo).toHaveLength(1);
      expect(data.inProgress).toHaveLength(1);
      expect(data.done).toHaveLength(1);
      expect(data.totalIssues).toBe(3);
      expect(data.totalStoryPoints).toBe(10);
      expect(data.completedStoryPoints).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Access control: project allowlist -> rejects disallowed project
  // -------------------------------------------------------------------------

  describe("access control: project allowlist", () => {
    it("rejects issue from disallowed project", async () => {
      const result = await handleGetIssue(client, cache, ["ALLOWED"], {
        issueKey: "BLOCKED-42",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("not in the allowed project list");
    });

    it("rejects project summary for disallowed project", async () => {
      const result = await handleGetProjectSummary(client, cache, ["ALLOWED"], {
        projectKey: "BLOCKED",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("not in the allowed project list");
    });

    it("rejects epic children for disallowed project", async () => {
      const result = await handleGetEpicChildren(client, cache, ["ALLOWED"], {
        epicKey: "BLOCKED-10",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("not in the allowed project list");
    });

    it("rejects active sprint for disallowed project", async () => {
      const result = await handleGetActiveSprint(client, cache, ["ALLOWED"], {
        projectKeyOrBoardId: "BLOCKED",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("not in the allowed project list");
    });
  });

  // -------------------------------------------------------------------------
  // 10. Access control: tool blocklist -> isToolAllowed returns false
  // -------------------------------------------------------------------------

  describe("access control: tool blocklist", () => {
    it("isToolAllowed returns false for blocked tool", () => {
      const registry = new ToolRegistry(
        {} as unknown as McpServer, // McpServer stub not needed for isToolAllowed
        [],
        ["get_issue", "search_issues"],
      );

      expect(registry.isToolAllowed("get_issue")).toBe(false);
      expect(registry.isToolAllowed("search_issues")).toBe(false);
      expect(registry.isToolAllowed("list_projects")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Cache integration -> second call returns cached result
  // -------------------------------------------------------------------------

  describe("cache integration", () => {
    it("second call returns cached result with cached flag", async () => {
      vi.mocked(client.getProjects).mockResolvedValue({
        startAt: 0,
        maxResults: 50,
        total: 1,
        values: [
          {
            id: "1",
            key: "PROJ",
            name: "Project",
            projectTypeKey: "software",
            lead: { displayName: "X" },
            description: "",
          },
        ],
      });

      // First call — hits the API.
      const result1 = await handleListProjects(client, cache, [], {});
      const data1 = parseResponse(result1) as {
        projects: unknown[];
        cached?: boolean;
      };
      expect(data1.cached).toBeUndefined();

      // Second call — should come from cache.
      const result2 = await handleListProjects(client, cache, [], {});
      const data2 = parseResponse(result2) as {
        projects: unknown[];
        cached: boolean;
        cachedAt: string;
      };
      expect(data2.cached).toBe(true);
      expect(data2.cachedAt).toBeDefined();

      // API should have been called only once.
      expect(vi.mocked(client.getProjects)).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 12. Error propagation -> JiraApiError (404) becomes structured error
  // -------------------------------------------------------------------------

  describe("error propagation", () => {
    it("JiraApiError (404) becomes structured error response for get_issue", async () => {
      vi.mocked(client.getIssue).mockRejectedValue(
        new JiraApiError("Resource not found", { statusCode: 404 }),
      );

      const result = await handleGetIssue(client, cache, ["PROJ"], {
        issueKey: "PROJ-999",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("not found");
    });

    it("JiraApiError propagates as structured error for search_issues", async () => {
      vi.mocked(client.searchIssues).mockRejectedValue(
        new JiraApiError("JQL parse error: unexpected token", {
          statusCode: 400,
        }),
      );

      const result = await handleSearchIssues(client, cache, [], {
        jql: "invalid jql {{",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("JQL parse error");
    });

    it("JiraApiError in list_projects returns structured error", async () => {
      vi.mocked(client.getProjects).mockRejectedValue(
        new JiraApiError("Authentication failed", { statusCode: 401 }),
      );

      const result = await handleListProjects(client, cache, [], {});
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("Failed to list projects");
    });
  });
});
