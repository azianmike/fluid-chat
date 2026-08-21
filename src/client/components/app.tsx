"use client";

import { useEffect, useRef } from "react";
import { notificationsPaused } from "@/shared/quiet-hours";
import { ALERTING_NOTIFICATION_TYPES, AppProvider, useApp } from "../store";
import { AuthScreen, WorkspaceSetupScreen } from "./auth-screen";
import { Sidebar } from "./shell/sidebar";
import { WorkspaceRail } from "./shell/workspace-rail";
import { TopBar } from "./shell/top-bar";
import { RightPanel } from "./shell/right-panel";
import { ConversationView } from "./shell/conversation-view";
import { ActivityView, DraftsView, SavedView, ThreadsView, UnreadsView } from "./views/activity-views";
import { BrowseChannelsView, FilesView, PeopleView, SearchView } from "./views/directory-views";
import { QuickSwitcher } from "./modals/quick-switcher";
import { AdminConsole } from "./modals/admin-console";
import {
  AddPeopleModal,
  CreateWorkspaceModal,
  InviteModal,
  NewChannelModal,
  NewDmModal,
  PreferencesModal,
  ProfileEditorModal,
  ScheduleModal,
  ShareModal,
  ShortcutsModal,
  StatusModal
} from "./modals/modals";
import { Spinner } from "./ui/primitives";

export function App() {
  return (
    <AppProvider>
      <AppRoot />
    </AppProvider>
  );
}

function AppRoot() {
  const { state, actions } = useApp();

  useTheme();
  useHotkeys();
  useDesktopNotifications();
  useDeepLink();

  if (state.status === "loading") {
    return (
      <div className="boot-screen">
        <Spinner label="Loading Fluid Chat" />
      </div>
    );
  }

  if (state.status === "anonymous" || !state.session) return <AuthScreen />;
  if (state.memberships.length === 0) return <WorkspaceSetupScreen />;

  return (
    <div className={`app-shell ${state.sidebarOpen ? "sidebar-open" : ""}`}>
      <TopBar />
      <div className="app-body">
        <WorkspaceRail />
        <Sidebar />
        {state.sidebarOpen ? (
          <button
            type="button"
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => actions.setSidebarOpen(false)}
          />
        ) : null}
        <main className="app-main">
          {state.view.kind === "conversation" ? <ConversationView conversationId={state.view.conversationId} /> : null}
          {state.view.kind === "activity" ? <ActivityView /> : null}
          {state.view.kind === "threads" ? <ThreadsView /> : null}
          {state.view.kind === "saved" ? <SavedView /> : null}
          {state.view.kind === "drafts" ? <DraftsView /> : null}
          {state.view.kind === "unreads" ? <UnreadsView /> : null}
          {state.view.kind === "browse" ? <BrowseChannelsView /> : null}
          {state.view.kind === "people" ? <PeopleView /> : null}
          {state.view.kind === "files" ? <FilesView /> : null}
          {state.view.kind === "search" ? <SearchView query={state.view.query} /> : null}
        </main>
        <RightPanel />
      </div>
      <Modals />
      <Toasts />
    </div>
  );
}

function Modals() {
  const { state, actions } = useApp();
  const close = () => actions.setModal(null);
  const modal = state.modal;
  if (!modal) return null;

  switch (modal.kind) {
    case "quick-switcher":
      return <QuickSwitcher onClose={close} />;
    case "preferences":
      return <PreferencesModal onClose={close} />;
    case "admin":
      return <AdminConsole onClose={close} />;
    case "invite":
      return <InviteModal onClose={close} />;
    case "new-channel":
      return <NewChannelModal onClose={close} />;
    case "new-dm":
      return <NewDmModal onClose={close} />;
    case "add-people":
      return <AddPeopleModal conversationId={modal.conversationId} onClose={close} />;
    case "shortcuts":
      return <ShortcutsModal onClose={close} />;
    case "status":
      return <StatusModal onClose={close} />;
    case "profile-editor":
      return <ProfileEditorModal onClose={close} />;
    case "create-workspace":
      return <CreateWorkspaceModal onClose={close} />;
    case "schedule":
      return (
        <ScheduleModal
          conversationId={modal.conversationId}
          bodyText={modal.bodyText}
          parentMessageId={modal.parentMessageId}
          onClose={close}
        />
      );
    case "share":
      return <ShareModal messageId={modal.messageId} onClose={close} />;
    default:
      return null;
  }
}

