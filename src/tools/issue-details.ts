/**
 * MCP tools for detailed Jira issue read operations.
 *
 * Provides read-only access to:
 * - `get_issue_comments`    — Paginated comments with ADF→text conversion
 * - `get_issue_transitions`  — Available status transitions
 * - `get_issue_changelog`    — Issue change history
 * - `get_issue_watchers`     — Issue watcher list
 */

import { z } from "zod";
import type { JiraClient } from "../jira/client.js";
import { JiraApiError } from "../jira/client.js";
import type { CacheManager } from "../cache/manager.js";
import type { ToolRegistry } from "./registry.js";
import { adfToText } from "../transformers/adf-to-text.js";
import type { AdfNode } from "../transformers/adf-to-text.js";
import {
  projectAllowed,
  textResult,
  errorResult,
  type ToolResult,
  type ToolErrorResult,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

function validateIssueKey(
  issueKey: string,
  projectKeys: string[],
): ToolErrorResult | null {
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    return errorResult(
      `Invalid issue key format: "${issueKey}". Expected format: PROJECT-123.`,
    );
  }
  const projectKey = issueKey.split("-")[0];
  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler: get_issue_comments
// ---------------------------------------------------------------------------

/**
 * Get comments for a Jira issue with ADF-to-text conversion.
 */
export async function handleGetIssueComments(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: {
    issueKey: string;
    maxResults?: number;
    startAt?: number;
  },
): Promise<ToolResult | ToolErrorResult> {
  const { issueKey, maxResults = 20, startAt = 0 } = params;

  const validationError = validateIssueKey(issueKey, projectKeys);
  if (validationError) return validationError;

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_issue_comments", {
    issueKey,
    maxResults,
    startAt,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  try {
    const response = await jiraClient.getIssueComments(
      issueKey,
      startAt,
      maxResults,
    );

    const comments = response.comments.map((comment) => ({
      id: comment.id,
      author: comment.author?.displayName ?? "Unknown",
      body: comment.body ? adfToText(comment.body as unknown as AdfNode) : "",
      created: comment.created,
      updated: comment.updated,
    }));

    const result = {
      issueKey,
      total: response.total,
      startAt: response.startAt,
      maxResults: response.maxResults,
      comments,
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError && error.statusCode === 404) {
      return errorResult(`Issue ${issueKey} not found.`);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get comments: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler: get_issue_transitions
// ---------------------------------------------------------------------------

/**
 * Get available status transitions for a Jira issue.
 */
export async function handleGetIssueTransitions(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: { issueKey: string },
): Promise<ToolResult | ToolErrorResult> {
  const { issueKey } = params;

  const validationError = validateIssueKey(issueKey, projectKeys);
  if (validationError) return validationError;

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_issue_transitions", {
    issueKey,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  try {
    const response = await jiraClient.getIssueTransitions(issueKey);

    const transitions = response.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to?.name ?? "",
      toStatusCategory: t.to?.statusCategory?.name ?? "",
    }));

    const result = {
      issueKey,
      transitions,
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError && error.statusCode === 404) {
      return errorResult(`Issue ${issueKey} not found.`);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get transitions: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler: get_issue_changelog
// ---------------------------------------------------------------------------

/**
 * Get the change history for a Jira issue.
 */
export async function handleGetIssueChangelog(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: {
    issueKey: string;
    maxResults?: number;
    startAt?: number;
  },
): Promise<ToolResult | ToolErrorResult> {
  const { issueKey, maxResults = 20, startAt = 0 } = params;

  const validationError = validateIssueKey(issueKey, projectKeys);
  if (validationError) return validationError;

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_issue_changelog", {
    issueKey,
    maxResults,
    startAt,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  try {
    const response = await jiraClient.getIssueChangelog(
      issueKey,
      startAt,
      maxResults,
    );

    const entries = response.values.map((entry) => ({
      id: entry.id,
      author: entry.author?.displayName ?? "Unknown",
      created: entry.created,
      changes: entry.items.map((item) => ({
        field: item.field,
        from: item.fromString,
        to: item.toString,
      })),
    }));

    const result = {
      issueKey,
      total: response.total,
      startAt: response.startAt,
      maxResults: response.maxResults,
      entries,
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError && error.statusCode === 404) {
      return errorResult(`Issue ${issueKey} not found.`);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get changelog: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Handler: get_issue_watchers
// ---------------------------------------------------------------------------

/**
 * Get watchers for a Jira issue.
 */
export async function handleGetIssueWatchers(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  params: { issueKey: string },
): Promise<ToolResult | ToolErrorResult> {
  const { issueKey } = params;

  const validationError = validateIssueKey(issueKey, projectKeys);
  if (validationError) return validationError;

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_issue_watchers", { issueKey });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  try {
    const response = await jiraClient.getIssueWatchers(issueKey);

    const result = {
      issueKey,
      watchCount: response.watchCount,
      isWatching: response.isWatching,
      watchers: (response.watchers ?? []).map((w) => ({
        accountId: w.accountId,
        displayName: w.displayName,
      })),
    };

    cacheManager.set(cacheKey, result);
    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError && error.statusCode === 404) {
      return errorResult(`Issue ${issueKey} not found.`);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get watchers: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register issue detail tools with the MCP server.
 */
export function registerIssueDetailTools(
  registry: ToolRegistry,
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
): void {
  registry.registerTool({
    name: "get_issue_comments",
    description:
      "Get comments for a Jira issue with full text content. Supports pagination.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Issue key in PROJECT-123 format"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max comments to return (default 20)"),
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination start index (default 0)"),
    },
    handler: async (params) =>
      handleGetIssueComments(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { issueKey: string; maxResults?: number; startAt?: number },
      ),
  });

  registry.registerTool({
    name: "get_issue_transitions",
    description:
      "Get available status transitions for a Jira issue. Shows which status changes are currently possible.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Issue key in PROJECT-123 format"),
    },
    handler: async (params) =>
      handleGetIssueTransitions(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { issueKey: string },
      ),
  });

  registry.registerTool({
    name: "get_issue_changelog",
    description:
      "Get the change history for a Jira issue. Shows who changed what and when. Supports pagination.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Issue key in PROJECT-123 format"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max changelog entries to return (default 20)"),
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination start index (default 0)"),
    },
    handler: async (params) =>
      handleGetIssueChangelog(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { issueKey: string; maxResults?: number; startAt?: number },
      ),
  });

  registry.registerTool({
    name: "get_issue_watchers",
    description: "Get the list of watchers for a Jira issue.",
    inputSchema: {
      issueKey: z.string().min(1).describe("Issue key in PROJECT-123 format"),
    },
    handler: async (params) =>
      handleGetIssueWatchers(
        jiraClient,
        cacheManager,
        projectKeys,
        params as { issueKey: string },
      ),
  });
}
