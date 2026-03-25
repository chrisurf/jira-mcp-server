import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { loadConfig } from "../../../src/config/loader.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Set the three required env vars to valid defaults. */
function setValidEnv(): void {
  process.env.JIRA_INSTANCE_URL = "https://myorg.atlassian.net";
  process.env.JIRA_API_TOKEN = "tok-abc-123";
  process.env.JIRA_USER_EMAIL = "user@example.com";
}

/** Remove all Jira/MCP env vars. */
function clearEnv(): void {
  delete process.env.JIRA_INSTANCE_URL;
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_USER_EMAIL;
  delete process.env.MCP_CONFIG_PATH;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("loadConfig", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearEnv();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Happy path ─────────────────────────────────────────────────── */

  it("loads valid config with all env vars set (no config file)", () => {
    setValidEnv();

    const config = loadConfig();

    expect(config.jiraInstanceUrl).toBe("https://myorg.atlassian.net");
    expect(config.jiraApiToken).toBe("tok-abc-123");
    expect(config.jiraUserEmail).toBe("user@example.com");
    expect(config.allowedTools).toEqual([]);
    expect(config.blockedTools).toEqual([]);
    expect(config.projectKeys).toEqual([]);
    expect(config.cache).toEqual({
      enabled: true,
      ttlSeconds: 300,
      maxEntries: 1000,
    });
  });

  it("applies default values when config file has no cache section", () => {
    setValidEnv();
    process.env.MCP_CONFIG_PATH = "/tmp/test-config.json";

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        allowed_tools: ["jira_search"],
      }),
    );

    const config = loadConfig();

    expect(config.allowedTools).toEqual(["jira_search"]);
    expect(config.cache).toEqual({
      enabled: true,
      ttlSeconds: 300,
      maxEntries: 1000,
    });
  });

  it("loads valid config with project_keys set", () => {
    setValidEnv();
    process.env.MCP_CONFIG_PATH = "/tmp/test-config.json";

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        project_keys: ["PROJ", "TEAM"],
        cache: { enabled: false, ttl_seconds: 60, max_entries: 500 },
      }),
    );

    const config = loadConfig();

    expect(config.projectKeys).toEqual(["PROJ", "TEAM"]);
    expect(config.cache.enabled).toBe(false);
    expect(config.cache.ttlSeconds).toBe(60);
    expect(config.cache.maxEntries).toBe(500);
  });

  it("loads successfully when both allowed_tools and blocked_tools are defined", () => {
    setValidEnv();
    process.env.MCP_CONFIG_PATH = "/tmp/test-config.json";

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        allowed_tools: ["jira_search"],
        blocked_tools: ["jira_delete"],
      }),
    );

    const config = loadConfig();

    expect(config.allowedTools).toEqual(["jira_search"]);
    expect(config.blockedTools).toEqual(["jira_delete"]);
  });

  /* ── Missing env vars ───────────────────────────────────────────── */

  it("exits with error when JIRA_INSTANCE_URL is missing", () => {
    process.env.JIRA_API_TOKEN = "tok";
    process.env.JIRA_USER_EMAIL = "a@b.com";

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("JIRA_INSTANCE_URL"),
    );
  });

  it("exits with error when JIRA_API_TOKEN is missing", () => {
    process.env.JIRA_INSTANCE_URL = "https://x.atlassian.net";
    process.env.JIRA_USER_EMAIL = "a@b.com";

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("JIRA_API_TOKEN"),
    );
  });

  it("exits with error when JIRA_USER_EMAIL is missing", () => {
    process.env.JIRA_INSTANCE_URL = "https://x.atlassian.net";
    process.env.JIRA_API_TOKEN = "tok";

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("JIRA_USER_EMAIL"),
    );
  });

  it("exits with error naming all missing env vars when multiple are absent", () => {
    // All three missing
    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("JIRA_INSTANCE_URL");
    expect(msg).toContain("JIRA_API_TOKEN");
    expect(msg).toContain("JIRA_USER_EMAIL");
  });

  /* ── Malformed URL ──────────────────────────────────────────────── */

  it("exits with error when JIRA_INSTANCE_URL has no protocol", () => {
    process.env.JIRA_INSTANCE_URL = "myorg.atlassian.net";
    process.env.JIRA_API_TOKEN = "tok";
    process.env.JIRA_USER_EMAIL = "a@b.com";

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("JIRA_INSTANCE_URL"),
    );
  });

  /* ── Config file errors ─────────────────────────────────────────── */

  it("exits with error when config file does not exist", () => {
    setValidEnv();
    process.env.MCP_CONFIG_PATH = "/nonexistent/config.json";

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Config file not found"),
    );
  });

  it("exits with error when config file contains malformed JSON", () => {
    setValidEnv();
    process.env.MCP_CONFIG_PATH = "/tmp/bad.json";

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("{ not valid json !!!");

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Malformed JSON"),
    );
  });

  /* ── Warning for empty allowed_tools ────────────────────────────── */

  it("logs a warning when allowed_tools is explicitly an empty array", () => {
    setValidEnv();
    process.env.MCP_CONFIG_PATH = "/tmp/test-config.json";

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        allowed_tools: [],
      }),
    );

    const config = loadConfig();

    expect(config.allowedTools).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("allowed_tools is an empty array"),
    );
  });
});
