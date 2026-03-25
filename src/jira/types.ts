/**
 * Jira REST API response type definitions.
 *
 * These interfaces model the JSON responses from the Jira Cloud REST API v3
 * and the Jira Agile REST API v1. Only fields relevant to read-only operations
 * are included.
 */

// ---------------------------------------------------------------------------
// Jira Core API types
// ---------------------------------------------------------------------------

/** Jira project as returned by /rest/api/3/project/search. */
export interface JiraProject {
  /** Unique project ID. */
  id: string;
  /** Short project key (e.g. "DPSPPT"). */
  key: string;
  /** Human-readable project name. */
  name: string;
  /** Project type key (e.g. "software", "business"). */
  projectTypeKey: string;
  /** Project lead information. */
  lead: {
    displayName: string;
  };
  /** Optional project description. */
  description: string;
}

/** Status category embedded in issue status. */
export interface JiraStatusCategory {
  /** Category name (e.g. "To Do", "In Progress", "Done"). */
  name: string;
  /** Machine-readable key (e.g. "new", "indeterminate", "done"). */
  key: string;
}

/** Issue status with its category. */
export interface JiraStatus {
  /** Display name of the status. */
  name: string;
  /** Status category grouping. */
  statusCategory: JiraStatusCategory;
}

/** Compact issue reference used in subtasks, links, and parent fields. */
export interface JiraIssueRef {
  /** Issue key (e.g. "PROJ-123"). */
  key: string;
  /** Subset of fields included in the reference. */
  fields: {
    summary: string;
    status: {
      name: string;
    };
  };
}

/** Issue link type descriptor. */
export interface JiraIssueLinkType {
  /** Link type name (e.g. "Blocks"). */
  name: string;
  /** Inward relationship label (e.g. "is blocked by"). */
  inward: string;
  /** Outward relationship label (e.g. "blocks"). */
  outward: string;
}

/** A single issue link. */
export interface JiraIssueLink {
  /** Describes the link relationship. */
  type: JiraIssueLinkType;
  /** The inward-related issue, if this link points inward. */
  inwardIssue?: JiraIssueRef;
  /** The outward-related issue, if this link points outward. */
  outwardIssue?: JiraIssueRef;
}

/** All issue fields returned by the Jira REST API. */
export interface JiraIssueFields {
  /** Issue summary / title. */
  summary: string;
  /** Description in Atlassian Document Format (ADF), or null if empty. */
  description: Record<string, unknown> | null;
  /** Current issue status. */
  status: JiraStatus;
  /** Issue type (e.g. "Story", "Bug", "Task"). */
  issuetype: {
    name: string;
  };
  /** Issue priority. */
  priority: {
    name: string;
  };
  /** Assignee, or null if unassigned. */
  assignee: { displayName: string } | null;
  /** Reporter, or null if unavailable. */
  reporter: { displayName: string } | null;
  /** Labels attached to the issue. */
  labels: string[];
  /** Components the issue belongs to. */
  components: { name: string }[];
  /** Fix versions associated with the issue. */
  fixVersions: { name: string }[];
  /** ISO 8601 creation timestamp. */
  created: string;
  /** ISO 8601 last-updated timestamp. */
  updated: string;
  /** Due date in YYYY-MM-DD format, or null. */
  duedate: string | null;
  /** Parent issue reference, or null for top-level issues. */
  parent: { key: string } | null;
  /** Subtasks of this issue. */
  subtasks: JiraIssueRef[];
  /** Links to other issues. */
  issuelinks: JiraIssueLink[];
  /** Comment metadata (only total count is included by default). */
  comment: {
    total: number;
  };
  /** Story points (Jira Software custom field). */
  customfield_10016: number | null;
}

/** A single Jira issue as returned by /rest/api/3/issue or /rest/api/3/search. */
export interface JiraIssue {
  /** Unique issue ID. */
  id: string;
  /** Issue key (e.g. "PROJ-42"). */
  key: string;
  /** Self URL pointing to the issue's REST endpoint. */
  self: string;
  /** Issue fields. */
  fields: JiraIssueFields;
}

