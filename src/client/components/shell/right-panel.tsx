"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, MessageSquare, Pin, Trash2, X } from "lucide-react";
import type { FileSummary, MessageDto, PublicUser } from "@/shared/types";
import { api } from "../../api";
import { formatBytes, formatDateTime, formatRelative, localTimeIn } from "../../format";
import { conversationTitle, useApp, useDirectory } from "../../store";
import { Avatar, EmptyState, IconButton, Spinner } from "../ui/primitives";
import { Composer } from "../message/composer";
import { MessageItem } from "../message/message-item";
import { MessageStack, TypingIndicator } from "../message/message-list";

export function RightPanel() {
  const { state, actions } = useApp();
  const panel = state.rightPanel;
  if (!panel) return null;

  const close = () => actions.setRightPanel(null);

  return (
    <aside className="right-panel" aria-label="Details panel">
      {panel.kind === "thread" ? <ThreadPanel messageId={panel.messageId} onClose={close} /> : null}
      {panel.kind === "profile" ? <ProfilePanel userId={panel.userId} onClose={close} /> : null}
      {panel.kind === "details" ? <DetailsPanel conversationId={panel.conversationId} onClose={close} /> : null}
      {panel.kind === "pins" ? <PinsPanel conversationId={panel.conversationId} onClose={close} /> : null}
      {panel.kind === "files" ? <FilesPanel conversationId={panel.conversationId} onClose={close} /> : null}
    </aside>
  );
}

function PanelHeader({
  title,
  subtitle,
  onClose,
  action
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  action?: React.ReactNode;
}) {
  return (
    <header className="panel-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="panel-header-actions">
        {action}
        <IconButton label="Close panel" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
    </header>
  );
}

