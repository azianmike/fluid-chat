/**
 * PostHog wiring for the chat app.
 *
 * Fluid Chat carries private conversations, so one rule governs this file: **no event
 * ever carries message text, channel names, file names, search terms, or any other free
 * text a person typed.** Only ids, counts, lengths and fixed enum values. If you are
 * adding an event and reaching for a string, stop and send an id or a category instead.
 *
 * That rule is why autocapture and session replay are both off: autocapture ships the
 * text content of whatever got clicked (channel names, message snippets) as event
 * properties, and replay would record DM contents to PostHog's servers. The one string
 * that does go out is the workspace name, attached to the workspace group — group
 * analytics is unreadable without it, and it is billing metadata the operator already has.
 *
 * Everything here degrades to a no-op when NEXT_PUBLIC_POSTHOG_KEY is unset, which is the
 * case for every self-hosted install that has not opted in.
 *
 * The second rule is that an event has to answer a question. Navigation and reactions are
 * deliberately not tracked: in a chat app they fire constantly and only ever confirm that
 * chat is being used. Thread engagement is already readable from `message_sent`'s
 * `is_thread_reply`, and the channel/DM split from its `conversation_kind`, without paying
 * for an event per click.
 */

import posthog from "posthog-js";
import type { ConversationSummary, SessionUser, WorkspaceSummary } from "@/shared/types";

/** Product events. Keep the property types narrow — it is the guardrail against leaking text. */
type Events = {
  signed_up: { workspace_count: number };
  signed_in: { workspace_count: number };
  signed_out: Record<string, never>;
  message_sent: {
    conversation_kind: ConversationKind;
    is_thread_reply: boolean;
    thread_broadcast: boolean;
    has_files: boolean;
    file_count: number;
    body_length: number;
  };
  slash_command_used: { command: string };
  channel_created: { visibility: "public" | "private"; has_description: boolean };
  dm_started: { participant_count: number };
  workspace_created: Record<string, never>;
  workspace_switched: Record<string, never>;
  invites_sent: { count: number; skipped_count: number; role: string };
  invite_link_created: Record<string, never>;
  search_performed: { sort: "recent" | "relevant"; query_length: number; result_count: number };
  file_uploaded: { byte_size: number; mime_type: string };
  message_scheduled: Record<string, never>;
};

/** Mirrors `ConversationSummary["type"]`, plus the case where the conversation is not loaded yet. */
export type ConversationKind = ConversationSummary["type"] | "unknown";

export function conversationKind(conversation: ConversationSummary | undefined): ConversationKind {
  return conversation?.type ?? "unknown";
}

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let started = false;

export function initAnalytics() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;

  posthog.init(KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    defaults: "2026-06-25",

    // See the note at the top of this file — none of these are safe in a chat app.
    autocapture: false,
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,

    // The app is a single route that never navigates, so automatic pageviews would only
    // ever record one hit per load. The named events above are the useful signal.
    capture_pageview: false,
    capture_pageleave: false,

    person_profiles: "identified_only"
  });
}

export function track<E extends keyof Events>(event: E, properties?: Events[E]) {
  if (!started) return;
  posthog.capture(event, properties);
}

/** Ties subsequent events to the signed-in user. Safe to call on every session refresh. */
export function identifyUser(user: SessionUser) {
  if (!started) return;
  posthog.identify(user.id, {
    email: user.email,
    name: user.displayName,
    timezone: user.timezone,
    email_verified: Boolean(user.emailVerifiedAt),
    is_bot: user.isBot
  });
}

/** Attributes events to a workspace, so retention and funnels can be read per customer. */
export function identifyWorkspace(workspace: WorkspaceSummary, role: string) {
  if (!started) return;
  posthog.group("workspace", workspace.id, {
    name: workspace.name,
    slug: workspace.slug,
    plan: workspace.plan,
    seat_limit: workspace.seatLimit,
    subscription_status: workspace.subscriptionStatus,
    read_only: Boolean(workspace.readOnlyAt),
    retention_days: workspace.retentionDays,
    viewer_role: role
  });
}

/** Clears the identity on sign-out so the next person on this browser is a fresh user. */
export function resetAnalytics() {
  if (!started) return;
  posthog.reset();
}

/**
 * Slash commands are typed by hand, so only the leading verb goes out, and only when it
 * looks like a command name rather than prose — `/remind me to call Dana` reports
 * `remind` and nothing else.
 */
export function commandName(bodyText: string): string | null {
  const verb = bodyText.trim().split(/\s+/, 1)[0]?.slice(1).toLowerCase() ?? "";
  return /^[a-z][a-z-]{0,19}$/.test(verb) ? verb : null;
}
