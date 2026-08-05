"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from "react";
import { io, type Socket } from "socket.io-client";
import { api, ApiError, type SlashOutcome } from "./api";
import { playNotificationSound } from "./sound";
import { isWithinQuietHours } from "@/shared/quiet-hours";
import type {
  ConversationSummary,
  MessageDto,
  NotificationDto,
  PublicUser,
  RealtimeEvent,
  SessionUser,
  WorkspaceBootstrap,
  WorkspaceMembership
} from "@/shared/types";

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export type View =
  | { kind: "conversation"; conversationId: string }
  | { kind: "activity" }
  | { kind: "threads" }
  | { kind: "saved" }
  | { kind: "drafts" }
  | { kind: "unreads" }
  | { kind: "files" }
  | { kind: "browse" }
  | { kind: "people" }
  | { kind: "search"; query: string };

export type RightPanel =
  | { kind: "thread"; messageId: string }
  | { kind: "profile"; userId: string }
  | { kind: "details"; conversationId: string }
  | { kind: "pins"; conversationId: string }
  | { kind: "files"; conversationId: string }
  | null;

export type ModalState =
  | { kind: "quick-switcher" }
  | { kind: "preferences" }
  | { kind: "admin" }
  | { kind: "invite" }
  | { kind: "new-channel" }
  | { kind: "new-dm" }
  | { kind: "add-people"; conversationId: string }
  | { kind: "shortcuts" }
  | { kind: "status" }
  | { kind: "profile-editor" }
  | { kind: "schedule"; conversationId: string; bodyText: string; parentMessageId: string | null }
  | { kind: "share"; messageId: string }
  | { kind: "create-workspace" }
  | null;

export type Toast = { id: string; text: string; tone: "info" | "error" | "success" };

export type MessageBucket = { items: MessageDto[]; hasMore: boolean; loading: boolean };

export type State = {
  status: "loading" | "anonymous" | "ready";
  session: SessionUser | null;
  memberships: WorkspaceMembership[];
  workspaceId: string | null;
  bootstrap: WorkspaceBootstrap | null;
  view: View;
  rightPanel: RightPanel;
  modal: ModalState;
  messages: Record<string, MessageBucket>;
  threads: Record<string, MessageDto[]>;
  typing: Record<string, Record<string, number>>;
  notifications: NotificationDto[];
  unreadNotifications: number;
  drafts: Record<string, string>;
  toasts: Toast[];
  connected: boolean;
  lastReadMarkers: Record<string, string | null>;
  editingMessageId: string | null;
  sidebarOpen: boolean;
};

const initialState: State = {
  status: "loading",
  session: null,
  memberships: [],
  workspaceId: null,
  bootstrap: null,
  view: { kind: "activity" },
  rightPanel: null,
  modal: null,
  messages: {},
  threads: {},
  typing: {},
  notifications: [],
  unreadNotifications: 0,
  drafts: {},
  toasts: [],
  connected: false,
  lastReadMarkers: {},
  editingMessageId: null,
  sidebarOpen: false
};

type Action =
  | { type: "session"; session: SessionUser | null; memberships: WorkspaceMembership[] }
  | { type: "workspace"; workspaceId: string | null }
  | { type: "bootstrap"; bootstrap: WorkspaceBootstrap }
  | { type: "conversations"; conversations: ConversationSummary[] }
  | { type: "view"; view: View }
  | { type: "right-panel"; panel: RightPanel }
  | { type: "modal"; modal: ModalState }
  | { type: "messages"; conversationId: string; bucket: Partial<MessageBucket> }
  | { type: "prepend-messages"; conversationId: string; items: MessageDto[]; hasMore: boolean }
  | { type: "upsert-message"; message: MessageDto }
  | { type: "remove-message"; conversationId: string; messageId: string; parentMessageId: string | null }
  | { type: "reactions"; conversationId: string; messageId: string; reactions: MessageDto["reactions"] }
  | { type: "thread"; rootId: string; messages: MessageDto[] }
  | { type: "typing"; conversationId: string; userId: string; parentMessageId: string | null }
  | { type: "prune-typing" }
  | { type: "notifications"; notifications: NotificationDto[]; unreadCount: number }
  | { type: "notification"; notification: NotificationDto }
  | { type: "read"; conversationId: string; lastReadAt: string | null }
  | { type: "unread-marker"; conversationId: string; messageId: string | null }
  | { type: "draft"; key: string; bodyText: string }
  | { type: "presence"; userId: string; presence: PublicUser["presence"] }
  | { type: "user"; user: PublicUser }
  | { type: "connected"; connected: boolean }
  | { type: "editing"; messageId: string | null }
  | { type: "sidebar"; open: boolean }
  | { type: "toast"; toast: Toast }
  | { type: "dismiss-toast"; id: string }
  | { type: "reset" };

