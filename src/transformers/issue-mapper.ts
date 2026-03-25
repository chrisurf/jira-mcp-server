/**
 * Jira issue mapper — transforms raw Jira API responses into clean,
 * typed objects suitable for MCP tool responses.
 *
 * The mapper normalises field names, converts the ADF description to
 * plain text, and resolves common custom fields (epic link, story points).
 */

import type { JiraIssue, JiraIssueLink } from "../jira/types.js";
import { adfToText } from "./adf-to-text.js";
import type { AdfNode } from "./adf-to-text.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** A normalised, agent-friendly representation of a Jira issue. */
export interface MappedIssue {
  /** Issue key (e.g. "PROJ-42"). */
  key: string;
  /** Issue summary / title. */
  summary: string;
  /** Plain-text description converted from ADF, or null. */
  description: string | null;
  /** Current status name. */
  status: string;
  /** Status category name (e.g. "To Do", "In Progress", "Done"). */
  statusCategory: string;
  /** Issue type name (e.g. "Story", "Bug"). */
  issueType: string;
  /** Priority name. */
  priority: string;
  /** Assignee display name, or null if unassigned. */
  assignee: string | null;
  /** Reporter display name, or null. */
  reporter: string | null;
  /** Labels attached to the issue. */
  labels: string[];
  /** Component names. */
  components: string[];
  /** Fix version names. */
  fixVersions: string[];
  /** Story points, or null when not set. */
  storyPoints: number | null;
  /** ISO 8601 creation timestamp. */
  created: string;
  /** ISO 8601 last-updated timestamp. */
  updated: string;
  /** Due date (YYYY-MM-DD), or null. */
  dueDate: string | null;
  /** Parent issue key, or null. */
  parentKey: string | null;
  /** Epic key (from parent or customfield_10014), or null. */
  epicKey: string | null;
  /** Number of subtasks. */
  subtaskCount: number;
  /** Number of comments. */
  commentCount: number;
  /** Linked issues with their relationship type. */
  linkedIssues: LinkedIssue[];
}

/** A simplified linked-issue reference. */
export interface LinkedIssue {
  /** Issue key of the linked issue. */
  key: string;
  /** Summary of the linked issue. */
  summary: string;
  /** Human-readable link type (e.g. "blocks", "is blocked by"). */
  linkType: string;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Map a raw Jira API issue object into a {@link MappedIssue}.
 *
 * The function is intentionally lenient — missing or unexpected fields
 * are handled gracefully with sensible defaults (null, empty array, etc.).
 */
export function mapIssue(jiraIssue: JiraIssue): MappedIssue {
  const f = jiraIssue.fields;

  const description = f.description
    ? adfToText(f.description as unknown as AdfNode)
    : null;

  return {
    key: jiraIssue.key,
    summary: f.summary ?? "",
    description: description || null,
    status: f.status?.name ?? "",
    statusCategory: f.status?.statusCategory?.name ?? "",
    issueType: f.issuetype?.name ?? "",
    priority: f.priority?.name ?? "",
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    components: (f.components ?? []).map((c) => c.name),
    fixVersions: (f.fixVersions ?? []).map((v) => v.name),
    storyPoints: f.customfield_10016 ?? null,
    created: f.created ?? "",
    updated: f.updated ?? "",
    dueDate: f.duedate ?? null,
    parentKey: f.parent?.key ?? null,
    epicKey: resolveEpicKey(jiraIssue),
    subtaskCount: f.subtasks?.length ?? 0,
    commentCount: f.comment?.total ?? 0,
    linkedIssues: mapLinkedIssues(f.issuelinks),
  };
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve the epic key from the issue.
 *
 * Strategy:
 * 1. Check `customfield_10014` (classic "Epic Link" field).
 * 2. Fall back to the parent key — in next-gen projects the parent *is*
 *    the epic when the parent's issue type is "Epic".  Since the search
 *    response does not include the parent's issue type we cannot verify
 *    this, so we only use `customfield_10014` when available.
 */
function resolveEpicKey(issue: JiraIssue): string | null {
  // Classic epic link custom field (string value = epic key).
  const epicLink = (issue.fields as unknown as Record<string, unknown>)[
    "customfield_10014"
  ];
  if (typeof epicLink === "string" && epicLink.length > 0) {
    return epicLink;
  }

  return null;
}

/** Map an array of Jira issue links into simplified {@link LinkedIssue} objects. */
function mapLinkedIssues(links: JiraIssueLink[] | undefined): LinkedIssue[] {
  if (!links) return [];

  return links
    .map((link): LinkedIssue | null => {
      if (link.outwardIssue) {
        return {
          key: link.outwardIssue.key,
          summary: link.outwardIssue.fields?.summary ?? "",
          linkType: link.type?.outward ?? "",
        };
      }
      if (link.inwardIssue) {
        return {
          key: link.inwardIssue.key,
          summary: link.inwardIssue.fields?.summary ?? "",
          linkType: link.type?.inward ?? "",
        };
      }
      return null;
    })
    .filter((item): item is LinkedIssue => item !== null);
}
