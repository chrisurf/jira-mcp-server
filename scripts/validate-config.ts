#!/usr/bin/env tsx

/**
 * CLI script to validate a Jira MCP Server config file against the Zod schema.
 *
 * Usage:
 *   npm run validate-config -- --config ./config.json
 */

import fs from 'node:fs';
import { configFileSchema } from '../src/config/schema.js';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(): string {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');

  if (configIndex === -1 || configIndex + 1 >= args.length) {
    console.error('Usage: npm run validate-config -- --config <path-to-config.json>');
    process.exit(1);
  }

  return args[configIndex + 1];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const configPath = parseArgs();

  // Check file exists
  if (!fs.existsSync(configPath)) {
    console.error(`Error: File not found: ${configPath}`);
    process.exit(1);
  }

  // Read file
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    console.error(`Error: Failed to read file: ${configPath}`);
    process.exit(1);
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`Error: Malformed JSON in ${configPath}`);
    process.exit(1);
  }

  // Validate against schema
  const result = configFileSchema.safeParse(parsed);

  if (!result.success) {
    console.error('Validation FAILED:');
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      console.error(`  - ${path}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log('Validation PASSED.');
  console.log('');
  console.log('Resolved configuration:');
  console.log(JSON.stringify(result.data, null, 2));
}

main();
