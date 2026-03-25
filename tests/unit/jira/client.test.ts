import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JiraClient, JiraApiError } from "../../../src/jira/client.js";

// Test fixtures
import issueFixture from "../../fixtures/jira-responses/issue.json";
import searchFixture from "../../fixtures/jira-responses/search.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
  instanceUrl: "https://myorg.atlassian.net",
  email: "test@example.com",
  token: "test-api-token",
};

/** Creates a mock Response object. */
function mockResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers),
    json: () => Promise.resolve(body),
  } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JiraClient", () => {
  let client: JiraClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new JiraClient(TEST_CONFIG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // validateConnection
  // -----------------------------------------------------------------------

  describe("validateConnection", () => {
    it("returns true when /myself responds with 200", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ accountId: "123", displayName: "Test User" }),
      );

      const result = await client.validateConnection();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("/rest/api/3/myself");
    });

    it("returns false when /myself responds with 401", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { errorMessages: ["Unauthorized"], errors: {} },
          { status: 401 },
        ),
      );

      const result = await client.validateConnection();

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // searchIssues
  // -----------------------------------------------------------------------

  describe("searchIssues", () => {
    it("constructs the correct URL with JQL encoding", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(searchFixture));

      const jql = 'project = DPSPPT AND status = "In Progress"';
      await client.searchIssues(jql, ["summary", "status"], 0, 25);

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/rest/api/3/search/jql");
      expect(url.searchParams.get("jql")).toBe(jql);
      expect(url.searchParams.get("fields")).toBe("summary,status");
      expect(url.searchParams.get("startAt")).toBe("0");
      expect(url.searchParams.get("maxResults")).toBe("25");
    });

    it("returns parsed search results", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(searchFixture));

      const result = await client.searchIssues("project = DPSPPT");

      expect(result.total).toBe(2);
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].key).toBe("DPSPPT-1549");
    });
  });

  // -----------------------------------------------------------------------
  // getIssue
  // -----------------------------------------------------------------------

  describe("getIssue", () => {
    it("returns a parsed issue", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(issueFixture));

      const issue = await client.getIssue("DPSPPT-1549");

      expect(issue.key).toBe("DPSPPT-1549");
      expect(issue.fields.summary).toBe(
        "Evaluate IAM Identity Center Permission Set options",
      );
      expect(issue.fields.customfield_10016).toBe(5);

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/rest/api/3/issue/DPSPPT-1549");
    });

    it("passes optional fields parameter", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(issueFixture));

      await client.getIssue("DPSPPT-1549", ["summary", "status"]);

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.get("fields")).toBe("summary,status");
    });
  });

  // -----------------------------------------------------------------------
  // getProjects
  // -----------------------------------------------------------------------

  describe("getProjects", () => {
    it("calls the project search endpoint with pagination", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ values: [{ key: "PROJ", name: "Project" }], total: 1 }),
      );

      const result = await client.getProjects(0, 10);
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/rest/api/3/project/search");
      expect(url.searchParams.get("startAt")).toBe("0");
      expect(url.searchParams.get("maxResults")).toBe("10");
      expect(result.values).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // getBoards
  // -----------------------------------------------------------------------

  describe("getBoards", () => {
    it("calls the board endpoint with project filter", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          values: [{ id: 1, name: "Board", type: "scrum" }],
          total: 1,
        }),
      );

      await client.getBoards("PROJ");
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/rest/agile/1.0/board");
      expect(url.searchParams.get("projectKeyOrId")).toBe("PROJ");
    });

    it("calls without project filter when not provided", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ values: [], total: 0 }));

      await client.getBoards();
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.has("projectKeyOrId")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getBoardSprints
  // -----------------------------------------------------------------------

  describe("getBoardSprints", () => {
    it("calls the sprint endpoint with state filter", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          values: [{ id: 10, name: "Sprint 1", state: "active" }],
          total: 1,
        }),
      );

      await client.getBoardSprints(1, "active");
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/rest/agile/1.0/board/1/sprint");
      expect(url.searchParams.get("state")).toBe("active");
    });
  });

  // -----------------------------------------------------------------------
  // getSprintIssues
  // -----------------------------------------------------------------------

  describe("getSprintIssues", () => {
    it("calls the sprint issues endpoint with pagination", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(searchFixture));

      await client.getSprintIssues(10, ["summary"], 0, 25);
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/rest/agile/1.0/sprint/10/issue");
      expect(url.searchParams.get("fields")).toBe("summary");
      expect(url.searchParams.get("startAt")).toBe("0");
      expect(url.searchParams.get("maxResults")).toBe("25");
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("throws JiraApiError with retryAfter on 429", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { errorMessages: ["Rate limit exceeded"], errors: {} },
          { status: 429, headers: { "Retry-After": "30" } },
        ),
      );

      await expect(client.searchIssues("project = DPSPPT")).rejects.toThrow(
        JiraApiError,
      );

      try {
        await client.searchIssues("project = DPSPPT");
      } catch {
        // Re-mock for the second call
      }

      // Verify error properties via a fresh call
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { errorMessages: ["Rate limit exceeded"], errors: {} },
          { status: 429, headers: { "Retry-After": "30" } },
        ),
      );

      try {
        await client.searchIssues("project = DPSPPT");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JiraApiError);
        const apiError = error as JiraApiError;
        expect(apiError.statusCode).toBe(429);
        expect(apiError.retryAfter).toBe(30);
        expect(apiError.message).toContain("Rate limited");
      }
    });

    it("throws JiraApiError on 401 without leaking credentials", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { errorMessages: ["Unauthorized"], errors: {} },
          { status: 401 },
        ),
      );

      try {
        await client.searchIssues("project = DPSPPT");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JiraApiError);
        const apiError = error as JiraApiError;
        expect(apiError.statusCode).toBe(401);
        expect(apiError.message).not.toContain(TEST_CONFIG.token);
        expect(apiError.message).not.toContain(TEST_CONFIG.email);
        expect(apiError.message).toContain("Authentication failed");
      }
    });

    it('throws "not found" on 404', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { errorMessages: ["Issue does not exist"], errors: {} },
          { status: 404 },
        ),
      );

      try {
        await client.getIssue("NONEXISTENT-999");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JiraApiError);
        const apiError = error as JiraApiError;
        expect(apiError.statusCode).toBe(404);
        expect(apiError.message).toContain("not found");
      }
    });

    it("handles network errors gracefully", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      try {
        await client.validateConnection();
      } catch {
        // validateConnection swallows errors and returns false
      }

      // Verify that a direct request throws a proper JiraApiError
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      try {
        await client.searchIssues("project = TEST");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JiraApiError);
        expect((error as JiraApiError).message).toContain("Network error");
      }
    });

    it("includes Jira error messages in error for other status codes", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            errorMessages: ['Field "foo" is not valid'],
            errors: { bar: "required" },
          },
          { status: 400 },
        ),
      );

      try {
        await client.searchIssues("invalid jql !!!");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JiraApiError);
        const apiError = error as JiraApiError;
        expect(apiError.statusCode).toBe(400);
        expect(apiError.message).toContain('Field "foo" is not valid');
        expect(apiError.message).toContain("required");
      }
    });
  });
});
