/**
 * Jira Cloud authentication utilities.
 *
 * Jira Cloud REST API uses HTTP Basic authentication with the user's
 * email address and an API token (not the password).
 */

/**
 * Creates an HTTP Basic Authorization header value for the Jira Cloud API.
 *
 * @param email - Atlassian account email address.
 * @param token - Jira API token generated at https://id.atlassian.com/manage-profile/security/api-tokens.
 * @returns The full Authorization header value, e.g. "Basic dXNlckBleGFtcGxlLmNvbTp0b2tlbg==".
 */
export function createAuthHeader(email: string, token: string): string {
  const credentials = `${email}:${token}`;
  const encoded = Buffer.from(credentials).toString("base64");
  return `Basic ${encoded}`;
}
