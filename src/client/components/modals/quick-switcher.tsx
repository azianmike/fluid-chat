"use client";

import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, Search, Users } from "lucide-react";
import { conversationTitle, useApp, useDirectory } from "../../store";
import { Avatar, Modal } from "../ui/primitives";

type Entry = { id: string; label: string; hint?: string; run: () => void; icon: React.ReactNode };

/** ⌘K: jump to any conversation, person, or view without leaving the keyboard. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    for (const conversation of state.bootstrap?.conversations ?? []) {
      const label = conversationTitle(conversation, directory, state.session?.id);
      list.push({
        id: conversation.id,
        label: conversation.channel ? `#${label}` : label,
        hint: conversation.channel?.topic ?? undefined,
        icon: conversation.channel ? (
          conversation.channel.visibility === "private" ? (
            <Lock size={14} />
          ) : (
            <Hash size={15} />
          )
        ) : (
          <Users size={15} />
        ),
        run: () => void actions.openConversation(conversation.id)
      });
    }
    for (const channel of state.bootstrap?.channels ?? []) {
      if ((state.bootstrap?.conversations ?? []).some((entry) => entry.channelId === channel.id)) continue;
      list.push({
        id: channel.id,
        label: `#${channel.name}`,
        hint: "Not joined",
        icon: <Hash size={15} />,
        run: () => void actions.openConversation(channel.conversationId)
      });
    }
    for (const member of state.bootstrap?.members ?? []) {
      if (member.user.id === state.session?.id) continue;
      list.push({
        id: `user-${member.user.id}`,
        label: member.user.displayName,
        hint: member.user.title ?? undefined,
        icon: <Avatar user={member.user} size={20} presence={false} />,
        run: async () => {
          if (!state.workspaceId) return;
          const { conversation } = await import("../../api").then(({ api }) =>
            api.conversations.openDm(state.workspaceId!, [member.user.id])
          );
          await actions.refreshBootstrap();
          await actions.openConversation(conversation.id);
        }
      });
    }
    const views: Array<[string, () => void]> = [
      ["Go to Threads", () => actions.setView({ kind: "threads" })],
      ["Go to Activity", () => actions.setView({ kind: "activity" })],
      ["Go to All unreads", () => actions.setView({ kind: "unreads" })],
      ["Go to Drafts & sent", () => actions.setView({ kind: "drafts" })],
      ["Go to Later", () => actions.setView({ kind: "saved" })],
      ["Browse channels", () => actions.setView({ kind: "browse" })],
      ["Open preferences", () => actions.setModal({ kind: "preferences" })],
      ["Invite people", () => actions.setModal({ kind: "invite" })]
    ];
    for (const [label, run] of views) {
      list.push({ id: label, label, icon: <Search size={14} />, run });
    }
    return list;
  }, [actions, directory, state.bootstrap, state.session?.id, state.workspaceId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^[#@]/, "");
    if (!term) return entries.slice(0, 12);
    return entries.filter((entry) => entry.label.toLowerCase().replace(/^[#@]/, "").includes(term)).slice(0, 20);
  }, [entries, query]);

  useEffect(() => setIndex(0), [query]);

  return (
    <Modal title="Jump to" onClose={onClose} width={560} align="top">
      <div className="quick-switcher">
        <div className="search-field">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search channels, people and commands"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => (value + 1) % Math.max(filtered.length, 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => (value - 1 + filtered.length) % Math.max(filtered.length, 1));
              }
              if (event.key === "Enter" && filtered[index]) {
                event.preventDefault();
                filtered[index].run();
                onClose();
              }
            }}
          />
        </div>
        <ul className="quick-list" role="listbox">
          {filtered.map((entry, entryIndex) => (
            <li key={entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={entryIndex === index}
                className={entryIndex === index ? "is-active" : ""}
                onMouseEnter={() => setIndex(entryIndex)}
                onClick={() => {
                  entry.run();
                  onClose();
                }}
              >
                {entry.icon}
                <span className="quick-label">{entry.label}</span>
                {entry.hint ? <span className="quick-hint">{entry.hint}</span> : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? <li className="quick-empty">Nothing matches “{query}”.</li> : null}
        </ul>
      </div>
    </Modal>
  );
}
