/**
 * MCP tools for Jira epic and issue hierarchy operations.
 *
 * Provides `list_epics` and `get_epic_children` tools that expose
 * epic structure and hierarchy to AI agents.
 */

import { z } from "zod";
import type { JiraClient } from "../jira/client.js";
import type { CacheManager } from "../cache/manager.js";
import type { JiraIssue, JiraIssueRef } from "../jira/types.js";
import type { ToolRegistry } from "./registry.js";
import { mapIssue } from "../transformers/issue-mapper.js";
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

/** Status category counts for child issues. */
interface StatusCategoryCounts {
  toDo: number;
  inProgress: number;
  done: number;
}

/** Epic list item with progress info. */
interface EpicListItem {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  priority: string;
  assignee: string | null;
  updated: string;
  childIssueCount: number;
  childStoriesByStatus: StatusCategoryCounts;
}

/** Child issue of an epic. */
interface EpicChild {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  statusCategory: string;
  priority: string;
  assignee: string | null;
  updated: string;
  storyPoints: number | null;
  subtaskCount: number;
  subtasksByStatus: StatusCategoryCounts;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count status categories from an array of Jira issues.
 */
function countByStatusCategory(issues: JiraIssue[]): StatusCategoryCounts {
  const counts: StatusCategoryCounts = { toDo: 0, inProgress: 0, done: 0 };
  for (const issue of issues) {
    const key = issue.fields?.status?.statusCategory?.key ?? "";
    if (key === "new") counts.toDo++;
    else if (key === "indeterminate") counts.inProgress++;
    else if (key === "done") counts.done++;
  }
  return counts;
}

/**
 * Extract the project key from an issue key (e.g. "PROJ-123" -> "PROJ").
 */
function extractProjectKey(issueKey: string): string {
  const idx = issueKey.lastIndexOf("-");
  return idx > 0 ? issueKey.substring(0, idx) : issueKey;
}

// ---------------------------------------------------------------------------
// Handler: list_epics
// ---------------------------------------------------------------------------

/**
 * List all epics in a project with their status, progress, and child story counts.
 */
export async function handleListEpics(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: {
    projectKey: string;
    status?: string[];
    maxResults?: number;
    startAt?: number;
  },
): Promise<ToolResult | ToolErrorResult> {
  const { projectKey, status, maxResults = 50, startAt = 0 } = params;

  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("list_epics", {
    projectKey,
    status: status ?? [],
    maxResults,
    startAt,
  });
  const cached = cacheManager.get<EpicListItem[]>(cacheKey);
  if (cached) {
    return textResult({
      epics: cached.data,
      cached: true,
      cachedAt: cached.cachedAt,
    });
  }

  try {
    // Build JQL.
    let jql = `project = ${projectKey} AND issuetype = Epic`;
    if (status && status.length > 0) {
      const statusList = status.map((s) => `"${s}"`).join(", ");
      jql += ` AND status IN (${statusList})`;
    }
    jql += " ORDER BY updated DESC";

    const epicResult = await jiraClient.searchIssues(
      jql,
      ["summary", "status", "priority", "assignee", "updated"],
      startAt,
      maxResults,
    );

    // For each epic, get child story counts.
    const epics: EpicListItem[] = await Promise.all(
      epicResult.issues.map(async (epic) => {
        let childStoriesByStatus: StatusCategoryCounts = {
          toDo: 0,
          inProgress: 0,
          done: 0,
        };
        let childIssueCount = 0;

        try {
          const childResult = await jiraClient.searchIssues(
            `"Epic Link" = ${epic.key} OR parent = ${epic.key}`,
            ["status"],
            0,
            100,
          );
          childIssueCount = childResult.total;
          childStoriesByStatus = countByStatusCategory(childResult.issues);

          // If more than 100 children, paginate to get accurate counts.
          if (childResult.total > 100) {
            let offset = 100;
            while (offset < childResult.total) {
              const page = await jiraClient.searchIssues(
                `"Epic Link" = ${epic.key} OR parent = ${epic.key}`,
                ["status"],
                offset,
                100,
              );
              const pageCounts = countByStatusCategory(page.issues);
              childStoriesByStatus.toDo += pageCounts.toDo;
              childStoriesByStatus.inProgress += pageCounts.inProgress;
              childStoriesByStatus.done += pageCounts.done;
              offset += 100;
            }
          }
        } catch {
          // Child count is best-effort.
        }

        return {
          key: epic.key,
          summary: epic.fields?.summary ?? "",
          status: epic.fields?.status?.name ?? "",
          statusCategory: epic.fields?.status?.statusCategory?.name ?? "",
          priority: epic.fields?.priority?.name ?? "",
          assignee: epic.fields?.assignee?.displayName ?? null,
          updated: epic.fields?.updated ?? "",
          childIssueCount,
          childStoriesByStatus,
        };
      }),
    );

    cacheManager.set(cacheKey, epics);

    if (epics.length === 0) {
      return textResult({ epics: [], message: "No epics found." });
    }

    return textResult({ epics, total: epicResult.total });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list epics: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler: get_epic_children
// ---------------------------------------------------------------------------

/**
 * Get all child issues (stories, tasks, bugs) of a specific epic with
 * their statuses and subtask summaries.
 */
export async function handleGetEpicChildren(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: {
    epicKey: string;
    status?: string[];
    issueType?: string[];
    maxResults?: number;
    startAt?: number;
  },
): Promise<ToolResult | ToolErrorResult> {
  const { epicKey, status, issueType, maxResults = 50, startAt = 0 } = params;

  // Validate project allowlist.
  const projectKey = extractProjectKey(epicKey);
  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_epic_children", {
    epicKey,
    status: status ?? [],
    issueType: issueType ?? [],
    maxResults,
    startAt,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      cached: true,
      cachedAt: cached.cachedAt,
    });
  }

