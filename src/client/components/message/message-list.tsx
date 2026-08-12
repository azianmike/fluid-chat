"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { MessageDto } from "@/shared/types";
import { formatDayLabel, isSameDay } from "../../format";
import { typingKey, useApp, useDirectory } from "../../store";
import { Spinner } from "../ui/primitives";
import { MessageItem } from "./message-item";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
// Tight on purpose: scrolling up even a little is a deliberate act, and we should
// stop following the bottom the moment the reader does.
const BOTTOM_THRESHOLD_PX = 48;

export function MessageList({ conversationId }: { conversationId: string }) {
  const { state, actions } = useApp();
  const bucket = state.messages[conversationId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const previousHeight = useRef(0);
  const lastHeight = useRef(0);
  const unreadMarkerId = state.lastReadMarkers[conversationId] ?? null;
  const messages = useMemo(() => bucket?.items ?? [], [bucket]);
  const ready = !!bucket && !(bucket.loading && messages.length === 0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinned.current = distanceFromBottom < BOTTOM_THRESHOLD_PX;
    setAtBottom(pinned.current);
    if (element.scrollTop < 240 && bucket?.hasMore && !bucket.loading) {
      previousHeight.current = element.scrollHeight;
      void actions.loadOlderMessages(conversationId);
    }
  }, [actions, bucket?.hasMore, bucket?.loading, conversationId]);

  // Keep the viewport anchored when older history is prepended.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || previousHeight.current === 0) return;
    const delta = element.scrollHeight - previousHeight.current;
    if (delta > 0) element.scrollTop += delta;
    previousHeight.current = 0;
  }, [messages.length]);

  // Follow the bottom only when the list actually gets *taller* — a new message, a
  // reaction chip, an edit, an image finishing its load. Reflows that leave the
  // height alone (hover states, scrollbars, width changes) must not move the view.
  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      const height = element.scrollHeight;
      const grew = height > lastHeight.current;
      lastHeight.current = height;
      // The history anchor above owns scrollTop until it has run.
      if (!grew || !pinned.current || previousHeight.current !== 0) return;
      element.scrollTop = height;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [ready]);

  useLayoutEffect(() => {
    pinned.current = true;
    previousHeight.current = 0;
    lastHeight.current = 0;
    setAtBottom(true);
    scrollToBottom();
  }, [conversationId, ready, scrollToBottom]);

  if (!bucket || (bucket.loading && messages.length === 0)) {
    return (
      <div className="message-scroll is-loading">
        <Spinner label="Loading messages" />
      </div>
    );
  }

  return (
    <div className="message-scroll-wrap">
      <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
        <div ref={contentRef}>
          {bucket.hasMore ? (
            <div className="history-loader">{bucket.loading ? <Spinner label="Loading history" /> : "Scroll for older messages"}</div>
          ) : (
            <ConversationIntro conversationId={conversationId} />
          )}

          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const showDay = !previous || !isSameDay(new Date(previous.createdAt), new Date(message.createdAt));
            const grouped =
              !showDay &&
              !!previous &&
              previous.senderId === message.senderId &&
              previous.type === "user" &&
              message.type === "user" &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;

            return (
              <div key={message.id}>
                {showDay ? (
                  <div className="day-divider">
                    <span>{formatDayLabel(message.createdAt)}</span>
                  </div>
                ) : null}
                {unreadMarkerId === message.id ? (
                  <div className="unread-divider">
                    <span>New messages</span>
                  </div>
                ) : null}
                <MessageItem message={message} grouped={grouped} />
              </div>
            );
          })}
        </div>
      </div>

      <TypingIndicator conversationId={conversationId} />

      {!atBottom ? (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            pinned.current = true;
            setAtBottom(true);
            scrollToBottom("smooth");
          }}
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      ) : null}
    </div>
  );
}

function ConversationIntro({ conversationId }: { conversationId: string }) {
  const { state } = useApp();
  const directory = useDirectory();
  const conversation = state.bootstrap?.conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return null;

  if (conversation.channel) {
    return (
      <div className="conversation-intro">
        <h2>
          {conversation.channel.visibility === "private" ? "🔒" : "#"} {conversation.channel.name}
        </h2>
        <p>
          This is the very beginning of the{" "}
          <strong>
            {conversation.channel.visibility === "private" ? "" : "#"}
            {conversation.channel.name}
          </strong>{" "}
          channel.{conversation.channel.description ? ` ${conversation.channel.description}` : ""}
        </p>
      </div>
    );
  }

  const others = conversation.memberIds.filter((id) => id !== state.session?.id).map((id) => directory.get(id));
  return (
    <div className="conversation-intro">
      <h2>{others.map((user) => user?.displayName ?? "Someone").join(", ")}</h2>
      <p>This is the start of your direct message history. Only the people here can see it.</p>
    </div>
  );
}

export function TypingIndicator({
  conversationId,
  parentMessageId = null
}: {
  conversationId: string;
  parentMessageId?: string | null;
}) {
  const { state } = useApp();
  const directory = useDirectory();
  const typing = state.typing[typingKey(conversationId, parentMessageId)];
  const names = Object.keys(typing ?? {})
    .map((userId) => directory.get(userId)?.displayName)
    .filter(Boolean) as string[];

  if (names.length === 0) return <div className="typing-indicator" aria-live="polite" />;
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : "Several people are typing";
  return (
    <div className="typing-indicator is-active" aria-live="polite">
      <span className="typing-dots">
        <i />
        <i />
        <i />
      </span>
      {label}…
    </div>
  );
}

export function MessageStack({ messages, context = "list" }: { messages: MessageDto[]; context?: "thread" | "list" }) {
  return (
    <>
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const grouped =
          !!previous &&
          previous.senderId === message.senderId &&
          previous.type === "user" &&
          message.type === "user" &&
          new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
        return <MessageItem key={message.id} message={message} grouped={grouped} context={context} />;
      })}
    </>
  );
}