function ThreadPanel({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const messages = state.threads[messageId];
  const root = messages?.[0];
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === root?.conversationId);

  useEffect(() => {
    if (!state.threads[messageId]) void actions.openThread(messageId);
  }, [messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PanelHeader
        title="Thread"
        subtitle={conversation ? conversationTitle(conversation, directory, state.session?.id) : undefined}
        onClose={onClose}
        action={
          root ? (
            <button
              type="button"
              className="button ghost small"
              onClick={async () => {
                const next = root.thread.following ? "muted" : "following";
                try {
                  await api.messages.follow(root.id, next);
                  actions.upsertMessage({ ...root, thread: { ...root.thread, following: next === "following" } });
                } catch (error) {
                  actions.fail(error);
                }
              }}
            >
              {root.thread.following ? "Following" : "Follow"}
            </button>
          ) : null
        }
      />
      <div className="panel-scroll">
        {!messages ? (
          <Spinner label="Loading thread" />
        ) : (
          <>
            <MessageItem message={messages[0]} context="thread" />
            {messages.length > 1 ? (
              <div className="thread-divider">
                {messages.length - 1} {messages.length === 2 ? "reply" : "replies"}
              </div>
            ) : null}
            <MessageStack messages={messages.slice(1)} context="thread" />
          </>
        )}
      </div>
      {root ? <TypingIndicator conversationId={root.conversationId} parentMessageId={root.id} /> : null}
      {root && conversation ? (
        <Composer
          conversationId={root.conversationId}
          parentMessageId={root.id}
          placeholder="Reply…"
          autoFocus
          onSent={() => void actions.openThread(messageId)}
        />
      ) : null}
    </>
  );
}

function ProfilePanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const [user, setUser] = useState<PublicUser | undefined>(directory.get(userId));
  const timeFormat = state.session?.preferences?.timeFormat ?? "12h";
  const isSelf = state.session?.id === userId;

  useEffect(() => {
    if (!directory.get(userId)) {
      api.users
        .profile(userId)
        .then(({ user: fetched }) => setUser(fetched))
        .catch(() => undefined);
    } else {
      setUser(directory.get(userId));
    }
  }, [userId, directory]);

  if (!user) return <PanelHeader title="Profile" onClose={onClose} />;

  const localTime = localTimeIn(user.timezone, timeFormat);

  return (
    <>
      <PanelHeader title="Profile" onClose={onClose} />
      <div className="panel-scroll profile-panel">
        <div className="profile-avatar">
          <Avatar user={user} size={160} presence={false} />
        </div>
        <h3>{user.displayName}</h3>
        {user.handle ? <p className="muted">@{user.handle}</p> : null}
        {user.title ? <p className="profile-title">{user.title}</p> : null}
        {user.statusText ? (
          <p className="profile-status">
            {user.statusEmoji ? <span aria-hidden>:{user.statusEmoji}:</span> : null} {user.statusText}
          </p>
        ) : null}
        <dl className="profile-facts">
          {user.pronouns ? (
            <>
              <dt>Pronouns</dt>
              <dd>{user.pronouns}</dd>
            </>
          ) : null}
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${user.email}`}>{user.email}</a>
          </dd>
          {localTime ? (
            <>
              <dt>Local time</dt>
              <dd>{localTime}</dd>
            </>
          ) : null}
          <dt>Presence</dt>
          <dd className="capitalize">{user.presence}</dd>
        </dl>
        <div className="profile-actions">
          {isSelf ? (
            <button type="button" className="button primary" onClick={() => actions.setModal({ kind: "profile-editor" })}>
              Edit profile
            </button>
          ) : (
            <button
              type="button"
              className="button primary"
              onClick={async () => {
                if (!state.workspaceId) return;
                try {
                  const { conversation } = await api.conversations.openDm(state.workspaceId, [userId]);
                  await actions.refreshBootstrap();
                  await actions.openConversation(conversation.id);
                } catch (error) {
                  actions.fail(error);
                }
              }}
            >
              <MessageSquare size={15} /> Message
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function DetailsPanel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === conversationId);
  const channel = conversation?.channel;
  const [tab, setTab] = useState<"about" | "members" | "settings">("about");
  const [topic, setTopic] = useState(channel?.topic ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");
  const isAdmin = state.bootstrap?.role === "owner" || state.bootstrap?.role === "admin";

  useEffect(() => {
    setTopic(channel?.topic ?? "");
    setDescription(channel?.description ?? "");
  }, [channel?.id, channel?.topic, channel?.description]);

  if (!conversation) return <PanelHeader title="Details" onClose={onClose} />;

  return (
    <>
      <PanelHeader
        title={conversationTitle(conversation, directory, state.session?.id)}
        subtitle={channel ? `${conversation.memberIds.length} members` : "Direct message"}
        onClose={onClose}
      />
      <div className="panel-tabs" role="tablist">
        {(["about", "members", ...(channel ? (["settings"] as const) : [])] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={tab === entry ? "is-active" : ""}
            onClick={() => setTab(entry)}
          >
            {entry === "about" ? "About" : entry === "members" ? "Members" : "Settings"}
          </button>
        ))}
      </div>

      <div className="panel-scroll">
        {tab === "about" ? (
          channel ? (
            <div className="panel-section">
              <label className="field">
                Topic
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  onBlur={async () => {
                    if (topic === (channel.topic ?? "")) return;
                    try {
                      await api.channels.update(channel.id, { topic: topic || null });
                      await actions.refreshBootstrap();
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                  placeholder="Add a topic"
                />
              </label>
              <label className="field">
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  onBlur={async () => {
                    if (description === (channel.description ?? "")) return;
                    try {
                      await api.channels.update(channel.id, { description: description || null });
                      await actions.refreshBootstrap();
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                  rows={4}
                  placeholder="What is this channel about?"
                />
              </label>
              <p className="muted">
                Created {formatDateTime(channel.createdAt)} by {directory.get(channel.createdByUserId)?.displayName ?? "someone"}
              </p>
            </div>
          ) : (
            <div className="panel-section">
              <p className="muted">Direct messages are private to their participants.</p>
            </div>
          )
        ) : null}

        {tab === "members" ? (
          <div className="panel-section member-list">
            {conversation.memberIds.map((id) => {
              const member = directory.get(id);
              return (
                <div key={id} className="member-row">
                  <button type="button" onClick={() => actions.setRightPanel({ kind: "profile", userId: id })}>
                    <Avatar user={member} size={30} />
                    <span>
                      <strong>{member?.displayName ?? "Unknown"}</strong>
                      {member?.title ? <small>{member.title}</small> : null}
                    </span>
                  </button>
                  {channel && isAdmin && id !== state.session?.id ? (
                    <IconButton
                      label={`Remove ${member?.displayName ?? "member"}`}
                      onClick={async () => {
                        try {
                          await api.channels.removeMember(channel.id, id);
                          await actions.refreshBootstrap();
                        } catch (error) {
                          actions.fail(error);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  ) : null}
                </div>
              );
            })}
            {channel ? (
              <button
                type="button"
                className="button ghost"
                onClick={() => actions.setModal({ kind: "add-people", conversationId })}
              >
                Add people
              </button>
            ) : null}
          </div>
        ) : null}

        {tab === "settings" && channel ? (
          <div className="panel-section">
            {isAdmin || channel.createdByUserId === state.session?.id ? (
              <form
                className="field"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget).get("name");
                  try {
                    await api.channels.update(channel.id, { name: String(name) });
                    await actions.refreshBootstrap();
                    actions.toast("Channel renamed", "success");
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                Channel name
                <div className="inline-field">
                  <input name="name" defaultValue={channel.name} maxLength={80} />
                  <button type="submit" className="button ghost">
                    Rename
                  </button>
                </div>
              </form>
            ) : null}

            <label className="field">
              Notifications
              <select
                value={conversation.membership?.notificationLevel ?? "all"}
                onChange={async (event) => {
                  await api.conversations.updateMembership(conversationId, {
                    notificationLevel: event.target.value as "all" | "mentions" | "none"
                  });
                  await actions.refreshConversations();
                }}
              >
                <option value="all">Every new message</option>
                <option value="mentions">Mentions only</option>
                <option value="none">Nothing</option>
              </select>
            </label>

            {isAdmin ? (
              <>
                <label className="field">
                  Who can post
                  <select
                    value={channel.postingPolicy}
                    onChange={async (event) => {
                      await api.channels.update(channel.id, { postingPolicy: event.target.value });
                      await actions.refreshBootstrap();
                    }}
                  >
                    <option value="everyone">Everyone</option>
                    <option value="admins">Admins only</option>
                  </select>
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={channel.autoJoin}
                    disabled={channel.visibility === "private"}
                    onChange={async (event) => {
                      try {
                        await api.channels.update(channel.id, { autoJoin: event.target.checked });
                        await actions.refreshBootstrap();
                      } catch (error) {
                        actions.fail(error);
                      }
                    }}
                  />
                  <span>
                    <strong>Add new members automatically</strong>
                    <small>Everyone who joins the workspace lands in this channel.</small>
                  </span>
                </label>

                <label className="field">
                  Keep messages for
                  <select
                    value={channel.retentionDays ?? ""}
                    onChange={async (event) => {
                      const value = event.target.value;
                      try {
                        await api.channels.update(channel.id, {
                          retentionDays: value === "" ? null : Number(value)
                        });
                        await actions.refreshBootstrap();
                        actions.toast("Retention updated", "success");
                      } catch (error) {
                        actions.fail(error);
                      }
                    }}
                  >
                    <option value="">Forever (workspace default)</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </select>
                </label>

                <WebhookSettings channelId={channel.id} />
              </>
            ) : null}

            {isAdmin && channel.visibility === "public" ? (
              <button
                type="button"
                className="button ghost"
                onClick={async () => {
                  if (!window.confirm(`Make #${channel.name} private? This cannot be undone.`)) return;
                  try {
                    await api.channels.update(channel.id, { visibility: "private" });
                    await actions.refreshBootstrap();
                    actions.toast("Channel is now private", "success");
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                Change to a private channel
              </button>
            ) : null}

            <div className="panel-danger">
              <button
                type="button"
                className="button ghost"
                onClick={async () => {
                  try {
                    await api.channels.leave(channel.id);
                    await actions.refreshBootstrap();
                    onClose();
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                Leave channel
              </button>
              {isAdmin && channel.name !== "general" ? (
                <button
                  type="button"
                  className="button danger"
                  onClick={async () => {
                    if (!window.confirm(`Archive #${channel.name}?`)) return;
                    try {
                      await api.channels.archive(channel.id);
                      await actions.refreshBootstrap();
                      onClose();
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                >
                  Archive channel
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Incoming webhooks for a channel: create, copy once, revoke. */
function WebhookSettings({ channelId }: { channelId: string }) {
  const { actions } = useApp();
  const [hooks, setHooks] = useState<Array<{ id: string; name: string; lastUsedAt: string | null }>>([]);
  const [name, setName] = useState("");
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const load = useCallback(() => {
    api.channels
      .webhooks(channelId)
      .then(({ webhooks }) => setHooks(webhooks))
      .catch(() => setHooks([]));
  }, [channelId]);

  useEffect(load, [load]);

  return (
    <div className="field">
      Incoming webhooks
      <p className="muted small">Let a build, alert or script post here without a user account.</p>
      <div className="inline-field">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Deploy bot" maxLength={60} />
        <button
          type="button"
          className="button ghost"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const { url } = await api.channels.createWebhook(channelId, name.trim());
              setFreshUrl(url);
              setName("");
              load();
            } catch (error) {
              actions.fail(error);
            }
          }}
        >
          Create
        </button>
      </div>

      {freshUrl ? (
        <div className="copy-row">
          <code>{freshUrl}</code>
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              void navigator.clipboard.writeText(freshUrl);
              actions.toast("Webhook URL copied — it is not shown again", "success");
            }}
          >
            Copy
          </button>
        </div>
      ) : null}

      <div className="webhook-list">
        {hooks.map((hook) => (
          <div key={hook.id} className="webhook-row">
            <span>
              <strong>{hook.name}</strong>
              <small>{hook.lastUsedAt ? `last used ${formatRelative(hook.lastUsedAt)}` : "never used"}</small>
            </span>
            <button
              type="button"
              className="button ghost"
              onClick={async () => {
                if (!window.confirm(`Revoke ${hook.name}?`)) return;
                await api.channels.deleteWebhook(hook.id);
                load();
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PinsPanel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [pins, setPins] = useState<Array<{ message: MessageDto; pinnedAt: string }> | null>(null);

  useEffect(() => {
    api.conversations
      .pins(conversationId)
      .then(({ pins: list }) => setPins(list))
      .catch(() => setPins([]));
  }, [conversationId]);

  return (
    <>
      <PanelHeader title="Pinned" subtitle="Messages pinned to this conversation" onClose={onClose} />
      <div className="panel-scroll">
        {!pins ? (
          <Spinner label="Loading pins" />
        ) : pins.length === 0 ? (
          <EmptyState title="Nothing pinned yet" body="Pin important messages from their ⋯ menu." />
        ) : (
          pins.map(({ message }) => (
            <div key={message.id} className="panel-card">
              <div className="panel-card-head">
                <Pin size={13} /> Pinned
              </div>
              <MessageItem message={message} context="list" />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function FilesPanel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [files, setFiles] = useState<FileSummary[] | null>(null);

  useEffect(() => {
    api.conversations
      .files(conversationId)
      .then(({ files: list }) => setFiles(list))
      .catch(() => setFiles([]));
  }, [conversationId]);

  return (
    <>
      <PanelHeader title="Files" subtitle="Everything shared here" onClose={onClose} />
      <div className="panel-scroll">
        {!files ? (
          <Spinner label="Loading files" />
        ) : files.length === 0 ? (
          <EmptyState title="No files yet" body="Drag a file into the message box to share it." />
        ) : (
          <div className="file-grid">
            {files.map((file) => (
              <a key={file.id} href={file.url} target="_blank" rel="noopener noreferrer" className="file-card">
                {file.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt="" loading="lazy" />
                ) : (
                  <Download size={18} />
                )}
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
