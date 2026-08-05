"use client";

import { useMemo, useState } from "react";
import {
  AtSign,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Hash,
  Inbox,
  Lock,
  MessageSquare,
  MoreHorizontal,
  PenSquare,
  Plus,
  Send,
  Users
} from "lucide-react";
import type { ConversationSummary } from "@/shared/types";
import { api } from "../../api";
import { conversationTitle, useApp, useDirectory, type View } from "../../store";
import { Avatar, Badge, MenuDivider, MenuItem, Popover } from "../ui/primitives";

export function Sidebar() {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const workspace = state.bootstrap?.workspace;
  const conversations = state.bootstrap?.conversations ?? [];
  const isAdmin = state.bootstrap?.role === "owner" || state.bootstrap?.role === "admin";

  const groups = useMemo(() => {
    const visible = conversations.filter(
      (conversation) => !conversation.membership?.hidden || conversation.unreadCount > 0
    );
    const starred = visible.filter((conversation) => conversation.membership?.starred);
    const rest = visible.filter((conversation) => !conversation.membership?.starred);
    // Channels read best alphabetically; DMs are most useful most-recent-first.
    const channels = rest
      .filter((conversation) => conversation.type === "channel")
      .sort((a, b) => (a.channel?.name ?? "").localeCompare(b.channel?.name ?? ""));
    const dms = rest
      .filter((conversation) => conversation.type !== "channel")
      .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());
    const sections = (state.bootstrap?.sections ?? []).map((section) => ({
      section,
      items: rest.filter((conversation) => conversation.membership?.sectionId === section.id)
    }));
    const sectioned = new Set(sections.flatMap((entry) => entry.items.map((item) => item.id)));
    return {
      starred,
      sections,
      channels: channels.filter((conversation) => !sectioned.has(conversation.id)),
      dms: dms.filter((conversation) => !sectioned.has(conversation.id))
    };
  }, [conversations, state.bootstrap?.sections]);

  const navItem = (view: View, label: string, icon: React.ReactNode, badge?: number) => {
    const active = state.view.kind === view.kind;
    return (
      <button type="button" className={`side-nav-item ${active ? "is-active" : ""}`} onClick={() => actions.setView(view)}>
        {icon}
        <span>{label}</span>
        {badge ? <Badge count={badge} mention /> : null}
      </button>
    );
  };

  return (
    <nav className="sidebar" aria-label="Workspace navigation">
      <Popover
        width={280}
        trigger={({ toggle, ref }) => (
          <button type="button" className="workspace-button" onClick={toggle} ref={ref}>
            <span className="workspace-name">
              {workspace?.iconEmoji ? <span aria-hidden>{workspace.iconEmoji}</span> : null}
              {workspace?.name ?? "Workspace"}
            </span>
            <ChevronDown size={16} />
          </button>
        )}
      >
        {(close) => (
          <div className="menu">
            <div className="menu-heading">
              <strong>{workspace?.name}</strong>
              <span>{workspace?.slug}</span>
            </div>
            <MenuItem
              onClick={() => {
                actions.setModal({ kind: "invite" });
                close();
              }}
            >
              <Users size={14} /> Invite people
            </MenuItem>
            <MenuItem
              onClick={() => {
                actions.setModal({ kind: "new-channel" });
                close();
              }}
            >
              <Hash size={14} /> Create a channel
            </MenuItem>
            {isAdmin ? (
              <MenuItem
                onClick={() => {
                  actions.setModal({ kind: "admin" });
                  close();
                }}
              >
                <MoreHorizontal size={14} /> Workspace settings
              </MenuItem>
            ) : null}
            <MenuDivider />
            <div className="menu-heading">
              <span>Switch workspace</span>
            </div>
            {state.memberships.map((membership) => (
              <MenuItem
                key={membership.workspace.id}
                onClick={() => {
                  void actions.selectWorkspace(membership.workspace.id);
                  close();
                }}
              >
                <span className="workspace-chip" aria-hidden>
                  {membership.workspace.name.slice(0, 1).toUpperCase()}
                </span>
                {membership.workspace.name}
              </MenuItem>
            ))}
            <MenuItem
              onClick={() => {
                actions.setModal({ kind: "create-workspace" });
                close();
              }}
            >
              <Plus size={14} /> Create a workspace
            </MenuItem>
          </div>
        )}
      </Popover>

      <div className="side-nav">
        {navItem({ kind: "threads" }, "Threads", <MessageSquare size={16} />)}
        {navItem({ kind: "activity" }, "Activity", <AtSign size={16} />, state.unreadNotifications)}
        {navItem({ kind: "unreads" }, "All unreads", <Inbox size={16} />)}
        {navItem({ kind: "drafts" }, "Drafts & sent", <PenSquare size={16} />)}
        {navItem({ kind: "saved" }, "Later", <Bookmark size={16} />)}
        {navItem({ kind: "files" }, "Files", <FileText size={16} />)}
        {navItem({ kind: "people" }, "People", <Users size={16} />)}
      </div>

      <div className="side-scroll">
        {groups.starred.length > 0 ? (
          <SidebarSection
            title="Starred"
            collapsed={collapsed.starred}
            onToggle={() => setCollapsed((value) => ({ ...value, starred: !value.starred }))}
          >
            {groups.starred.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} />
            ))}
          </SidebarSection>
        ) : null}

        {groups.sections.map(({ section, items }) => (
          <SidebarSection
            key={section.id}
            title={section.name}
            collapsed={collapsed[section.id]}
            onToggle={() => setCollapsed((value) => ({ ...value, [section.id]: !value[section.id] }))}
          >
            {items.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} />
            ))}
            {items.length === 0 ? <p className="side-empty">Drag conversations here from their ⋯ menu.</p> : null}
          </SidebarSection>
        ))}

        <SidebarSection
          title="Channels"
          collapsed={collapsed.channels}
          onToggle={() => setCollapsed((value) => ({ ...value, channels: !value.channels }))}
          action={
            <Popover
              width={240}
              align="end"
              trigger={({ toggle, ref }) => (
                <button type="button" className="section-action" ref={ref} onClick={toggle} aria-label="Add channels">
                  <Plus size={14} />
                </button>
              )}
            >
              {(close) => (
                <div className="menu">
                  <MenuItem
                    onClick={() => {
                      actions.setView({ kind: "browse" });
                      close();
                    }}
                  >
                    <Compass size={14} /> Browse channels
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      actions.setModal({ kind: "new-channel" });
                      close();
                    }}
                  >
                    <Plus size={14} /> Create a channel
                  </MenuItem>
                </div>
              )}
            </Popover>
          }
        >
          {groups.channels.map((conversation) => (
            <ConversationRow key={conversation.id} conversation={conversation} />
          ))}
          <button type="button" className="side-row is-muted" onClick={() => actions.setView({ kind: "browse" })}>
            <Plus size={15} />
            <span className="side-label">Add channels</span>
          </button>
        </SidebarSection>

        <SidebarSection
          title="Direct messages"
          collapsed={collapsed.dms}
          onToggle={() => setCollapsed((value) => ({ ...value, dms: !value.dms }))}
          action={
            <button
              type="button"
              className="section-action"
              onClick={() => actions.setModal({ kind: "new-dm" })}
              aria-label="New direct message"
            >
              <Plus size={14} />
            </button>
          }
        >
          {groups.dms.map((conversation) => (
            <ConversationRow key={conversation.id} conversation={conversation} />
          ))}
          {groups.dms.length === 0 ? (
            <button type="button" className="side-row is-muted" onClick={() => actions.setModal({ kind: "new-dm" })}>
              <Send size={15} />
              <span className="side-label">Start a conversation</span>
            </button>
          ) : null}
        </SidebarSection>
      </div>

      {state.session ? (
        <div className="sidebar-footer">
          <Avatar user={state.session} size={26} />
          <span className="side-label">{state.session.displayName}</span>
          {!state.connected ? <span className="connection-dot" title="Reconnecting…" /> : null}
        </div>
      ) : null}
    </nav>
  );
}

