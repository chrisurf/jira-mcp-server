#!/usr/bin/env node

/**
 * Main entry point for the Jira MCP Server.
 *
 * Loads configuration, validates the Jira connection, creates the MCP
 * server with all registered tools, and connects via stdio transport.
 *
 * Security: Credentials are NEVER logged.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/loader.js";
import { JiraClient } from "./jira/client.js";
import { CacheManager } from "./cache/manager.js";
import { ToolRegistry } from "./tools/registry.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerEpicTools } from "./tools/epics.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerSprintTools } from "./tools/sprints.js";
import { registerIssueDetailTools } from "./tools/issue-details.js";
import type { ToolDescription } from "./tools/admin.js";

// Package metadata — read version from package.json at runtime.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
);
const SERVER_NAME: string = pkg.name;
const SERVER_VERSION: string = pkg.version;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ── 1. Load config ──────────────────────────────────────────────────
  const config = loadConfig();

  // ── 2. Create Jira client and validate connection ───────────────────
  const jiraClient = new JiraClient({
    instanceUrl: config.jiraInstanceUrl,
    email: config.jiraUserEmail,
    token: config.jiraApiToken,
  });

  let healthy = false;
  try {
    healthy = await jiraClient.validateConnection();
  } catch {
    // healthy remains false
  }

  if (healthy) {
    console.error(`[${SERVER_NAME}] Jira connection validated successfully.`);
  } else {
    console.error(
      `[${SERVER_NAME}] WARNING: Jira connection validation failed — server will start but Jira tools may not work.`,
    );
  }

  // ── 3. Create cache manager ─────────────────────────────────────────
  const cache = new CacheManager({
    enabled: config.cache.enabled,
    ttlSeconds: config.cache.ttlSeconds,
    maxEntries: config.cache.maxEntries,
  });

  // ── 4. Create MCP server ────────────────────────────────────────────
  const mcpServer = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ── 5. Create tool registry ─────────────────────────────────────────
  const registry = new ToolRegistry(
    mcpServer,
    config.allowedTools,
    config.blockedTools,
  );

  // ── 6. Collect tool descriptions and register tools ─────────────────
  // All tool descriptions (used by list_available_tools).
  const allToolDescriptions: ToolDescription[] = [
    {
      name: "list_projects",
      description: "List all Jira projects accessible to the server.",
    },
    {
      name: "get_project_summary",
      description: "Get a high-level project health summary.",
    },
    {
      name: "list_epics",
      description: "List all epics in a project with progress info.",
    },
    {
      name: "get_epic_children",
      description: "Get child issues of a specific epic.",
    },
    {
      name: "get_issue_subtasks",
      description: "Get all subtasks for a given issue.",
    },
    {
      name: "get_issue",
      description: "Get full details for a specific Jira issue.",
    },
    { name: "search_issues", description: "Search Jira issues using JQL." },
    {
      name: "get_epic_overview",
      description:
        "Get complete epic overview with all children, descriptions, and subtasks in one call.",
    },
    {
      name: "get_active_sprint",
      description:
        "Get the current active sprint with issues grouped by status.",
    },
    {
      name: "list_sprints",
      description:
        "List all sprints for a project board (future, active, closed).",
    },
    {
      name: "get_issue_comments",
      description: "Get comments for a Jira issue with full text content.",
    },
    {
      name: "get_issue_transitions",
      description: "Get available status transitions for a Jira issue.",
    },
    {
      name: "get_issue_changelog",
      description: "Get the change history for a Jira issue.",
    },
    {
      name: "get_issue_watchers",
      description: "Get the list of watchers for a Jira issue.",
    },
    {
      name: "list_available_tools",
      description: "Returns the list of currently enabled tools.",
    },
    { name: "clear_cache", description: "Clears the API response cache." },
  ];

  registerAdminTools(registry, cache, allToolDescriptions);

  // Register all domain tools through the registry for consistent allowlist/blocklist filtering.
  registerProjectTools(registry, jiraClient, cache, config.projectKeys);
  registerEpicTools(registry, jiraClient, cache, config.projectKeys);
  registerIssueTools(registry, jiraClient, cache, config.projectKeys);
  registerSprintTools(registry, jiraClient, cache, config.projectKeys);
  registerIssueDetailTools(registry, jiraClient, cache, config.projectKeys);

  // ── 7. Log startup info ─────────────────────────────────────────────
  const registeredTools = registry.getRegisteredTools();
  console.error(`[${SERVER_NAME}] Version: ${SERVER_VERSION}`);
  console.error(
    `[${SERVER_NAME}] Tools registered: ${registeredTools.length} (${registeredTools.join(", ")})`,
  );
  console.error(
    `[${SERVER_NAME}] Cache: ${config.cache.enabled ? `enabled (TTL ${config.cache.ttlSeconds}s, max ${config.cache.maxEntries} entries)` : "disabled"}`,
  );

  if (config.projectKeys.length > 0) {
    console.error(
      `[${SERVER_NAME}] Project allowlist: ${config.projectKeys.join(", ")}`,
    );
  }

  // ── 8. Connect via stdio transport ──────────────────────────────────
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error(`[${SERVER_NAME}] Server started and listening on stdio.`);

  // ── 9. Graceful shutdown ──────────────────────────────────────────
  const shutdown = async () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    try {
      await mcpServer.close();
    } catch {
      // Ignore close errors during shutdown.
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${SERVER_NAME}] Fatal error: ${message}`);
  process.exit(1);
});
