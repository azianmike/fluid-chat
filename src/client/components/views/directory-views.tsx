"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Hash, Lock, Search } from "lucide-react";
import type { ChannelSummary, FileSummary, MessageDto } from "@/shared/types";
import { api } from "../../api";
import { formatBytes, formatRelative } from "../../format";
import { useApp, useDirectory } from "../../store";
import { Avatar, EmptyState, Spinner } from "../ui/primitives";
import { MessageItem } from "../message/message-item";
import { HighlightProvider } from "../message/rich-text";

type DirectoryChannel = ChannelSummary & { conversationId: string; joined: boolean };

export function BrowseChannelsView() {
  const { state, actions } = useApp();
  const [channels, setChannels] = useState<DirectoryChannel[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "joined" | "unjoined" | "archived">("all");

  useEffect(() => {
    if (!state.workspaceId) return;
    api.channels
      .list(state.workspaceId, { includeArchived: filter === "archived" })
      .then(({ channels: list }) => setChannels(list))
      .catch(() => setChannels([]));
  }, [state.workspaceId, filter]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (channels ?? [])
      .filter((channel) => (term ? channel.name.includes(term) || channel.description?.toLowerCase().includes(term) : true))
      .filter((channel) => {
        if (filter === "joined") return channel.joined;
        if (filter === "unjoined") return !channel.joined;
        if (filter === "archived") return !!channel.archivedAt;
        return !channel.archivedAt;
      });
  }, [channels, filter, query]);

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <h1>Channels</h1>
          <p>{visible.length} channels in this workspace</p>
        </div>
        <button type="button" className="button primary" onClick={() => actions.setModal({ kind: "new-channel" })}>
          Create channel
        </button>
      </header>

      <div className="view-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels" />
        </div>
        <div className="view-filters">
          {(["all", "joined", "unjoined", "archived"] as const).map((entry) => (
            <button key={entry} type="button" className={filter === entry ? "is-active" : ""} onClick={() => setFilter(entry)}>
              {entry === "all" ? "All" : entry === "joined" ? "My channels" : entry === "unjoined" ? "Not joined" : "Archived"}
            </button>
          ))}
        </div>
      </div>

      <div className="view-scroll">
        {!channels ? (
          <Spinner label="Loading channels" />
        ) : visible.length === 0 ? (
          <EmptyState title="No channels found" body="Try a different search, or create one." />
        ) : (
          visible.map((channel) => (
            <div key={channel.id} className="channel-row">
              <button type="button" className="channel-row-main" onClick={() => void actions.openConversation(channel.conversationId)}>
                <span className="channel-row-name">
                  {channel.visibility === "private" ? <Lock size={14} /> : <Hash size={15} />}
                  {channel.name}
                  {channel.archivedAt ? <span className="pill">archived</span> : null}
                </span>
                <span className="channel-row-meta">
                  {channel.memberCount ?? 0} members
                  {channel.description ? ` · ${channel.description}` : ""}
                </span>
              </button>
              {channel.joined ? (
                <span className="pill">Joined</span>
              ) : (
                <button
                  type="button"
                  className="button ghost"
                  onClick={async () => {
                    try {
                      await api.channels.join(channel.id);
                      await actions.refreshBootstrap();
                      await actions.openConversation(channel.conversationId);
                    } catch (error) {
                      actions.fail(error);
                    }
                  }}
                >
                  Join
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function PeopleView() {
  const { state, actions } = useApp();
  const [query, setQuery] = useState("");
  const members = state.bootstrap?.members ?? [];

  const visible = members.filter((member) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return `${member.user.displayName} ${member.user.handle ?? ""} ${member.user.title ?? ""}`
      .toLowerCase()
      .includes(term);
  });

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <h1>People</h1>
          <p>{members.length} members</p>
        </div>
        <button type="button" className="button primary" onClick={() => actions.setModal({ kind: "invite" })}>
          Invite people
        </button>
      </header>

      <div className="view-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" />
        </div>
      </div>

      <div className="people-grid">
        {visible.map((member) => (
          <button
            key={member.user.id}
            type="button"
            className="person-card"
            onClick={() => actions.setRightPanel({ kind: "profile", userId: member.user.id })}
          >
            <Avatar user={member.user} size={56} />
            <strong>{member.user.displayName}</strong>
            <span>{member.user.title ?? (member.role === "owner" ? "Workspace owner" : member.role)}</span>
            {member.user.statusText ? <small>{member.user.statusText}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

export function FilesView() {
  const { state } = useApp();
  const directory = useDirectory();
  const [files, setFiles] = useState<FileSummary[] | null>(null);

  useEffect(() => {
    if (!state.workspaceId) return;
    api.activity
      .files(state.workspaceId)
      .then(({ files: list }) => setFiles(list))
      .catch(() => setFiles([]));
  }, [state.workspaceId]);

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <h1>Files</h1>
          <p>Everything shared in conversations you are in</p>
        </div>
      </header>
      <div className="view-scroll">
        {!files ? (
          <Spinner label="Loading files" />
        ) : files.length === 0 ? (
          <EmptyState title="No files yet" body="Attach a file to a message to see it here." />
        ) : (
          <div className="file-grid wide">
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
                  <small>
                    {formatBytes(file.size)} · {directory.get(file.uploaderId)?.displayName ?? "Someone"} ·{" "}
                    {formatRelative(file.createdAt)}
                  </small>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function SearchView({ query }: { query: string }) {
  const { state, actions } = useApp();
  const [term, setTerm] = useState(query);
  // Highlight the free-text words, not the operator tokens.
  const highlightTerms = useMemo(
    () =>
      term
        .split(/\s+/)
        .filter((word) => word && !/^\w+:/.test(word))
        .map((word) => word.replace(/^["']|["']$/g, "")),
    [term]
  );
  const [sort, setSort] = useState<"recent" | "relevant">("recent");
  const [results, setResults] = useState<Array<{ message: MessageDto; conversationId: string; channelName: string | null }> | null>(
    null
  );

  useEffect(() => setTerm(query), [query]);

  useEffect(() => {
    if (!state.workspaceId || !term.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setResults(null);
    api.activity
      .search(state.workspaceId, term, sort)
      .then(({ results: list }) => !cancelled && setResults(list))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [state.workspaceId, term, sort]);

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <h1>Search</h1>
          <p>
            Operators: <code>in:#channel</code> <code>from:@person</code> <code>has:file</code> <code>before:2026-01-01</code>
          </p>
        </div>
      </header>

      <div className="view-toolbar">
        <form
          className="search-field grow"
          onSubmit={(event) => {
            event.preventDefault();
            actions.setView({ kind: "search", query: term });
          }}
        >
          <Search size={15} />
          <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search messages" autoFocus />
        </form>
        <div className="view-filters">
          {(["recent", "relevant"] as const).map((entry) => (
            <button key={entry} type="button" className={sort === entry ? "is-active" : ""} onClick={() => setSort(entry)}>
              Most {entry}
            </button>
          ))}
        </div>
      </div>

      <div className="view-scroll">
        {!results ? (
          <Spinner label="Searching" />
        ) : results.length === 0 ? (
          <EmptyState title="No matches" body="Try different words, or widen the filters." />
        ) : (
          <HighlightProvider terms={highlightTerms}>
            {results.map((result) => (
              <div key={result.message.id} className="search-result">
                <button
                  type="button"
                  className="search-result-head"
                  onClick={() => void actions.openConversation(result.conversationId)}
                >
                  {result.channelName ? `#${result.channelName}` : "Direct message"}
                  <time>{formatRelative(result.message.createdAt)}</time>
                </button>
                <MessageItem message={result.message} context="list" />
              </div>
            ))}
          </HighlightProvider>
        )}
      </div>
    </section>
  );
}
