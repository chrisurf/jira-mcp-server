/**
 * Zod validation schemas for configuration and environment variables.
 *
 * - {@link configFileSchema} validates the optional JSON config file.
 * - {@link envSchema} validates required environment variables.
 */

import { z } from "zod";
import {
  DEFAULT_CACHE_CONFIG,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_BLOCKED_TOOLS,
  DEFAULT_PROJECT_KEYS,
} from "./defaults.js";

/** Schema for the cache section inside the config file. */
export const cacheSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CACHE_CONFIG.enabled),
  ttl_seconds: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_CACHE_CONFIG.ttlSeconds),
  max_entries: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_CACHE_CONFIG.maxEntries),
});

/** Schema for the optional JSON config file (all fields optional with defaults). */
export const configFileSchema = z.object({
  allowed_tools: z.array(z.string()).default(DEFAULT_ALLOWED_TOOLS),
  blocked_tools: z.array(z.string()).default(DEFAULT_BLOCKED_TOOLS),
  project_keys: z.array(z.string()).default(DEFAULT_PROJECT_KEYS),
  cache: cacheSchema.default({}),
});

/** Inferred TypeScript type for the config file schema. */
export type ConfigFile = z.infer<typeof configFileSchema>;

/**
 * Schema for required environment variables.
 *
 * - `JIRA_INSTANCE_URL` must be a valid URL starting with http:// or https://.
 * - `JIRA_API_TOKEN` must be a non-empty string.
 * - `JIRA_USER_EMAIL` must be a valid email address.
 */
export const envSchema = z.object({
  JIRA_INSTANCE_URL: z
    .string()
    .url(
      "JIRA_INSTANCE_URL must be a valid URL with protocol (e.g. https://myorg.atlassian.net)",
    ),
  JIRA_API_TOKEN: z
    .string()
    .min(1, "JIRA_API_TOKEN must be a non-empty string"),
  JIRA_USER_EMAIL: z
    .string()
    .email("JIRA_USER_EMAIL must be a valid email address"),
});
