/**
 * Atlassian Document Format (ADF) to plain-text/markdown converter.
 *
 * ADF is a JSON tree structure used by Jira Cloud for rich-text fields
 * such as issue descriptions and comments.  This module converts an ADF
 * tree into a human-readable plain-text string with light markdown
 * formatting so that AI agents can consume it easily.
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

/* ------------------------------------------------------------------ */
/*  ADF type definitions                                               */
/* ------------------------------------------------------------------ */

/** A mark (inline decoration) applied to a text node. */
export interface AdfMark {
  /** Mark type, e.g. "strong", "em", "code", "link". */
  type: string;
  /** Optional attributes (e.g. href for links). */
  attrs?: Record<string, unknown>;
}

/** A single node in the ADF tree. */
export interface AdfNode {
  /** Node type, e.g. "doc", "paragraph", "text". */
  type: string;
  /** Child nodes (block or inline). */
  content?: AdfNode[];
  /** Text payload (only for "text" nodes). */
  text?: string;
  /** Node-level attributes (e.g. heading level, language). */
  attrs?: Record<string, unknown>;
  /** Inline marks applied to this node. */
  marks?: AdfMark[];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Convert an ADF tree to a plain-text/markdown string.
 *
 * @param adf - Root ADF node (typically `type: "doc"`), or `null`.
 * @returns The converted text. Returns an empty string for `null` input.
 */
export function adfToText(adf: AdfNode | null): string {
  if (!adf) return "";
  return processNode(adf).trimEnd();
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/** Recursively convert a single ADF node to text. */
function processNode(node: AdfNode): string {
  switch (node.type) {
    case "doc":
      return processChildren(node);

    case "paragraph":
      return processChildren(node) + "\n";

    case "text":
      return processTextNode(node);

    case "heading":
      return processHeading(node);

    case "bulletList":
      return processBulletList(node);

    case "orderedList":
      return processOrderedList(node);

    case "listItem":
      return processChildren(node);

    case "codeBlock":
      return processCodeBlock(node);

    case "blockquote":
      return processBlockquote(node);

    case "rule":
      return "---\n";

    case "hardBreak":
      return "\n";

    case "mention":
      return `@${(node.attrs?.text as string) ?? "unknown"}`;

    case "emoji":
      return (
        (node.attrs?.shortName as string) ?? (node.attrs?.text as string) ?? ""
      );

    case "table":
      return processTable(node);

    case "tableRow":
      return processChildren(node);

    case "tableCell":
    case "tableHeader":
      return processChildren(node);

    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "[media]";

    case "panel":
      return processPanel(node);

    case "expand":
      return processExpand(node);

    default:
      // Unknown node — try to recurse into children.
      return node.content ? processChildren(node) : "";
  }
}

/** Process all children of a node and concatenate the results. */
function processChildren(node: AdfNode): string {
  if (!node.content) return "";
  return node.content.map(processNode).join("");
}

/** Render a text node, applying any inline marks. */
function processTextNode(node: AdfNode): string {
  let text = node.text ?? "";

  if (!node.marks || node.marks.length === 0) return text;

  for (const mark of node.marks) {
    switch (mark.type) {
      case "strong":
        text = `**${text}**`;
        break;
      case "em":
        text = `*${text}*`;
        break;
      case "code":
        text = `\`${text}\``;
        break;
      case "link": {
        const href = mark.attrs?.href as string | undefined;
        if (href) {
          text = `${text} (${href})`;
        }
        break;
      }
      // Other marks (e.g. underline, strike) are passed through unchanged.
    }
  }

  return text;
}

/** Render a heading node (e.g. `## Heading`). */
function processHeading(node: AdfNode): string {
  const level = (node.attrs?.level as number) ?? 1;
  const prefix = "#".repeat(level);
  return `${prefix} ${processChildren(node)}\n`;
}

/** Render a bullet list. */
function processBulletList(node: AdfNode): string {
  if (!node.content) return "";
  return node.content
    .map((item) => prefixListItem("- ", processChildren(item)))
    .join("");
}

/** Render an ordered list. */
function processOrderedList(node: AdfNode): string {
  if (!node.content) return "";
  return node.content
    .map((item, idx) => prefixListItem(`${idx + 1}. `, processChildren(item)))
    .join("");
}

/**
 * Prefix each line of a list item's text.
 *
 * The first line gets the bullet/number prefix; continuation lines are
 * indented by the same width so nested content aligns properly.
 */
function prefixListItem(prefix: string, text: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  const indent = " ".repeat(prefix.length);
  return (
    lines
      .map((line, i) => (i === 0 ? `${prefix}${line}` : `${indent}${line}`))
      .join("\n") + "\n"
  );
}

/** Render a fenced code block. */
function processCodeBlock(node: AdfNode): string {
  const lang = (node.attrs?.language as string) ?? "";
  const code = processChildren(node).replace(/\n$/, "");
  return `\`\`\`${lang}\n${code}\n\`\`\`\n`;
}

/** Render a blockquote by prefixing every line with "> ". */
function processBlockquote(node: AdfNode): string {
  const inner = processChildren(node).replace(/\n$/, "");
  return (
    inner
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n") + "\n"
  );
}

/** Render a table as a markdown table (best effort). */
function processTable(node: AdfNode): string {
  if (!node.content) return "";

  const rows: string[][] = [];

  for (const row of node.content) {
    if (row.type !== "tableRow" || !row.content) continue;
    const cells = row.content.map((cell) =>
      processChildren(cell).replace(/\n/g, " ").trim(),
    );
    rows.push(cells);
  }

  if (rows.length === 0) return "";

  // Determine column widths.
  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    // Pad row to colCount.
    while (rows[i].length < colCount) rows[i].push("");
    lines.push(`| ${rows[i].join(" | ")} |`);

    // Insert separator after the header row.
    if (i === 0) {
      lines.push(`| ${rows[i].map(() => "---").join(" | ")} |`);
    }
  }

  return lines.join("\n") + "\n";
}

/** Render a panel (info, note, warning, etc.). */
function processPanel(node: AdfNode): string {
  const panelType = (node.attrs?.panelType as string) ?? "info";
  const inner = processChildren(node).replace(/\n$/, "");
  return `[${panelType.toUpperCase()}] ${inner}\n`;
}

/** Render an expand/collapse section. */
function processExpand(node: AdfNode): string {
  const title = (node.attrs?.title as string) ?? "";
  const inner = processChildren(node);
  return title ? `${title}\n${inner}` : inner;
}
