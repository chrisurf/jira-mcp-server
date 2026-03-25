/**
 * MCP tool handlers for Jira issue operations.
 *
 * Provides get_issue, get_issue_subtasks, and search_issues tools.
 * Each handler follows the pattern: validate -> cache check -> API call ->
 * transform -> cache store -> return MCP response.
 */

import { z } from "zod";
import type { JiraClient } from "../jira/client.js";
import { JiraApiError } from "../jira/client.js";
import type { CacheManager } from "../cache/manager.js";
import type { ToolRegistry } from "./registry.js";
import { mapIssue } from "../transformers/issue-mapper.js";
import type { MappedIssue } from "../transformers/issue-mapper.js";
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

/** Input parameters for the get_issue tool. */
export interface GetIssueInput {
  /** Issue key in PROJECT-123 format. */
  issueKey: string;
  /** Optional list of fields to include in the response. */
  fields?: string[];
}

/** Input parameters for the get_issue_subtasks tool. */
export interface GetIssueSubtasksInput {
  /** Issue key in PROJECT-123 format. */
  issueKey: string;
}

/** Input parameters for the search_issues tool. */
export interface SearchIssuesInput {
  /** JQL query string. */
  jql: string;
  /** Optional list of fields to include per issue. */
  fields?: string[];
  /** Maximum number of results (default 50, max 100). */
  maxResults?: number;
  /** Pagination offset (default 0). */
  startAt?: number;
}

// ---------------------------------------------------------------------------
// Regex for issue key validation
// ---------------------------------------------------------------------------

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

// ---------------------------------------------------------------------------
// get_issue
// ---------------------------------------------------------------------------

/**
 * Get full details for a specific Jira issue including description, status,
 * assignee, linked issues, and more.
 *
 * @param input        - Tool input parameters.
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager instance.
 * @param projectKeys  - Configured project allowlist.
 */
