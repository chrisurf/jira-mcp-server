/**
 * Unit tests for the ToolRegistry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ToolRegistry,
  type ToolDefinition,
} from "../../../src/tools/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal mock McpServer with a `tool()` spy. */
function createMockServer() {
  return {
    tool: vi.fn(),
  } as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
}

/** Creates a simple ToolDefinition stub. */
function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: `Description for ${name}`,
    inputSchema: {},
    handler: vi.fn().mockResolvedValue({
      content: [{ type: "text" as const, text: "ok" }],
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: isToolAllowed
// ---------------------------------------------------------------------------

describe("ToolRegistry.isToolAllowed", () => {
  it("should allow all tools when both lists are empty", () => {
    const registry = new ToolRegistry(createMockServer(), [], []);
    expect(registry.isToolAllowed("any_tool")).toBe(true);
    expect(registry.isToolAllowed("another_tool")).toBe(true);
  });

  it("should allow only listed tools when allowlist is set", () => {
    const registry = new ToolRegistry(
      createMockServer(),
      ["tool_a", "tool_b"],
      [],
    );
    expect(registry.isToolAllowed("tool_a")).toBe(true);
    expect(registry.isToolAllowed("tool_b")).toBe(true);
    expect(registry.isToolAllowed("tool_c")).toBe(false);
  });

  it("should block only listed tools when blocklist is set", () => {
    const registry = new ToolRegistry(createMockServer(), [], ["tool_x"]);
    expect(registry.isToolAllowed("tool_a")).toBe(true);
    expect(registry.isToolAllowed("tool_x")).toBe(false);
  });

  it("should let allowlist win when both lists are set", () => {
    const registry = new ToolRegistry(
      createMockServer(),
      ["tool_a"],
      ["tool_a", "tool_b"],
    );
    // Allowlist takes precedence — tool_a is explicitly allowed
    expect(registry.isToolAllowed("tool_a")).toBe(true);
    // tool_b is not in the allowlist, so it is blocked
    expect(registry.isToolAllowed("tool_b")).toBe(false);
    // tool_c is also not in the allowlist
    expect(registry.isToolAllowed("tool_c")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: registerTool
// ---------------------------------------------------------------------------

describe("ToolRegistry.registerTool", () => {
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    mockServer = createMockServer();
  });

  it("should register a tool when it is allowed", () => {
    const registry = new ToolRegistry(mockServer, [], []);
    const definition = stubTool("my_tool");

    const result = registry.registerTool(definition);

    expect(result).toBe(true);
    expect(mockServer.tool).toHaveBeenCalledOnce();
    expect(registry.getRegisteredTools()).toContain("my_tool");
  });

  it("should not register a tool when it is blocked", () => {
    const registry = new ToolRegistry(mockServer, [], ["blocked_tool"]);
    const definition = stubTool("blocked_tool");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = registry.registerTool(definition);
    consoleSpy.mockRestore();

    expect(result).toBe(false);
    expect(mockServer.tool).not.toHaveBeenCalled();
    expect(registry.getRegisteredTools()).not.toContain("blocked_tool");
  });

  it("should not register a tool when it is not in the allowlist", () => {
    const registry = new ToolRegistry(mockServer, ["allowed_only"], []);
    const definition = stubTool("other_tool");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = registry.registerTool(definition);
    consoleSpy.mockRestore();

    expect(result).toBe(false);
    expect(mockServer.tool).not.toHaveBeenCalled();
  });

  it("should call server.tool with name, description, schema, and handler", () => {
    const registry = new ToolRegistry(mockServer, [], []);
    const definition = stubTool("test_tool");

    registry.registerTool(definition);

    expect(mockServer.tool).toHaveBeenCalledWith(
      "test_tool",
      "Description for test_tool",
      definition.inputSchema,
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: getRegisteredTools
// ---------------------------------------------------------------------------

describe("ToolRegistry.getRegisteredTools", () => {
  it("should return an empty array before any registration", () => {
    const registry = new ToolRegistry(createMockServer(), [], []);
    expect(registry.getRegisteredTools()).toEqual([]);
  });

  it("should return all registered tool names", () => {
    const registry = new ToolRegistry(createMockServer(), [], []);
    registry.registerTool(stubTool("tool_a"));
    registry.registerTool(stubTool("tool_b"));

    expect(registry.getRegisteredTools()).toEqual(["tool_a", "tool_b"]);
  });

  it("should return a copy, not a reference to the internal array", () => {
    const registry = new ToolRegistry(createMockServer(), [], []);
    registry.registerTool(stubTool("tool_a"));

    const tools = registry.getRegisteredTools();
    tools.push("injected");

    expect(registry.getRegisteredTools()).toEqual(["tool_a"]);
  });
});
