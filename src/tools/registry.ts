/**
 * Tool Registry for the Jira MCP Server.
 *
 * Manages MCP tool registration with allowlist/blocklist filtering.
 * Tools that are blocked by configuration are silently skipped during
 * registration and logged to stderr for debugging.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Zod-based parameter schema for a tool (key → ZodType). */
export type ToolParamsSchema = Record<string, z.ZodTypeAny>;

/** Definition of a single MCP tool to be registered. */
export interface ToolDefinition {
  /** Unique tool name. */
  name: string;
  /** Human-readable description shown to the client. */
  description: string;
  /** Zod shape object describing the tool's input parameters. */
  inputSchema: ToolParamsSchema;
  /** Handler function invoked when the tool is called. */
  handler: (params: Record<string, unknown>) => Promise<CallToolResult>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Manages the registration of MCP tools on an {@link McpServer}.
 *
 * Supports allowlist and blocklist filtering:
 * - If `allowedTools` is non-empty, **only** listed tools are registered.
 * - Otherwise, if `blockedTools` is non-empty, all tools **except** listed
 *   ones are registered.
 * - If both lists are empty, every tool is registered.
 */
export class ToolRegistry {
  private readonly registeredTools: string[] = [];

  constructor(
    private readonly server: McpServer,
    private readonly allowedTools: string[],
    private readonly blockedTools: string[],
  ) {}

  // -----------------------------------------------------------------------
  // Filter logic
  // -----------------------------------------------------------------------

  /**
   * Check whether a tool should be registered based on the allowlist/blocklist
   * configuration.
   *
   * Resolution order:
   * 1. Allowlist wins — if it is non-empty, only listed tools pass.
   * 2. Blocklist — if it is non-empty, all tools except listed ones pass.
   * 3. Default — everything is allowed.
   */
  isToolAllowed(toolName: string): boolean {
    if (this.allowedTools.length > 0) {
      return this.allowedTools.includes(toolName);
    }
    if (this.blockedTools.length > 0) {
      return !this.blockedTools.includes(toolName);
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a tool on the MCP server if it passes the filter.
   *
   * Uses the SDK's `server.tool(name, description, schema, handler)` overload
   * so that tools appear with a description in the client's tool listing.
   *
   * @returns `true` when the tool was successfully registered, `false` when
   *          it was blocked by configuration.
   */
  registerTool(definition: ToolDefinition): boolean {
    if (!this.isToolAllowed(definition.name)) {
      console.error(
        `[registry] Tool "${definition.name}" is blocked by configuration — not registered.`,
      );
      return false;
    }

    // server.tool(name, description, paramsSchema, handler)
    // The handler receives the parsed params and an extra context object.
    this.server.tool(
      definition.name,
      definition.description,
      definition.inputSchema,
      async (params) => {
        return definition.handler(params as Record<string, unknown>);
      },
    );

    this.registeredTools.push(definition.name);
    return true;
  }

  // -----------------------------------------------------------------------
  // Introspection
  // -----------------------------------------------------------------------

  /** Returns the list of tool names that have been successfully registered. */
  getRegisteredTools(): string[] {
    return [...this.registeredTools];
  }
}
