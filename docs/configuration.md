# Configuration Guide

This document describes all configuration options for the Jira MCP Server.

## Environment Variables

The server requires three environment variables for Jira Cloud authentication and accepts one optional variable for the config file path.

| Variable | Required | Description |
|---|---|---|
| `JIRA_INSTANCE_URL` | Yes | Base URL of the Jira Cloud instance (e.g. `https://your-domain.atlassian.net`). Must include the protocol. |
| `JIRA_API_TOKEN` | Yes | Jira API token. Generate one at [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens). |
| `JIRA_USER_EMAIL` | Yes | Email address associated with the API token. |
| `MCP_CONFIG_PATH` | No | Absolute or relative path to a JSON configuration file. When omitted, the server uses default settings. |

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

## Config File Format

The config file is a JSON object. All fields are optional -- defaults are applied for any missing field.

```json
{
  "allowed_tools": [],
  "blocked_tools": [],
  "project_keys": [],
  "cache": {
    "enabled": true,
    "ttl_seconds": 300,
    "max_entries": 1000
  }
}
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `allowed_tools` | `string[]` | `[]` | Allowlist of tool names to expose. When non-empty, **only** these tools are registered. An empty array means all tools are allowed. |
| `blocked_tools` | `string[]` | `[]` | Blocklist of tool names to hide. Ignored when `allowed_tools` is non-empty. |
| `project_keys` | `string[]` | `[]` | Restrict all queries to these Jira project keys (e.g. `["PROJ", "TEAM"]`). An empty array means no restriction. |
| `cache.enabled` | `boolean` | `true` | Enable or disable API response caching. |
| `cache.ttl_seconds` | `integer` | `300` | Time-to-live for cache entries in seconds. |
| `cache.max_entries` | `integer` | `1000` | Maximum number of entries the cache can hold. Oldest entries are evicted first. |

### Tool Filter Resolution

1. If `allowed_tools` is non-empty, **only** listed tools are registered (allowlist wins).
2. Otherwise, if `blocked_tools` is non-empty, all tools **except** listed ones are registered.
3. If both lists are empty, every tool is registered.

## Examples

### Allowlist: Expose only read tools

```json
{
  "allowed_tools": ["get_issue", "search_issues", "list_projects"]
}
```

### Blocklist: Hide admin tools

```json
{
  "blocked_tools": ["clear_cache"]
}
```

### Project restriction

```json
{
  "project_keys": ["DPSPPT", "INFRA"]
}
```

### Cache tuning

```json
{
  "cache": {
    "enabled": true,
    "ttl_seconds": 60,
    "max_entries": 500
  }
}
```

### Disable cache entirely

```json
{
  "cache": {
    "enabled": false
  }
}
```

## Claude Desktop Configuration

Add the server to your `claude_desktop_config.json` (typically at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp-server/dist/server.js"],
      "env": {
        "JIRA_INSTANCE_URL": "https://your-domain.atlassian.net",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_USER_EMAIL": "you@example.com",
        "MCP_CONFIG_PATH": "/absolute/path/to/config.json"
      }
    }
  }
}
```

To use the development version with `tsx` instead of the compiled output:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/jira-mcp-server/src/server.ts"],
      "env": {
        "JIRA_INSTANCE_URL": "https://your-domain.atlassian.net",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_USER_EMAIL": "you@example.com"
      }
    }
  }
}
```

## Claude Code Configuration

Add the server to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp-server/dist/server.js"],
      "env": {
        "JIRA_INSTANCE_URL": "https://your-domain.atlassian.net",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_USER_EMAIL": "you@example.com",
        "MCP_CONFIG_PATH": "/absolute/path/to/config.json"
      }
    }
  }
}
```

Alternatively, add it via the CLI:

```bash
claude mcp add jira -- node /absolute/path/to/jira-mcp-server/dist/server.js
```

## Docker Usage

Build the image:

```bash
docker build -t jira-mcp-server .
```

Run with environment variables:

```bash
docker run --rm \
  -e JIRA_INSTANCE_URL="https://your-domain.atlassian.net" \
  -e JIRA_API_TOKEN="your-api-token" \
  -e JIRA_USER_EMAIL="you@example.com" \
  jira-mcp-server
```

Run with a mounted config file:

```bash
docker run --rm \
  -e JIRA_INSTANCE_URL="https://your-domain.atlassian.net" \
  -e JIRA_API_TOKEN="your-api-token" \
  -e JIRA_USER_EMAIL="you@example.com" \
  -e MCP_CONFIG_PATH="/app/config/config.json" \
  -v /path/to/config.json:/app/config/config.json:ro \
  jira-mcp-server
```

## Validating a Config File

Use the built-in validation script to check a config file before deploying:

```bash
npm run validate-config -- --config ./config.json
```

The script loads the file, validates it against the Zod schema, and prints the result.
