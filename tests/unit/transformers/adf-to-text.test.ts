import { describe, it, expect } from "vitest";
import { adfToText } from "../../../src/transformers/adf-to-text.js";
import type { AdfNode } from "../../../src/transformers/adf-to-text.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Shorthand to create a doc node wrapping arbitrary content. */
function doc(...content: AdfNode[]): AdfNode {
  return { type: "doc", content };
}

/** Shorthand to create a paragraph containing text nodes. */
function para(...content: AdfNode[]): AdfNode {
  return { type: "paragraph", content };
}

/** Shorthand to create a plain text node. */
function text(value: string, marks?: AdfNode["marks"]): AdfNode {
  return { type: "text", text: value, marks };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("adfToText", () => {
  /* ── Null / empty ────────────────────────────────────────────────── */

  it("returns empty string for null input", () => {
    expect(adfToText(null)).toBe("");
  });

  it("returns empty string for empty doc", () => {
    expect(adfToText(doc())).toBe("");
  });

  /* ── Paragraphs ──────────────────────────────────────────────────── */

  it("renders a simple paragraph", () => {
    const result = adfToText(doc(para(text("Hello world"))));
    expect(result).toBe("Hello world");
  });

  it("renders multiple paragraphs", () => {
    const result = adfToText(doc(para(text("First")), para(text("Second"))));
    expect(result).toBe("First\nSecond");
  });

  /* ── Headings ────────────────────────────────────────────────────── */

  it("renders heading level 1", () => {
    const node = doc({
      type: "heading",
      attrs: { level: 1 },
      content: [text("Title")],
    });
    expect(adfToText(node)).toBe("# Title");
  });

  it("renders heading level 2", () => {
    const node = doc({
      type: "heading",
      attrs: { level: 2 },
      content: [text("Subtitle")],
    });
    expect(adfToText(node)).toBe("## Subtitle");
  });

  it("renders heading level 3", () => {
    const node = doc({
      type: "heading",
      attrs: { level: 3 },
      content: [text("Section")],
    });
    expect(adfToText(node)).toBe("### Section");
  });

  /* ── Inline marks ────────────────────────────────────────────────── */

  it("renders bold text", () => {
    const result = adfToText(doc(para(text("bold", [{ type: "strong" }]))));
    expect(result).toBe("**bold**");
  });

  it("renders italic text", () => {
    const result = adfToText(doc(para(text("italic", [{ type: "em" }]))));
    expect(result).toBe("*italic*");
  });

  it("renders inline code", () => {
    const result = adfToText(doc(para(text("code", [{ type: "code" }]))));
    expect(result).toBe("`code`");
  });

  it("renders link with URL", () => {
    const result = adfToText(
      doc(
        para(
          text("click here", [
            { type: "link", attrs: { href: "https://example.com" } },
          ]),
        ),
      ),
    );
    expect(result).toBe("click here (https://example.com)");
  });

  /* ── Lists ───────────────────────────────────────────────────────── */

  it("renders a bullet list", () => {
    const node = doc({
      type: "bulletList",
      content: [
        { type: "listItem", content: [para(text("Alpha"))] },
        { type: "listItem", content: [para(text("Beta"))] },
      ],
    });
    expect(adfToText(node)).toBe("- Alpha\n- Beta");
  });

  it("renders an ordered list", () => {
    const node = doc({
      type: "orderedList",
      content: [
        { type: "listItem", content: [para(text("First"))] },
        { type: "listItem", content: [para(text("Second"))] },
        { type: "listItem", content: [para(text("Third"))] },
      ],
    });
    expect(adfToText(node)).toBe("1. First\n2. Second\n3. Third");
  });

  it("renders a nested list", () => {
    const node = doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            para(text("Parent")),
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [para(text("Child"))] }],
            },
          ],
        },
      ],
    });
    const result = adfToText(node);
    expect(result).toContain("- Parent");
    expect(result).toContain("Child");
  });

  /* ── Code block ──────────────────────────────────────────────────── */

  it("renders a code block with language", () => {
    const node = doc({
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [text("const x = 1;")],
    });
    expect(adfToText(node)).toBe("```typescript\nconst x = 1;\n```");
  });

  it("renders a code block without language", () => {
    const node = doc({
      type: "codeBlock",
      content: [text("echo hello")],
    });
    expect(adfToText(node)).toBe("```\necho hello\n```");
  });

  /* ── Blockquote ──────────────────────────────────────────────────── */

  it("renders a blockquote", () => {
    const node = doc({
      type: "blockquote",
      content: [para(text("Quoted text"))],
    });
    expect(adfToText(node)).toBe("> Quoted text");
  });

  /* ── Mention ─────────────────────────────────────────────────────── */

  it("renders a mention", () => {
    const node = doc(para({ type: "mention", attrs: { text: "John Doe" } }));
    expect(adfToText(node)).toBe("@John Doe");
  });

  /* ── Emoji ───────────────────────────────────────────────────────── */

  it("renders an emoji", () => {
    const node = doc(
      para({ type: "emoji", attrs: { shortName: ":thumbsup:" } }),
    );
    expect(adfToText(node)).toBe(":thumbsup:");
  });

  /* ── Rule ────────────────────────────────────────────────────────── */

  it("renders a horizontal rule", () => {
    const node = doc(
      para(text("Above")),
      { type: "rule" },
      para(text("Below")),
    );
    expect(adfToText(node)).toContain("---");
  });

  /* ── Hard break ──────────────────────────────────────────────────── */

  it("renders a hard break", () => {
    const result = adfToText(
      doc(para(text("Line 1"), { type: "hardBreak" }, text("Line 2"))),
    );
    expect(result).toBe("Line 1\nLine 2");
  });

  /* ── Table ───────────────────────────────────────────────────────── */

  it("renders a simple table", () => {
    const node = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [para(text("Name"))] },
            { type: "tableHeader", content: [para(text("Value"))] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [para(text("A"))] },
            { type: "tableCell", content: [para(text("1"))] },
          ],
        },
      ],
    });
    const result = adfToText(node);
    expect(result).toContain("| Name | Value |");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain("| A | 1 |");
  });

  /* ── Media ───────────────────────────────────────────────────────── */

  it("renders media as placeholder", () => {
    const node = doc({ type: "mediaSingle", content: [{ type: "media" }] });
    expect(adfToText(node)).toBe("[media]");
  });

  /* ── Panel ───────────────────────────────────────────────────────── */

  it("renders a panel with type", () => {
    const node = doc({
      type: "panel",
      attrs: { panelType: "warning" },
      content: [para(text("Be careful"))],
    });
    expect(adfToText(node)).toBe("[WARNING] Be careful");
  });

  /* ── Expand ──────────────────────────────────────────────────────── */

  it("renders an expand with title", () => {
    const node = doc({
      type: "expand",
      attrs: { title: "Details" },
      content: [para(text("Hidden content"))],
    });
    const result = adfToText(node);
    expect(result).toContain("Details");
    expect(result).toContain("Hidden content");
  });

  /* ── Complex document ────────────────────────────────────────────── */

  it("handles a complex document with mixed node types", () => {
    const node = doc(
      { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
      para(text("Some "), text("bold", [{ type: "strong" }]), text(" text.")),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para(text("Item A"))] },
          { type: "listItem", content: [para(text("Item B"))] },
        ],
      },
      { type: "rule" },
      para(text("End.")),
    );

    const result = adfToText(node);
    expect(result).toContain("# Title");
    expect(result).toContain("**bold**");
    expect(result).toContain("- Item A");
    expect(result).toContain("---");
    expect(result).toContain("End.");
  });

  /* ── Unknown node ────────────────────────────────────────────────── */

  it("does not crash on unknown node types", () => {
    const node = doc({
      type: "totallyUnknown",
      content: [para(text("fallback"))],
    });
    expect(adfToText(node)).toBe("fallback");
  });

  it("returns empty string for unknown node without children", () => {
    const node = doc({ type: "totallyUnknown" });
    expect(adfToText(node)).toBe("");
  });
});