export function typingKey(conversationId: string, parentMessageId?: string | null) {
  return `${conversationId}:${parentMessageId ?? "root"}`;
}

function sortByCreatedAt(items: MessageDto[]) {
  return [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function mergeMessage(items: MessageDto[], message: MessageDto) {
  const existingIndex = items.findIndex(
    (item) =>
      item.id === message.id ||
      (!!message.clientMessageId && item.clientMessageId === message.clientMessageId)
  );
  if (existingIndex === -1) return sortByCreatedAt([...items, message]);
  const next = [...items];
  next[existingIndex] = { ...next[existingIndex], ...message };
  return next;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "session":
      return {
        ...state,
        session: action.session,
        memberships: action.memberships,
        status: action.session ? "ready" : "anonymous"
      };
    case "workspace":
      return { ...state, workspaceId: action.workspaceId, bootstrap: null, messages: {}, threads: {} };
    case "bootstrap": {
      const drafts = { ...state.drafts };
      for (const draft of action.bootstrap.drafts) {
        drafts[`${draft.conversationId}:${draft.parentMessageId ?? "root"}`] = draft.bodyText;
      }
      return {
        ...state,
        bootstrap: action.bootstrap,
        drafts,
        unreadNotifications: action.bootstrap.unreadNotifications
      };
    }
    case "conversations":
      return state.bootstrap
        ? { ...state, bootstrap: { ...state.bootstrap, conversations: action.conversations } }
        : state;
    case "view":
      return { ...state, view: action.view, modal: null };
    case "right-panel":
      return { ...state, rightPanel: action.panel };
    case "modal":
      return { ...state, modal: action.modal };
    case "messages": {
      const current = state.messages[action.conversationId] ?? { items: [], hasMore: false, loading: false };
      return {
        ...state,
        messages: { ...state.messages, [action.conversationId]: { ...current, ...action.bucket } }
      };
    }
    case "prepend-messages": {
      const current = state.messages[action.conversationId] ?? { items: [], hasMore: false, loading: false };
      const seen = new Set(current.items.map((item) => item.id));
      const merged = sortByCreatedAt([...action.items.filter((item) => !seen.has(item.id)), ...current.items]);
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { items: merged, hasMore: action.hasMore, loading: false }
        }
      };
    }
    case "upsert-message": {
      const { message } = action;
      const next = { ...state };
      const rootId = message.parentMessageId;

      if (!rootId || message.threadBroadcast) {
        const bucket = state.messages[message.conversationId];
        if (bucket) {
          next.messages = {
            ...state.messages,
            [message.conversationId]: { ...bucket, items: mergeMessage(bucket.items, message) }
          };
        }
      }
      if (rootId) {
        const thread = state.threads[rootId];
        if (thread) next.threads = { ...state.threads, [rootId]: mergeMessage(thread, message) };
        const parentBucket = next.messages[message.conversationId];
        if (parentBucket) {
          next.messages = {
            ...next.messages,
            [message.conversationId]: {
              ...parentBucket,
              items: parentBucket.items.map((item) =>
                item.id === rootId
                  ? {
                      ...item,
                      thread: {
                        ...item.thread,
                        replyCount: Math.max(item.thread.replyCount, 1),
                        lastReplyAt: message.createdAt,
                        participantIds: Array.from(new Set([...item.thread.participantIds, message.senderId]))
                      }
                    }
                  : item
              )
            }
          };
        }
      }
      if (state.threads[message.id]) {
        next.threads = { ...next.threads, [message.id]: mergeMessage(state.threads[message.id], message) };
      }
      return next;
    }
    case "remove-message": {
      const next = { ...state };
      const bucket = state.messages[action.conversationId];
      if (bucket) {
        next.messages = {
          ...state.messages,
          [action.conversationId]: {
            ...bucket,
            items: bucket.items.map((item) =>
              item.id === action.messageId ? { ...item, deletedAt: new Date().toISOString(), bodyText: "" } : item
            )
          }
        };
      }
      if (action.parentMessageId && state.threads[action.parentMessageId]) {
        next.threads = {
          ...next.threads,
          [action.parentMessageId]: state.threads[action.parentMessageId].map((item) =>
            item.id === action.messageId ? { ...item, deletedAt: new Date().toISOString(), bodyText: "" } : item
          )
        };
      }
      return next;
    }
    case "reactions": {
      const apply = (items: MessageDto[]) =>
        items.map((item) => (item.id === action.messageId ? { ...item, reactions: action.reactions } : item));
      const next = { ...state };
      const bucket = state.messages[action.conversationId];
      if (bucket) {
        next.messages = { ...state.messages, [action.conversationId]: { ...bucket, items: apply(bucket.items) } };
      }
      next.threads = Object.fromEntries(
        Object.entries(state.threads).map(([rootId, items]) => [rootId, apply(items)])
      );
      return next;
    }
    case "thread":
      return { ...state, threads: { ...state.threads, [action.rootId]: action.messages } };
    case "typing": {
      // Typing is tracked per composer, so a thread reply does not light up the
      // channel footer and vice versa.
      const key = typingKey(action.conversationId, action.parentMessageId);
      return {
        ...state,
        typing: { ...state.typing, [key]: { ...(state.typing[key] ?? {}), [action.userId]: Date.now() } }
      };
    }
    case "prune-typing": {
      const cutoff = Date.now() - 6000;
      const typing: State["typing"] = {};
      let changed = false;
      for (const [conversationId, users] of Object.entries(state.typing)) {
        const active = Object.entries(users).filter(([, at]) => at > cutoff);
        if (active.length !== Object.keys(users).length) changed = true;
        if (active.length > 0) typing[conversationId] = Object.fromEntries(active);
      }
      return changed ? { ...state, typing } : state;
    }
    case "notifications":
      return { ...state, notifications: action.notifications, unreadNotifications: action.unreadCount };
    case "notification":
      return {
        ...state,
        notifications: [action.notification, ...state.notifications].slice(0, 100),
        unreadNotifications: state.unreadNotifications + 1
      };
    case "read":
      return state.bootstrap
        ? {
            ...state,
            bootstrap: {
              ...state.bootstrap,
              conversations: state.bootstrap.conversations.map((conversation) =>
                conversation.id === action.conversationId
                  ? {
                      ...conversation,
                      unreadCount: 0,
                      mentionCount: 0,
                      membership: conversation.membership
                        ? { ...conversation.membership, lastReadAt: action.lastReadAt }
                        : conversation.membership
                    }
                  : conversation
              )
            }
          }
        : state;
    case "unread-marker":
      return { ...state, lastReadMarkers: { ...state.lastReadMarkers, [action.conversationId]: action.messageId } };
    case "draft":
      return { ...state, drafts: { ...state.drafts, [action.key]: action.bodyText } };
    case "presence":
      return state.bootstrap
        ? {
            ...state,
            bootstrap: {
              ...state.bootstrap,
              members: state.bootstrap.members.map((member) =>
                member.user.id === action.userId
                  ? { ...member, user: { ...member.user, presence: action.presence } }
                  : member
              )
            }
          }
        : state;
    case "user":
      return {
        ...state,
        session: state.session?.id === action.user.id ? { ...state.session, ...action.user } : state.session,
        bootstrap: state.bootstrap
          ? {
              ...state.bootstrap,
              members: state.bootstrap.members.map((member) =>
                member.user.id === action.user.id ? { ...member, user: action.user } : member
              )
            }
          : state.bootstrap
      };
    case "connected":
      return { ...state, connected: action.connected };
    case "editing":
      return { ...state, editingMessageId: action.messageId };
    case "sidebar":
      return { ...state, sidebarOpen: action.open };
    case "toast":
      return { ...state, toasts: [...state.toasts, action.toast].slice(-4) };
    case "dismiss-toast":
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case "reset":
      return { ...initialState, status: "anonymous" };
    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

export type Actions = ReturnType<typeof useActions>;

const AppContext = createContext<{ state: State; actions: Actions } | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}

