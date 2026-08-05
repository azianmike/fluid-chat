"use client";

import { Fragment, createContext, useContext, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMessage, type BlockNode, type InlineNode } from "@/shared/markdown";
import { emojiChar } from "../../emoji";
import { useApp, useCustomEmoji, useDirectory } from "../../store";

/** Terms to mark in message text, set by search results. */
const HighlightContext = createContext<string[]>([]);

export function HighlightProvider({ terms, children }: { terms: string[]; children: React.ReactNode }) {
  const value = useMemo(() => terms.filter((term) => term.length > 1), [terms]);
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMessage(text), [text]);
  return (
    <div className="rich-text">
      {blocks.map((block, index) => (
        <Block key={index} node={block} />
      ))}
    </div>
  );
}

function HighlightedText({ value }: { value: string }) {
  const terms = useContext(HighlightContext);
  if (terms.length === 0) return <>{value}</>;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = value.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
          <mark key={index}>{part}</mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Block({ node }: { node: BlockNode }) {
  switch (node.type) {
    case "paragraph":
      return (
        <p>
          <Inlines nodes={node.children} />
        </p>
      );
    case "codeblock":
      return <CodeBlock value={node.value} language={node.language} />;
    case "quote":
      return (
        <blockquote>
          {node.children.map((child, index) => (
            <Block key={index} node={child} />
          ))}
        </blockquote>
      );
    case "list":
      return node.ordered ? (
        <ol>
          {node.items.map((item, index) => (
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul>
          {node.items.map((item, index) => (
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

function CodeBlock({ value, language }: { value: string; language: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{language ?? "code"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}

function Inlines({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          <Inline node={node} />
        </Fragment>
      ))}
    </>
  );
}

function Inline({ node }: { node: InlineNode }) {
  const { state, actions } = useApp();
  const directory = useDirectory();
  const customEmoji = useCustomEmoji();

  switch (node.type) {
    case "text":
      return <HighlightedText value={node.value} />;
    case "bold":
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      );
    case "italic":
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case "strike":
      return (
        <s>
          <Inlines nodes={node.children} />
        </s>
      );
    case "code":
      return <code className="inline-code">{node.value}</code>;
    case "link":
      return (
        <a href={node.href} target="_blank" rel="noopener noreferrer nofollow">
          {node.label}
        </a>
      );
    case "mention": {
      const user = directory.get(node.userId);
      const isMe = state.session?.id === node.userId;
      return (
        <button
          type="button"
          className={`mention ${isMe ? "is-me" : ""}`}
          onClick={() => actions.setRightPanel({ kind: "profile", userId: node.userId })}
        >
          @{user?.displayName ?? "unknown"}
        </button>
      );
    }
    case "channel": {
      const conversation = state.bootstrap?.conversations.find((entry) => entry.channelId === node.channelId);
      const channel = state.bootstrap?.channels.find((entry) => entry.id === node.channelId);
      return (
        <button
          type="button"
          className="mention"
          onClick={() => {
            const target = conversation?.id ?? channel?.id;
            if (conversation) void actions.openConversation(conversation.id);
            else if (target) actions.setView({ kind: "browse" });
          }}
        >
          #{channel?.name ?? node.name}
        </button>
      );
    }
    case "broadcast":
      return <span className="mention is-broadcast">@{node.name}</span>;
    case "group":
      return <span className="mention">@{node.handle}</span>;
    case "emoji": {
      const custom = customEmoji.get(node.name);
      if (custom) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img className="inline-emoji" src={custom} alt={`:${node.name}:`} width={20} height={20} />;
      }
      const char = emojiChar(node.name);
      return char ? <span className="inline-emoji-char">{char}</span> : <>{`:${node.name}:`}</>;
    }
    default:
      return null;
  }
}

/** Renders a reaction value: a literal emoji, or `:name:` for custom emoji. */
export function EmojiValue({ value }: { value: string }) {
  const customEmoji = useCustomEmoji();
  const match = /^:([a-z0-9_+-]+):$/i.exec(value);
  if (match) {
    const url = customEmoji.get(match[1].toLowerCase());
    if (url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="inline-emoji" src={url} alt={value} width={18} height={18} />;
    }
    return <span>{emojiChar(match[1]) ?? value}</span>;
  }
  return <span>{value}</span>;
}