export async function handleGetIssue(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  input: GetIssueInput,
): Promise<ToolResult | ToolErrorResult> {
  const { issueKey, fields } = input;

  // Validate issue key format.
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    return errorResult(
      `Invalid issue key format: "${issueKey}". Expected format: PROJECT-123 (uppercase letters followed by a dash and number).`,
    );
  }

  // Check project allowlist.
  const projectKey = issueKey.split("-")[0];
  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_issue", {
    issueKey,
    fields: fields ?? [],
  });
  const cached = cacheManager.get<MappedIssue>(cacheKey);
  if (cached) {
    return textResult({
      ...cached.data,
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  // Call Jira API.
  try {
    const jiraIssue = await jiraClient.getIssue(issueKey, fields);
    const mapped = mapIssue(jiraIssue);

    // If specific fields were requested, filter the mapped result.
    const result =
      fields && fields.length > 0 ? filterFields(mapped, fields) : mapped;

    // Store in cache.
    cacheManager.set(cacheKey, fields && fields.length > 0 ? result : mapped);

    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError && error.statusCode === 404) {
      return errorResult(`Issue ${issueKey} not found.`);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get issue: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// get_issue_subtasks
// ---------------------------------------------------------------------------

/**
 * Get all subtasks for a given issue.
 *
 * If the issue is itself a subtask, returns its info with an empty subtasks
 * array and the parentKey populated.
 *
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager instance.
 * @param projectKeys  - Configured project allowlist.
 * @param input        - Tool input parameters.
 */
export async function handleGetIssueSubtasks(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  input: GetIssueSubtasksInput,
): Promise<ToolResult | ToolErrorResult> {
  const { issueKey } = input;

  // Validate issue key format.
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    return errorResult(
      `Invalid issue key format: "${issueKey}". Expected format: PROJECT-123 (uppercase letters followed by a dash and number).`,
    );
  }

  // Check project allowlist.
  const projectKey = issueKey.split("-")[0];
  if (!projectAllowed(projectKey, projectKeys)) {
    return errorResult(
      `Project "${projectKey}" is not in the allowed project list.`,
    );
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("get_issue_subtasks", { issueKey });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  // Call Jira API — request only the fields we need.
  try {
    const jiraIssue = await jiraClient.getIssue(issueKey, [
      "summary",
      "status",
      "issuetype",
      "subtasks",
      "parent",
      "assignee",
      "priority",
      "created",
      "updated",
    ]);

    const f = jiraIssue.fields;
    const isSubtask =
      f.issuetype?.name?.toLowerCase() === "sub-task" ||
      f.issuetype?.name?.toLowerCase() === "subtask" ||
      (f.parent != null && (f.subtasks ?? []).length === 0);

    const subtasks = (f.subtasks ?? []).map((sub) => ({
      key: sub.key,
      summary: sub.fields?.summary ?? "",
      status: sub.fields?.status?.name ?? "",
    }));

    const result = {
      key: jiraIssue.key,
      summary: f.summary ?? "",
      status: f.status?.name ?? "",
      parentKey: f.parent?.key ?? null,
      subtasks: isSubtask ? [] : subtasks,
    };

    // Store in cache.
    cacheManager.set(cacheKey, result);

    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError && error.statusCode === 404) {
      return errorResult(`Issue ${issueKey} not found.`);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get subtasks: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// search_issues
// ---------------------------------------------------------------------------

/**
 * Search Jira issues using JQL (Jira Query Language). Supports pagination
 * and field selection.
 *
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager instance.
 * @param projectKeys  - Configured project allowlist.
 * @param input        - Tool input parameters.
 */
export async function handleSearchIssues(
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
  input: SearchIssuesInput,
): Promise<ToolResult | ToolErrorResult> {
  const { fields } = input;
  let jql = input.jql;
  const startAt = input.startAt ?? 0;
  const maxResults = Math.min(input.maxResults ?? 50, 100);

  // Validate JQL is not empty.
  if (!jql || jql.trim().length === 0) {
    return errorResult("JQL query cannot be empty.");
  }

  // If project allowlist is active and JQL does not already contain a project clause,
  // automatically append a project filter.
  if (projectKeys.length > 0 && !jqlContainsProject(jql)) {
    const projectList = projectKeys.map((k) => `"${k}"`).join(", ");
    jql = `${jql} AND project IN (${projectList})`;
  }

  // Check cache.
  const cacheKey = cacheManager.generateKey("search_issues", {
    jql,
    fields: fields ?? [],
    startAt,
    maxResults,
  });
  const cached = cacheManager.get<unknown>(cacheKey);
  if (cached) {
    return textResult({
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: cached.cachedAt,
    });
  }

  // Call Jira API.
  try {
    const searchResult = await jiraClient.searchIssues(
      jql,
      fields,
      startAt,
      maxResults,
    );
    const issues = searchResult.issues.map(mapIssue);

    const result = {
      total: searchResult.total,
      startAt: searchResult.startAt,
      maxResults: searchResult.maxResults,
      issues,
    };

    // Store in cache.
    cacheManager.set(cacheKey, result);

    return textResult(result);
  } catch (error: unknown) {
    if (error instanceof JiraApiError) {
      // Pass through JQL syntax errors as structured errors.
      return errorResult(error.message);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to search issues: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register issue-level tools with the MCP server.
 *
 * @param registry     - The McpServer instance to register tools on.
 * @param jiraClient   - Authenticated Jira API client.
 * @param cacheManager - Cache manager for response caching.
 * @param projectKeys  - Allowed project keys (empty = allow all).
 */
export function registerIssueTools(
  registry: ToolRegistry,
  jiraClient: JiraClient,
  cacheManager: CacheManager,
  projectKeys: string[],
): void {
  registry.registerTool({
    name: "get_issue",
    description:
      "Get full details for a specific Jira issue including description, status, assignee, linked issues, and more.",
    inputSchema: {
      issueKey: z
        .string()
        .min(1)
        .describe('Issue key in PROJECT-123 format (e.g. "PROJ-42")'),
      fields: z
        .array(z.string())
        .optional()
        .describe("Optional list of fields to include in the response"),
    },
    handler: async (params) =>
      handleGetIssue(
        jiraClient,
        cacheManager,
        projectKeys,
        params as unknown as GetIssueInput,
      ),
  });

  registry.registerTool({
    name: "get_issue_subtasks",
    description: "Get all subtasks for a given issue.",
    inputSchema: {
      issueKey: z
        .string()
        .min(1)
        .describe('Issue key in PROJECT-123 format (e.g. "PROJ-42")'),
    },
    handler: async (params) =>
      handleGetIssueSubtasks(
        jiraClient,
        cacheManager,
        projectKeys,
        params as unknown as GetIssueSubtasksInput,
      ),
  });

  registry.registerTool({
    name: "search_issues",
    description:
      "Search Jira issues using JQL (Jira Query Language). Supports pagination and field selection.",
    inputSchema: {
      jql: z.string().min(1).describe("JQL query string"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Optional list of fields to include per issue"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of results (default 50, max 100)"),
      startAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset (default 0)"),
    },
    handler: async (params) =>
      handleSearchIssues(
        jiraClient,
        cacheManager,
        projectKeys,
        params as unknown as SearchIssuesInput,
      ),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a JQL string already contains a "project" field clause.
 *
 * Strips quoted strings first to avoid false positives from values like
 * `assignee = "project manager"` being mistaken for a project filter.
 */
function jqlContainsProject(jql: string): boolean {
  // Remove single- and double-quoted string literals to avoid matching
  // the word "project" inside user-provided values.
  const withoutStrings = jql.replace(/"[^"]*"|'[^']*'/g, '""');
  // Match "project" as a JQL field name followed by an operator.
  return /\bproject\s*(=|!=|in\b|not\s+in\b|is\b)/i.test(withoutStrings);
}

/**
 * Filter a mapped issue to only the requested fields (plus key, which is always included).
 * Unknown field names are silently ignored.
 */
function filterFields(
  mapped: MappedIssue,
  fields: string[],
): Partial<MappedIssue> & { key: string } {
  const result: Record<string, unknown> = { key: mapped.key };
  const mappedRecord = mapped as unknown as Record<string, unknown>;

  for (const field of fields) {
    if (field in mappedRecord && field !== "key") {
      result[field] = mappedRecord[field];
    }
  }

  return result as Partial<MappedIssue> & { key: string };
}