function SidebarSection({
  title,
  children,
  collapsed,
  onToggle,
  action
}: {
  title: string;
  children: React.ReactNode;
  collapsed?: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <section className="side-section">
      <div className="side-section-head">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          {title}
        </button>
        {action}
      </div>
      {!collapsed ? <div className="side-section-body">{children}</div> : null}
    </section>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const active = state.view.kind === "conversation" && state.view.conversationId === conversation.id;
  const unread = conversation.unreadCount > 0;
  const title = conversationTitle(conversation, directory, state.session?.id);
  const otherId = conversation.memberIds.find((id) => id !== state.session?.id);
  const other = conversation.type === "dm" && otherId ? directory.get(otherId) : undefined;
  const draft = state.drafts[`${conversation.id}:root`];

  return (
    <div className={`side-row-wrap ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className={`side-row ${unread ? "is-unread" : ""}`}
        onClick={() => void actions.openConversation(conversation.id)}
      >
        {conversation.channel ? (
          conversation.channel.visibility === "private" ? (
            <Lock size={14} />
          ) : (
            <Hash size={15} />
          )
        ) : conversation.type === "group_dm" ? (
          <Users size={15} />
        ) : (
          <Avatar user={other} size={20} />
        )}
        <span className="side-label">{title}</span>
        {draft?.trim() ? <span className="draft-dot" title="Unsent draft" /> : null}
        {conversation.mentionCount > 0 ? (
          <Badge count={conversation.mentionCount} mention />
        ) : conversation.unreadCount > 0 ? (
          <Badge count={conversation.unreadCount} />
        ) : null}
      </button>

      <Popover
        width={240}
        align="end"
        trigger={({ toggle, ref }) => (
          <button type="button" className="side-row-menu" ref={ref} onClick={toggle} aria-label={`Options for ${title}`}>
            <MoreHorizontal size={14} />
          </button>
        )}
      >
        {(close) => (
          <div className="menu">
            <MenuItem
              onClick={async () => {
                close();
                await api.conversations.updateMembership(conversation.id, {
                  starred: !conversation.membership?.starred
                });
                await actions.refreshConversations();
              }}
            >
              {conversation.membership?.starred ? "Remove from starred" : "Star conversation"}
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close();
                await api.conversations.updateMembership(conversation.id, { muted: !conversation.membership?.muted });
                await actions.refreshConversations();
              }}
            >
              {conversation.membership?.muted ? "Unmute conversation" : "Mute conversation"}
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close();
                await api.conversations.markRead(conversation.id);
                await actions.refreshConversations();
              }}
            >
              Mark as read
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close();
                await api.conversations.markUnread(conversation.id);
                await actions.refreshConversations();
              }}
            >
              Mark as unread
            </MenuItem>
            {state.bootstrap?.sections.length ? <MenuDivider /> : null}
            {state.bootstrap?.sections.map((section) => (
              <MenuItem
                key={section.id}
                onClick={async () => {
                  close();
                  await api.conversations.updateMembership(conversation.id, { sectionId: section.id });
                  await actions.refreshConversations();
                }}
              >
                Move to {section.name}
              </MenuItem>
            ))}
            <MenuDivider />
            {conversation.type === "channel" && conversation.channel ? (
              <MenuItem
                danger
                onClick={async () => {
                  close();
                  try {
                    await api.channels.leave(conversation.channel!.id);
                    await actions.refreshBootstrap();
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                Leave channel
              </MenuItem>
            ) : (
              <MenuItem
                onClick={async () => {
                  close();
                  await api.conversations.updateMembership(conversation.id, { hidden: true });
                  await actions.refreshConversations();
                }}
              >
                Close conversation
              </MenuItem>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}
