/**
 * MCP tools for Jira project-level operations.
 *
 * Provides `list_projects` and `get_project_summary` tools that expose
 * project metadata and health summaries to AI agents.
 */

import { z } from "zod";
import type { JiraClient } from "../jira/client.js";
import type { CacheManager } from "../cache/manager.js";
import type { JiraIssue } from "../jira/types.js";
import type { ToolRegistry } from "./registry.js";
import {
  projectAllowed,
  textResult,
  errorResult,
  type ToolResult,
  type ToolErrorResult,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compact project representation returned by list_projects. */
interface ProjectListItem {
  key: string;
  name: string;
  id: string;
  projectTypeKey: string;
  lead: string;
  description: string;
}

/** Aggregated project health summary returned by get_project_summary. */
interface ProjectSummary {
  projectKey: string;
  totalIssues: number;
  issuesByStatusCategory: {
    toDo: number;
    inProgress: number;
    done: number;
  };
  issuesByType: Record<string, number>;
  epicCount: number;
  activeSprint: {
    id: number;
    name: string;
    goal: string | null;
    startDate: string | null;
    endDate: string | null;
    issueCount: number;
  } | null;
  recentlyUpdated: Array<{
    key: string;
    summary: string;
    status: string;
    issueType: string;
    updated: string;
  }>;
}

// ---------------------------------------------------------------------------
// Handler: list_projects
// ---------------------------------------------------------------------------

/**
 * List all Jira projects accessible to the server, with optional pagination.
 *
 * Projects are filtered by the configured allowlist when present.
 */
export async function handleListProjects(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: { startAt?: number; maxResults?: number },
): Promise<ToolResult | ToolErrorResult> {
  const startAt = params.startAt ?? 0;
  const maxResults = params.maxResults ?? 50;

  // Check cache.
  const cacheKey = cacheManager.generateKey("list_projects", {
    startAt,
    maxResults,
  });
  const cached = cacheManager.get<ProjectListItem[]>(cacheKey);
  if (cached) {
    return textResult({
      projects: cached.data,
      cached: true,
      cachedAt: cached.cachedAt,
    });
  }

  try {
    const response = await jiraClient.getProjects(startAt, maxResults);

    let projects: ProjectListItem[] = (response.values ?? []).map((p) => ({
      key: p.key,
      name: p.name,
      id: p.id,
      projectTypeKey: p.projectTypeKey ?? "",
      lead: p.lead?.displayName ?? "",
      description: p.description ?? "",
    }));

    // Filter by allowlist if configured.
    if (projectKeys.length > 0) {
      const allowedSet = new Set(projectKeys.map((k) => k.toUpperCase()));
      projects = projects.filter((p) => allowedSet.has(p.key.toUpperCase()));
    }

    cacheManager.set(cacheKey, projects);

    if (projects.length === 0) {
      return textResult({ projects: [], message: "No projects found." });
    }

    return textResult({ projects });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list projects: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler: get_project_summary
// ---------------------------------------------------------------------------

/**
 * Get a high-level project health summary including issue counts by
 * status/type, active sprint info, and recently updated issues.
 */
export async function handleGetProjectSummary(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: { projectKey: string },
): Promise<ToolResult | ToolErrorResult> {
  const { projectKey } = params;

  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_project_summary", {
    projectKey,
  });
  const cached = cacheManager.get<ProjectSummary>(cacheKey);
  if (cached) {
    return textResult({
      ...cached.data,
      cached: true,
      cachedAt: cached.cachedAt,
    });
  }

  try {
    // --- Parallel: count issues + recently updated ---
    const countFields = ["status", "issuetype"];
    const recentFields = ["summary", "status", "issuetype", "updated"];

    const [firstPage, recentResult] = await Promise.all([
      jiraClient.searchIssues(`project = ${projectKey}`, countFields, 0, 100),
      jiraClient.searchIssues(
        `project = ${projectKey} ORDER BY updated DESC`,
        recentFields,
        0,
        5,
      ),
    ]);

    // Paginate through ALL issues for counting.
    const allIssues: JiraIssue[] = [...firstPage.issues];
    let startAt = 100;
    while (startAt < firstPage.total) {
      const page = await jiraClient.searchIssues(
        `project = ${projectKey}`,
        countFields,
        startAt,
        100,
      );
      allIssues.push(...page.issues);
      startAt += 100;
    }

    // Aggregate counts.
    const issuesByStatusCategory = { toDo: 0, inProgress: 0, done: 0 };
    const issuesByType: Record<string, number> = {};
    let epicCount = 0;

    for (const issue of allIssues) {
      const categoryKey = issue.fields?.status?.statusCategory?.key ?? "";
      if (categoryKey === "new") {
        issuesByStatusCategory.toDo++;
      } else if (categoryKey === "indeterminate") {
        issuesByStatusCategory.inProgress++;
      } else if (categoryKey === "done") {
        issuesByStatusCategory.done++;
      }

      const typeName = issue.fields?.issuetype?.name ?? "Unknown";
      issuesByType[typeName] = (issuesByType[typeName] ?? 0) + 1;

      if (typeName === "Epic") {
        epicCount++;
      }
    }

    // Recently updated.
    const recentlyUpdated = recentResult.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      status: issue.fields?.status?.name ?? "",
      issueType: issue.fields?.issuetype?.name ?? "",
      updated: issue.fields?.updated ?? "",
    }));

    // --- Active sprint (best effort) ---
    let activeSprint: ProjectSummary["activeSprint"] = null;
    try {
      const boardsResponse = await jiraClient.getBoards(projectKey);
      const boards = boardsResponse.values ?? [];

      if (boards.length > 0) {
        const board = boards[0];
        const sprintsResponse = await jiraClient.getBoardSprints(
          board.id,
          "active",
        );
        const sprints = sprintsResponse.values ?? [];

        if (sprints.length > 0) {
          const sprint = sprints[0];
          const sprintIssues = await jiraClient.getSprintIssues(
            sprint.id,
            ["summary"],
            0,
            1,
          );

          activeSprint = {
            id: sprint.id,
            name: sprint.name,
            goal: sprint.goal ?? null,
            startDate: sprint.startDate ?? null,
            endDate: sprint.endDate ?? null,
            issueCount: sprintIssues.total,
          };
        }
      }
    } catch {
      // Sprint info is best-effort; ignore failures (e.g. Kanban boards).
    }

    const summary: ProjectSummary = {
      projectKey,
      totalIssues: allIssues.length,
      issuesByStatusCategory,
      issuesByType,
      epicCount,
      activeSprint,
      recentlyUpdated,
    };

    cacheManager.set(cacheKey, summary);
    return textResult(summary);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get project summary: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register project-level tools with the MCP server.
 *
 * @param registry     - The McpServer instance to register tools on.
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager for response caching.
 * @param projectKeys  - Allowed project keys (empty = allow all).
 */
export function registerProjectTools(
  registry: ToolRegistry,
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
): void {
  registry.registerTool({
    name: "list_projects",
    description:
      "List all Jira projects accessible to the server, with optional pagination.",
    inputSchema: {
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination start index (default 0)"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (default 50, max 100)"),
    },
    handler: async (params) =>
      handleListProjects(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { startAt?: number; maxResults?: number },
      ),
  });

  registry.registerTool({
    name: "get_project_summary",
    description:
      "Get a high-level project health summary including issue counts by status/type, active sprint info, and recently updated issues.",
    inputSchema: {
      projectKey: z.string().min(1).describe('Jira project key (e.g. "PROJ")'),
    },
    handler: async (params) =>
      handleGetProjectSummary(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { projectKey: string },
      ),
  });
}