function draftKey(conversationId: string, parentMessageId?: string | null) {
  return `${conversationId}:${parentMessageId ?? "root"}`;
}

function useActions(state: State, dispatch: React.Dispatch<Action>) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef<Socket | null>(null);

  const toast = useCallback(
    (text: string, tone: Toast["tone"] = "info") => {
      dispatch({ type: "toast", toast: { id: crypto.randomUUID(), text, tone } });
    },
    [dispatch]
  );

  const fail = useCallback(
    (error: unknown) => {
      const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong";
      toast(message, "error");
    },
    [toast]
  );

  const refreshConversations = useCallback(async () => {
    const workspaceId = stateRef.current.workspaceId;
    if (!workspaceId) return;
    try {
      const { conversations } = await api.conversations.list(workspaceId);
      dispatch({ type: "conversations", conversations });
    } catch (error) {
      fail(error);
    }
  }, [dispatch, fail]);

  const refreshBootstrap = useCallback(
    async (workspaceId?: string) => {
      const id = workspaceId ?? stateRef.current.workspaceId;
      if (!id) return;
      const bootstrap = await api.workspaces.bootstrap(id);
      dispatch({ type: "bootstrap", bootstrap });
      return bootstrap;
    },
    [dispatch]
  );

  const loadNotifications = useCallback(async () => {
    const workspaceId = stateRef.current.workspaceId;
    if (!workspaceId) return;
    const { notifications, unreadCount } = await api.activity.notifications(workspaceId);
    dispatch({ type: "notifications", notifications, unreadCount });
  }, [dispatch]);

  const markRead = useCallback(
    async (conversationId: string, messageId?: string) => {
      try {
        const { lastReadAt } = await api.conversations.markRead(conversationId, messageId);
        dispatch({ type: "read", conversationId, lastReadAt });
        void loadNotifications();
      } catch {
        /* read receipts are best-effort */
      }
    },
    [dispatch, loadNotifications]
  );

  const loadMessages = useCallback(
    async (conversationId: string) => {
      dispatch({ type: "messages", conversationId, bucket: { loading: true } });
      try {
        const { messages, hasMore } = await api.conversations.messages(conversationId, { limit: 50 });
        dispatch({ type: "messages", conversationId, bucket: { items: messages, hasMore, loading: false } });

        const conversation = stateRef.current.bootstrap?.conversations.find((entry) => entry.id === conversationId);
        const lastReadAt = conversation?.membership?.lastReadAt ?? null;
        const firstUnread = lastReadAt
          ? messages.find(
              (message) =>
                new Date(message.createdAt) > new Date(lastReadAt) &&
                message.senderId !== stateRef.current.session?.id
            )
          : undefined;
        dispatch({ type: "unread-marker", conversationId, messageId: firstUnread?.id ?? null });
        await markRead(conversationId, messages.at(-1)?.id);
      } catch (error) {
        dispatch({ type: "messages", conversationId, bucket: { loading: false } });
        fail(error);
      }
    },
    [dispatch, fail, markRead]
  );

  const loadOlderMessages = useCallback(
    async (conversationId: string) => {
      const bucket = stateRef.current.messages[conversationId];
      if (!bucket || bucket.loading || !bucket.hasMore || bucket.items.length === 0) return;
      dispatch({ type: "messages", conversationId, bucket: { loading: true } });
      try {
        const { messages, hasMore } = await api.conversations.messages(conversationId, {
          before: bucket.items[0].createdAt,
          limit: 50
        });
        dispatch({ type: "prepend-messages", conversationId, items: messages, hasMore });
      } catch (error) {
        dispatch({ type: "messages", conversationId, bucket: { loading: false } });
        fail(error);
      }
    },
    [dispatch, fail]
  );

  /** "Jump to date": reload the conversation starting at a chosen day. */
  const jumpToDate = useCallback(
    async (conversationId: string, isoDate: string) => {
      dispatch({ type: "messages", conversationId, bucket: { loading: true } });
      try {
        const { messages } = await api.conversations.messages(conversationId, {
          after: new Date(isoDate).toISOString(),
          limit: 50
        });
        dispatch({
          type: "messages",
          conversationId,
          bucket: { items: messages, hasMore: true, loading: false }
        });
        if (messages.length === 0) toast("No messages on or after that date");
      } catch (error) {
        dispatch({ type: "messages", conversationId, bucket: { loading: false } });
        fail(error);
      }
    },
    [dispatch, fail, toast]
  );

  const openConversation = useCallback(
    async (conversationId: string) => {
      dispatch({ type: "view", view: { kind: "conversation", conversationId } });
      dispatch({ type: "right-panel", panel: null });
      dispatch({ type: "sidebar", open: false });
      await loadMessages(conversationId);
    },
    [dispatch, loadMessages]
  );

  const openThread = useCallback(
    async (messageId: string) => {
      dispatch({ type: "right-panel", panel: { kind: "thread", messageId } });
      try {
        const { messages } = await api.messages.thread(messageId);
        dispatch({ type: "thread", rootId: messageId, messages });
      } catch (error) {
        fail(error);
      }
    },
    [dispatch, fail]
  );

  const sendMessage = useCallback(
    async (input: {
      conversationId: string;
      bodyText: string;
      parentMessageId?: string | null;
      threadBroadcast?: boolean;
      fileIds?: string[];
    }): Promise<SlashOutcome | null> => {
      const session = stateRef.current.session;
      if (!session) return null;
      const clientMessageId = crypto.randomUUID();
      const isCommand = input.bodyText.trim().startsWith("/");

      if (!isCommand) {
        const optimistic: MessageDto = {
          id: `pending-${clientMessageId}`,
          workspaceId: stateRef.current.workspaceId ?? "",
          conversationId: input.conversationId,
          senderId: session.id,
          parentMessageId: input.parentMessageId ?? null,
          clientMessageId,
          type: "user",
          bodyText: input.bodyText,
          metadata: { pending: true },
          threadBroadcast: input.threadBroadcast ?? false,
          editedAt: null,
          deletedAt: null,
          createdAt: new Date().toISOString(),
          reactions: [],
          files: [],
          links: [],
          thread: { replyCount: 0, lastReplyAt: null, participantIds: [], following: true },
          pinned: false,
          saved: false
        };
        dispatch({ type: "upsert-message", message: optimistic });
      }

      try {
        const response = await api.conversations.send(input.conversationId, {
          bodyText: input.bodyText,
          clientMessageId,
          parentMessageId: input.parentMessageId ?? undefined,
          threadBroadcast: input.threadBroadcast,
          fileIds: input.fileIds
        });
        if (response.message) dispatch({ type: "upsert-message", message: response.message });
        dispatch({ type: "draft", key: draftKey(input.conversationId, input.parentMessageId), bodyText: "" });
        void api.conversations
          .saveDraft(input.conversationId, "", input.parentMessageId ?? null)
          .catch(() => undefined);
        void refreshConversations();
        if (response.command) {
          if (response.command.kind === "ephemeral") toast(response.command.text);
          if (response.command.kind === "navigate") {
            if (response.command.text) toast(response.command.text);
            await refreshBootstrap();
            await openConversation(response.command.conversationId);
          }
          return response.command;
        }
        return null;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [dispatch, fail, openConversation, refreshBootstrap, refreshConversations, toast]
  );

  const toggleReaction = useCallback(
    async (message: MessageDto, emoji: string) => {
      const reacted = message.reactions.find((reaction) => reaction.emoji === emoji)?.reacted;
      try {
        const { reactions } = reacted
          ? await api.messages.removeReaction(message.id, emoji)
          : await api.messages.addReaction(message.id, emoji);
        dispatch({ type: "reactions", conversationId: message.conversationId, messageId: message.id, reactions });
      } catch (error) {
        fail(error);
      }
    },
    [dispatch, fail]
  );

  const saveDraft = useCallback(
    (conversationId: string, bodyText: string, parentMessageId?: string | null) => {
      dispatch({ type: "draft", key: draftKey(conversationId, parentMessageId), bodyText });
      void api.conversations.saveDraft(conversationId, bodyText, parentMessageId ?? null).catch(() => undefined);
    },
    [dispatch]
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      dispatch({ type: "workspace", workspaceId });
      window.localStorage.setItem("openchat:workspace", workspaceId);
      try {
        const bootstrap = await refreshBootstrap(workspaceId);
        const first =
          bootstrap?.conversations.find((conversation) => conversation.channel?.name === "general") ??
          bootstrap?.conversations[0];
        if (first) await openConversation(first.id);
        else dispatch({ type: "view", view: { kind: "browse" } });
        await loadNotifications();
      } catch (error) {
        fail(error);
      }
    },
    [dispatch, fail, loadNotifications, openConversation, refreshBootstrap]
  );

  /** Shift+Esc: clear every unread badge in the workspace. */
  const markEverythingRead = useCallback(async () => {
    const conversations = stateRef.current.bootstrap?.conversations ?? [];
    const unread = conversations.filter((conversation) => conversation.unreadCount > 0);
    await Promise.all(
      unread.map((conversation) => api.conversations.markRead(conversation.id).catch(() => undefined))
    );
    const workspaceId = stateRef.current.workspaceId;
    if (workspaceId) await api.activity.markNotificationsRead(workspaceId).catch(() => undefined);
    await refreshConversations();
    await loadNotifications();
    toast(unread.length > 0 ? `Marked ${unread.length} conversation${unread.length === 1 ? "" : "s"} read` : "All caught up");
  }, [loadNotifications, refreshConversations, toast]);

  const applySession = useCallback(
    (session: SessionUser) => dispatch({ type: "session", session, memberships: stateRef.current.memberships }),
    [dispatch]
  );

  const updatePreferences = useCallback(
    async (input: Record<string, unknown>) => {
      try {
        const { user } = await api.users.updatePreferences(input);
        applySession(user);
      } catch (error) {
        fail(error);
      }
    },
    [applySession, fail]
  );

  const updateProfile = useCallback(
    async (input: Record<string, unknown>) => {
      const { user } = await api.users.updateProfile(input);
      applySession(user);
      return user;
    },
    [applySession]
  );

  const setStatus = useCallback(
    async (input: { emoji: string | null; text: string | null; expiresAt?: string | null }) => {
      const { user } = await api.users.setStatus(input);
      applySession(user);
    },
    [applySession]
  );

  const setPresence = useCallback(
    async (presence: "active" | "away" | "dnd" | "offline", dndUntil?: string | null) => {
      const { user } = await api.users.setPresence(presence, dndUntil);
      applySession(user);
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    socketRef.current?.disconnect();
    dispatch({ type: "reset" });
  }, [dispatch]);

  return useMemo(
    () => ({
      dispatch,
      toast,
      fail,
      socketRef,
      refreshBootstrap,
      refreshConversations,
      loadNotifications,
      loadMessages,
      loadOlderMessages,
      openConversation,
      openThread,
      jumpToDate,
      sendMessage,
      toggleReaction,
      markRead,
      markEverythingRead,
      saveDraft,
      selectWorkspace,
      signOut,
      updatePreferences,
      updateProfile,
      setStatus,
      setPresence,
      setView: (view: View) => {
        dispatch({ type: "view", view });
        dispatch({ type: "sidebar", open: false });
      },
      setSidebarOpen: (open: boolean) => dispatch({ type: "sidebar", open }),
      setRightPanel: (panel: RightPanel) => dispatch({ type: "right-panel", panel }),
      setEditingMessage: (messageId: string | null) => dispatch({ type: "editing", messageId }),
      setModal: (modal: ModalState) => dispatch({ type: "modal", modal }),
      upsertMessage: (message: MessageDto) => dispatch({ type: "upsert-message", message }),
      setSession: (session: SessionUser | null, memberships: WorkspaceMembership[]) =>
        dispatch({ type: "session", session, memberships }),
      dismissToast: (id: string) => dispatch({ type: "dismiss-toast", id })
    }),
    [
      dispatch,
      fail,
      jumpToDate,
      loadMessages,
      loadNotifications,
      loadOlderMessages,
      markEverythingRead,
      markRead,
      openConversation,
      openThread,
      refreshBootstrap,
      refreshConversations,
      saveDraft,
      selectWorkspace,
      sendMessage,
      setPresence,
      setStatus,
      signOut,
      toast,
      toggleReaction,
      updatePreferences,
      updateProfile
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const actions = useActions(state, dispatch);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Initial session load.
  useEffect(() => {
    let cancelled = false;
    api.auth
      .me()
      .then(async ({ user, workspaces }) => {
        if (cancelled) return;
        dispatch({ type: "session", session: user, memberships: workspaces });
        if (!user || workspaces.length === 0) return;
        const stored = window.localStorage.getItem("openchat:workspace");
        const target = workspaces.find((entry) => entry.workspace.id === stored) ?? workspaces[0];
        await actions.selectWorkspace(target.workspace.id);
      })
      .catch(() => dispatch({ type: "session", session: null, memberships: [] }));
    return () => {
      cancelled = true;
    };
    // Runs once on mount; `actions` is stable enough for this bootstrap path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime connection: one socket per session, rooms follow the workspace.
  useEffect(() => {
    if (!state.session || !state.workspaceId || !state.bootstrap) return;
    const socket = io(process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:3001", {
      withCredentials: true,
      transports: ["websocket", "polling"]
    });
    actions.socketRef.current = socket;

    const rooms = [
      `user:${state.session.id}`,
      `workspace:${state.workspaceId}`,
      ...state.bootstrap.conversations.map((conversation) => `conversation:${conversation.id}`)
    ];

    socket.on("connect", () => {
      dispatch({ type: "connected", connected: true });
      socket.emit("join", rooms);
    });
    socket.on("disconnect", () => dispatch({ type: "connected", connected: false }));

    socket.on("event", (event: RealtimeEvent) => {
      switch (event.type) {
        case "message.created":
        case "message.updated": {
          dispatch({ type: "upsert-message", message: event.message });
          // Someone who joined after this client booted: refresh the directory
          // so their name and avatar render instead of "Unknown".
          const known = stateRef.current.bootstrap?.members.some((member) => member.user.id === event.message.senderId);
          if (!known) void actions.refreshBootstrap();
          if (
            event.type === "message.created" &&
            event.message.senderId !== stateRef.current.session?.id
          ) {
            const active =
              stateRef.current.view.kind === "conversation" &&
              stateRef.current.view.conversationId === event.conversationId;
            if (active && document.visibilityState === "visible") {
              void actions.markRead(event.conversationId, event.message.id);
            } else {
              void actions.refreshConversations();
            }
          }
          break;
        }
        case "message.deleted":
          dispatch({
            type: "remove-message",
            conversationId: event.conversationId,
            messageId: event.messageId,
            parentMessageId: event.parentMessageId
          });
          break;
        case "reaction.changed":
          dispatch({
            type: "reactions",
            conversationId: event.conversationId,
            messageId: event.messageId,
            reactions: event.reactions
          });
          break;
        case "typing":
          if (event.userId !== stateRef.current.session?.id) {
            dispatch({
              type: "typing",
              conversationId: event.conversationId,
              userId: event.userId,
              parentMessageId: event.parentMessageId
            });
          }
          break;
        case "presence":
          dispatch({ type: "presence", userId: event.userId, presence: event.presence });
          break;
        case "user.updated":
          dispatch({ type: "user", user: event.user });
          break;
        case "notification.created": {
          dispatch({ type: "notification", notification: event.notification });
          const wanted = ["mention", "dm", "thread_reply", "keyword", "reminder"].includes(event.notification.type);
          const preferences = stateRef.current.session?.preferences;
          const quiet = isWithinQuietHours(
            { start: preferences?.quietHoursStart, end: preferences?.quietHoursEnd },
            new Date(),
            stateRef.current.session?.timezone
          );
          if (wanted && !quiet && preferences?.notificationSound !== false) {
            playNotificationSound();
          }
          break;
        }
        case "conversation.updated":
          void actions.refreshConversations();
          break;
        case "channel.created":
        case "channel.updated":
        case "member.changed":
          void actions.refreshBootstrap();
          break;
        case "pin.changed":
          void actions.refreshConversations();
          break;
        default:
          break;
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      actions.socketRef.current = null;
    };
  }, [state.session?.id, state.workspaceId, state.bootstrap?.conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to the tab clears the badge for whatever is on screen.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      const view = stateRef.current.view;
      if (view.kind !== "conversation") return;
      const last = stateRef.current.messages[view.conversationId]?.items.at(-1);
      void actions.markRead(view.conversationId, last?.id);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [actions]);

  // Typing indicators fade out on their own.
  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: "prune-typing" }), 2000);
    return () => clearInterval(timer);
  }, []);

  // Presence heartbeat keeps the green dot honest without a socket dependency.
  useEffect(() => {
    if (!state.session) return;
    const beat = () => {
      if (document.visibilityState === "visible") {
        void api.users.heartbeat().catch(() => undefined);
        actions.socketRef.current?.emit("heartbeat");
      }
    };
    beat();
    const timer = setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [state.session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

export function useConversation(conversationId: string | null | undefined) {
  const { state } = useApp();
  return useMemo(
    () => state.bootstrap?.conversations.find((conversation) => conversation.id === conversationId) ?? null,
    [state.bootstrap, conversationId]
  );
}

export function useDirectory() {
  const { state } = useApp();
  return useMemo(() => {
    const map = new Map<string, PublicUser>();
    for (const member of state.bootstrap?.members ?? []) map.set(member.user.id, member.user);
    for (const bot of state.bootstrap?.bots ?? []) map.set(bot.id, bot);
    if (state.session) map.set(state.session.id, state.session);
    return map;
  }, [state.bootstrap, state.session]);
}

export function useCustomEmoji() {
  const { state } = useApp();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const emoji of state.bootstrap?.emoji ?? []) map.set(emoji.name, emoji.imageUrl);
    return map;
  }, [state.bootstrap]);
}

export function conversationTitle(
  conversation: ConversationSummary | null,
  directory: Map<string, PublicUser>,
  currentUserId?: string
) {
  if (!conversation) return "OpenChat";
  if (conversation.channel) return conversation.channel.name;
  if (conversation.name) return conversation.name;
  const others = conversation.memberIds.filter((id) => id !== currentUserId);
  if (others.length === 0) return "You";
  const names = others.map((id) => directory.get(id)?.displayName ?? "Someone");
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}
