/**
 * Shared helper functions for MCP tool handlers.
 *
 * Provides common utilities for project allowlist checks,
 * structured response formatting, and error responses.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Successful MCP tool response payload. */
export type ToolResult = CallToolResult;

/** Error MCP tool response payload. */
export type ToolErrorResult = CallToolResult;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a project key is permitted by the server's allowlist.
 *
 * @param projectKey  - The project key to validate.
 * @param projectKeys - The configured allowlist. An empty array means "allow all".
 * @returns `true` if the project is allowed, `false` otherwise.
 */
export function projectAllowed(
  projectKey: string,
  projectKeys: string[],
): boolean {
  if (projectKeys.length === 0) return true;
  return projectKeys.includes(projectKey.toUpperCase());
}

/**
 * Wrap arbitrary data in the MCP tool response format.
 *
 * @param data - The data to serialize as JSON in the response text.
 */
export function textResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create an MCP error response with `isError: true`.
 *
 * @param message - Human-readable error message.
 */
export function errorResult(message: string): ToolErrorResult {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message }) },
    ],
    isError: true,
  };
}
