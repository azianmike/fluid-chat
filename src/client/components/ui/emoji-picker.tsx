"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EMOJI_CATEGORIES, applySkinTone, emojiChar, frequentEmoji, rememberEmoji, searchEmoji } from "../../emoji";
import { useApp, useCustomEmoji } from "../../store";

/**
 * Reaction values are stored either as a literal emoji character or as
 * `:name:` for workspace custom emoji, which keeps rendering trivial everywhere.
 */
export function EmojiPicker({ onPick, onClose }: { onPick: (value: string) => void; onClose?: () => void }) {
  const { state, actions } = useApp();
  const customEmoji = useCustomEmoji();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0].id);
  const skinTone = state.session?.preferences?.skinTone ?? 0;

  const results = useMemo(() => (query.trim() ? searchEmoji(query) : []), [query]);
  const customMatches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...customEmoji.entries()].filter(([name]) => !term || name.includes(term));
  }, [customEmoji, query]);

  const active = EMOJI_CATEGORIES.find((entry) => entry.id === category) ?? EMOJI_CATEGORIES[0];

  const frequent = useMemo(() => frequentEmoji(), []);

  const pick = (value: string) => {
    rememberEmoji(value);
    onPick(value);
    onClose?.();
  };

  return (
    <div className="emoji-picker">
      <div className="emoji-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji"
          autoFocus
          aria-label="Search emoji"
        />
      </div>

      {!query ? (
        <>
          <div className="emoji-tabs" role="tablist">
            {EMOJI_CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === category}
                className={entry.id === category ? "is-active" : ""}
                title={entry.label}
                onClick={() => setCategory(entry.id)}
              >
                {entry.emoji[0][1]}
              </button>
            ))}
          </div>
          <div className="emoji-section">
            <h4>Frequently used</h4>
            <div className="emoji-grid">
              {frequent.map((entry) => {
                const custom = /^:([a-z0-9_+-]+):$/i.exec(entry);
                if (custom) {
                  const url = customEmoji.get(custom[1].toLowerCase());
                  if (!url) return null;
                  return (
                    <button key={entry} type="button" title={entry} onClick={() => pick(entry)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={entry} width={22} height={22} />
                    </button>
                  );
                }
                const char = emojiChar(entry) ?? entry;
                return (
                  <button key={entry} type="button" title={char} onClick={() => pick(char)}>
                    {char}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="emoji-scroll">
        {customMatches.length > 0 ? (
          <div className="emoji-section">
            <h4>Custom</h4>
            <div className="emoji-grid">
              {customMatches.map(([name, url]) => (
                <button key={name} type="button" title={`:${name}:`} onClick={() => pick(`:${name}:`)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`:${name}:`} width={22} height={22} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="emoji-section">
          <h4>{query ? "Results" : active.label}</h4>
          <div className="emoji-grid">
            {(query ? results : active.emoji.map(([name, char]) => [name, char] as [string, string])).map(
              ([name, char]) => (
                <button
                  key={`${name}-${char}`}
                  type="button"
                  title={`:${name}:`}
                  onClick={() => pick(applySkinTone(char, skinTone))}
                >
                  {applySkinTone(char, skinTone)}
                </button>
              )
            )}
            {query && results.length === 0 && customMatches.length === 0 ? (
              <p className="emoji-empty">No emoji found</p>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="emoji-footer">
        <span>Skin tone</span>
        <div className="skin-tones">
          {[0, 1, 2, 3, 4, 5].map((tone) => (
            <button
              key={tone}
              type="button"
              className={tone === skinTone ? "is-active" : ""}
              aria-label={`Skin tone ${tone + 1}`}
              onClick={() => void actions.updatePreferences({ skinTone: tone })}
            >
              {applySkinTone("👍", tone)}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
