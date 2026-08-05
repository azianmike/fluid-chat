"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, Lock, RefreshCw, Trash2 } from "lucide-react";
import type { ChannelSummary, CustomEmojiDto, PublicUser } from "@/shared/types";
import { api } from "../../api";
import { formatRelative } from "../../format";
import { useApp } from "../../store";
import { Avatar, Modal, Spinner } from "../ui/primitives";

type Tab = "overview" | "members" | "invitations" | "channels" | "emoji" | "settings" | "audit" | "export";

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
  const [usage, setUsage] = useState<{ activeMembers: number; pendingInvites: number; fileCount: number } | null>(null);
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
        <span>Files</span>
        <strong>{usage?.fileCount ?? "—"}</strong>
      </div>
      <div className="stat-card">
        <span>Plan</span>
        <strong className="capitalize">{workspace?.plan ?? "free"}</strong>
        <small className="capitalize">{workspace?.subscriptionStatus}</small>
      </div>
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
