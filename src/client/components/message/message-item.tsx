"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Bookmark,
  BookmarkCheck,
  Clock,
  Copy,
  Download,
  Link2,
  MessageSquare,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Smile,
  Trash2
} from "lucide-react";
import type { MessageDto } from "@/shared/types";
import { api } from "../../api";
import { formatBytes, formatDateTime, formatRelative, formatTime } from "../../format";
import { useApp, useDirectory } from "../../store";
import { Avatar, IconButton, MenuDivider, MenuItem, Popover } from "../ui/primitives";
import { EmojiPicker } from "../ui/emoji-picker";
import { EmojiValue, RichText } from "./rich-text";

const QUICK_REACTIONS = ["👍", "✅", "👀", "🎉"];

export function MessageItem({
  message,
  grouped,
  context = "channel",
  highlight
}: {
  message: MessageDto;
  grouped?: boolean;
  context?: "channel" | "thread" | "list";
  highlight?: boolean;
}) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const [localEditing, setLocalEditing] = useState(false);
  const [editText, setEditText] = useState(message.bodyText);
  // ↑ in the composer asks the store to edit the last message you sent.
  const editing = localEditing || state.editingMessageId === message.id;
  const setEditing = (value: boolean) => {
    setLocalEditing(value);
    if (!value && state.editingMessageId === message.id) actions.setEditingMessage(null);
    if (value) setEditText(message.bodyText);
  };
  const sender = directory.get(message.senderId);
  const timeFormat = state.session?.preferences?.timeFormat ?? "12h";
  const isAuthor = message.senderId === state.session?.id;
  const role = state.bootstrap?.role;
  const canModerate = role === "owner" || role === "admin";
  const pending = (message.metadata as { pending?: boolean } | null)?.pending === true;
  const isMeMessage = (message.metadata as { subtype?: string } | null)?.subtype === "me_message";
  const sharedId = (message.metadata as { sharedMessageId?: string } | null)?.sharedMessageId;

  useEffect(() => {
    if (state.editingMessageId === message.id) setEditText(message.bodyText);
  }, [state.editingMessageId, message.id, message.bodyText]);

  if (message.type !== "user") {
    return (
      <div className="system-message" data-message-id={message.id}>
        <span className="system-dot" />
        <RichText text={message.bodyText} />
        <time dateTime={message.createdAt}>{formatTime(message.createdAt, timeFormat)}</time>
      </div>
    );
  }

  if (message.deletedAt) {
    return (
      <article className="message is-deleted" data-message-id={message.id}>
        <div className="message-gutter" />
        <div className="message-content">
          <p className="deleted-note">This message was deleted.</p>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`message ${grouped ? "is-grouped" : ""} ${highlight ? "is-highlight" : ""} ${pending ? "is-pending" : ""}`}
      data-message-id={message.id}
    >
      <div className="message-gutter">
        {grouped ? (
          <time className="hover-time" dateTime={message.createdAt}>
            {formatTime(message.createdAt, timeFormat)}
          </time>
        ) : (
          <button
            type="button"
            className="avatar-button"
            onClick={() => actions.setRightPanel({ kind: "profile", userId: message.senderId })}
            aria-label={`Open ${sender?.displayName ?? "profile"}`}
          >
            <Avatar user={sender} size={36} />
          </button>
        )}
      </div>

      <div className="message-content">
        {!grouped ? (
          <div className="message-head">
            <button
              type="button"
              className="sender-name"
              onClick={() => actions.setRightPanel({ kind: "profile", userId: message.senderId })}
            >
              {sender?.displayName ?? "Unknown"}
            </button>
            {sender?.isBot ? <span className="pill app-pill">APP</span> : null}
            {sender?.statusEmoji ? <EmojiValue value={`:${sender.statusEmoji}:`} /> : null}
            <time dateTime={message.createdAt} title={formatDateTime(message.createdAt, timeFormat)}>
              {formatTime(message.createdAt, timeFormat)}
            </time>
            {message.editedAt ? <span className="edited">(edited)</span> : null}
            {message.pinned ? (
              <span className="pill">
                <Pin size={11} /> pinned
              </span>
            ) : null}
          </div>
        ) : null}

        {editing ? (
          <form
            className="edit-form"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                const { message: updated } = await api.messages.update(message.id, editText);
                actions.upsertMessage(updated);
                setEditing(false);
              } catch (error) {
                actions.fail(error);
              }
            }}
          >
            <textarea
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              rows={Math.min(8, editText.split("\n").length + 1)}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="edit-actions">
              <button type="button" className="button ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={!editText.trim()}>
                Save changes
              </button>
            </div>
          </form>
        ) : (
          <div className={isMeMessage ? "message-body is-action" : "message-body"}>
            <RichText text={message.bodyText} />
          </div>
        )}

        {sharedId ? <SharedMessage messageId={sharedId} /> : null}

        {message.files.length > 0 ? (
          <div className="attachments">
            {message.files.map((file) =>
              file.mimeType.startsWith("image/") ? (
                <a key={file.id} href={file.url} target="_blank" rel="noopener noreferrer" className="attachment-image">
                  {/* Known dimensions keep the scroll position stable while images load. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file.url}
                    alt={file.name}
                    loading="lazy"
                    width={file.width ?? undefined}
                    height={file.height ?? undefined}
                  />
                </a>
              ) : (
                <a key={file.id} href={file.url} target="_blank" rel="noopener noreferrer" className="attachment-file">
                  <Download size={16} />
                  <span>
                    <strong>{file.name}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </span>
                </a>
              )
            )}
          </div>
        ) : null}

        {message.links.map((link) => (
          <a key={link.url} className="link-preview" href={link.url} target="_blank" rel="noopener noreferrer">
            {link.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={link.imageUrl} alt="" loading="lazy" />
            ) : null}
            <span>
              {link.siteName ? <small>{link.siteName}</small> : null}
              <strong>{link.title ?? link.url}</strong>
              {link.description ? <p>{link.description}</p> : null}
            </span>
          </a>
        ))}

        {message.reactions.length > 0 ? (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={reaction.reacted ? "reaction is-mine" : "reaction"}
                title={`${reaction.users.map((user) => user.displayName).join(", ")} reacted with ${reaction.emoji}`}
                onClick={() => void actions.toggleReaction(message, reaction.emoji)}
              >
                <EmojiValue value={reaction.emoji} />
                <span>{reaction.count}</span>
              </button>
            ))}
            <Popover
              width={340}
              trigger={({ toggle, ref }) => (
                <button type="button" className="reaction add-reaction" onClick={toggle} ref={ref} aria-label="Add reaction">
                  <Smile size={14} />
                </button>
              )}
            >
              {(close) => <EmojiPicker onPick={(value) => void actions.toggleReaction(message, value)} onClose={close} />}
            </Popover>
          </div>
        ) : null}

        {context !== "thread" && message.thread.replyCount > 0 ? (
          <button type="button" className="thread-summary" onClick={() => void actions.openThread(message.id)}>
            <span className="thread-avatars">
              {message.thread.participantIds.slice(0, 4).map((id) => (
                <Avatar key={id} user={directory.get(id)} size={20} presence={false} />
              ))}
            </span>
            <span className="thread-count">
              {message.thread.replyCount} {message.thread.replyCount === 1 ? "reply" : "replies"}
            </span>
            {message.thread.lastReplyAt ? (
              <span className="thread-time">Last reply {formatRelative(message.thread.lastReplyAt)}</span>
            ) : null}
          </button>
        ) : null}
      </div>

      <div className="message-toolbar" role="toolbar" aria-label="Message actions">
        {QUICK_REACTIONS.map((emoji) => (
          <button key={emoji} type="button" title={`React ${emoji}`} onClick={() => void actions.toggleReaction(message, emoji)}>
            {emoji}
          </button>
        ))}
        <Popover
          width={340}
          align="end"
          trigger={({ toggle, ref }) => (
            <button type="button" ref={ref} onClick={toggle} title="Add reaction">
              <Smile size={16} />
            </button>
          )}
        >
          {(close) => <EmojiPicker onPick={(value) => void actions.toggleReaction(message, value)} onClose={close} />}
        </Popover>

        {context !== "thread" ? (
          <button type="button" title="Reply in thread" onClick={() => void actions.openThread(message.id)}>
            <MessageSquare size={16} />
          </button>
        ) : null}

        <button type="button" title="Share message" onClick={() => actions.setModal({ kind: "share", messageId: message.id })}>
          <Share2 size={16} />
        </button>

        <button
          type="button"
          title={message.saved ? "Remove from saved" : "Save for later"}
          onClick={async () => {
            try {
              if (message.saved) await api.messages.unsave(message.id);
              else await api.messages.save(message.id);
              actions.upsertMessage({ ...message, saved: !message.saved });
            } catch (error) {
              actions.fail(error);
            }
          }}
        >
          {message.saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        </button>

        <Popover
          width={230}
          align="end"
          trigger={({ toggle, ref }) => (
            <button type="button" ref={ref} onClick={toggle} title="More actions">
              <MoreVertical size={16} />
            </button>
          )}
        >
          {(close) => (
            <div className="menu">
              {isAuthor ? (
                <MenuItem
                  onClick={() => {
                    setEditing(true);
                    close();
                  }}
                >
                  <Pencil size={14} /> Edit message
                </MenuItem>
              ) : null}
              <MenuItem
                onClick={async () => {
                  close();
                  try {
                    if (message.pinned) await api.messages.unpin(message.id);
                    else await api.messages.pin(message.id);
                    actions.upsertMessage({ ...message, pinned: !message.pinned });
                    actions.toast(message.pinned ? "Message unpinned" : "Message pinned to this conversation");
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                {message.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                {message.pinned ? "Unpin from conversation" : "Pin to conversation"}
              </MenuItem>
              {message.thread.replyCount > 0 || context === "thread" ? (
                <MenuItem
                  onClick={async () => {
                    close();
                    const next = message.thread.following ? "muted" : "following";
                    try {
                      await api.messages.follow(message.id, next);
                      actions.upsertMessage({
                        ...message,
                        thread: { ...message.thread, following: next === "following" }
                      });
                      actions.toast(next === "following" ? "Following this thread" : "You will not be notified about this thread");
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                >
                  <Bell size={14} /> {message.thread.following ? "Unfollow thread" : "Follow thread"}
                </MenuItem>
              ) : null}
              <div className="menu-submenu">
                <span className="menu-submenu-label">
                  <Clock size={14} /> Remind me
                </span>
                <div className="menu-submenu-options">
                  {(
                    [
                      ["in 20 minutes", "20 min"],
                      ["in 1 hour", "1 hour"],
                      ["in 3 hours", "3 hours"],
                      ["tomorrow at 9am", "Tomorrow"],
                      ["next week at 9am", "Next week"]
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={async () => {
                        close();
                        try {
                          const { reminder } = await api.messages.remind(message.id, value);
                          actions.toast(`Reminder set for ${new Date(reminder.remindAt).toLocaleString()}`, "success");
                        } catch (error) {
                          actions.fail(error);
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <MenuItem
                onClick={() => {
                  close();
                  void navigator.clipboard.writeText(message.bodyText);
                  actions.toast("Message text copied", "success");
                }}
              >
                <Copy size={14} /> Copy text
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  const url = `${window.location.origin}/?conversation=${message.conversationId}&message=${message.id}`;
                  void navigator.clipboard.writeText(url);
                  actions.toast("Link copied to clipboard", "success");
                }}
              >
                <Link2 size={14} /> Copy link
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  close();
                  await api.conversations.markUnread(message.conversationId, message.id);
                  await actions.refreshConversations();
                  actions.toast("Marked unread from here");
                }}
              >
                <MessageSquare size={14} /> Mark unread from here
              </MenuItem>
              {isAuthor || canModerate ? (
                <>
                  <MenuDivider />
                  <MenuItem
                    danger
                    onClick={async () => {
                      close();
                      if (!window.confirm("Delete this message? This cannot be undone.")) return;
                      try {
                        await api.messages.remove(message.id);
                      } catch (error) {
                        actions.fail(error);
                      }
                    }}
                  >
                    <Trash2 size={14} /> Delete message
                  </MenuItem>
                </>
              ) : null}
            </div>
          )}
        </Popover>
      </div>
    </article>
  );
}

function SharedMessage({ messageId }: { messageId: string }) {
  const [message, setMessage] = useState<MessageDto | null>(null);
  const directory = useDirectory();
  const { state } = useApp();
  const timeFormat = state.session?.preferences?.timeFormat ?? "12h";

  useEffect(() => {
    let cancelled = false;
    api.messages
      .thread(messageId)
      .then(({ messages }) => {
        if (!cancelled) setMessage(messages.find((entry) => entry.id === messageId) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  const sender = useMemo(() => (message ? directory.get(message.senderId) : undefined), [directory, message]);
  if (!message) return <div className="quoted-message is-loading">Loading shared message…</div>;

  return (
    <div className="quoted-message">
      <div className="quoted-head">
        <Avatar user={sender} size={20} presence={false} />
        <strong>{sender?.displayName ?? "Unknown"}</strong>
        <time>{formatDateTime(message.createdAt, timeFormat)}</time>
      </div>
      <RichText text={message.bodyText} />
    </div>
  );
}
