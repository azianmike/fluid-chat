"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Hash, Lock } from "lucide-react";
import { api } from "../../api";
import { track } from "../../analytics";
import { EMOJI_CATEGORIES } from "../../emoji";
import { conversationTitle, useApp, useDirectory } from "../../store";
import { Avatar, Modal } from "../ui/primitives";
import { RichText } from "../message/rich-text";

/* -------------------------------------------------------------------------- */
/* Invite                                                                      */
/* -------------------------------------------------------------------------- */

export function InviteModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "guest">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      title={`Invite people to ${state.bootstrap?.workspace.name ?? "workspace"}`}
      onClose={onClose}
      footer={
        <button type="button" className="button ghost" onClick={onClose}>
          Done
        </button>
      }
    >
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!state.workspaceId) return;
          const list = emails
            .split(/[\s,;]+/)
            .map((value) => value.trim())
            .filter(Boolean);
          if (list.length === 0) return;
          try {
            const { invites, skipped } = await api.invites.send(state.workspaceId, list, role);
            track("invites_sent", { count: invites.length, skipped_count: skipped.length, role });
            setSent(invites.map((invite) => invite.inviteUrl));
            setEmails("");
            actions.toast(
              `${invites.length} invite${invites.length === 1 ? "" : "s"} sent${skipped.length ? `, ${skipped.length} already pending` : ""}`,
              "success"
            );
          } catch (error) {
            actions.fail(error);
          }
        }}
      >
        <label className="field">
          Email addresses
          <textarea
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            rows={3}
            placeholder="ada@example.com, grace@example.com"
          />
        </label>
        <label className="field">
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="member">Member — full access to public channels</option>
            <option value="admin">Admin — can manage members and channels</option>
            <option value="guest">Guest — only the channels you add them to</option>
          </select>
        </label>
        <button type="submit" className="button primary">
          Send invitations
        </button>
      </form>

      {sent.length > 0 ? (
        <div className="invite-links">
          <h4>Invitation links</h4>
          {sent.map((link) => (
            <code key={link}>{link}</code>
          ))}
        </div>
      ) : null}

      <div className="modal-section">
        <h4>Share an invite link</h4>
        <p className="muted">Anyone with the link can join as a member. The link expires in 30 days.</p>
        {inviteLink ? (
          <div className="copy-row">
            <code>{inviteLink}</code>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                void navigator.clipboard.writeText(inviteLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button ghost"
            onClick={async () => {
              if (!state.workspaceId) return;
              try {
                const { inviteUrl } = await api.invites.createLink(state.workspaceId, { expiresInDays: 30 });
                track("invite_link_created", {});
                setInviteLink(inviteUrl);
              } catch (error) {
                actions.fail(error);
              }
            }}
          >
            Create invite link
          </button>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* New channel                                                                 */
/* -------------------------------------------------------------------------- */

export function NewChannelModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Create a channel" onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!state.workspaceId || busy) return;
          setBusy(true);
          try {
            const { conversationId } = await api.channels.create(state.workspaceId, {
              name,
              visibility,
              description: description || undefined
            });
            track("channel_created", { visibility, has_description: description.trim().length > 0 });
            await actions.refreshBootstrap();
            await actions.openConversation(conversationId);
            onClose();
          } catch (error) {
            actions.fail(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Name
          <div className="prefixed-input">
            <span>{visibility === "private" ? <Lock size={14} /> : <Hash size={15} />}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="plan-budget"
              required
              maxLength={80}
              autoFocus
            />
          </div>
        </label>
        <label className="field">
          Description <span className="optional">(optional)</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this channel about?"
            maxLength={500}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={visibility === "private"}
            onChange={(event) => setVisibility(event.target.checked ? "private" : "public")}
          />
          <span>
            <strong>Make private</strong>
            <small>Only invited people can see this channel.</small>
          </span>
        </label>
        <button type="submit" className="button primary" disabled={!name.trim() || busy}>
          Create channel
        </button>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* New direct message                                                          */
/* -------------------------------------------------------------------------- */

export function NewDmModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const members = (state.bootstrap?.members ?? []).filter((member) => member.user.id !== state.session?.id);
  const visible = members.filter((member) =>
    `${member.user.displayName} ${member.user.handle ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <Modal
      title="New message"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="button primary"
          disabled={selected.length === 0}
          onClick={async () => {
            if (!state.workspaceId) return;
            try {
              const { conversation } = await api.conversations.openDm(state.workspaceId, selected);
              track("dm_started", { participant_count: selected.length });
              await actions.refreshBootstrap();
              await actions.openConversation(conversation.id);
              onClose();
            } catch (error) {
              actions.fail(error);
            }
          }}
        >
          Start conversation
        </button>
      }
    >
      <div className="chips">
        {selected.map((id) => {
          const member = members.find((entry) => entry.user.id === id);
          return (
            <button key={id} type="button" className="chip" onClick={() => setSelected((current) => current.filter((entry) => entry !== id))}>
              {member?.user.displayName} ✕
            </button>
          );
        })}
      </div>
      <input
        className="modal-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search people"
        autoFocus
      />
      <div className="picker-list">
        {visible.map((member) => (
          <button
            key={member.user.id}
            type="button"
            className={selected.includes(member.user.id) ? "is-selected" : ""}
            onClick={() =>
              setSelected((current) =>
                current.includes(member.user.id)
                  ? current.filter((entry) => entry !== member.user.id)
                  : [...current, member.user.id]
              )
            }
          >
            <Avatar user={member.user} size={28} />
            <span>
              <strong>{member.user.displayName}</strong>
              <small>{member.user.title ?? member.user.email}</small>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Add people to a channel                                                     */
/* -------------------------------------------------------------------------- */

export function AddPeopleModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const { state, actions } = useApp();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === conversationId);
  const channel = conversation?.channel;

  const candidates = (state.bootstrap?.members ?? []).filter(
    (member) => !conversation?.memberIds.includes(member.user.id)
  );
  const visible = candidates.filter((member) =>
    `${member.user.displayName} ${member.user.handle ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <Modal
      title={channel ? `Add people to #${channel.name}` : "Add people"}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="button primary"
          disabled={selected.length === 0 || !channel}
          onClick={async () => {
            if (!channel) return;
            try {
              await api.channels.addMembers(channel.id, selected);
              await actions.refreshBootstrap();
              actions.toast(`Added ${selected.length} ${selected.length === 1 ? "person" : "people"}`, "success");
              onClose();
            } catch (error) {
              actions.fail(error);
            }
          }}
        >
          Add
        </button>
      }
    >
      {!channel ? (
        <p className="muted">You can only add people to channels. Start a new group message instead.</p>
      ) : (
        <>
          <div className="chips">
            {selected.map((id) => {
              const member = candidates.find((entry) => entry.user.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  className="chip"
                  onClick={() => setSelected((current) => current.filter((entry) => entry !== id))}
                >
                  {member?.user.displayName} ✕
                </button>
              );
            })}
          </div>
          <input
            className="modal-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            autoFocus
          />
          <div className="picker-list">
            {visible.map((member) => (
              <button
                key={member.user.id}
                type="button"
                className={selected.includes(member.user.id) ? "is-selected" : ""}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(member.user.id)
                      ? current.filter((entry) => entry !== member.user.id)
                      : [...current, member.user.id]
                  )
                }
              >
                <Avatar user={member.user} size={28} />
                <span>
                  <strong>{member.user.displayName}</strong>
                  <small>{member.user.title ?? member.user.email}</small>
                </span>
              </button>
            ))}
            {visible.length === 0 ? <p className="muted">Everyone in the workspace is already here.</p> : null}
          </div>
        </>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

const STATUS_PRESETS = [
  { emoji: "calendar", text: "In a meeting", minutes: 60 },
  { emoji: "bus", text: "Commuting", minutes: 30 },
  { emoji: "face_with_thermometer", text: "Out sick", minutes: 60 * 24 },
  { emoji: "beach_umbrella", text: "Vacationing", minutes: 60 * 24 * 7 },
  { emoji: "house", text: "Working remotely", minutes: 60 * 8 }
];

export function StatusModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const [emoji, setEmoji] = useState(state.session?.statusEmoji ?? "speech_balloon");
  const [text, setText] = useState(state.session?.statusText ?? "");
  const [minutes, setMinutes] = useState<number | null>(null);

  const emojiOptions = useMemo(
    () => EMOJI_CATEGORIES.flatMap((category) => category.emoji.slice(0, 12).map(([name, char]) => ({ name, char }))),
    []
  );

  return (
    <Modal
      title="Set a status"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button ghost"
            onClick={async () => {
              await actions.setStatus({ emoji: null, text: null, expiresAt: null });
              onClose();
            }}
          >
            Clear status
          </button>
          <button
            type="button"
            className="button primary"
            onClick={async () => {
              await actions.setStatus({
                emoji,
                text: text || null,
                expiresAt: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null
              });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="status-row">
        <select value={emoji} onChange={(event) => setEmoji(event.target.value)} aria-label="Status emoji">
          {emojiOptions.map((option) => (
            <option key={option.name} value={option.name}>
              {option.char} :{option.name}:
            </option>
          ))}
        </select>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What is happening?" maxLength={140} />
      </div>

      <label className="field">
        Clear after
        <select value={minutes ?? ""} onChange={(event) => setMinutes(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Do not clear</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="240">4 hours</option>
          <option value="480">Today</option>
          <option value="10080">This week</option>
        </select>
      </label>

      <div className="status-presets">
        {STATUS_PRESETS.map((preset) => (
          <button
            key={preset.text}
            type="button"
            onClick={() => {
              setEmoji(preset.emoji);
              setText(preset.text);
              setMinutes(preset.minutes);
            }}
          >
            {preset.text}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile editor                                                              */
/* -------------------------------------------------------------------------- */

export function ProfileEditorModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const session = state.session;
  const [form, setForm] = useState({
    displayName: session?.displayName ?? "",
    handle: session?.handle ?? "",
    title: session?.title ?? "",
    pronouns: session?.pronouns ?? "",
    phone: session?.phone ?? "",
    timezone: session?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Edit your profile" onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await actions.updateProfile({
              displayName: form.displayName,
              handle: form.handle || undefined,
              title: form.title || null,
              pronouns: form.pronouns || null,
              phone: form.phone || null,
              timezone: form.timezone
            });
            actions.toast("Profile updated", "success");
            onClose();
          } catch (error) {
            actions.fail(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="profile-editor">
          <Avatar user={session ?? undefined} size={92} presence={false} />
          <div className="stack-form grow">
            <label className="field">
              Full name
              <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required />
            </label>
            <label className="field">
              Handle
              <input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value })} placeholder="ada" />
            </label>
          </div>
        </div>
        <label className="field">
          What I do
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Product engineer" />
        </label>
        <label className="field">
          Pronouns
          <input value={form.pronouns} onChange={(event) => setForm({ ...form, pronouns: event.target.value })} placeholder="they/them" />
        </label>
        <label className="field">
          Phone
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </label>
        <label className="field">
          Time zone
          <input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
        </label>
        <div className="upload-avatar">
          <span>Profile photo</span>
          <input
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !state.workspaceId) return;
              try {
                const { file: uploaded } = await api.files.upload(state.workspaceId, file);
                await actions.updateProfile({ avatarUrl: uploaded.url });
                actions.toast("Photo updated", "success");
              } catch (error) {
                actions.fail(error);
              }
            }}
          />
        </div>
        <button type="submit" className="button primary" disabled={busy}>
          Save changes
        </button>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                 */
/* -------------------------------------------------------------------------- */

export function PreferencesModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp();
  const preferences = state.session?.preferences ?? {};
  const [tab, setTab] = useState<"appearance" | "notifications" | "advanced">("appearance");
  const [keywords, setKeywords] = useState(((preferences as { keywords?: string[] }).keywords ?? []).join(", "));

  const set = (input: Record<string, unknown>) => void actions.updatePreferences(input);

  return (
    <Modal title="Preferences" onClose={onClose} width={640}>
      <div className="panel-tabs" role="tablist">
        {(["appearance", "notifications", "advanced"] as const).map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? "is-active" : ""} onClick={() => setTab(entry)}>
            {entry === "appearance" ? "Appearance" : entry === "notifications" ? "Notifications" : "Advanced"}
          </button>
        ))}
      </div>

      {tab === "appearance" ? (
        <div className="stack-form">
          <label className="field">
            Theme
            <select value={preferences.theme ?? "system"} onChange={(event) => set({ theme: event.target.value })}>
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="field">
            Message density
            <select value={preferences.messageDensity ?? "comfortable"} onChange={(event) => set({ messageDensity: event.target.value })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label className="field">
            Time format
            <select value={preferences.timeFormat ?? "12h"} onChange={(event) => set({ timeFormat: event.target.value })}>
              <option value="12h">12-hour</option>
              <option value="24h">24-hour</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={preferences.enterToSend !== false} onChange={(event) => set({ enterToSend: event.target.checked })} />
            <span>
              <strong>Press Enter to send</strong>
              <small>When off, use Cmd/Ctrl+Enter to send.</small>
            </span>
          </label>
        </div>
      ) : null}

      {tab === "notifications" ? (
        <div className="stack-form">
          <label className="field">
            Desktop notifications
            <select value={preferences.desktopNotifications ?? "mentions"} onChange={(event) => set({ desktopNotifications: event.target.value })}>
              <option value="all">Every new message</option>
              <option value="mentions">Direct messages and mentions</option>
              <option value="none">Nothing</option>
            </select>
          </label>
          <label className="field">
            Email notifications
            <select value={preferences.emailNotifications ?? "mentions"} onChange={(event) => set({ emailNotifications: event.target.value })}>
              <option value="all">Everything I miss</option>
              <option value="mentions">Direct messages and mentions</option>
              <option value="none">Nothing</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={preferences.notificationSound !== false} onChange={(event) => set({ notificationSound: event.target.checked })} />
            <span>
              <strong>Play a sound for new messages</strong>
            </span>
          </label>
          <label className="field">
            Highlight words
            <input
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              onBlur={() =>
                set({
                  keywords: keywords
                    .split(",")
                    .map((word) => word.trim())
                    .filter(Boolean)
                })
              }
              placeholder="deploy, incident, roadmap"
            />
          </label>

          <div className="field">
            Notification schedule
            <p className="muted small">Pause sounds, desktop alerts and email between these times.</p>
            <div className="inline-field">
              <input
                type="time"
                value={preferences.quietHoursStart ?? ""}
                onChange={(event) => set({ quietHoursStart: event.target.value || null })}
                aria-label="Quiet hours start"
              />
              <span className="muted small">to</span>
              <input
                type="time"
                value={preferences.quietHoursEnd ?? ""}
                onChange={(event) => set({ quietHoursEnd: event.target.value || null })}
                aria-label="Quiet hours end"
              />
              {preferences.quietHoursStart || preferences.quietHoursEnd ? (
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => set({ quietHoursStart: null, quietHoursEnd: null })}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="button ghost"
            onClick={async () => {
              if (typeof Notification === "undefined") return;
              const permission = await Notification.requestPermission();
              actions.toast(permission === "granted" ? "Desktop notifications enabled" : "Permission denied");
            }}
          >
            Enable browser notifications
          </button>
        </div>
      ) : null}

      {tab === "advanced" ? (
        <div className="stack-form">
          <label className="checkbox-field">
            <input type="checkbox" checked={preferences.showUnreadsFirst === true} onChange={(event) => set({ showUnreadsFirst: event.target.checked })} />
            <span>
              <strong>Sort the sidebar by unread first</strong>
            </span>
          </label>
          <div className="field">
            Sessions
            <SessionList />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function SessionList() {
  const [sessions, setSessions] = useState<Array<{ id: string; userAgent: string | null; createdAt: string }>>([]);

  useEffect(() => {
    api.auth
      .sessions()
      .then(({ sessions: list }) => setSessions(list))
      .catch(() => undefined);
  }, []);

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <div key={session.id} className="session-row">
          <span>{session.userAgent?.slice(0, 60) ?? "Unknown device"}</span>
          <button
            type="button"
            className="button ghost"
            onClick={async () => {
              await api.auth.revokeSession(session.id);
              setSessions((current) => current.filter((entry) => entry.id !== session.id));
            }}
          >
            Revoke
          </button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Schedule and share                                                          */
/* -------------------------------------------------------------------------- */

export function ScheduleModal({
  conversationId,
  bodyText,
  parentMessageId,
  onClose
}: {
  conversationId: string;
  bodyText: string;
  parentMessageId: string | null;
  onClose: () => void;
}) {
  const { actions } = useApp();
  const [when, setWhen] = useState(() => {
    const date = new Date(Date.now() + 60 * 60_000);
    date.setSeconds(0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  return (
    <Modal title="Schedule message" onClose={onClose}>
      <p className="muted">This message will be sent automatically at the time you pick.</p>
      <blockquote className="schedule-preview">
        <RichText text={bodyText} />
      </blockquote>
      <label className="field">
        Send at
        <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
      </label>
      <button
        type="button"
        className="button primary"
        onClick={async () => {
          try {
            await api.conversations.schedule(conversationId, {
              bodyText,
              sendAt: new Date(when).toISOString(),
              parentMessageId
            });
            track("message_scheduled", {});
            actions.toast("Message scheduled", "success");
            onClose();
          } catch (error) {
            actions.fail(error);
          }
        }}
      >
        Schedule
      </button>
    </Modal>
  );
}

export function ShareModal({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const [target, setTarget] = useState("");
  const [comment, setComment] = useState("");

  return (
    <Modal title="Share message" onClose={onClose}>
      <label className="field">
        Share to
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Pick a conversation</option>
          {(state.bootstrap?.conversations ?? []).map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.channel ? `#${conversation.channel.name}` : conversationTitle(conversation, directory, state.session?.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Add a comment <span className="optional">(optional)</span>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} />
      </label>
      <button
        type="button"
        className="button primary"
        disabled={!target}
        onClick={async () => {
          try {
            const { conversationId } = await api.messages.share(messageId, { conversationId: target, comment });
            await actions.openConversation(conversationId);
            onClose();
          } catch (error) {
            actions.fail(error);
          }
        }}
      >
        Share
      </button>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Shortcuts and workspace creation                                            */
/* -------------------------------------------------------------------------- */

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K / Ctrl+K", "Jump to a conversation or person"],
  ["⌘/ / Ctrl+/", "Show this shortcut list"],
  ["⌘⇧K", "Start a direct message"],
  ["⌘⇧A", "Go to all unreads"],
  ["⌘⇧T", "Go to threads"],
  ["Alt+↑ / Alt+↓", "Previous or next conversation"],
  ["⇧Esc", "Mark everything read"],
  ["⌘B / ⌘I", "Bold or italic in the composer"],
  ["Enter", "Send the message"],
  ["Shift+Enter", "New line"],
  ["↑", "Edit your last message"],
  ["Esc", "Close the panel, modal or thread"]
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <ul className="shortcut-list">
        {SHORTCUTS.map(([keys, description]) => (
          <li key={keys}>
            <kbd>{keys}</kbd>
            <span>{description}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const { actions } = useApp();
  const [name, setName] = useState("");

  return (
    <Modal title="Create a workspace" onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const { workspace } = await api.workspaces.create(name);
            track("workspace_created", {});
            const { user, workspaces } = await api.auth.me();
            actions.setSession(user, workspaces);
            await actions.selectWorkspace(workspace.id);
            onClose();
          } catch (error) {
            actions.fail(error);
          }
        }}
      >
        <label className="field">
          Workspace name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Inc" required autoFocus />
        </label>
        <button type="submit" className="button primary" disabled={name.trim().length < 2}>
          Create workspace
        </button>
      </form>
    </Modal>
  );
}
