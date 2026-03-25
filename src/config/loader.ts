/**
 * Configuration loader for the Jira MCP Server.
 *
 * Reads environment variables and an optional JSON config file,
 * validates both with Zod schemas, merges with defaults, and
 * returns a fully resolved {@link ServerConfig}.
 */

import fs from "node:fs";
import { configFileSchema, envSchema } from "./schema.js";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_BLOCKED_TOOLS,
  DEFAULT_PROJECT_KEYS,
  DEFAULT_CACHE_CONFIG,
} from "./defaults.js";
import type { ServerConfig } from "../types/config.js";

/**
 * Load and validate the server configuration.
 *
 * Resolution order:
 * 1. Read `JIRA_INSTANCE_URL`, `JIRA_API_TOKEN`, `JIRA_USER_EMAIL` from env.
 * 2. If `MCP_CONFIG_PATH` is set, read and parse the JSON file.
 * 3. Validate all inputs with Zod; merge with defaults.
 *
 * Exits the process with a descriptive error message if validation fails.
 * Never logs credentials.
 *
 * @returns A fully resolved {@link ServerConfig}.
 */
export function loadConfig(): ServerConfig {
  // ── 1. Collect required env vars ──────────────────────────────────────
  const requiredVars = [
    "JIRA_INSTANCE_URL",
    "JIRA_API_TOKEN",
    "JIRA_USER_EMAIL",
  ] as const;
  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `[jira-mcp-server] Missing required environment variable(s): ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  // Validate env values with Zod
  const envResult = envSchema.safeParse({
    JIRA_INSTANCE_URL: process.env.JIRA_INSTANCE_URL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    JIRA_USER_EMAIL: process.env.JIRA_USER_EMAIL,
  });

  if (!envResult.success) {
    const issues = envResult.error.issues.map((i) => i.message).join("; ");
    console.error(`[jira-mcp-server] Environment validation failed: ${issues}`);
    process.exit(1);
  }

  const env = envResult.data;

  // ── 2. Optional config file ───────────────────────────────────────────
  const configPath = process.env.MCP_CONFIG_PATH;
  let fileConfig: {
    allowed_tools: string[];
    blocked_tools: string[];
    project_keys: string[];
    cache: { enabled: boolean; ttl_seconds: number; max_entries: number };
  } = {
    allowed_tools: DEFAULT_ALLOWED_TOOLS,
    blocked_tools: DEFAULT_BLOCKED_TOOLS,
    project_keys: DEFAULT_PROJECT_KEYS,
    cache: {
      enabled: DEFAULT_CACHE_CONFIG.enabled,
      ttl_seconds: DEFAULT_CACHE_CONFIG.ttlSeconds,
      max_entries: DEFAULT_CACHE_CONFIG.maxEntries,
    },
  };

  if (configPath) {
    if (!fs.existsSync(configPath)) {
      console.error(`[jira-mcp-server] Config file not found: ${configPath}`);
      process.exit(1);
    }

    let raw: string;
    try {
      raw = fs.readFileSync(configPath, "utf-8");
    } catch {
      console.error(
        `[jira-mcp-server] Failed to read config file: ${configPath}`,
      );
      process.exit(1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(
        `[jira-mcp-server] Malformed JSON in config file: ${configPath}`,
      );
      process.exit(1);
    }

    const cfgResult = configFileSchema.safeParse(parsed);
    if (!cfgResult.success) {
      const issues = cfgResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      console.error(
        `[jira-mcp-server] Config file validation failed: ${issues}`,
      );
      process.exit(1);
    }

    fileConfig = cfgResult.data;

    // Warn when allowed_tools is explicitly set but empty
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "allowed_tools" in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>).allowed_tools) &&
      ((parsed as Record<string, unknown>).allowed_tools as unknown[])
        .length === 0
    ) {
      console.warn(
        "[jira-mcp-server] Warning: allowed_tools is an empty array — all tools will be exposed.",
      );
    }
  }

  // ── 3. Build final config ─────────────────────────────────────────────
  const config: ServerConfig = {
    jiraInstanceUrl: env.JIRA_INSTANCE_URL,
    jiraApiToken: env.JIRA_API_TOKEN,
    jiraUserEmail: env.JIRA_USER_EMAIL,
    allowedTools: fileConfig.allowed_tools,
    blockedTools: fileConfig.blocked_tools,
    projectKeys: fileConfig.project_keys,
    cache: {
      enabled: fileConfig.cache.enabled,
      ttlSeconds: fileConfig.cache.ttl_seconds,
      maxEntries: fileConfig.cache.max_entries,
    },
  };

  return config;
}