  try {
    // Verify the epic exists and is actually an Epic type.
    let epicIssue: JiraIssue;
    try {
      epicIssue = await jiraClient.getIssue(epicKey, [
        "issuetype",
        "summary",
        "status",
      ]);
    } catch {
      return errorResult(`Issue "${epicKey}" not found or is not an Epic.`);
    }

    const epicTypeName = epicIssue.fields?.issuetype?.name ?? "";
    if (epicTypeName !== "Epic") {
      return errorResult(
        `Issue "${epicKey}" is a ${epicTypeName}, not an Epic.`,
      );
    }

    // Build JQL for children.
    let jql = `"Epic Link" = ${epicKey} OR parent = ${epicKey}`;
    const filters: string[] = [];
    if (status && status.length > 0) {
      const statusList = status.map((s) => `"${s}"`).join(", ");
      filters.push(`status IN (${statusList})`);
    }
    if (issueType && issueType.length > 0) {
      const typeList = issueType.map((t) => `"${t}"`).join(", ");
      filters.push(`issuetype IN (${typeList})`);
    }
    if (filters.length > 0) {
      jql = `(${jql}) AND ${filters.join(" AND ")}`;
    }
    jql += " ORDER BY priority ASC, updated DESC";

    const childResult = await jiraClient.searchIssues(
      jql,
      [
        "summary",
        "issuetype",
        "status",
        "priority",
        "assignee",
        "updated",
        "subtasks",
        "customfield_10016",
      ],
      startAt,
      maxResults,
    );

    const children: EpicChild[] = childResult.issues.map((issue) => {
      const subtasks = issue.fields?.subtasks ?? [];
      const subtasksByStatus: StatusCategoryCounts = {
        toDo: 0,
        inProgress: 0,
        done: 0,
      };
      for (const st of subtasks) {
        const stStatus = st.fields?.status?.name ?? "";
        // Subtask refs don't have statusCategory, so we map by convention.
        // Since JiraIssueRef only has status.name, we cannot reliably
        // categorize without the category key. Count all as toDo by default
        // and adjust below if we can match known patterns.
        // Actually JiraIssueRef has fields.status.name — we'll try a simple heuristic.
        const lowerStatus = stStatus.toLowerCase();
        if (
          lowerStatus.includes("done") ||
          lowerStatus.includes("closed") ||
          lowerStatus.includes("resolved")
        ) {
          subtasksByStatus.done++;
        } else if (
          lowerStatus.includes("progress") ||
          lowerStatus.includes("review")
        ) {
          subtasksByStatus.inProgress++;
        } else {
          subtasksByStatus.toDo++;
        }
      }

      return {
        key: issue.key,
        summary: issue.fields?.summary ?? "",
        issueType: issue.fields?.issuetype?.name ?? "",
        status: issue.fields?.status?.name ?? "",
        statusCategory: issue.fields?.status?.statusCategory?.name ?? "",
        priority: issue.fields?.priority?.name ?? "",
        assignee: issue.fields?.assignee?.displayName ?? null,
        updated: issue.fields?.updated ?? "",
        storyPoints: issue.fields?.customfield_10016 ?? null,
        subtaskCount: subtasks.length,
        subtasksByStatus,
      };
    });

    const result = {
      epicKey,
      epicSummary: epicIssue.fields?.summary ?? "",
      children,
      total: childResult.total,
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get epic children: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler: get_epic_overview
// ---------------------------------------------------------------------------

/** Subtask within an epic overview child. */
interface EpicOverviewSubtask {
  key: string;
  summary: string;
  status: string;
}

/** Child issue (story/task/bug) in the epic overview. */
interface EpicOverviewChild {
  key: string;
  summary: string;
  description: string | null;
  issueType: string;
  status: string;
  statusCategory: string;
  priority: string;
  assignee: string | null;
  storyPoints: number | null;
  subtasks: EpicOverviewSubtask[];
}

/**
 * Get a complete epic overview: epic metadata + all children with descriptions
 * and their subtasks — in a single MCP call.
 *
 * This drastically reduces the number of tool calls needed to understand an
 * epic's full structure (2-3 API calls instead of N+1 per story).
 */
export async function handleGetEpicOverview(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: {
    epicKey: string;
    maxDescriptionLength?: number;
    maxResults?: number;
    startAt?: number;
  },
): Promise<ToolResult | ToolErrorResult> {
  const {
    epicKey,
    maxDescriptionLength = 500,
    maxResults = 50,
    startAt = 0,
  } = params;

  // Validate project allowlist.
  const projectKey = extractProjectKey(epicKey);
  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_epic_overview", {
    epicKey,
    maxDescriptionLength,
    maxResults,
    startAt,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      cached: true,
      cachedAt: cached.cachedAt,
    });
  }

