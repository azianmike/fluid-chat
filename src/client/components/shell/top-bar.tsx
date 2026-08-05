"use client";

import { useState } from "react";
import { Clock, HelpCircle, LogOut, Menu, Moon, Search, Settings, Smile, UserCircle } from "lucide-react";
import { useApp } from "../../store";
import { Avatar, MenuDivider, MenuItem, Popover } from "../ui/primitives";

export function TopBar() {
  const { state, actions } = useApp();
  const [query, setQuery] = useState("");
  const session = state.session;
  // The label follows what is on screen, which may be the OS theme.
  const resolvedTheme = typeof document === "undefined" ? "light" : document.documentElement.dataset.theme ?? "light";

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          type="button"
          className="icon-button menu-toggle"
          aria-label="Toggle navigation"
          aria-expanded={state.sidebarOpen}
          onClick={() => actions.setSidebarOpen(!state.sidebarOpen)}
        >
          <Menu size={18} />
        </button>
        <span className="brand">OpenChat</span>
      </div>

      <form
        className="top-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) actions.setView({ kind: "search", query: query.trim() });
        }}
      >
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${state.bootstrap?.workspace.name ?? "workspace"}`}
          aria-label="Search messages"
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
            if (event.key === "Enter" && query.trim()) {
              event.preventDefault();
              actions.setView({ kind: "search", query: query.trim() });
            }
          }}
        />
        <kbd>⌘K</kbd>
      </form>

      <div className="top-bar-right">
        <button type="button" className="icon-button" onClick={() => actions.setModal({ kind: "shortcuts" })} aria-label="Keyboard shortcuts">
          <HelpCircle size={18} />
        </button>

        <Popover
          width={300}
          align="end"
          trigger={({ toggle, ref }) => (
            <button type="button" className="avatar-button" ref={ref} onClick={toggle} aria-label="You">
              <Avatar user={session ?? undefined} size={30} />
            </button>
          )}
        >
          {(close) => (
            <div className="menu">
              <div className="menu-heading">
                <strong>{session?.displayName}</strong>
                <span>{session?.statusText ? `${session.statusEmoji ? "" : ""} ${session.statusText}` : "Set a status"}</span>
              </div>
              <MenuItem
                onClick={() => {
                  actions.setModal({ kind: "status" });
                  close();
                }}
              >
                <Smile size={14} /> Update your status
              </MenuItem>
              <MenuItem
                onClick={() => {
                  void actions.setPresence(session?.presence === "away" ? "active" : "away");
                  close();
                }}
              >
                <UserCircle size={14} /> Set yourself {session?.presence === "away" ? "active" : "away"}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  void actions.setPresence("dnd", new Date(Date.now() + 60 * 60_000).toISOString());
                  close();
                }}
              >
                <Clock size={14} /> Pause notifications for 1 hour
              </MenuItem>
              <MenuDivider />
              <MenuItem
                onClick={() => {
                  actions.setModal({ kind: "profile-editor" });
                  close();
                }}
              >
                <UserCircle size={14} /> Edit profile
              </MenuItem>
              <MenuItem
                onClick={() => {
                  actions.setModal({ kind: "preferences" });
                  close();
                }}
              >
                <Settings size={14} /> Preferences
              </MenuItem>
              <MenuItem
                onClick={() => {
                  void actions.updatePreferences({ theme: resolvedTheme === "dark" ? "light" : "dark" });
                  close();
                }}
              >
                <Moon size={14} /> Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
              </MenuItem>
              <MenuDivider />
              <MenuItem
                danger
                onClick={() => {
                  void actions.signOut();
                  close();
                }}
              >
                <LogOut size={14} /> Sign out
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>
    </header>
  );
}
