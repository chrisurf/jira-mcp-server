## Summary

<!-- Brief description of the changes -->

## Type of Change

- [ ] Feature (`feat:`)
- [ ] Bug fix (`fix:`)
- [ ] Refactoring (`refactor:`)
- [ ] Documentation (`docs:`)
- [ ] Chore / tooling (`chore:`)
- [ ] Breaking change (`feat!:` / `fix!:`)

## MCP Server Checklist

### Protocol Compliance
- [ ] `tools/list` returns complete schemas for new/changed tools
- [ ] `tools/call` returns correct `Content` types
- [ ] `isError: true` is set on tool error responses
- [ ] New tools are registered via `ToolRegistry` (not directly on `McpServer`)

### Security
- [ ] All tool inputs are validated (not just TypeScript types)
- [ ] No secrets in code or tool responses
- [ ] No unhandled exceptions that could leak stack traces

### Tool Definitions
- [ ] Tool descriptions are clear and LLM-optimized
- [ ] All `required` fields are correctly declared via Zod
- [ ] Numeric constraints (`min`/`max`) are set where applicable

### Tests
- [ ] Unit tests cover new/changed tool handlers
- [ ] Error cases are tested
- [ ] All tests pass (`npm test`)

### Documentation
- [ ] README updated if new tools were added
- [ ] Environment variables documented in `.env.example` if changed

## Test Plan

<!-- How to verify this change works -->

- [ ] `npm test` passes (180+ tests)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
