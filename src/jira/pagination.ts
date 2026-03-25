/**
 * Generic pagination helper for Jira REST API endpoints.
 *
 * Many Jira endpoints return paginated results. This async generator
 * transparently fetches all pages and yields items one by one.
 */

/** Shape of a single page returned by the fetch callback. */
export interface PageResult<T> {
  /** Index of the first item on this page. */
  startAt: number;
  /** Total number of items matching the query. */
  total: number;
  /** Items on this page. */
  items: T[];
}

/**
 * Async generator that fetches all pages from a paginated Jira endpoint
 * and yields items individually.
 *
 * @param fetchPage - Callback that retrieves a single page given startAt and maxResults.
 * @param maxResults - Page size per request (defaults to 50).
 * @yields Individual items of type T from all pages.
 *
 * @example
 * ```ts
 * for await (const issue of paginateAll((s, m) => client.searchPage(jql, s, m))) {
 *   console.log(issue.key);
 * }
 * ```
 */
export async function* paginateAll<T>(
  fetchPage: (startAt: number, maxResults: number) => Promise<PageResult<T>>,
  maxResults: number = 50,
): AsyncGenerator<T> {
  let startAt = 0;

  while (true) {
    const page = await fetchPage(startAt, maxResults);

    for (const item of page.items) {
      yield item;
    }

    startAt += page.items.length;

    // Stop when we have fetched all items or received an empty page.
    if (startAt >= page.total || page.items.length === 0) {
      break;
    }
  }
}
