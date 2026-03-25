# Jira MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that gives AI agents structured access to Jira Cloud.

## Features

- Read-only access to Jira Cloud via REST API v3
- Project listing and health summaries
- Epic browsing with progress tracking
- Issue retrieval and JQL search
- Sprint overview with status grouping
- API response caching with configurable TTL
- Tool allowlist/blocklist for fine-grained access control
- Project key restriction to limit query scope

## Quick Start

### Prerequisites

- Node.js >= 20
- A Jira Cloud instance with an API token ([generate one here](https://id.atlassian.com/manage-profile/security/api-tokens))

### Install and Run

```bash
# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your Jira credentials

# Run in development mode
npm run dev

# Or build and run production
npm run build
npm start
```

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp-server/dist/server.js"],
      "env": {
        "JIRA_INSTANCE_URL": "https://your-domain.atlassian.net",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_USER_EMAIL": "you@example.com"
      }
    }
  }
}
```

## Claude Code Setup

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp-server/dist/server.js"],
      "env": {
        "JIRA_INSTANCE_URL": "https://your-domain.atlassian.net",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_USER_EMAIL": "you@example.com"
      }
    }
  }
}
```

Or via the CLI:

```bash
claude mcp add jira -- node /absolute/path/to/jira-mcp-server/dist/server.js
```

## Available Tools

| Tool | Description |
|---|---|
| `list_projects` | List all Jira projects accessible to the server. |
| `get_project_summary` | Get a high-level project health summary. |
| `list_epics` | List all epics in a project with progress info. |
| `get_epic_children` | Get child issues of a specific epic. |
| `get_issue_subtasks` | Get all subtasks for a given issue. |
| `get_issue` | Get full details for a specific Jira issue. |
| `search_issues` | Search Jira issues using JQL. |
| `get_epic_overview` | Get complete epic overview with all children, descriptions, and subtasks in one call. |
| `get_active_sprint` | Get the current active sprint with issues grouped by status. |
| `list_sprints` | List all sprints for a project board (future, active, closed). |
| `get_issue_comments` | Get comments for a Jira issue with full text content. |
| `get_issue_transitions` | Get available status transitions for a Jira issue. |
| `get_issue_changelog` | Get the change history for a Jira issue. |
| `get_issue_watchers` | Get the list of watchers for a Jira issue. |
| `list_available_tools` | Returns the list of currently enabled tools. |
| `clear_cache` | Clears the API response cache. |

## Configuration

The server is configured through environment variables (Jira credentials) and an optional JSON config file (tool filters, project restrictions, cache settings).

Set `MCP_CONFIG_PATH` to point to your config file:

```bash
export MCP_CONFIG_PATH=./config.json
```

See [docs/configuration.md](docs/configuration.md) for the full configuration reference.

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Type-check without emitting
npm run typecheck

# Format code
npm run format

# Validate a config file
npm run validate-config -- --config ./config.json
```

## Docker

Build the image:

```bash
docker build -t jira-mcp-server .
```

Run the container:

```bash
docker run --rm \
  -e JIRA_INSTANCE_URL="https://your-domain.atlassian.net" \
  -e JIRA_API_TOKEN="your-api-token" \
  -e JIRA_USER_EMAIL="you@example.com" \
  jira-mcp-server
```

Mount a config file:

```bash
docker run --rm \
  -e JIRA_INSTANCE_URL="https://your-domain.atlassian.net" \
  -e JIRA_API_TOKEN="your-api-token" \
  -e JIRA_USER_EMAIL="you@example.com" \
  -e MCP_CONFIG_PATH="/app/config/config.json" \
  -v ./config.json:/app/config/config.json:ro \
  jira-mcp-server
```

## License

MIT
