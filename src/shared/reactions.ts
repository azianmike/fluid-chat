/**
 * How reaction groups are built, ordered and pruned — shared so the server's
 * hydration, its realtime broadcasts and the client's optimistic update all
 * produce the same shape, and a chip never jumps when the server confirms.
 *
 * The central rule: a group is viewer-independent. `reacted` is the one piece
 * of per-viewer state and is stamped on last, by whoever knows the viewer.
 */
import type { ReactionGroup, ReactionSummary } from "./types";

export type Reactor = { id: string; displayName: string };

/**
 * Folds one reaction into its emoji's group, mutating `groups` in place.
 * Reactions must arrive oldest-first so groups end up ordered by who reacted
 * first, which is the order the chips render in.
 */
export function groupReactions(groups: ReactionGroup[], row: Reactor & { emoji: string }): ReactionGroup[] {
  const existing = groups.find((group) => group.emoji === row.emoji);
  if (existing) {
    existing.count += 1;
    existing.users.push({ id: row.id, displayName: row.displayName });
  } else {
    groups.push({ emoji: row.emoji, count: 1, users: [{ id: row.id, displayName: row.displayName }] });
  }
  return groups;
}

/** Stamps the per-viewer `reacted` flag onto viewer-independent groups. */
export function withReacted(groups: ReactionGroup[], viewerId: string | undefined): ReactionSummary[] {
  return groups.map((group) => ({ ...group, reacted: group.users.some((user) => user.id === viewerId) }));
}

/**
 * The groups as they will look once the server has applied a toggle, so an
 * optimistic update and the broadcast that follows it agree: a new emoji lands
 * at the end, and a group nobody is left in disappears.
 */
export function toggleReactionGroup(
  groups: ReactionGroup[],
  emoji: string,
  user: Reactor,
  remove: boolean
): ReactionGroup[] {
  // Narrowed rather than stored as-is: callers pass the whole session user, and
  // the rest of the session has no business sitting in a reaction list.
  const reactor = { id: user.id, displayName: user.displayName };
  if (remove) {
    return groups
      .map((group) =>
        group.emoji === emoji
          ? { ...group, count: group.count - 1, users: group.users.filter((entry) => entry.id !== user.id) }
          : group
      )
      .filter((group) => group.count > 0);
  }
  if (groups.some((group) => group.emoji === emoji && group.users.some((entry) => entry.id === user.id))) {
    return groups;
  }
  if (!groups.some((group) => group.emoji === emoji)) {
    return [...groups, { emoji, count: 1, users: [reactor] }];
  }
  return groups.map((group) =>
    group.emoji === emoji ? { ...group, count: group.count + 1, users: [...group.users, reactor] } : group
  );
}
