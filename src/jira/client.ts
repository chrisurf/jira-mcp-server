/**
 * Jira Cloud REST API client.
 *
 * Provides typed, read-only access to the Jira Cloud REST API v3
 * and the Jira Agile REST API v1. Uses the built-in Node.js 20+ fetch API.
 *
 * Security: This client NEVER logs issue content, descriptions, or comments.
 */

import { createAuthHeader } from "./auth.js";
import type {
  JiraBoard,
  JiraChangelogResponse,
  JiraCommentResponse,
  JiraErrorResponse,
  JiraIssue,
  JiraPaginatedResponse,
  JiraProject,
  JiraSearchResult,
  JiraSprint,
  JiraTransitionsResponse,
  JiraWatchersResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Structured error thrown by the Jira client. */
export class JiraApiError extends Error {
  /** HTTP status code, if available. */
  readonly statusCode: number | undefined;
  /** Retry-After header value in seconds (only set on 429 responses). */
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    options?: { statusCode?: number; retryAfter?: number },
  ) {
    super(message);
    this.name = "JiraApiError";
    this.statusCode = options?.statusCode;
    this.retryAfter = options?.retryAfter;
  }
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/** Configuration required to instantiate a JiraClient. */
export interface JiraClientConfig {
  /** Base URL of the Jira Cloud instance (e.g. "https://myorg.atlassian.net"). */
  instanceUrl: string;
  /** Atlassian account email address. */
  email: string;
  /** Jira API token. */
  token: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Read-only client for the Jira Cloud REST API.
 *
 * All public methods return typed responses and throw {@link JiraApiError}
 * on failure. Credentials are never included in error messages.
 */
/** Default request timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum requests per sliding window. */
const MAX_REQUESTS_PER_WINDOW = 60;

/** Sliding window duration in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  /** Rate-limiting state: request timestamps within the current window. */
  private readonly requestTimestamps: number[] = [];

  constructor(config: JiraClientConfig) {
    // Strip trailing slash to simplify URL construction.
    this.baseUrl = config.instanceUrl.replace(/\/+$/, "");
    this.authHeader = createAuthHeader(config.email, config.token);
  }

  // -----------------------------------------------------------------------
  // Rate limiting
  // -----------------------------------------------------------------------

  /**
   * Enforces a client-side sliding-window rate limit.
   *
   * Throws a {@link JiraApiError} with status 429 when the limit is exceeded.
   * This prevents LLM tool-call loops from overwhelming the Jira API.
   */
  private enforceRateLimit(): void {
    const now = Date.now();
    // Remove timestamps outside the sliding window.
    while (
      this.requestTimestamps.length > 0 &&
      this.requestTimestamps[0] <= now - RATE_LIMIT_WINDOW_MS
    ) {
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
      throw new JiraApiError(
        `Client-side rate limit exceeded: ${MAX_REQUESTS_PER_WINDOW} requests per minute. Please wait before retrying.`,
        { statusCode: 429 },
      );
    }
    this.requestTimestamps.push(now);
  }

  // -----------------------------------------------------------------------
  // Internal request helper
  // -----------------------------------------------------------------------

  /**
   * Performs a GET request against the Jira API and returns the parsed JSON body.
   *
   * @param path   - API path relative to the instance URL (e.g. "/rest/api/3/myself").
   * @param params - Optional query parameters.
   * @returns Parsed JSON response body.
   * @throws {JiraApiError} On any non-2xx response or network error.
   */
  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    // Enforce client-side rate limit before making the request.
    this.enforceRateLimit();

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new JiraApiError(
          `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000} seconds: ${path}`,
        );
      }
      const message =
        error instanceof Error ? error.message : "Unknown network error";
      throw new JiraApiError(`Network error: ${message}`);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    // --- Error handling by status code ---

    if (response.status === 401) {
      throw new JiraApiError("Authentication failed – check your credentials", {
        statusCode: 401,
      });
    }

    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("Retry-After");
      const retryAfter = retryAfterRaw
        ? parseInt(retryAfterRaw, 10)
        : undefined;
      throw new JiraApiError("Rate limited by Jira API", {
        statusCode: 429,
        retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter,
      });
    }

    if (response.status === 404) {
      throw new JiraApiError("Resource not found", { statusCode: 404 });
    }

    // Try to extract Jira error messages from the response body.
    let detail = "";
    try {
      const body = (await response.json()) as JiraErrorResponse;
      const messages = [
        ...(body.errorMessages ?? []),
        ...Object.values(body.errors ?? {}),
      ].filter(Boolean);
      if (messages.length > 0) {
        detail = `: ${messages.join("; ")}`;
      }
    } catch {
      // Body was not valid JSON – ignore.
    }

    throw new JiraApiError(`Jira API error (${response.status})${detail}`, {
      statusCode: response.status,
    });
  }

  // -----------------------------------------------------------------------
  // Public methods – Core API
  // -----------------------------------------------------------------------

  /**
   * Validates that the configured credentials can reach the Jira instance.
   *
   * @returns `true` if the connection succeeds, `false` otherwise.
   */
  async validateConnection(): Promise<boolean> {
    try {
      await this.request("/rest/api/3/myself");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns a paginated list of projects visible to the authenticated user.
   *
   * @param startAt    - Index of the first result (default 0).
   * @param maxResults - Maximum number of results per page (default 50).
   */
  async getProjects(
    startAt: number = 0,
    maxResults: number = 50,
  ): Promise<JiraPaginatedResponse<JiraProject>> {
    return this.request<JiraPaginatedResponse<JiraProject>>(
      "/rest/api/3/project/search",
      {
        startAt: String(startAt),
        maxResults: String(maxResults),
      },
    );
  }

  /**
   * Searches for issues using JQL.
   *
   * @param jql        - Jira Query Language expression.
   * @param fields     - List of fields to include (default: all navigable fields).
   * @param startAt    - Index of the first result (default 0).
   * @param maxResults - Maximum number of results per page (default 50).
   */
  async searchIssues(
    jql: string,
    fields?: string[],
    startAt: number = 0,
    maxResults: number = 50,
  ): Promise<JiraSearchResult> {
    const params: Record<string, string> = {
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
    };

    if (fields && fields.length > 0) {
      params.fields = fields.join(",");
    }

    return this.request<JiraSearchResult>("/rest/api/3/search/jql", params);
  }

  /**
   * Retrieves a single issue by its key (e.g. "PROJ-42").
   *
   * @param issueKey - Issue key.
   * @param fields   - Optional list of fields to include.
   */
  async getIssue(issueKey: string, fields?: string[]): Promise<JiraIssue> {
    const params: Record<string, string> = {};
    if (fields && fields.length > 0) {
      params.fields = fields.join(",");
    }

    return this.request<JiraIssue>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  /**
   * Returns comments for an issue.
   *
   * @param issueKey   - Issue key (e.g. "PROJ-42").
   * @param startAt    - Index of the first result (default 0).
   * @param maxResults - Maximum number of results per page (default 50).
   */
  async getIssueComments(
    issueKey: string,
    startAt: number = 0,
    maxResults: number = 50,
  ): Promise<JiraCommentResponse> {
    return this.request<JiraCommentResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        startAt: String(startAt),
        maxResults: String(maxResults),
        orderBy: "-created",
      },
    );
  }

  /**
   * Returns available transitions for an issue.
   *
   * @param issueKey - Issue key (e.g. "PROJ-42").
   */
  async getIssueTransitions(
    issueKey: string,
  ): Promise<JiraTransitionsResponse> {
    return this.request<JiraTransitionsResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
  }

  /**
   * Returns the changelog for an issue.
   *
   * @param issueKey   - Issue key (e.g. "PROJ-42").
   * @param startAt    - Index of the first result (default 0).
   * @param maxResults - Maximum number of results per page (default 50).
   */
  async getIssueChangelog(
    issueKey: string,
    startAt: number = 0,
    maxResults: number = 50,
  ): Promise<JiraChangelogResponse> {
    return this.request<JiraChangelogResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog`,
      {
        startAt: String(startAt),
        maxResults: String(maxResults),
      },
    );
  }

  /**
   * Returns watchers for an issue.
   *
   * @param issueKey - Issue key (e.g. "PROJ-42").
   */
  async getIssueWatchers(issueKey: string): Promise<JiraWatchersResponse> {
    return this.request<JiraWatchersResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/watchers`,
    );
  }

  // -----------------------------------------------------------------------
  // Public methods – Agile API
  // -----------------------------------------------------------------------

  /**
   * Returns boards, optionally filtered by project.
   *
   * @param projectKeyOrId - Optional project key or ID to filter boards.
   */
  async getBoards(
    projectKeyOrId?: string,
  ): Promise<JiraPaginatedResponse<JiraBoard>> {
    const params: Record<string, string> = {};
    if (projectKeyOrId) {
      params.projectKeyOrId = projectKeyOrId;
    }

    return this.request<JiraPaginatedResponse<JiraBoard>>(
      "/rest/agile/1.0/board",
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  /**
   * Returns sprints for a given board.
   *
   * @param boardId - Board ID.
   * @param state   - Optional sprint state filter ("future", "active", "closed").
   */
  async getBoardSprints(
    boardId: number,
    state?: string,
  ): Promise<JiraPaginatedResponse<JiraSprint>> {
    const params: Record<string, string> = {};
    if (state) {
      params.state = state;
    }

    return this.request<JiraPaginatedResponse<JiraSprint>>(
      `/rest/agile/1.0/board/${boardId}/sprint`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  /**
   * Returns issues in a given sprint.
   *
   * @param sprintId   - Sprint ID.
   * @param fields     - Optional list of fields to include.
   * @param startAt    - Index of the first result (default 0).
   * @param maxResults - Maximum number of results per page (default 50).
   */
  async getSprintIssues(
    sprintId: number,
    fields?: string[],
    startAt: number = 0,
    maxResults: number = 50,
  ): Promise<JiraSearchResult> {
    const params: Record<string, string> = {
      startAt: String(startAt),
      maxResults: String(maxResults),
    };

    if (fields && fields.length > 0) {
      params.fields = fields.join(",");
    }

    return this.request<JiraSearchResult>(
      `/rest/agile/1.0/sprint/${sprintId}/issue`,
      params,
    );
  }
}
