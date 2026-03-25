/**
 * Admin tools for the Jira MCP Server.
 *
 * Provides introspection and maintenance utilities:
 * - `list_available_tools` — lists all currently enabled tools with descriptions
 * - `clear_cache` — clears the response cache
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CacheManager } from "../cache/manager.js";
import type { ToolRegistry, ToolDefinition } from "./registry.js";

// ---------------------------------------------------------------------------
// Tool description metadata (used by list_available_tools itself)
// ---------------------------------------------------------------------------

/** Compact description of a tool for the listing response. */
export interface ToolDescription {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Handler factories
// ---------------------------------------------------------------------------

/**
 * Handler for `list_available_tools`.
 *
 * Returns the names and descriptions of all currently enabled tools as JSON.
 */
export function createListAvailableToolsHandler(
  allToolDescriptions: ToolDescription[],
): () => Promise<CallToolResult> {
  return async (): Promise<CallToolResult> => {
    const result = {
      tools: allToolDescriptions,
      count: allToolDescriptions.length,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  };
}

/**
 * Handler for `clear_cache`.
 *
 * Clears all entries from the response cache and returns the number of
 * entries that were removed.
 */
export function createClearCacheHandler(
  cache: CacheManager,
): () => Promise<CallToolResult> {
  return async (): Promise<CallToolResult> => {
    const { entriesCleared } = cache.clear();

    const result = {
      success: true,
      entriesCleared,
      message: `Cache cleared. ${entriesCleared} entries removed.`,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers all admin tools on the given {@link ToolRegistry}.
 *
 * @param registry            - The tool registry to register tools on.
 * @param cache               - The cache manager instance (for clear_cache).
 * @param allToolDescriptions - Descriptions of all tools (for list_available_tools).
 */
export function registerAdminTools(
  registry: ToolRegistry,
  cache: CacheManager,
  allToolDescriptions: ToolDescription[],
): void {
  const tools: ToolDefinition[] = [
    {
      name: "list_available_tools",
      description:
        "Returns the list of currently enabled tools with their descriptions.",
      inputSchema: {},
      handler: createListAvailableToolsHandler(allToolDescriptions),
    },
    {
      name: "clear_cache",
      description:
        "Clears the API response cache and returns the number of entries removed.",
      inputSchema: {},
      handler: createClearCacheHandler(cache),
    },
  ];

  for (const tool of tools) {
    registry.registerTool(tool);
  }
}