  try {
    // 1. Get the epic itself with full details.
    let epicIssue: JiraIssue;
    try {
      epicIssue = await jiraClient.getIssue(epicKey, [
        "summary",
        "status",
        "description",
        "issuetype",
        "priority",
        "assignee",
        "updated",
      ]);
    } catch {
      return errorResult(`Issue "${epicKey}" not found.`);
    }

    const epicTypeName = epicIssue.fields?.issuetype?.name ?? "";
    if (epicTypeName !== "Epic") {
      return errorResult(
        `Issue "${epicKey}" is a ${epicTypeName}, not an Epic.`,
      );
    }

    const epicMapped = mapIssue(epicIssue);

    // 2. Get all children with descriptions and subtasks in one search.
    const jql = `("Epic Link" = ${epicKey} OR parent = ${epicKey}) ORDER BY priority ASC, updated DESC`;
    const childResult = await jiraClient.searchIssues(
      jql,
      [
        "summary",
        "description",
        "issuetype",
        "status",
        "priority",
        "assignee",
        "subtasks",
        "customfield_10016",
      ],
      startAt,
      maxResults,
    );

    // Paginate if needed.
    const allChildIssues: JiraIssue[] = [...childResult.issues];
    if (startAt === 0 && childResult.total > maxResults) {
      let offset = maxResults;
      while (offset < childResult.total) {
        const page = await jiraClient.searchIssues(
          jql,
          [
            "summary",
            "description",
            "issuetype",
            "status",
            "priority",
            "assignee",
            "subtasks",
            "customfield_10016",
          ],
          offset,
          maxResults,
        );
        allChildIssues.push(...page.issues);
        offset += maxResults;
      }
    }

    // 3. Map children with descriptions and subtasks.
    const children: EpicOverviewChild[] = allChildIssues.map((issue) => {
      const mapped = mapIssue(issue);
      let description = mapped.description;
      if (
        description &&
        maxDescriptionLength > 0 &&
        description.length > maxDescriptionLength
      ) {
        description = description.substring(0, maxDescriptionLength) + "...";
      }

      const subtasks: EpicOverviewSubtask[] = (
        issue.fields?.subtasks ?? []
      ).map((st: JiraIssueRef) => ({
        key: st.key,
        summary: st.fields?.summary ?? "",
        status: st.fields?.status?.name ?? "",
      }));

      return {
        key: mapped.key,
        summary: mapped.summary,
        description,
        issueType: mapped.issueType,
        status: mapped.status,
        statusCategory: mapped.statusCategory,
        priority: mapped.priority,
        assignee: mapped.assignee,
        storyPoints: mapped.storyPoints,
        subtasks,
      };
    });

    const result = {
      epic: {
        key: epicMapped.key,
        summary: epicMapped.summary,
        description: epicMapped.description,
        status: epicMapped.status,
        statusCategory: epicMapped.statusCategory,
        priority: epicMapped.priority,
        assignee: epicMapped.assignee,
      },
      children,
      total: childResult.total,
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get epic overview: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register epic and hierarchy tools with the MCP server.
 *
 * @param registry     - The McpServer instance to register tools on.
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager for response caching.
 * @param projectKeys  - Allowed project keys (empty = allow all).
 */
export function registerEpicTools(
  registry: ToolRegistry,
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
): void {
  registry.registerTool({
    name: "list_epics",
    description:
      "List all epics in a project with their status, progress, and child story counts.",
    inputSchema: {
      projectKey: z.string().min(1).describe('Jira project key (e.g. "PROJ")'),
      status: z
        .array(z.string())
        .optional()
        .describe('Filter by status names (e.g. ["To Do", "In Progress"])'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (default 50)"),
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination start index (default 0)"),
    },
    handler: async (params) =>
      handleListEpics(
        jiraClient,
        cacheManager,
        projectKeys,
        params as {
          projectKey: string;
          status?: string[];
          maxResults?: number;
          startAt?: number;
        },
      ),
  });

  registry.registerTool({
    name: "get_epic_children",
    description:
      "Get all child issues (stories, tasks, bugs) of a specific epic with their statuses and subtask summaries.",
    inputSchema: {
      epicKey: z.string().min(1).describe('Epic issue key (e.g. "PROJ-42")'),
      status: z
        .array(z.string())
        .optional()
        .describe("Filter children by status names"),
      issueType: z
        .array(z.string())
        .optional()
        .describe('Filter children by issue type (e.g. ["Story", "Bug"])'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (default 50)"),
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination start index (default 0)"),
    },
    handler: async (params) =>
      handleGetEpicChildren(
        jiraClient,
        cacheManager,
        projectKeys,
        params as {
          epicKey: string;
          status?: string[];
          issueType?: string[];
          maxResults?: number;
          startAt?: number;
        },
      ),
  });

  registry.registerTool({
    name: "get_epic_overview",
    description:
      "Get a complete epic overview with all children (stories, tasks, bugs) including their descriptions and subtasks in a single call. Much more efficient than fetching each issue individually.",
    inputSchema: {
      epicKey: z.string().min(1).describe('Epic issue key (e.g. "PROJ-42")'),
      maxDescriptionLength: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Max characters for descriptions (0 = full, default 500)"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max children per page (default 50)"),
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination start index (default 0)"),
    },
    handler: async (params) =>
      handleGetEpicOverview(
        jiraClient,
        cacheManager,
        projectKeys,
        params as {
          epicKey: string;
          maxDescriptionLength?: number;
          maxResults?: number;
          startAt?: number;
        },
      ),
  });
}
