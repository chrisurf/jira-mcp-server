import { describe, it, expect } from "vitest";
import { mapIssue } from "../../../src/transformers/issue-mapper.js";
import type { JiraIssue } from "../../../src/jira/types.js";

/** Create a minimal Jira issue for testing. */
function makeIssue(overrides: Partial<JiraIssue["fields"]> = {}): JiraIssue {
  return {
    id: "10001",
    key: "TEST-1",
    self: "https://test.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "Test issue",
      description: null,
      status: {
        name: "In Progress",
        statusCategory: { key: "indeterminate", name: "In Progress" },
      },
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      assignee: { displayName: "Alice" },
      reporter: { displayName: "Bob" },
      labels: ["backend"],
      components: [{ name: "API" }],
      fixVersions: [{ name: "v1.0" }],
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-15T00:00:00.000Z",
      duedate: "2026-02-01",
      parent: null,
      subtasks: [],
      issuelinks: [],
      comment: { total: 3 },
      customfield_10016: 5,
      ...overrides,
    },
  };
}

describe("mapIssue", () => {
  it("maps all standard fields correctly", () => {
    const result = mapIssue(makeIssue());

    expect(result.key).toBe("TEST-1");
    expect(result.summary).toBe("Test issue");
    expect(result.description).toBeNull();
    expect(result.status).toBe("In Progress");
    expect(result.statusCategory).toBe("In Progress");
    expect(result.issueType).toBe("Story");
    expect(result.priority).toBe("Medium");
    expect(result.assignee).toBe("Alice");
    expect(result.reporter).toBe("Bob");
    expect(result.labels).toEqual(["backend"]);
    expect(result.components).toEqual(["API"]);
    expect(result.fixVersions).toEqual(["v1.0"]);
    expect(result.storyPoints).toBe(5);
    expect(result.created).toBe("2026-01-01T00:00:00.000Z");
    expect(result.updated).toBe("2026-01-15T00:00:00.000Z");
    expect(result.dueDate).toBe("2026-02-01");
    expect(result.parentKey).toBeNull();
    expect(result.epicKey).toBeNull();
    expect(result.subtaskCount).toBe(0);
    expect(result.commentCount).toBe(3);
    expect(result.linkedIssues).toEqual([]);
  });

  it("handles null assignee and reporter", () => {
    const result = mapIssue(makeIssue({ assignee: null, reporter: null }));
    expect(result.assignee).toBeNull();
    expect(result.reporter).toBeNull();
  });

  it("handles missing story points", () => {
    const result = mapIssue(makeIssue({ customfield_10016: null }));
    expect(result.storyPoints).toBeNull();
  });

  it("extracts parent key", () => {
    const result = mapIssue(makeIssue({ parent: { key: "TEST-100" } }));
    expect(result.parentKey).toBe("TEST-100");
  });

  it("converts ADF description to plain text", () => {
    const adf = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    };
    const result = mapIssue(
      makeIssue({ description: adf as Record<string, unknown> }),
    );
    expect(result.description).toBe("Hello world");
  });

  it("counts subtasks", () => {
    const result = mapIssue(
      makeIssue({
        subtasks: [
          {
            key: "TEST-2",
            fields: { summary: "Sub 1", status: { name: "Done" } },
          },
          {
            key: "TEST-3",
            fields: { summary: "Sub 2", status: { name: "To Do" } },
          },
        ],
      }),
    );
    expect(result.subtaskCount).toBe(2);
  });

  it("maps outward linked issues", () => {
    const result = mapIssue(
      makeIssue({
        issuelinks: [
          {
            type: {
              name: "Blocks",
              inward: "is blocked by",
              outward: "blocks",
            },
            outwardIssue: {
              key: "TEST-50",
              fields: { summary: "Blocked issue", status: { name: "To Do" } },
            },
          },
        ],
      }),
    );
    expect(result.linkedIssues).toEqual([
      { key: "TEST-50", summary: "Blocked issue", linkType: "blocks" },
    ]);
  });

  it("maps inward linked issues", () => {
    const result = mapIssue(
      makeIssue({
        issuelinks: [
          {
            type: {
              name: "Blocks",
              inward: "is blocked by",
              outward: "blocks",
            },
            inwardIssue: {
              key: "TEST-51",
              fields: { summary: "Blocking issue", status: { name: "Done" } },
            },
          },
        ],
      }),
    );
    expect(result.linkedIssues).toEqual([
      { key: "TEST-51", summary: "Blocking issue", linkType: "is blocked by" },
    ]);
  });

  it("resolves epic key from customfield_10014", () => {
    const issue = makeIssue();
    // Add customfield_10014 (epic link) to the fields
    (issue.fields as Record<string, unknown>)["customfield_10014"] = "EPIC-1";
    const result = mapIssue(issue);
    expect(result.epicKey).toBe("EPIC-1");
  });

  it("handles empty components and fixVersions", () => {
    const result = mapIssue(makeIssue({ components: [], fixVersions: [] }));
    expect(result.components).toEqual([]);
    expect(result.fixVersions).toEqual([]);
  });
});
