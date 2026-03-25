/**
 * MCP tool handler for Jira sprint operations.
 *
 * Provides the get_active_sprint tool that retrieves the current active
 * sprint's issues grouped by status category with aggregate statistics.
 */

import { z } from "zod";
import type { JiraClient } from "../jira/client.js";
import { JiraApiError } from "../jira/client.js";
import type { JiraIssue } from "../jira/types.js";
import type { CacheManager } from "../cache/manager.js";
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
// Input types
// ---------------------------------------------------------------------------

/** Input parameters for the get_active_sprint tool. */
export interface GetActiveSprintInput {
  /** Project key (e.g. "PROJ") or numeric board ID. */
  projectKeyOrBoardId: string;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** A single issue in the sprint response. */
interface SprintIssueItem {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  assignee: string | null;
  storyPoints: number | null;
  subtaskCount: number;
}

// ---------------------------------------------------------------------------
// get_active_sprint
// ---------------------------------------------------------------------------

/**
 * Get the current active sprint's issues grouped by status category
 * (To Do, In Progress, Done) with aggregate statistics.
 *
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager instance.
 * @param projectKeys  - Configured project allowlist.
 * @param input        - Tool input parameters.
 */
export async function handleGetActiveSprint(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  input: GetActiveSprintInput,
): Promise<ToolResult | ToolErrorResult> {
  const { projectKeyOrBoardId } = input;
  const isNumeric = /^\d+$/.test(projectKeyOrBoardId);

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_active_sprint", {
    projectKeyOrBoardId,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  let boardId: number;
  let boardName: string;

  if (isNumeric) {
    // Input is a board ID — use directly.
    boardId = parseInt(projectKeyOrBoardId, 10);
    boardName = `Board ${boardId}`;
  } else {
    // Input is a project key — find a Scrum board.
    const projectKey = projectKeyOrBoardId.toUpperCase();

    if (!projectAllowed(projectKey, projectKeys)) {
      return errorResult(
        `Project "${projectKey}" is not in the allowed project list.`,
      );
    }

    try {
      const boardsResponse = await jiraClient.getBoards(projectKey);
      const boards = boardsResponse.values ?? [];

      if (boards.length === 0) {
        return errorResult(
          `No Scrum board found for project ${projectKey}. This tool requires a Scrum-managed project.`,
        );
      }

      // Check for Scrum boards first.
      const scrumBoards = boards.filter((b) => b.type === "scrum");
      if (scrumBoards.length === 0) {
        const kanbanBoard = boards.find((b) => b.type === "kanban");
        if (kanbanBoard) {
          return errorResult(
            `Board "${kanbanBoard.name}" is a Kanban board and does not use sprints. Use search_issues with JQL for Kanban workflows.`,
          );
        }
        return errorResult(
          `No Scrum board found for project ${projectKey}. This tool requires a Scrum-managed project.`,
        );
      }

      boardId = scrumBoards[0].id;
      boardName = scrumBoards[0].name;
    } catch (error: unknown) {
      if (error instanceof JiraApiError) {
        return errorResult(error.message);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return errorResult(`Failed to resolve board: ${message}`);
    }
  }

  // Get active sprint.
  let sprintData;
  try {
    const sprintsResponse = await jiraClient.getBoardSprints(boardId, "active");
    const sprints = sprintsResponse.values ?? [];

    if (sprints.length === 0) {
      return errorResult(`No active sprint found on board "${boardName}".`);
    }

    sprintData = sprints[0];
  } catch (error: unknown) {
    if (error instanceof JiraApiError) {
      return errorResult(error.message);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get sprint data: ${message}`);
  }

  // Get ALL sprint issues with pagination.
  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const pageSize = 50;

  try {
    let hasMore = true;
    while (hasMore) {
      const issuesResponse = await jiraClient.getSprintIssues(
        sprintData.id,
        undefined,
        startAt,
        pageSize,
      );
      allIssues.push(...issuesResponse.issues);
      startAt += pageSize;
      hasMore = startAt < issuesResponse.total;
    }
  } catch (error: unknown) {
    if (error instanceof JiraApiError) {
      return errorResult(error.message);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get sprint issues: ${message}`);
  }

  // Group issues by status category.
  const toDo: SprintIssueItem[] = [];
  const inProgress: SprintIssueItem[] = [];
  const done: SprintIssueItem[] = [];

  let totalStoryPoints = 0;
  let completedStoryPoints = 0;

  for (const issue of allIssues) {
    const mapped = mapIssue(issue);
    const item: SprintIssueItem = {
      key: mapped.key,
      summary: mapped.summary,
      issueType: mapped.issueType,
      priority: mapped.priority,
      assignee: mapped.assignee,
      storyPoints: mapped.storyPoints,
      subtaskCount: mapped.subtaskCount,
    };

    if (mapped.storyPoints != null) {
      totalStoryPoints += mapped.storyPoints;
    }

    const categoryKey = issue.fields.status?.statusCategory?.key ?? "";

    switch (categoryKey) {
      case "done":
        done.push(item);
        if (mapped.storyPoints != null) {
          completedStoryPoints += mapped.storyPoints;
        }
        break;
      case "indeterminate":
        inProgress.push(item);
        break;
      case "new":
      default:
        toDo.push(item);
        break;
    }
  }

  const result = {
    sprint: {
      id: sprintData.id,
      name: sprintData.name,
      goal: sprintData.goal,
      startDate: sprintData.startDate,
      endDate: sprintData.endDate,
      state: sprintData.state,
    },
    boardId,
    boardName,
    toDo,
    inProgress,
    done,
    totalIssues: allIssues.length,
    totalStoryPoints,
    completedStoryPoints,
  };

  // Store in cache.
  cacheManager.set(cacheKey, result);

  return textResult(result);
}

// ---------------------------------------------------------------------------
// list_sprints
// ---------------------------------------------------------------------------

/**
 * List all sprints for a project's board, optionally filtered by state.
 */
export async function handleListSprints(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  input: {
    projectKeyOrBoardId: string;
    state?: string;
  },
): Promise<ToolResult | ToolErrorResult> {
  const { projectKeyOrBoardId, state } = input;
  const isNumeric = /^\d+$/.test(projectKeyOrBoardId);

  // Check cache.
  const cacheKey = cacheManager.generateKey("list_sprints", {
    projectKeyOrBoardId,
    state: state ?? "all",
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  let boardId: number;
  let boardName: string;

  if (isNumeric) {
    boardId = parseInt(projectKeyOrBoardId, 10);
    boardName = `Board ${boardId}`;
  } else {
    const projectKey = projectKeyOrBoardId.toUpperCase();

    if (!projectAllowed(projectKey, projectKeys)) {
      return errorResult(
        `Project "${projectKey}" is not in the allowed project list.`,
      );
    }

    try {
      const boardsResponse = await jiraClient.getBoards(projectKey);
      const boards = boardsResponse.values ?? [];
      const scrumBoards = boards.filter((b) => b.type === "scrum");

      if (scrumBoards.length === 0) {
        return errorResult(
          `No Scrum board found for project ${projectKey}. Sprints require a Scrum board.`,
        );
      }

      boardId = scrumBoards[0].id;
      boardName = scrumBoards[0].name;
    } catch (error: unknown) {
      if (error instanceof JiraApiError) {
        return errorResult(error.message);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return errorResult(`Failed to resolve board: ${message}`);
    }
  }

  try {
    const sprintsResponse = await jiraClient.getBoardSprints(boardId, state);
    const sprints = (sprintsResponse.values ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      goal: s.goal,
      startDate: s.startDate,
      endDate: s.endDate,
    }));

    const result = {
      boardId,
      boardName,
      sprints,
      total: sprints.length,
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError) {
      return errorResult(error.message);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list sprints: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register sprint-level tools with the MCP server.
 *
 * @param registry     - The McpServer instance to register tools on.
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager for response caching.
 * @param projectKeys  - Allowed project keys (empty = allow all).
 */
export function registerSprintTools(
  registry: ToolRegistry,
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
): void {
  registry.registerTool({
    name: "get_active_sprint",
    description:
      "Get the current active sprint's issues grouped by status category (To Do, In Progress, Done) with aggregate statistics.",
    inputSchema: {
      projectKeyOrBoardId: z
        .string()
        .min(1)
        .describe('Project key (e.g. "PROJ") or numeric board ID'),
    },
    handler: async (params) =>
      handleGetActiveSprint(
        jiraClient,
        cacheManager,
        projectKeys,
        params as unknown as GetActiveSprintInput,
      ),
  });

  registry.registerTool({
    name: "list_sprints",
    description:
      "List all sprints for a project board. Supports filtering by state (future, active, closed). Returns all sprints by default.",
    inputSchema: {
      projectKeyOrBoardId: z
        .string()
        .min(1)
        .describe('Project key (e.g. "PROJ") or numeric board ID'),
      state: z
        .string()
        .optional()
        .describe(
          'Filter by sprint state: "future", "active", "closed", or omit for all',
        ),
    },
    handler: async (params) =>
      handleListSprints(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { projectKeyOrBoardId: string; state?: string },
      ),
  });
}
