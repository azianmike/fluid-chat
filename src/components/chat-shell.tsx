"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Bell, Hash, LogOut, MessageCircle, Pencil, Plus, Reply, Search, Send, Settings, Smile, Trash2, UserPlus, X } from "lucide-react";
import { io } from "socket.io-client";

type User = { id: string; email: string; displayName: string };
type WorkspaceRow = { workspace: { id: string; name: string; slug: string }; member: { role: string } };
type ChannelRow = {
  channel: { id: string; name: string; visibility: string; topic?: string | null; archivedAt?: string | null };
  conversation: { id: string };
  member?: { lastReadAt?: string | null } | null;
  unreadCount?: number;
  mentionCount?: number;
};
type ConversationRow = {
  conversation: { id: string; type: string };
  channel?: { id: string; name: string } | null;
  unreadCount?: number;
  mentionCount?: number;
};
type MemberRow = { member: { id: string; role: string; status: string; userId: string }; user: User };
type ReactionSummary = { emoji: string; count: number; users: Array<{ id: string; displayName: string }> };
type MessageRow = {
  message: { id: string; bodyText: string; senderId: string; createdAt: string; editedAt?: string | null; deletedAt?: string | null };
  sender: { id: string; displayName: string; email: string };
  thread?: { replyCount: number; lastReplyAt?: string | null };
  reactions?: ReactionSummary[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export function ChatShell() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [threadParent, setThreadParent] = useState<MessageRow | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageRow[]>([]);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelVisibility, setChannelVisibility] = useState<"public" | "private">("public");
  const [inviteEmail, setInviteEmail] = useState("");
  const [dmUserId, setDmUserId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [threadText, setThreadText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  const activeWorkspace = useMemo(() => workspaces.find((row) => row.workspace.id === workspaceId)?.workspace, [workspaceId, workspaces]);
  const activeRole = useMemo(() => workspaces.find((row) => row.workspace.id === workspaceId)?.member.role, [workspaceId, workspaces]);
  const activeChannel = useMemo(() => channels.find((row) => row.conversation.id === conversationId), [channels, conversationId]);
  const activeConversation = useMemo(() => conversations.find((row) => row.conversation.id === conversationId), [conversations, conversationId]);
  const dmConversations = useMemo(() => conversations.filter((row) => row.conversation.type === "dm"), [conversations]);
  const activeTitle = activeChannel?.channel.name ?? (activeConversation?.conversation.type === "dm" ? "Direct message" : activeWorkspace?.name);

  async function loadMe() {
    const data = await api<{ user: User | null; workspaces: WorkspaceRow[] }>("/auth/me");
    setUser(data.user);
    setWorkspaces(data.workspaces);
    if (!workspaceId && data.workspaces[0]) setWorkspaceId(data.workspaces[0].workspace.id);
  }

  async function loadChannels(id = workspaceId, options?: { selectFirst?: boolean }) {
    if (!id) return;
    const data = await api<{ channels: ChannelRow[] }>(`/workspaces/${id}/channels`);
    setChannels(data.channels);
    if ((options?.selectFirst || !conversationId) && data.channels[0]) setConversationId(data.channels[0].conversation.id);
  }

  async function loadConversations(id = workspaceId) {
    if (!id) return;
    const data = await api<{ conversations: ConversationRow[] }>(`/workspaces/${id}/conversations`);
    setConversations(data.conversations);
  }

  async function loadMembers(id = workspaceId) {
    if (!id) return;
    const data = await api<{ members: MemberRow[] }>(`/workspaces/${id}/members`);
    setMembers(data.members);
  }

  async function loadMessages(id = conversationId) {
    if (!id) return;
    const data = await api<{ messages: MessageRow[] }>(`/conversations/${id}/messages`);
    setMessages(data.messages);
    await api(`/conversations/${id}/read`, { method: "POST", body: JSON.stringify({ messageId: data.messages.at(-1)?.message.id }) });
    if (workspaceId) {
      await Promise.all([
        loadChannels(workspaceId),
        loadConversations(workspaceId)
      ]);
    }
  }

  async function loadThread(parent = threadParent) {
    if (!parent) return;
    const data = await api<{ messages: MessageRow[] }>(`/messages/${parent.message.id}/thread`);
    setThreadMessages(data.messages);
  }

  useEffect(() => {
    loadMe().catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    setConversationId("");
    setThreadParent(null);
    setThreadMessages([]);
    loadChannels(workspaceId, { selectFirst: true }).catch((error) => setNotice(error.message));
    loadConversations().catch((error) => setNotice(error.message));
    loadMembers().catch((error) => setNotice(error.message));
  }, [workspaceId]);

  useEffect(() => {
    setThreadParent(null);
    setThreadMessages([]);
    loadMessages().catch((error) => setNotice(error.message));
  }, [conversationId]);

  useEffect(() => {
    if (!user) return;
    const socket = io(process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:3001", {
      withCredentials: true,
      transports: ["websocket"]
    });
    const rooms = [`user:${user.id}`];
    if (workspaceId) rooms.push(`workspace:${workspaceId}`);
    if (conversationId) rooms.push(`conversation:${conversationId}`);

    socket.on("connect", () => socket.emit("join", rooms));
    socket.on("message.created", () => loadMessages(conversationId).catch((error) => setNotice(error.message)));
    socket.on("message.updated", () => loadMessages(conversationId).catch((error) => setNotice(error.message)));
    socket.on("message.deleted", () => loadMessages(conversationId).catch((error) => setNotice(error.message)));
    socket.on("reaction.created", () => loadMessages(conversationId).catch((error) => setNotice(error.message)));
    socket.on("reaction.deleted", () => loadMessages(conversationId).catch((error) => setNotice(error.message)));
    socket.on("channel.created", () => {
      loadChannels(workspaceId).catch((error) => setNotice(error.message));
      loadConversations(workspaceId).catch((error) => setNotice(error.message));
    });
    socket.on("channel.updated", () => loadChannels(workspaceId).catch((error) => setNotice(error.message)));
    socket.on("channel.archived", () => loadChannels(workspaceId).catch((error) => setNotice(error.message)));
    socket.on("member.joined", () => loadMe().catch((error) => setNotice(error.message)));
    socket.on("member.removed", () => loadMe().catch((error) => setNotice(error.message)));
    socket.on("notification.created", () => setNotice("New notification"));

    return () => {
      socket.emit("leave", rooms);
      socket.disconnect();
    };
  }, [user?.id, workspaceId, conversationId]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    const path = mode === "signup" ? "/auth/signup" : "/auth/login";
    await api(path, {
      method: "POST",
      body: JSON.stringify(mode === "signup" ? { email: authEmail, password: authPassword, displayName } : { email: authEmail, password: authPassword })
    });
    setNotice(mode === "signup" ? "Account created. Create a workspace to begin." : "Signed in.");
    await loadMe();
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    const data = await api<{ workspace: { id: string } }>("/workspaces", { method: "POST", body: JSON.stringify({ name: workspaceName }) });
    setWorkspaceName("");
    await loadMe();
    setWorkspaceId(data.workspace.id);
  }

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    await api(`/workspaces/${workspaceId}/channels`, { method: "POST", body: JSON.stringify({ name: channelName, visibility: channelVisibility }) });
    setChannelName("");
    await loadChannels();
  }

  async function selectChannel(row: ChannelRow) {
    if (!row.member) {
      await api(`/channels/${row.channel.id}/join`, { method: "POST" });
      await Promise.all([loadChannels(workspaceId), loadConversations(workspaceId)]);
    }
    setConversationId(row.conversation.id);
  }

  async function leaveActiveChannel() {
    if (!activeChannel) return;
    await api(`/channels/${activeChannel.channel.id}/leave`, { method: "POST" });
    setConversationId("");
    await Promise.all([
      loadChannels(workspaceId, { selectFirst: true }),
      loadConversations(workspaceId)
    ]);
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    const data = await api<{ invites: Array<{ inviteUrl: string }> }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      body: JSON.stringify({ emails: [inviteEmail], role: "member" })
    });
    setNotice(`Invite created: ${data.invites[0]?.inviteUrl}`);
    setInviteEmail("");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!messageText.trim()) return;
    await api(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ bodyText: messageText, clientMessageId: crypto.randomUUID() })
    });
    setMessageText("");
    await loadMessages();
  }

  async function openDm(event: FormEvent) {
    event.preventDefault();
    if (!dmUserId) return;
    const data = await api<{ conversation: { id: string } }>("/conversations/dm", {
      method: "POST",
      body: JSON.stringify({ workspaceId, userId: dmUserId })
    });
    setDmUserId("");
    await loadConversations();
    setConversationId(data.conversation.id);
  }

  async function openThread(message: MessageRow) {
    setThreadParent(message);
    const data = await api<{ messages: MessageRow[] }>(`/messages/${message.message.id}/thread`);
    setThreadMessages(data.messages);
  }

  async function sendThreadReply(event: FormEvent) {
    event.preventDefault();
    if (!threadParent || !threadText.trim()) return;
    await api(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ bodyText: threadText, parentMessageId: threadParent.message.id, clientMessageId: crypto.randomUUID() })
    });
    setThreadText("");
    await loadMessages();
    await loadThread(threadParent);
  }

  async function toggleReaction(message: MessageRow, emoji: string) {
    const existing = message.reactions?.find((reaction) => reaction.emoji === emoji);
    const reacted = existing?.users.some((reactionUser) => reactionUser.id === user?.id);
    if (reacted) {
      await api(`/messages/${message.message.id}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" });
    } else {
      await api(`/messages/${message.message.id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
    }
    await loadMessages();
  }

  async function saveMessageEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingMessageId || !editingText.trim()) return;
    await api(`/messages/${editingMessageId}`, { method: "PATCH", body: JSON.stringify({ bodyText: editingText }) });
    setEditingMessageId("");
    setEditingText("");
    await loadMessages();
  }

  async function deleteMessage(message: MessageRow) {
    await api(`/messages/${message.message.id}`, { method: "DELETE" });
    if (threadParent?.message.id === message.message.id) setThreadParent(null);
    await loadMessages();
    await loadThread();
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!search.trim()) return;
    const data = await api<{ results: MessageRow[] }>(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(search)}`);
    setMessages(data.results);
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setWorkspaces([]);
    setChannels([]);
    setConversations([]);
    setMembers([]);
    setMessages([]);
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div>
            <p className="eyebrow">OpenChat</p>
            <h1>Team chat you can self-host.</h1>
            <p className="muted">Channels, DMs, threads, search, invites, and export-ready data ownership for small teams.</p>
          </div>
          <form onSubmit={submitAuth} className="stack">
            <div className="segmented">
              <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Sign up</button>
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Log in</button>
            </div>
            {mode === "signup" ? <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" required /> : null}
            <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} type="email" placeholder="Email" required />
            <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} type="password" placeholder="Password" required minLength={8} />
            <button className="primary">{mode === "signup" ? "Create account" : "Log in"}</button>
            {notice ? <p className="notice">{notice}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (workspaces.length === 0) {
    return (
      <main className="auth-page">
        <section className="auth-panel compact">
          <p className="eyebrow">Welcome, {user.displayName}</p>
          <h1>Create your workspace.</h1>
          <form onSubmit={createWorkspace} className="stack">
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" required />
            <button className="primary">Create workspace</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="workspace-switcher">
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}
          </select>
          <button title="Log out" onClick={logout}><LogOut size={18} /></button>
        </div>

        <form onSubmit={createChannel} className="inline-form">
          <input value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="new-channel" />
          <select value={channelVisibility} onChange={(event) => setChannelVisibility(event.target.value as "public" | "private")} aria-label="Channel visibility">
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          <button title="Create channel"><Plus size={17} /></button>
        </form>

        <nav className="channel-list">
          {channels.map((row) => (
            <button
              key={row.conversation.id}
              className={[row.conversation.id === conversationId ? "selected" : "", row.unreadCount || row.mentionCount ? "unread" : ""].filter(Boolean).join(" ")}
              onClick={() => selectChannel(row).catch((error) => setNotice(error.message))}
            >
              <Hash size={16} /> <span className="nav-label">{row.channel.name}</span>
              {!row.member ? <span className="join-pill">Join</span> : null}
              {row.mentionCount ? <span className="badge mention">{row.mentionCount}</span> : row.unreadCount ? <span className="badge">{row.unreadCount}</span> : null}
            </button>
          ))}
          {dmConversations.map((row, index) => (
            <button
              key={row.conversation.id}
              className={[row.conversation.id === conversationId ? "selected" : "", row.unreadCount || row.mentionCount ? "unread" : ""].filter(Boolean).join(" ")}
              onClick={() => setConversationId(row.conversation.id)}
            >
              <MessageCircle size={16} /> <span className="nav-label">Direct message {index + 1}</span>
              {row.mentionCount ? <span className="badge mention">{row.mentionCount}</span> : row.unreadCount ? <span className="badge">{row.unreadCount}</span> : null}
            </button>
          ))}
        </nav>

        <form onSubmit={openDm} className="dm-form">
          <MessageCircle size={16} />
          <select value={dmUserId} onChange={(event) => setDmUserId(event.target.value)}>
            <option value="">New DM</option>
            {members.filter((row) => row.user.id !== user.id).map((row) => (
              <option key={row.user.id} value={row.user.id}>{row.user.displayName}</option>
            ))}
          </select>
          <button>Open</button>
        </form>

        <form onSubmit={sendInvite} className="invite-form">
          <UserPlus size={16} />
          <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} type="email" placeholder="Invite email" />
          <button>Send</button>
        </form>
      </aside>

      <section className="chat">
        <header className="chat-header">
          <div>
            <h1>{activeChannel ? <Hash size={22} /> : <MessageCircle size={22} />} {activeTitle}</h1>
            <p>{activeChannel?.channel.topic ?? (activeConversation?.conversation.type === "dm" ? "Private conversation" : "Workspace conversation")}</p>
          </div>
          <form onSubmit={runSearch} className="search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" />
          </form>
          <button title="Notifications"><Bell size={18} /></button>
          {activeChannel?.member && activeChannel.channel.name !== "general" ? <button type="button" title="Leave channel" onClick={leaveActiveChannel}><LogOut size={18} /></button> : null}
          <button title="Settings"><Settings size={18} /></button>
        </header>

        {notice ? <div className="banner">{notice}</div> : null}

        <div className={threadParent ? "conversation-layout with-thread" : "conversation-layout"}>
          <div className="message-list">
            {messages.map((row) => (
              <article key={row.message.id} className={row.message.deletedAt ? "deleted message" : "message"}>
                <div className="avatar">{row.sender.displayName.slice(0, 1).toUpperCase()}</div>
                <div>
                  <div className="message-meta">
                    <strong>{row.sender.displayName}</strong>
                    <time>{new Date(row.message.createdAt).toLocaleString()}</time>
                    {row.message.editedAt ? <span>edited</span> : null}
                  </div>
                  {editingMessageId === row.message.id ? (
                    <form className="edit-form" onSubmit={saveMessageEdit}>
                      <input value={editingText} onChange={(event) => setEditingText(event.target.value)} />
                      <button className="primary" disabled={!editingText.trim()}>Save</button>
                      <button type="button" onClick={() => setEditingMessageId("")}>Cancel</button>
                    </form>
                  ) : (
                    <p>{row.message.deletedAt ? "This message was deleted" : row.message.bodyText}</p>
                  )}
                  {!row.message.deletedAt ? (
                    <div className="message-actions">
                      {row.reactions?.map((reaction) => (
                        <button key={reaction.emoji} type="button" title={reaction.users.map((reactionUser) => reactionUser.displayName).join(", ")} onClick={() => toggleReaction(row, reaction.emoji)}>
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                      <button type="button" title="React" onClick={() => toggleReaction(row, "👍")}><Smile size={14} /></button>
                      <button type="button" title="Reply" onClick={() => openThread(row)}>
                        <Reply size={14} /> {row.thread?.replyCount ? row.thread.replyCount : ""}
                      </button>
                      {row.message.senderId === user.id ? (
                        <button type="button" title="Edit message" onClick={() => { setEditingMessageId(row.message.id); setEditingText(row.message.bodyText); }}><Pencil size={14} /></button>
                      ) : null}
                      {row.message.senderId === user.id || activeRole === "owner" || activeRole === "admin" ? (
                        <button type="button" title="Delete message" onClick={() => deleteMessage(row).catch((error) => setNotice(error.message))}><Trash2 size={14} /></button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          {threadParent ? (
            <aside className="thread-panel">
              <header>
                <strong>Thread</strong>
                <button type="button" title="Close thread" onClick={() => setThreadParent(null)}><X size={16} /></button>
              </header>
              <div className="thread-list">
                {threadMessages.map(({ message, sender }) => (
                  <article key={message.id} className={message.deletedAt ? "deleted message" : "message"}>
                    <div className="avatar">{sender.displayName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <div className="message-meta">
                        <strong>{sender.displayName}</strong>
                        <time>{new Date(message.createdAt).toLocaleString()}</time>
                      </div>
                      <p>{message.deletedAt ? "This message was deleted" : message.bodyText}</p>
                    </div>
                  </article>
                ))}
              </div>
              <form onSubmit={sendThreadReply} className="thread-composer">
                <input value={threadText} onChange={(event) => setThreadText(event.target.value)} placeholder="Reply in thread" />
                <button className="primary" disabled={!threadText.trim()}><Send size={16} /></button>
              </form>
            </aside>
          ) : null}
        </div>

        <form onSubmit={sendMessage} className="composer">
          <input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder={activeChannel ? `Message #${activeChannel.channel.name}` : "Message conversation"} disabled={!conversationId} />
          <button className="primary" disabled={!conversationId}><Send size={18} /> Send</button>
        </form>
      </section>
    </main>
  );
}