function Toasts() {
  const { state, actions } = useApp();

  useEffect(() => {
    if (state.toasts.length === 0) return;
    const timer = setTimeout(() => actions.dismissToast(state.toasts[0].id), 5000);
    return () => clearTimeout(timer);
  }, [state.toasts, actions]);

  if (state.toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {state.toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast is-${toast.tone}`} onClick={() => actions.dismissToast(toast.id)}>
          {toast.text}
        </button>
      ))}
    </div>
  );
}

/** Applies the theme preference, following the OS when set to `system`. */
function useTheme() {
  const { state } = useApp();
  const theme = state.session?.preferences?.theme ?? "system";
  const density = state.session?.preferences?.messageDensity ?? "comfortable";

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.dataset.theme = resolved;
      root.dataset.density = density;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, density]);
}

function useHotkeys() {
  const { state, actions } = useApp();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      if (meta && event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault();
        actions.setModal({ kind: "quick-switcher" });
        return;
      }
      if (meta && event.key === "/") {
        event.preventDefault();
        actions.setModal({ kind: "shortcuts" });
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        actions.setModal({ kind: "new-dm" });
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        actions.setView({ kind: "unreads" });
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        actions.setView({ kind: "threads" });
        return;
      }
      // Alt+↑/↓ walks the sidebar, the way Slack moves between conversations.
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const conversations = state.bootstrap?.conversations.filter(
          (conversation) => !conversation.membership?.hidden || conversation.unreadCount > 0
        );
        if (conversations && conversations.length > 0) {
          event.preventDefault();
          const activeId = state.view.kind === "conversation" ? state.view.conversationId : null;
          const current = activeId ? conversations.findIndex((conversation) => conversation.id === activeId) : -1;
          const step = event.key === "ArrowDown" ? 1 : -1;
          const next = (current + step + conversations.length) % conversations.length;
          void actions.openConversation(conversations[next].id);
        }
        return;
      }

      if (event.shiftKey && event.key === "Escape") {
        event.preventDefault();
        void actions.markEverythingRead();
        return;
      }

      if (event.key === "Escape" && !typing) {
        if (state.modal) actions.setModal(null);
        else if (state.rightPanel) actions.setRightPanel(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, state.modal, state.rightPanel]);
}

/**
 * Desktop banners for activity that arrives while the app is not in front.
 *
 * Everything already in the list on the first run is treated as seen, so a
 * reload or a refetch never replays yesterday's mentions, and each id fires at
 * most once — three mentions in a row raise three banners rather than only the
 * newest surviving as `notifications[0]`.
 */
function useDesktopNotifications() {
  const { state, actions } = useApp();
  const session = state.session;
  const preference = session?.preferences?.desktopNotifications ?? "mentions";
  const notifications = state.notifications;
  const paused = notificationsPaused({
    quietHours: { start: session?.preferences?.quietHoursStart, end: session?.preferences?.quietHoursEnd },
    timeZone: session?.timezone,
    dndUntil: session?.dndUntil
  });

  const seen = useRef<Set<string> | null>(null);
  const loadedAt = useRef(Date.now());
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const known = seen.current;
    seen.current = new Set(notifications.map((entry) => entry.id));
    // The first list only seeds the baseline; nothing on it is new to this tab.
    if (!known) return;

    const fresh = notifications.filter(
      (entry) =>
        !known.has(entry.id) &&
        !entry.readAt &&
        // The list is also filled by refetches, which can pull in unread rows
        // that predate this tab. Those are history, not an interruption.
        new Date(entry.createdAt).getTime() >= loadedAt.current
    );
    if (fresh.length === 0 || preference === "none" || paused) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // `visibilityState` alone is not enough: a tab sitting behind another app is
    // still "visible", which is exactly when someone wants to be told.
    if (document.visibilityState === "visible" && document.hasFocus()) return;

    for (const entry of fresh.slice(0, 3).reverse()) {
      const relevant = ALERTING_NOTIFICATION_TYPES.includes(entry.type);
      if (preference === "mentions" && !relevant) continue;
      const banner = new Notification("Fluid Chat", {
        body: entry.body ?? "New activity",
        tag: entry.id,
        icon: "/icon.svg"
      });
      banner.onclick = () => {
        window.focus();
        if (entry.conversationId) void actionsRef.current.openConversation(entry.conversationId);
        banner.close();
      };
    }
  }, [notifications, preference, paused]);
}

/** `/?conversation=…&message=…` opens a permalink from a copied message link. */
function useDeepLink() {
  const { state, actions } = useApp();

  useEffect(() => {
    if (!state.bootstrap) return;
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("conversation");
    if (!conversationId) return;
    void actions.openConversation(conversationId).then(() => {
      const messageId = params.get("message");
      if (messageId) {
        requestAnimationFrame(() => {
          document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ block: "center" });
        });
      }
      window.history.replaceState({}, "", window.location.pathname);
    });
  }, [state.bootstrap?.workspace.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
