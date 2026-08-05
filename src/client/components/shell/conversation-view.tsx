"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  BellOff,
  CalendarDays,
  FileText,
  Hash,
  Info,
  Lock,
  Pin,
  Plus,
  Star,
  UserPlus,
  Users
} from "lucide-react";
import type { BookmarkDto } from "@/shared/types";
import { api } from "../../api";
import { conversationTitle, useApp, useDirectory } from "../../store";
import { Avatar, IconButton, MenuDivider, MenuItem, Popover } from "../ui/primitives";
import { Composer } from "../message/composer";
import { MessageList } from "../message/message-list";

export function ConversationView({ conversationId }: { conversationId: string }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === conversationId);
  const channel = conversation?.channel;
  const [bookmarks, setBookmarks] = useState<BookmarkDto[]>([]);
  const title = conversationTitle(conversation ?? null, directory, state.session?.id);
  const joined = conversation?.membership?.joined ?? false;
  const dmPartnerId =
    conversation?.type === "dm" ? conversation.memberIds.find((id) => id !== state.session?.id) : undefined;

  useEffect(() => {
    if (!channel) {
      setBookmarks([]);
      return;
    }
    api.channels
      .bookmarks(channel.id)
      .then(({ bookmarks: list }) => setBookmarks(list))
      .catch(() => setBookmarks([]));
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!conversation) {
    return (
      <section className="conversation">
        <div className="conversation-empty">This conversation is no longer available.</div>
      </section>
    );
  }

  const memberAvatars = conversation.memberIds.slice(0, 4);

  return (
    <section className="conversation">
      <header className="conversation-header">
        <div className="conversation-title">
          <h1>
            {channel ? (
              channel.visibility === "private" ? (
                <Lock size={16} />
              ) : (
                <Hash size={18} />
              )
            ) : dmPartnerId ? (
              <Avatar user={directory.get(dmPartnerId)} size={22} />
            ) : (
              <Users size={16} />
            )}
            {title}
          </h1>
          <button
            type="button"
            className={`star-toggle ${conversation.membership?.starred ? "is-on" : ""}`}
            aria-label={conversation.membership?.starred ? "Unstar conversation" : "Star conversation"}
            onClick={async () => {
              await api.conversations.updateMembership(conversationId, { starred: !conversation.membership?.starred });
              await actions.refreshConversations();
            }}
          >
            <Star size={14} />
          </button>
          {channel?.topic ? (
            <button
              type="button"
              className="conversation-topic"
              onClick={() => actions.setRightPanel({ kind: "details", conversationId })}
            >
              {channel.topic}
            </button>
          ) : channel ? (
            <button
              type="button"
              className="conversation-topic is-empty"
              onClick={() => actions.setRightPanel({ kind: "details", conversationId })}
            >
              Add a topic
            </button>
          ) : null}
        </div>

        <div className="conversation-actions">
          <button
            type="button"
            className="member-facepile"
            onClick={() => actions.setRightPanel({ kind: "details", conversationId })}
            aria-label={`${conversation.memberIds.length} members`}
          >
            {memberAvatars.map((id) => (
              <Avatar key={id} user={directory.get(id)} size={22} presence={false} />
            ))}
            <span>{conversation.memberIds.length}</span>
          </button>

          <label className="jump-date" title="Jump to a date">
            <CalendarDays size={17} />
            <span className="sr-only">Jump to a date</span>
            <input
              type="date"
              onChange={(event) => {
                if (event.target.value) void actions.jumpToDate(conversationId, event.target.value);
              }}
            />
          </label>

          <IconButton label="Pinned messages" onClick={() => actions.setRightPanel({ kind: "pins", conversationId })}>
            <Pin size={17} />
          </IconButton>
          <IconButton label="Files" onClick={() => actions.setRightPanel({ kind: "files", conversationId })}>
            <FileText size={17} />
          </IconButton>
          <IconButton
            label={conversation.membership?.muted ? "Unmute conversation" : "Mute conversation"}
            onClick={async () => {
              await api.conversations.updateMembership(conversationId, { muted: !conversation.membership?.muted });
              await actions.refreshConversations();
            }}
          >
            {conversation.membership?.muted ? <BellOff size={17} /> : <Bell size={17} />}
          </IconButton>
          {channel ? (
            <IconButton label="Add people" onClick={() => actions.setModal({ kind: "add-people", conversationId })}>
              <UserPlus size={17} />
            </IconButton>
          ) : null}
          <IconButton label="Conversation details" onClick={() => actions.setRightPanel({ kind: "details", conversationId })}>
            <Info size={17} />
          </IconButton>
        </div>
      </header>

      {channel ? (
        <div className="bookmark-bar">
          {bookmarks.map((bookmark) => (
            <a key={bookmark.id} href={bookmark.url} target="_blank" rel="noopener noreferrer" className="bookmark">
              {bookmark.emoji ? <span aria-hidden>{bookmark.emoji}</span> : null}
              {bookmark.title}
            </a>
          ))}
          <Popover
            width={320}
            trigger={({ toggle, ref }) => (
              <button type="button" className="bookmark add" ref={ref} onClick={toggle}>
                <Plus size={13} /> Add a bookmark
              </button>
            )}
          >
            {(close) => (
              <form
                className="stack-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  try {
                    const { bookmark } = await api.channels.addBookmark(channel.id, {
                      title: String(form.get("title")),
                      url: String(form.get("url"))
                    });
                    setBookmarks((current) => [...current, bookmark]);
                    close();
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                <label>
                  Title
                  <input name="title" required maxLength={120} placeholder="Runbook" />
                </label>
                <label>
                  Link
                  <input name="url" type="url" required placeholder="https://" />
                </label>
                <button className="button primary" type="submit">
                  Add bookmark
                </button>
              </form>
            )}
          </Popover>
        </div>
      ) : null}

      <MessageList conversationId={conversationId} />

      {channel?.archivedAt ? (
        <div className="composer-locked">
          This channel is archived. It is read-only.
          {state.bootstrap?.role !== "member" ? (
            <button
              type="button"
              className="button ghost"
              onClick={async () => {
                await api.channels.unarchive(channel.id);
                await actions.refreshBootstrap();
              }}
            >
              Unarchive
            </button>
          ) : null}
        </div>
      ) : !joined && channel ? (
        <div className="composer-locked">
          You are previewing #{channel.name}.
          <button
            type="button"
            className="button primary"
            onClick={async () => {
              try {
                await api.channels.join(channel.id);
                await actions.refreshBootstrap();
                await actions.openConversation(conversationId);
              } catch (error) {
                actions.fail(error);
              }
            }}
          >
            Join channel
          </button>
        </div>
      ) : (
        <Composer
          conversationId={conversationId}
          placeholder={channel ? `Message #${channel.name}` : `Message ${title}`}
        />
      )}
    </section>
  );
}

export function ConversationMenuItems({ conversationId }: { conversationId: string }) {
  const { state, actions } = useApp();
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return null;
  return (
    <>
      <MenuItem onClick={() => actions.setRightPanel({ kind: "details", conversationId })}>Open details</MenuItem>
      <MenuDivider />
      <MenuItem
        onClick={async () => {
          await api.conversations.updateMembership(conversationId, {
            notificationLevel: conversation.membership?.notificationLevel === "all" ? "mentions" : "all"
          });
          await actions.refreshConversations();
        }}
      >
        Notify me about {conversation.membership?.notificationLevel === "all" ? "mentions only" : "every message"}
      </MenuItem>
    </>
  );
}