/** Paginated search result from /rest/api/3/search. */
export interface JiraSearchResult {
  /** Index of the first result in this page. */
  startAt: number;
  /** Requested page size. */
  maxResults: number;
  /** Total number of matching issues. */
  total: number;
  /** Issues on this page. */
  issues: JiraIssue[];
}

// ---------------------------------------------------------------------------
// Jira Agile API types
// ---------------------------------------------------------------------------

/** Sprint as returned by the Jira Agile API. */
export interface JiraSprint {
  /** Unique sprint ID. */
  id: number;
  /** Sprint name. */
  name: string;
  /** Sprint goal text, or null. */
  goal: string | null;
  /** Sprint state: "future", "active", or "closed". */
  state: string;
  /** ISO 8601 start date, or null for future sprints. */
  startDate: string | null;
  /** ISO 8601 end date, or null for future sprints. */
  endDate: string | null;
}

/** Board as returned by the Jira Agile API. */
export interface JiraBoard {
  /** Unique board ID. */
  id: number;
  /** Board display name. */
  name: string;
  /** Board type: "scrum", "kanban", or "simple". */
  type: string;
}

// ---------------------------------------------------------------------------
// Generic pagination and error types
// ---------------------------------------------------------------------------

/** Generic paginated response wrapper used by Agile endpoints. */
export interface JiraPaginatedResponse<T> {
  /** Index of the first result in this page. */
  startAt: number;
  /** Requested page size. */
  maxResults: number;
  /** Total number of results. */
  total: number;
  /** Items on this page. */
  values: T[];
  /** Whether this is the last page (present on some endpoints). */
  isLast?: boolean;
}

/** Error response returned by Jira when a request fails. */
export interface JiraErrorResponse {
  /** Top-level error messages. */
  errorMessages: string[];
  /** Field-level errors keyed by field name. */
  errors: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Comment types
// ---------------------------------------------------------------------------

/** Author information for comments and changelog entries. */
export interface JiraAuthor {
  /** Atlassian account ID. */
  accountId: string;
  /** Display name. */
  displayName: string;
}

/** A single Jira comment. */
export interface JiraComment {
  /** Unique comment ID. */
  id: string;
  /** Comment author. */
  author: JiraAuthor;
  /** Comment body in ADF format. */
  body: Record<string, unknown>;
  /** ISO 8601 creation timestamp. */
  created: string;
  /** ISO 8601 last-updated timestamp. */
  updated: string;
}

/** Paginated comment response from /rest/api/3/issue/{key}/comment. */
export interface JiraCommentResponse {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraComment[];
}

// ---------------------------------------------------------------------------
// Transition types
// ---------------------------------------------------------------------------

/** A single available transition for an issue. */
export interface JiraTransition {
  /** Unique transition ID. */
  id: string;
  /** Transition name (e.g. "Start Progress"). */
  name: string;
  /** Target status after the transition. */
  to: JiraStatus;
}

/** Response from /rest/api/3/issue/{key}/transitions. */
export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

// ---------------------------------------------------------------------------
// Changelog types
// ---------------------------------------------------------------------------

/** A single changed field within a changelog entry. */
export interface JiraChangeItem {
  /** Field name that was changed. */
  field: string;
  /** Field type (e.g. "jira", "custom"). */
  fieldtype: string;
  /** Previous value as display string. */
  fromString: string | null;
  /** New value as display string. */
  toString: string | null;
}

/** A single changelog entry. */
export interface JiraChangelogEntry {
  /** Unique changelog entry ID. */
  id: string;
  /** Who made the change. */
  author: JiraAuthor;
  /** ISO 8601 timestamp of the change. */
  created: string;
  /** Changed fields. */
  items: JiraChangeItem[];
}

/** Paginated changelog response from /rest/api/3/issue/{key}/changelog. */
export interface JiraChangelogResponse {
  startAt: number;
  maxResults: number;
  total: number;
  values: JiraChangelogEntry[];
}

// ---------------------------------------------------------------------------
// Watcher types
// ---------------------------------------------------------------------------

/** Watchers response from /rest/api/3/issue/{key}/watchers. */
export interface JiraWatchersResponse {
  /** Total number of watchers. */
  watchCount: number;
  /** Whether the current user is watching. */
  isWatching: boolean;
  /** List of watchers (only populated if user has permission). */
  watchers: JiraAuthor[];
}
