/**
 * Display form of message text.
 *
 * Messages travel and are stored in the token format described in
 * `markdown.ts` — `<@uuid>`, `<#uuid|name>` — because ids survive renames. That
 * format is unreadable in an editing surface: picking "Bob" from the composer's
 * autocomplete used to drop 39 characters of UUID into the textarea, so you
 * could not proofread what you wrote, and one backspace silently broke the
 * mention.
 *
 * So editing surfaces hold the *display* form (`@bob`, `#general`) and convert
 * at the boundary: `toMentionDisplay` on the way in, `toMentionWire` on the way
 * out. When a label no longer resolves — the user retyped it, the person was
 * renamed — it degrades to a plain `@handle`, which the server still resolves
 * in `resolveMentionedUserIds`.
 */

export type MentionUser = { id: string; displayName: string; handle: string | null };

export type MentionDirectory = {
  users: MentionUser[];
  groups: Array<{ id: string; handle: string }>;
  channels: Array<{ id: string; name: string }>;
};

export const EMPTY_MENTION_DIRECTORY: MentionDirectory = { users: [], groups: [], channels: [] };

const BROADCASTS = ["here", "channel", "everyone"] as const;

/** Characters a label may contain — mirrors the server's handle pattern, plus letters outside ASCII. */
const LABEL_CHARS = "\\p{L}\\p{N}._-";
const LABEL_PATTERN = new RegExp(`(^|[\\s(])([@#])([${LABEL_CHARS}]{1,64})`, "gu");

/** Code spans and fences are captured so they can be passed through untouched. */
const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/;

/**
 * The text a person types to mention someone: their handle, else their display
 * name with spaces turned into dots — both forms the server can resolve on its
 * own if the token rewrite below ever misses.
 */
export function userMentionLabel(user: { displayName: string; handle: string | null }): string {
  if (user.handle) return user.handle.toLowerCase();
  return user.displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(new RegExp(`[^${LABEL_CHARS}]`, "gu"), "");
}

function mapOutsideCode(text: string, transform: (chunk: string) => string): string {
  // A capturing split puts the code segments at the odd indices.
  return text
    .split(CODE_SEGMENT)
    .map((chunk, index) => (index % 2 === 1 ? chunk : transform(chunk)))
    .join("");
}

/** Wire tokens → the text shown in a composer or edit box. */
export function toMentionDisplay(wire: string, directory: MentionDirectory): string {
  const labelById = new Map(directory.users.map((user) => [user.id.toLowerCase(), userMentionLabel(user)]));

  return mapOutsideCode(wire, (chunk) =>
    chunk
      // An id nobody in the directory matches is left alone rather than
      // flattened to a name we cannot turn back into an id.
      .replace(/<@([0-9a-f-]{36})>/gi, (token, id: string) => {
        const label = labelById.get(id.toLowerCase());
        return label ? `@${label}` : token;
      })
      .replace(/<!group:[0-9a-f-]{36}\|([^>]*)>/gi, (_, handle: string) => `@${handle}`)
      .replace(/<!(here|channel|everyone)>/gi, (_, name: string) => `@${name.toLowerCase()}`)
      .replace(/<#[0-9a-f-]{36}\|([^>]*)>/gi, (_, name: string) => `#${name}`)
  );
}

/** Typed text → the wire tokens that get stored and sent. */
export function toMentionWire(display: string, directory: MentionDirectory): string {
  const people = new Map<string, string>();
  for (const user of directory.users) {
    const label = userMentionLabel(user);
    if (label && !people.has(label)) people.set(label, `<@${user.id}>`);
  }
  for (const group of directory.groups) {
    const label = group.handle.toLowerCase();
    if (!people.has(label)) people.set(label, `<!group:${group.id}|${group.handle}>`);
  }
  for (const name of BROADCASTS) people.set(name, `<!${name}>`);

  const channels = new Map<string, string>();
  for (const channel of directory.channels) {
    const label = channel.name.toLowerCase();
    if (!channels.has(label)) channels.set(label, `<#${channel.id}|${channel.name}>`);
  }

  return mapOutsideCode(display, (chunk) =>
    chunk.replace(LABEL_PATTERN, (match, lead: string, symbol: string, label: string) => {
      const table = symbol === "@" ? people : channels;
      let name = label.toLowerCase();
      let trailing = "";
      // `@bob.` and `@bob-` end sentences as often as they end handles, so give
      // back trailing punctuation one character at a time until a label matches.
      while (!table.has(name)) {
        if (!/[._-]$/.test(name)) return match;
        trailing = `${name.slice(-1)}${trailing}`;
        name = name.slice(0, -1);
      }
      return `${lead}${table.get(name)}${trailing}`;
    })
  );
}
