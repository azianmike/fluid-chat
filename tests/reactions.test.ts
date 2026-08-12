import { describe, expect, it } from "vitest";
import { groupReactions, toggleReactionGroup, withReacted } from "@/shared/reactions";
import type { ReactionGroup } from "@/shared/types";

const alice = { id: "alice", displayName: "Alice" };
const bob = { id: "bob", displayName: "Bob" };

function groupsOf(...rows: Array<{ emoji: string; id: string; displayName: string }>) {
  return rows.reduce(groupReactions, [] as ReactionGroup[]);
}

describe("reaction groups", () => {
  it("collects reactors per emoji in the order they reacted", () => {
    const groups = groupsOf(
      { emoji: "🎉", ...alice },
      { emoji: "👍", ...bob },
      { emoji: "🎉", ...bob }
    );
    expect(groups.map((group) => [group.emoji, group.count])).toEqual([
      ["🎉", 2],
      ["👍", 1]
    ]);
    expect(groups[0].users).toEqual([alice, bob]);
  });

  it("resolves `reacted` per viewer rather than per payload", () => {
    // The regression: one set of groups is broadcast to the whole room, so each
    // client has to decide for itself whether it is in the reactor list.
    const groups = groupsOf({ emoji: "🎉", ...alice });
    expect(withReacted(groups, "alice")[0].reacted).toBe(true);
    expect(withReacted(groups, "bob")[0].reacted).toBe(false);
    expect(withReacted(groups, undefined)[0].reacted).toBe(false);
  });

  it("does not let one viewer's flag leak into another's", () => {
    const groups = groupsOf({ emoji: "🎉", ...alice });
    withReacted(groups, "alice");
    expect(withReacted(groups, "bob")[0].reacted).toBe(false);
  });
});

describe("optimistic toggle", () => {
  it("adds a new emoji at the end of the row", () => {
    const next = toggleReactionGroup(groupsOf({ emoji: "🎉", ...alice }), "👍", bob, false);
    expect(next.map((group) => group.emoji)).toEqual(["🎉", "👍"]);
    expect(withReacted(next, "bob")).toEqual([
      { emoji: "🎉", count: 1, users: [alice], reacted: false },
      { emoji: "👍", count: 1, users: [bob], reacted: true }
    ]);
  });

  it("joins an existing group without disturbing its position", () => {
    const groups = groupsOf({ emoji: "🎉", ...alice }, { emoji: "👍", ...alice });
    const next = toggleReactionGroup(groups, "🎉", bob, false);
    expect(next[0]).toEqual({ emoji: "🎉", count: 2, users: [alice, bob] });
  });

  it("is a no-op when the viewer already reacted, matching the unique index", () => {
    const groups = groupsOf({ emoji: "🎉", ...alice });
    expect(toggleReactionGroup(groups, "🎉", alice, false)).toEqual(groups);
  });

  it("removes only the viewer, keeping the group alive for everyone else", () => {
    const groups = groupsOf({ emoji: "🎉", ...alice }, { emoji: "🎉", ...bob });
    const next = toggleReactionGroup(groups, "🎉", bob, true);
    expect(next).toEqual([{ emoji: "🎉", count: 1, users: [alice] }]);
  });

  it("drops a group once its last reactor leaves", () => {
    const next = toggleReactionGroup(groupsOf({ emoji: "🎉", ...alice }), "🎉", alice, true);
    expect(next).toEqual([]);
  });

  it("stores only the reactor's identity, not the rest of the session user", () => {
    const session = { ...bob, email: "bob@example.com", phone: "555-0100" };
    const [group] = toggleReactionGroup([], "🎉", session, false);
    expect(group.users).toEqual([bob]);
  });

  it("leaves the input untouched so a failed request can roll back", () => {
    const groups = groupsOf({ emoji: "🎉", ...alice });
    toggleReactionGroup(groups, "🎉", bob, false);
    toggleReactionGroup(groups, "🎉", alice, true);
    expect(groups).toEqual([{ emoji: "🎉", count: 1, users: [alice] }]);
  });
});
