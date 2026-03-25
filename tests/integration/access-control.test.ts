/**
 * Integration tests for the ToolRegistry's access-control filtering logic.
 *
 * Tests allowlist, blocklist, and combined behaviour of the ToolRegistry,
 * as well as project-key allowlist enforcement at the tool handler level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../../src/jira/client.js";
import { CacheManager } from "../../src/cache/manager.js";
import { handleGetIssue } from "../../src/tools/issues.js";
import { handleListEpics } from "../../src/tools/epics.js";
import { handleGetProjectSummary } from "../../src/tools/projects.js";
import type { JiraIssue } from "../../src/jira/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text from an MCP tool response. */
function parseResponse(result: {
  content: Array<{ type: string; text: string }>;
}): unknown {
  return JSON.parse(result.content[0].text);
}

/** Create a mocked JiraClient. */
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

/** Stub McpServer that records tool registrations. */
function createMockServer() {
  const registeredTools: string[] = [];
  return {
    tool: vi.fn((...args: unknown[]) => {
      registeredTools.push(args[0] as string);
    }),
    _registeredTools: registeredTools,
  };
}

// ---------------------------------------------------------------------------
// Tests: ToolRegistry filtering
// ---------------------------------------------------------------------------

describe("Integration: access-control", () => {
  describe("ToolRegistry.isToolAllowed", () => {
    // 1. Empty lists -> all tools allowed
    it("allows all tools when both lists are empty", () => {
      const registry = new ToolRegistry({} as unknown as McpServer, [], []);

      expect(registry.isToolAllowed("list_projects")).toBe(true);
      expect(registry.isToolAllowed("get_issue")).toBe(true);
      expect(registry.isToolAllowed("search_issues")).toBe(true);
      expect(registry.isToolAllowed("get_active_sprint")).toBe(true);
      expect(registry.isToolAllowed("any_random_tool")).toBe(true);
    });

    // 2. Allowlist -> only listed tools pass
    it("allows only listed tools when allowlist is set", () => {
      const registry = new ToolRegistry(
        {} as unknown as McpServer,
        ["list_projects", "get_issue"],
        [],
      );

      expect(registry.isToolAllowed("list_projects")).toBe(true);
      expect(registry.isToolAllowed("get_issue")).toBe(true);
      expect(registry.isToolAllowed("search_issues")).toBe(false);
      expect(registry.isToolAllowed("get_active_sprint")).toBe(false);
    });

    // 3. Blocklist -> all except listed pass
    it("blocks only listed tools when blocklist is set", () => {
      const registry = new ToolRegistry(
        {} as unknown as McpServer,
        [],
        ["search_issues", "get_active_sprint"],
      );

      expect(registry.isToolAllowed("list_projects")).toBe(true);
      expect(registry.isToolAllowed("get_issue")).toBe(true);
      expect(registry.isToolAllowed("search_issues")).toBe(false);
      expect(registry.isToolAllowed("get_active_sprint")).toBe(false);
    });

    // 4. Both defined -> allowlist wins
    it("allowlist takes precedence when both are defined", () => {
      const registry = new ToolRegistry(
        {} as unknown as McpServer,
        ["list_projects"], // allowlist
        ["list_projects"], // blocklist (should be ignored)
      );

      // list_projects is in the allowlist, so it passes even though it is also
      // in the blocklist. The blocklist is entirely ignored when the allowlist
      // is non-empty.
      expect(registry.isToolAllowed("list_projects")).toBe(true);
      expect(registry.isToolAllowed("get_issue")).toBe(false);
      expect(registry.isToolAllowed("search_issues")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ToolRegistry.registerTool — blocked tools are not registered
  // -------------------------------------------------------------------------

  describe("ToolRegistry.registerTool", () => {
    it("registers allowed tool and returns true", () => {
      const server = createMockServer();
      const registry = new ToolRegistry(server as unknown as McpServer, [], []);

      const registered = registry.registerTool({
        name: "test_tool",
        description: "A test tool",
        inputSchema: {},
        handler: async () => ({
          content: [{ type: "text" as const, text: "{}" }],
        }),
      });

      expect(registered).toBe(true);
      expect(registry.getRegisteredTools()).toContain("test_tool");
    });

    it("does not register blocked tool and returns false", () => {
      const server = createMockServer();
      const registry = new ToolRegistry(
        server as unknown as McpServer,
        [],
        ["blocked_tool"],
      );

      const registered = registry.registerTool({
        name: "blocked_tool",
        description: "Should not register",
        inputSchema: {},
        handler: async () => ({
          content: [{ type: "text" as const, text: "{}" }],
        }),
      });

      expect(registered).toBe(false);
      expect(registry.getRegisteredTools()).not.toContain("blocked_tool");
      expect(server.tool).not.toHaveBeenCalled();
    });

    it("registers only allowlisted tools from a batch", () => {
      const server = createMockServer();
      const registry = new ToolRegistry(
        server as unknown as McpServer,
        ["tool_a", "tool_c"],
        [],
      );

      const tools = ["tool_a", "tool_b", "tool_c", "tool_d"];
      const results = tools.map((name) =>
        registry.registerTool({
          name,
          description: `Tool ${name}`,
          inputSchema: {},
          handler: async () => ({
            content: [{ type: "text" as const, text: "{}" }],
          }),
        }),
      );

      expect(results).toEqual([true, false, true, false]);
      expect(registry.getRegisteredTools()).toEqual(["tool_a", "tool_c"]);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Project key not in allowlist -> tools return error
  // -------------------------------------------------------------------------

  describe("project key not in allowlist -> tools return error", () => {
    let client: JiraClient;
    let cache: CacheManager;
    const projectAllowlist = ["ALLOWED", "ALSO_OK"];

    beforeEach(() => {
      client = createMockClient();
      cache = new CacheManager({
        enabled: true,
        ttlSeconds: 300,
        maxEntries: 100,
      });
    });

    it("get_issue rejects issue from disallowed project", async () => {
      const result = await handleGetIssue(client, cache, projectAllowlist, {
        issueKey: "FORBIDDEN-123",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("FORBIDDEN");
      expect(data.error).toContain("not in the allowed project list");
      // Jira API should NOT have been called.
      expect(client.getIssue).not.toHaveBeenCalled();
    });

    it("list_epics rejects disallowed project key", async () => {
      const result = await handleListEpics(client, cache, projectAllowlist, {
        projectKey: "NOPE",
      });
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("NOPE");
      expect(data.error).toContain("not in the allowed project list");
      expect(client.searchIssues).not.toHaveBeenCalled();
    });

    it("get_project_summary rejects disallowed project key", async () => {
      const result = await handleGetProjectSummary(
        client,
        cache,
        projectAllowlist,
        {
          projectKey: "DENIED",
        },
      );
      const data = parseResponse(result) as { error: string };

      expect(result.isError).toBe(true);
      expect(data.error).toContain("DENIED");
      expect(data.error).toContain("not in the allowed project list");
      expect(client.searchIssues).not.toHaveBeenCalled();
    });

    it("allows issue from an allowed project", async () => {
      const issue: JiraIssue = {
        id: "1",
        key: "ALLOWED-1",
        self: "https://test.atlassian.net/rest/api/3/issue/ALLOWED-1",
        fields: {
          summary: "Allowed issue",
          description: null,
          status: {
            name: "Open",
            statusCategory: { name: "To Do", key: "new" },
          },
          issuetype: { name: "Task" },
          priority: { name: "Medium" },
          assignee: null,
          reporter: null,
          labels: [],
          components: [],
          fixVersions: [],
          created: "2026-03-01T10:00:00.000+0000",
          updated: "2026-03-10T15:00:00.000+0000",
          duedate: null,
          parent: null,
          subtasks: [],
          issuelinks: [],
          comment: { total: 0 },
          customfield_10016: null,
        },
      };
      vi.mocked(client.getIssue).mockResolvedValue(issue);

      const result = await handleGetIssue(client, cache, projectAllowlist, {
        issueKey: "ALLOWED-1",
      });
      const data = parseResponse(result) as { key: string };

      expect(result.isError).toBeUndefined();
      expect(data.key).toBe("ALLOWED-1");
      expect(client.getIssue).toHaveBeenCalledOnce();
    });
  });
});
