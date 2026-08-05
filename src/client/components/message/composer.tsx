"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent
} from "react";
import {
  Bold,
  Code,
  CodeSquare,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Send,
  Smile,
  Strikethrough,
  Timer,
  X
} from "lucide-react";
import type { FileSummary } from "@/shared/types";
import { api } from "../../api";
import { searchEmoji } from "../../emoji";
import { formatBytes } from "../../format";
import { useApp, useCustomEmoji, useDirectory } from "../../store";
import { Avatar, IconButton, Popover } from "../ui/primitives";
import { EmojiPicker } from "../ui/emoji-picker";

type Suggestion = { id: string; label: string; hint?: string; insert: string; avatarUserId?: string; preview?: string };

export function Composer({
  conversationId,
  parentMessageId = null,
  placeholder,
  autoFocus,
  onSent
}: {
  conversationId: string;
  parentMessageId?: string | null;
  placeholder: string;
  autoFocus?: boolean;
  onSent?: () => void;
}) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const customEmoji = useCustomEmoji();
  const draftKey = `${conversationId}:${parentMessageId ?? "root"}`;
  const [text, setText] = useState(state.drafts[draftKey] ?? "");
  const [attachments, setAttachments] = useState<FileSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [commands, setCommands] = useState<Array<{ name: string; usage: string; description: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingSentAt = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enterToSend = state.session?.preferences?.enterToSend !== false;
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === conversationId);

  useEffect(() => {
    setText(state.drafts[draftKey] ?? "");
    setAttachments([]);
    // Draft text is owned by the store; only reset when switching targets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    api.activity
      .commands()
      .then(({ commands: list }) => setCommands(list))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 320)}px`;
  }, [text]);

  const persistDraft = useCallback(
    (value: string) => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => actions.saveDraft(conversationId, value, parentMessageId), 700);
    },
    [actions, conversationId, parentMessageId]
  );

  const broadcastTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current < 3000) return;
    typingSentAt.current = now;
    const socket = actions.socketRef.current;
    if (socket?.connected) socket.emit("typing", { conversationId, parentMessageId });
    else void api.conversations.typing(conversationId, parentMessageId).catch(() => undefined);
  }, [actions, conversationId, parentMessageId]);

  /* ------------------------------------------------------------ suggestions */

  const trigger = useMemo(() => {
    const element = textareaRef.current;
    const caret = element?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const match = /(^|[\s(])([@#:/])([\w.+-]*)$/.exec(before);
    if (!match) return null;
    if (match[2] === "/" && before.trim() !== `/${match[3]}`) return null;
    return { symbol: match[2], query: match[3].toLowerCase(), start: caret - match[3].length - 1, end: caret };
  }, [text]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger) return [];
    const { symbol, query } = trigger;

    if (symbol === "@") {
      const people = (state.bootstrap?.members ?? [])
        .filter((member) => member.user.id !== state.session?.id)
        .filter((member) => {
          const haystack = `${member.user.displayName} ${member.user.handle ?? ""}`.toLowerCase();
          return !query || haystack.includes(query);
        })
        .slice(0, 8)
        .map((member) => ({
          id: member.user.id,
          label: member.user.displayName,
          hint: member.user.handle ? `@${member.user.handle}` : undefined,
          insert: `<@${member.user.id}> `,
          avatarUserId: member.user.id
        }));
      const groups = (state.bootstrap?.groups ?? [])
        .filter((group) => !query || group.handle.includes(query))
        .slice(0, 3)
        .map((group) => ({
          id: group.id,
          label: `@${group.handle}`,
          hint: `${group.memberIds.length} people`,
          insert: `<!group:${group.id}|${group.handle}> `
        }));
      const broadcasts = ["here", "channel", "everyone"]
        .filter((name) => !query || name.startsWith(query))
        .map((name) => ({
          id: name,
          label: `@${name}`,
          hint: name === "here" ? "Notify people who are active" : "Notify everyone in this conversation",
          insert: `<!${name}> `
        }));
      return [...people, ...groups, ...broadcasts];
    }

    if (symbol === "#") {
      return (state.bootstrap?.channels ?? [])
        .filter((channel) => !query || channel.name.includes(query))
        .slice(0, 8)
        .map((channel) => ({
          id: channel.id,
          label: `#${channel.name}`,
          hint: channel.topic ?? undefined,
          insert: `<#${channel.id}|${channel.name}> `
        }));
    }

    if (symbol === ":") {
      if (query.length < 1) return [];
      const custom = [...customEmoji.entries()]
        .filter(([name]) => name.includes(query))
        .slice(0, 4)
        .map(([name, url]) => ({ id: name, label: `:${name}:`, insert: `:${name}: `, preview: url }));
      const standard = searchEmoji(query, 8).map(([name, char]) => ({
        id: name,
        label: `:${name}:`,
        insert: `${char} `,
        preview: char
      }));
      return [...custom, ...standard];
    }

    return commands
      .filter((command) => !query || command.name.startsWith(query))
      .slice(0, 8)
      .map((command) => ({ id: command.name, label: command.usage, hint: command.description, insert: `/${command.name} ` }));
  }, [commands, customEmoji, state.bootstrap, state.session?.id, trigger]);

  useEffect(() => setSuggestionIndex(0), [suggestions.length]);

  const applySuggestion = (suggestion: Suggestion) => {
    if (!trigger) return;
    const next = `${text.slice(0, trigger.start)}${suggestion.insert}${text.slice(trigger.end)}`;
    setText(next);
    persistDraft(next);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      const caret = trigger.start + suggestion.insert.length;
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  /* --------------------------------------------------------------- actions */

  const wrapSelection = (before: string, after = before) => {
    const element = textareaRef.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = text.slice(start, end) || "text";
    const next = `${text.slice(0, start)}${before}${selected}${after}${text.slice(end)}`;
    setText(next);
    persistDraft(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const prefixLines = (prefix: string) => {
    const element = textareaRef.current;
    if (!element) return;
    const start = element.selectionStart;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const next = `${text.slice(0, lineStart)}${prefix}${text.slice(lineStart)}`;
    setText(next);
    persistDraft(next);
    requestAnimationFrame(() => element.focus());
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    const workspaceId = state.workspaceId;
    if (!workspaceId) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList).slice(0, 10)) {
        const { file: uploaded } = await api.files.upload(workspaceId, file, conversationId);
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (error) {
      actions.fail(error);
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body && attachments.length === 0) return;
    setText("");
    setAttachments([]);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    await actions.sendMessage({
      conversationId,
      bodyText: body,
      parentMessageId,
      threadBroadcast: parentMessageId ? broadcast : undefined,
      fileIds: attachments.map((file) => file.id)
    });
    setBroadcast(false);
    onSent?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSuggestionIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && suggestions[suggestionIndex])) {
        event.preventDefault();
        applySuggestion(suggestions[suggestionIndex]);
        return;
      }
      if (event.key === "Escape") {
        setText((value) => value);
        return;
      }
    }

    if (event.key === "ArrowUp" && !text.trim()) {
      const own = (state.messages[conversationId]?.items ?? [])
        .filter((message) => message.senderId === state.session?.id && !message.deletedAt && message.type === "user")
        .at(-1);
      if (own) {
        event.preventDefault();
        actions.setEditingMessage(own.id);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey && enterToSend) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      wrapSelection("*");
    }
    if (event.key === "i" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      wrapSelection("_");
    }
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    persistDraft(event.target.value);
    broadcastTyping();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
  };

  return (
    <div
      className={`composer ${dragOver ? "is-dragover" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {suggestions.length > 0 ? (
        <div className="suggestions" role="listbox">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.id}-${index}`}
              type="button"
              role="option"
              aria-selected={index === suggestionIndex}
              className={index === suggestionIndex ? "is-active" : ""}
              onMouseEnter={() => setSuggestionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(suggestion);
              }}
            >
              {suggestion.avatarUserId ? <Avatar user={directory.get(suggestion.avatarUserId)} size={20} presence={false} /> : null}
              {suggestion.preview && suggestion.preview.startsWith("/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={suggestion.preview} alt="" width={18} height={18} />
              ) : suggestion.preview ? (
                <span className="suggestion-emoji">{suggestion.preview}</span>
              ) : null}
              <span className="suggestion-label">{suggestion.label}</span>
              {suggestion.hint ? <span className="suggestion-hint">{suggestion.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="composer-box">
        <div className="composer-toolbar">
          <IconButton label="Bold" onClick={() => wrapSelection("*")}>
            <Bold size={15} />
          </IconButton>
          <IconButton label="Italic" onClick={() => wrapSelection("_")}>
            <Italic size={15} />
          </IconButton>
          <IconButton label="Strikethrough" onClick={() => wrapSelection("~")}>
            <Strikethrough size={15} />
          </IconButton>
          <span className="toolbar-divider" />
          <IconButton label="Link" onClick={() => wrapSelection("<", "|label>")}>
            <Link2 size={15} />
          </IconButton>
          <IconButton label="Ordered list" onClick={() => prefixLines("1. ")}>
            <ListOrdered size={15} />
          </IconButton>
          <IconButton label="Bulleted list" onClick={() => prefixLines("- ")}>
            <List size={15} />
          </IconButton>
          <IconButton label="Blockquote" onClick={() => prefixLines("> ")}>
            <Quote size={15} />
          </IconButton>
          <IconButton label="Inline code" onClick={() => wrapSelection("`")}>
            <Code size={15} />
          </IconButton>
          <IconButton label="Code block" onClick={() => wrapSelection("```\n", "\n```")}>
            <CodeSquare size={15} />
          </IconButton>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          autoFocus={autoFocus}
          aria-label={placeholder}
        />

        {attachments.length > 0 || uploading ? (
          <div className="attachment-tray">
            {attachments.map((file) => (
              <div key={file.id} className="attachment-chip">
                {file.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt="" />
                ) : (
                  <Paperclip size={14} />
                )}
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    setAttachments((current) => current.filter((entry) => entry.id !== file.id));
                    void api.files.remove(file.id).catch(() => undefined);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {uploading ? <span className="uploading">Uploading…</span> : null}
          </div>
        ) : null}

        <div className="composer-actions">
          <div className="composer-left">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
            />
            <IconButton label="Attach file" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={17} />
            </IconButton>
            <Popover
              width={340}
              trigger={({ toggle, ref }) => (
                <button type="button" className="icon-button" ref={ref} onClick={toggle} aria-label="Emoji">
                  <Smile size={17} />
                </button>
              )}
            >
              {(close) => (
                <EmojiPicker
                  onPick={(value) => {
                    const next = `${text}${text.endsWith(" ") || !text ? "" : " "}${value} `;
                    setText(next);
                    persistDraft(next);
                  }}
                  onClose={close}
                />
              )}
            </Popover>
            {parentMessageId ? (
              <label className="broadcast-toggle">
                <input type="checkbox" checked={broadcast} onChange={(event) => setBroadcast(event.target.checked)} />
                Also send to {conversation?.channel ? `#${conversation.channel.name}` : "conversation"}
              </label>
            ) : null}
          </div>

          <div className="composer-right">
            <IconButton
              label="Schedule for later"
              onClick={() =>
                actions.setModal({ kind: "schedule", conversationId, bodyText: text, parentMessageId })
              }
              disabled={!text.trim()}
            >
              <Timer size={17} />
            </IconButton>
            <button
              type="button"
              className="button primary send-button"
              onClick={() => void send()}
              disabled={!text.trim() && attachments.length === 0}
            >
              <Send size={15} /> Send
            </button>
          </div>
        </div>
      </div>
      <p className="composer-hint">
        {enterToSend ? "Enter to send · Shift+Enter for a new line" : "Cmd+Enter to send"} · Type / for commands
      </p>
    </div>
  );
}
