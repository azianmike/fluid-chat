/**
 * Message text format.
 *
 * Messages are stored as plain text with a small set of stable tokens, the same
 * approach Slack uses: entity references survive renames, and the text remains
 * greppable, exportable, and searchable.
 *
 *   <@user-uuid>            user mention
 *   <#channel-uuid|name>    channel link
 *   <!here> <!channel> <!everyone>   broadcast mention
 *   <!group:group-uuid|handle>       user group mention
 *   <https://example.com|label>      explicit link
 *
 * Formatting supports both Slack (*bold*, _italic_, ~strike~) and common
 * markdown (**bold**, __italic__), plus `code`, ```blocks```, > quotes and lists.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; label: string }
  | { type: "mention"; userId: string }
  | { type: "channel"; channelId: string; name: string }
  | { type: "broadcast"; name: "here" | "channel" | "everyone" }
  | { type: "group"; groupId: string; handle: string }
  | { type: "emoji"; name: string };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "codeblock"; language: string | null; value: string }
  | { type: "quote"; children: BlockNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] };

// `|` and `>` are excluded so the label half of `<url|label>` is never captured.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>()|]+[^\s<>()|.,!?;:'"]/gi;

export function parseMessage(text: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim() || null;
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        buffer.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "codeblock", language, value: buffer.join("\n") });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        buffer.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", children: parseMessage(buffer.join("\n")) });
      continue;
    }

    const listMatch = /^\s*([-*•]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const itemMatch = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (!itemMatch) break;
        if (/\d/.test(itemMatch[1]) !== ordered) break;
        items.push(parseInline(itemMatch[2]));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const buffer: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].trimStart().startsWith("```") &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[index])
    ) {
      buffer.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(buffer.join("\n")) });
  }

  return blocks;
}

type Matcher = {
  pattern: RegExp;
  build: (match: RegExpExecArray) => InlineNode;
};

const matchers: Matcher[] = [
  { pattern: /^`([^`\n]+)`/, build: (match) => ({ type: "code", value: match[1] }) },
  { pattern: /^<@([0-9a-f-]{36})>/i, build: (match) => ({ type: "mention", userId: match[1] }) },
  { pattern: /^<#([0-9a-f-]{36})\|([^>]*)>/i, build: (match) => ({ type: "channel", channelId: match[1], name: match[2] }) },
  {
    pattern: /^<!(here|channel|everyone)>/i,
    build: (match) => ({ type: "broadcast", name: match[1].toLowerCase() as "here" | "channel" | "everyone" })
  },
  {
    pattern: /^<!group:([0-9a-f-]{36})\|([^>]*)>/i,
    build: (match) => ({ type: "group", groupId: match[1], handle: match[2] })
  },
  {
    pattern: /^<(https?:\/\/[^>|\s]+)(?:\|([^>]*))?>/i,
    build: (match) => ({ type: "link", href: match[1], label: match[2] || match[1] })
  },
  { pattern: /^:([a-z0-9_+-]{1,64}):/i, build: (match) => ({ type: "emoji", name: match[1].toLowerCase() }) },
  { pattern: /^\*\*([^\n]+?)\*\*/, build: (match) => ({ type: "bold", children: parseInline(match[1]) }) },
  { pattern: /^\*([^*\n]+?)\*/, build: (match) => ({ type: "bold", children: parseInline(match[1]) }) },
  { pattern: /^__([^\n]+?)__/, build: (match) => ({ type: "italic", children: parseInline(match[1]) }) },
  { pattern: /^_([^_\n]+?)_/, build: (match) => ({ type: "italic", children: parseInline(match[1]) }) },
  { pattern: /^~~([^\n]+?)~~/, build: (match) => ({ type: "strike", children: parseInline(match[1]) }) },
  { pattern: /^~([^~\n]+?)~/, build: (match) => ({ type: "strike", children: parseInline(match[1]) }) },
  {
    pattern: /^(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])/i,
    build: (match) => ({ type: "link", href: match[1], label: match[1] })
  }
];

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let cursor = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (cursor < text.length) {
    const rest = text.slice(cursor);
    let matched = false;
    for (const matcher of matchers) {
      const match = matcher.pattern.exec(rest);
      if (!match || match[0].length === 0) continue;
      flush();
      nodes.push(matcher.build(match));
      cursor += match[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      buffer += text[cursor];
      cursor += 1;
    }
  }

  flush();
  return nodes;
}

/** Plain-text rendering used for notifications, previews, and email. */
export function toPlainText(text: string, resolve?: { user?: (id: string) => string | undefined }) {
  return text
    .replace(/<@([0-9a-f-]{36})>/gi, (_, id: string) => `@${resolve?.user?.(id) ?? "someone"}`)
    .replace(/<#[0-9a-f-]{36}\|([^>]*)>/gi, (_, name: string) => `#${name}`)
    .replace(/<!(here|channel|everyone)>/gi, (_, name: string) => `@${name}`)
    .replace(/<!group:[0-9a-f-]{36}\|([^>]*)>/gi, (_, handle: string) => `@${handle}`)
    .replace(/<(https?:\/\/[^>|\s]+)(?:\|([^>]*))?>/gi, (_, href: string, label: string) => label || href)
    .replace(/```([\s\S]*?)```/g, (_, code: string) => code.trim())
    .replace(/[*_~`]/g, "")
    .trim();
}

export function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) urls.add(match[0]);
  for (const match of text.matchAll(/<(https?:\/\/[^>|\s]+)(?:\|[^>]*)?>/gi)) urls.add(match[1]);
  return Array.from(urls);
}
