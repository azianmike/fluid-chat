"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, Lock, RefreshCw, Trash2 } from "lucide-react";
import type { ChannelSummary, CustomEmojiDto, PublicUser, WorkspaceUsage } from "@/shared/types";
import { api } from "../../api";
import type { ApiKeyDto } from "../../api";
import { formatBytes, formatRelative } from "../../format";
import { useApp } from "../../store";
import { Avatar, Modal, Spinner } from "../ui/primitives";

type Tab = "overview" | "members" | "invitations" | "channels" | "emoji" | "api" | "settings" | "audit" | "export";

type MemberRow = { memberId: string; role: string; status: string; user: PublicUser };
type InviteRow = {
  id: string;
  email: string | null;
  role: string;
  inviteType: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  useCount: number;
  maxUses: number | null;
};

export function AdminConsole({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>("overview");
  const workspaceId = state.workspaceId;
  const isOwner = state.bootstrap?.role === "owner";

  return (
    <Modal title={`${state.bootstrap?.workspace.name ?? "Workspace"} settings`} onClose={onClose} width={860}>
      <div className="panel-tabs wrap" role="tablist">
        {(
          [
            ["overview", "Overview"],
            ["members", "Members"],
            ["invitations", "Invitations"],
            ["channels", "Channels"],
            ["emoji", "Emoji"],
            ["api", "API keys"],
            ["settings", "Settings"],
            ["audit", "Audit log"],
            ["export", "Export"]
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>

      {!workspaceId ? null : (
        <div className="admin-body">
          {tab === "overview" ? <Overview workspaceId={workspaceId} /> : null}
          {tab === "members" ? <Members workspaceId={workspaceId} isOwner={isOwner} /> : null}
          {tab === "invitations" ? <Invitations workspaceId={workspaceId} /> : null}
          {tab === "channels" ? <Channels workspaceId={workspaceId} /> : null}
          {tab === "emoji" ? <Emoji workspaceId={workspaceId} /> : null}
          {tab === "api" ? <ApiKeys workspaceId={workspaceId} /> : null}
          {tab === "settings" ? <Settings workspaceId={workspaceId} isOwner={isOwner} /> : null}
          {tab === "audit" ? <AuditLog workspaceId={workspaceId} /> : null}
          {tab === "export" ? <Exports workspaceId={workspaceId} isOwner={isOwner} /> : null}
          <p className="admin-note">
            Signed in as {state.session?.email} · role: {state.bootstrap?.role}
          </p>
        </div>
      )}
    </Modal>
  );
}

function Overview({ workspaceId }: { workspaceId: string }) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const { state } = useApp();

  useEffect(() => {
    api.workspaces
      .usage(workspaceId)
      .then(({ usage: value }) => setUsage(value))
      .catch(() => setUsage(null));
  }, [workspaceId]);

  const workspace = state.bootstrap?.workspace;

  return (
    <div className="admin-grid">
      <div className="stat-card">
        <span>Members</span>
        <strong>{usage?.activeMembers ?? "—"}</strong>
        <small>of {workspace?.seatLimit ?? 0} seats</small>
      </div>
      <div className="stat-card">
        <span>Pending invites</span>
        <strong>{usage?.pendingInvites ?? "—"}</strong>
      </div>
      <div className="stat-card">
        <span>Storage</span>
        <strong>{usage ? formatBytes(usage.storageBytes) : "—"}</strong>
        {!usage ? (
          <small>—</small>
        ) : usage.storageLimitBytes ? (
          <>
            <small>
              of {formatBytes(usage.storageLimitBytes)} · {usage.fileCount} files
            </small>
            <StorageBar used={usage.storageBytes} limit={usage.storageLimitBytes} />
          </>
        ) : (
          <small>{usage.fileCount} files · no limit</small>
        )}
      </div>
      <div className="stat-card">
        <span>Plan</span>
        <strong className="capitalize">{workspace?.plan ?? "free"}</strong>
        <small className="capitalize">{workspace?.subscriptionStatus}</small>
      </div>
    </div>
  );
}

function StorageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = Math.min(1, used / limit);
  const level = ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok";
  return (
    <div className={`storage-bar storage-bar-${level}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

function Members({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const { actions } = useApp();
  const [members, setMembers] = useState<MemberRow[] | null>(null);

  const load = useCallback(() => {
    api.workspaces
      .members(workspaceId, true)
      .then(({ members: list }) => setMembers(list as MemberRow[]))
      .catch(() => setMembers([]));
  }, [workspaceId]);

  useEffect(load, [load]);

  if (!members) return <Spinner label="Loading members" />;

  return (
    <div className="admin-list">
      {members.map((member) => (
        <div key={member.memberId} className="admin-row">
          <div className="admin-row-main">
            <Avatar user={member.user} size={32} />
            <span>
              <strong>{member.user.displayName}</strong>
              <small>
                {member.user.email} · {member.status}
              </small>
            </span>
          </div>
          <div className="admin-row-actions">
            {isOwner ? (
              <select
                value={member.role}
                onChange={async (event) => {
                  try {
                    await api.workspaces.updateMember(workspaceId, member.memberId, { role: event.target.value });
                    load();
                    await actions.refreshBootstrap();
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="guest">Guest</option>
              </select>
            ) : (
              <span className="pill capitalize">{member.role}</span>
            )}
            {member.status === "active" ? (
              <button
                type="button"
                className="button ghost"
                onClick={async () => {
                  if (!window.confirm(`Remove ${member.user.displayName} from the workspace?`)) return;
                  try {
                    await api.workspaces.removeMember(workspaceId, member.memberId);
                    load();
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                className="button ghost"
                onClick={async () => {
                  try {
                    await api.workspaces.updateMember(workspaceId, member.memberId, { status: "active" });
                    load();
                  } catch (error) {
                    actions.fail(error);
                  }
                }}
              >
                Reactivate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Invitations({ workspaceId }: { workspaceId: string }) {
  const { actions } = useApp();
  const [invites, setInvites] = useState<InviteRow[] | null>(null);

  const load = useCallback(() => {
    api.invites
      .list(workspaceId)
      .then(({ invites: list }) => setInvites(list as InviteRow[]))
      .catch(() => setInvites([]));
  }, [workspaceId]);

  useEffect(load, [load]);

  if (!invites) return <Spinner label="Loading invitations" />;
  const pending = invites.filter((invite) => !invite.acceptedAt && !invite.revokedAt && new Date(invite.expiresAt) > new Date());

  return (
    <div className="admin-list">
      {pending.length === 0 ? <p className="muted">No pending invitations.</p> : null}
      {pending.map((invite) => (
        <div key={invite.id} className="admin-row">
          <div className="admin-row-main">
            <span>
              <strong>{invite.email ?? "Shareable invite link"}</strong>
              <small>
                {invite.role} · expires {formatRelative(invite.expiresAt)}
                {invite.maxUses ? ` · ${invite.useCount}/${invite.maxUses} uses` : ""}
              </small>
            </span>
          </div>
          <div className="admin-row-actions">
            <button
              type="button"
              className="button ghost"
              onClick={async () => {
                try {
                  const { inviteUrl } = await api.invites.resend(invite.id);
                  void navigator.clipboard.writeText(inviteUrl);
                  actions.toast("New invite link copied to clipboard", "success");
                  load();
                } catch (error) {
                  actions.fail(error);
                }
              }}
            >
              <RefreshCw size={13} /> Resend
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={async () => {
                await api.invites.revoke(invite.id);
                load();
              }}
            >
              Revoke
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Channels({ workspaceId }: { workspaceId: string }) {
  const { actions } = useApp();
  const [channels, setChannels] = useState<Array<ChannelSummary & { conversationId: string }> | null>(null);

  const load = useCallback(() => {
    api.channels
      .list(workspaceId, { includeArchived: true })
      .then(({ channels: list }) => setChannels(list))
      .catch(() => setChannels([]));
  }, [workspaceId]);

  useEffect(load, [load]);

  if (!channels) return <Spinner label="Loading channels" />;

  return (
    <div className="admin-list">
      {channels.map((channel) => (
        <div key={channel.id} className="admin-row">
          <div className="admin-row-main">
            {channel.visibility === "private" ? <Lock size={14} /> : <Hash size={15} />}
            <span>
              <strong>{channel.name}</strong>
              <small>
                {channel.memberCount ?? 0} members{channel.archivedAt ? " · archived" : ""}
              </small>
            </span>
          </div>
          <div className="admin-row-actions">
            {channel.archivedAt ? (
              <button
                type="button"
                className="button ghost"
                onClick={async () => {
                  await api.channels.unarchive(channel.id);
                  load();
                  await actions.refreshBootstrap();
                }}
              >
                Unarchive
              </button>
            ) : channel.name !== "general" ? (
              <button
                type="button"
                className="button ghost"
                onClick={async () => {
                  if (!window.confirm(`Archive #${channel.name}?`)) return;
                  await api.channels.archive(channel.id);
                  load();
                  await actions.refreshBootstrap();
                }}
              >
                Archive
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Emoji({ workspaceId }: { workspaceId: string }) {
  const { actions } = useApp();
  const [emoji, setEmoji] = useState<CustomEmojiDto[] | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(() => {
    api.workspaces
      .emoji(workspaceId)
      .then(({ emoji: list }) => setEmoji(list))
      .catch(() => setEmoji([]));
  }, [workspaceId]);

  useEffect(load, [load]);

  return (
    <div className="stack-form">
      <label className="field">
        Add custom emoji
        <div className="emoji-upload">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="party-parrot" />
          <input
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !name.trim()) {
                actions.toast("Name the emoji first", "error");
                return;
              }
              try {
                const { file: uploaded } = await api.files.upload(workspaceId, file);
                await api.workspaces.createEmoji(workspaceId, name.trim().toLowerCase(), uploaded.id);
                setName("");
                load();
                await actions.refreshBootstrap();
              } catch (error) {
                actions.fail(error);
              }
            }}
          />
        </div>
      </label>
      <div className="emoji-admin-grid">
        {(emoji ?? []).map((entry) => (
          <div key={entry.id} className="emoji-admin-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entry.imageUrl} alt={`:${entry.name}:`} width={28} height={28} />
            <code>:{entry.name}:</code>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete :${entry.name}:`}
              onClick={async () => {
                await api.workspaces.deleteEmoji(entry.id);
                load();
                await actions.refreshBootstrap();
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {emoji?.length === 0 ? <p className="muted">No custom emoji yet.</p> : null}
      </div>
    </div>
  );
}

const DEFAULT_SCOPES = ["messages:read", "messages:write", "channels:read", "conversations:read"];

function ApiKeys({ workspaceId }: { workspaceId: string }) {
  const { actions } = useApp();
  const [keys, setKeys] = useState<ApiKeyDto[] | null>(null);
  const [catalogue, setCatalogue] = useState<Array<{ scope: string; summary: string }>>([]);
  const [secret, setSecret] = useState<{ token: string; name: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    identity: "bot" as "bot" | "self",
    botRole: "member" as "member" | "admin",
    scopes: DEFAULT_SCOPES,
    rateLimitPerMinute: 120,
    messageLimitPerMinute: 60,
    expiresInDays: ""
  });

  const load = useCallback(() => {
    api.apiKeys
      .list(workspaceId)
      .then(({ apiKeys }) => setKeys(apiKeys))
      .catch(() => setKeys([]));
  }, [workspaceId]);

  useEffect(load, [load]);
  useEffect(() => {
    api.apiKeys
      .scopes()
      .then(({ scopes }) => setCatalogue(scopes))
      .catch(() => setCatalogue([]));
  }, []);

  const toggleScope = (scope: string) =>
    setForm((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((entry) => entry !== scope)
        : [...current.scopes, scope]
    }));

  return (
    <div className="stack-form">
      <p className="muted">
        An API key calls the same endpoints this app does, so anything a person can do here, a script or an agent can
        automate. Keys are pinned to this workspace, limited to the scopes you grant and rate limited per key. The full
        route list lives at <code>/api/meta/routes</code>.
      </p>

      {secret ? (
        <div className="api-key-reveal">
          <strong>Copy “{secret.name}” now — this is the only time it is shown.</strong>
          <code>{secret.token}</code>
          <div className="admin-row-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => {
                void navigator.clipboard.writeText(secret.token);
                actions.toast("API key copied to clipboard", "success");
              }}
            >
              Copy key
            </button>
            <button type="button" className="button ghost" onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
          <small>
            Try it: <code>curl -H &quot;Authorization: Bearer {secret.token.slice(0, 14)}…&quot; {location.origin}/api/auth/me</code>
          </small>
        </div>
      ) : null}

      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (form.scopes.length === 0) {
            actions.toast("Grant at least one scope", "error");
            return;
          }
          try {
            const { apiKey, token } = await api.apiKeys.create(workspaceId, {
              name: form.name.trim(),
              scopes: form.scopes,
              identity: form.identity,
              botRole: form.botRole,
              rateLimitPerMinute: form.rateLimitPerMinute,
              messageLimitPerMinute: form.messageLimitPerMinute,
              expiresInDays: form.expiresInDays === "" ? null : Number(form.expiresInDays)
            });
            setSecret({ token, name: apiKey.name });
            setForm({ ...form, name: "" });
            load();
          } catch (error) {
            actions.fail(error);
          }
        }}
      >
        <label className="field">
          Key name
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Release bot"
            required
          />
        </label>

        <div className="api-key-row">
          <label className="field">
            Acts as
            <select
              value={form.identity}
              onChange={(event) => setForm({ ...form, identity: event.target.value as "bot" | "self" })}
            >
              <option value="bot">Its own bot identity</option>
              <option value="self">Me</option>
            </select>
          </label>
          {form.identity === "bot" ? (
            <label className="field">
              Bot role
              <select
                value={form.botRole}
                onChange={(event) => setForm({ ...form, botRole: event.target.value as "member" | "admin" })}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            Requests / minute
            <input
              type="number"
              min={1}
              max={6000}
              value={form.rateLimitPerMinute}
              onChange={(event) => setForm({ ...form, rateLimitPerMinute: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            Messages / minute
            <input
              type="number"
              min={1}
              max={6000}
              value={form.messageLimitPerMinute}
              onChange={(event) => setForm({ ...form, messageLimitPerMinute: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            Expires in days
            <input
              type="number"
              min={1}
              value={form.expiresInDays}
              placeholder="never"
              onChange={(event) => setForm({ ...form, expiresInDays: event.target.value })}
            />
          </label>
        </div>

        <fieldset className="scope-grid">
          <legend>Scopes</legend>
          {catalogue.map((entry) => (
            <label key={entry.scope} className="checkbox-field">
              <input
                type="checkbox"
                checked={form.scopes.includes(entry.scope)}
                onChange={() => toggleScope(entry.scope)}
              />
              <span>
                <strong>{entry.scope}</strong>
                <small>{entry.summary}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <button type="submit" className="button primary">
          Create API key
        </button>
      </form>

      {!keys ? (
        <Spinner label="Loading API keys" />
      ) : (
        <div className="admin-list">
          {keys.length === 0 ? <p className="muted">No API keys yet.</p> : null}
          {keys.map((key) => (
            <div key={key.id} className="admin-row">
              <div className="admin-row-main">
                <span>
                  <strong>
                    {key.name} <code>{key.prefix}…</code>
                  </strong>
                  <small>
                    as {key.actor.displayName}
                    {key.actor.isBot ? " (bot)" : ""} · {key.scopes.length} scopes · {key.rateLimitPerMinute}/min ·{" "}
                    {key.requestCount} calls ·{" "}
                    {key.lastUsedAt ? `last used ${formatRelative(key.lastUsedAt)}` : "never used"}
                    {key.expiresAt ? ` · expires ${formatRelative(key.expiresAt)}` : ""}
                  </small>
                </span>
              </div>
              <div className="admin-row-actions">
                <button
                  type="button"
                  className="button ghost"
                  onClick={async () => {
                    if (!window.confirm(`Rotate “${key.name}”? The current secret stops working immediately.`)) return;
                    try {
                      const { token } = await api.apiKeys.rotate(key.id);
                      setSecret({ token, name: key.name });
                      load();
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                >
                  <RefreshCw size={13} /> Rotate
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={async () => {
                    if (!window.confirm(`Revoke “${key.name}”? Anything using it stops working.`)) return;
                    try {
                      await api.apiKeys.revoke(key.id);
                      load();
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Settings({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const { state, actions } = useApp();
  const workspace = state.bootstrap?.workspace;
  const [form, setForm] = useState({
    name: workspace?.name ?? "",
    description: workspace?.description ?? "",
    iconEmoji: workspace?.iconEmoji ?? "",
    membersCanInvite: workspace?.membersCanInvite ?? true,
    membersCanCreateChannels: workspace?.membersCanCreateChannels ?? true,
    retentionDays: workspace?.retentionDays ?? ""
  });

  return (
    <form
      className="stack-form"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api.workspaces.update(workspaceId, {
            name: form.name,
            description: form.description || null,
            iconEmoji: form.iconEmoji || null,
            membersCanInvite: form.membersCanInvite,
            membersCanCreateChannels: form.membersCanCreateChannels,
            retentionDays: form.retentionDays === "" ? null : Number(form.retentionDays)
          });
          await actions.refreshBootstrap();
          actions.toast("Workspace updated", "success");
        } catch (error) {
          actions.fail(error);
        }
      }}
    >
      <label className="field">
        Workspace name
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      </label>
      <label className="field">
        Description
        <textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} />
      </label>
      <label className="field">
        Icon emoji
        <input value={form.iconEmoji ?? ""} onChange={(event) => setForm({ ...form, iconEmoji: event.target.value })} placeholder="🚀" />
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={form.membersCanInvite} onChange={(event) => setForm({ ...form, membersCanInvite: event.target.checked })} />
        <span>
          <strong>Members can invite people</strong>
        </span>
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={form.membersCanCreateChannels}
          onChange={(event) => setForm({ ...form, membersCanCreateChannels: event.target.checked })}
        />
        <span>
          <strong>Members can create channels</strong>
        </span>
      </label>
      {isOwner ? (
        <label className="field">
          Message retention (days, blank keeps forever)
          <input
            type="number"
            min={1}
            value={form.retentionDays ?? ""}
            onChange={(event) => setForm({ ...form, retentionDays: event.target.value })}
          />
        </label>
      ) : null}
      <button type="submit" className="button primary">
        Save settings
      </button>
    </form>
  );
}

function AuditLog({ workspaceId }: { workspaceId: string }) {
  const [events, setEvents] = useState<Array<{ id: string; type: string; createdAt: string; actor: { displayName: string } | null }> | null>(
    null
  );

  useEffect(() => {
    api.workspaces
      .auditEvents(workspaceId)
      .then(({ auditEvents }) => setEvents(auditEvents))
      .catch(() => setEvents([]));
  }, [workspaceId]);

  if (!events) return <Spinner label="Loading audit log" />;

  return (
    <div className="admin-list">
      {events.map((event) => (
        <div key={event.id} className="admin-row compact">
          <span>
            <strong>{event.type}</strong>
            <small>{event.actor?.displayName ?? "system"}</small>
          </span>
          <time>{formatRelative(event.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

function Exports({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const { actions } = useApp();
  const [jobs, setJobs] = useState<Array<{ id: string; status: string; createdAt: string; fileUrl: string | null }> | null>(null);

  const load = useCallback(() => {
    api.workspaces
      .exports(workspaceId)
      .then(({ exportJobs }) => setJobs(exportJobs))
      .catch(() => setJobs([]));
  }, [workspaceId]);

  useEffect(load, [load]);

  if (!isOwner) return <p className="muted">Only workspace owners can export data.</p>;

  return (
    <div className="stack-form">
      <p className="muted">
        Exports include every message, channel, member and file manifest as JSONL and CSV, written to the server’s export
        directory.
      </p>
      <button
        type="button"
        className="button primary"
        onClick={async () => {
          try {
            await api.workspaces.requestExport(workspaceId);
            actions.toast("Export queued — it will appear below when ready", "success");
            setTimeout(load, 2000);
          } catch (error) {
            actions.fail(error);
          }
        }}
      >
        Start a new export
      </button>
      <div className="admin-list">
        {(jobs ?? []).map((job) => (
          <div key={job.id} className="admin-row compact">
            <span>
              <strong className="capitalize">{job.status}</strong>
              <small>{job.fileUrl ?? "Preparing…"}</small>
            </span>
            <time>{formatRelative(job.createdAt)}</time>
          </div>
        ))}
      </div>
    </div>
  );
}
