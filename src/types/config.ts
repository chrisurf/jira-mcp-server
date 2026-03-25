/**
 * Configuration type definitions for the Jira MCP Server.
 *
 * These interfaces define the shape of the server configuration,
 * including cache settings and Jira connection parameters.
 */

/** Cache configuration for API response caching. */
export interface CacheConfig {
  /** Whether caching is enabled. */
  enabled: boolean;
  /** Time-to-live for cache entries in seconds. */
  ttlSeconds: number;
  /** Maximum number of entries the cache can hold. */
  maxEntries: number;
}

/** Complete server configuration combining Jira credentials, tool filters, and cache settings. */
export interface ServerConfig {
  /** Base URL of the Jira Cloud instance (e.g. https://myorg.atlassian.net). */
  jiraInstanceUrl: string;
  /** Jira API token for authentication. */
  jiraApiToken: string;
  /** Email address associated with the Jira API token. */
  jiraUserEmail: string;
  /** Allowlist of tool names to expose. Empty array means all tools are allowed. */
  allowedTools: string[];
  /** Blocklist of tool names to hide. Ignored when allowedTools is non-empty. */
  blockedTools: string[];
  /** Jira project keys to restrict queries to. Empty array means no restriction. */
  projectKeys: string[];
  /** Cache configuration. */
  cache: CacheConfig;
}
