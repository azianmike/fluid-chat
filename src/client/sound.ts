let context: AudioContext | null = null;
let lastPlayedAt = 0;

function audioContext() {
  const AudioContextClass =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  context ??= new AudioContextClass();
  return context;
}

/**
 * Browsers create an AudioContext in the `suspended` state until the page has
 * seen a gesture, and `resume()` only succeeds from inside one. Calling this on
 * the first click or keypress is what makes the *first* chime audible — without
 * it the context stays suspended for the life of the tab and every notification
 * is silent.
 */
export function unlockNotificationSound() {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "suspended") return;
  void ctx.resume().catch(() => undefined);
}

/**
 * A short two-tone chime for mentions and DMs. Synthesised so there is no audio
 * asset to ship.
 */
export function playNotificationSound() {
  // One chime per burst. Ten messages landing at once should not stack ten
  // overlapping tones, and a DM raises both a `message` and a `notification`
  // event that would otherwise chime twice.
  const now = Date.now();
  if (now - lastPlayedAt < 400) return;
  lastPlayedAt = now;

  try {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      // `currentTime` is frozen while suspended, so scheduling now would place
      // both notes in the past. Wait for the context to actually start.
      void ctx
        .resume()
        .then(() => chime(ctx))
        .catch(() => undefined);
      return;
    }
    chime(ctx);
  } catch {
    // Audio is a nicety; never let it break message delivery.
  }
}

function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  gain.connect(ctx.destination);

  for (const [frequency, offset] of [
    [880, 0],
    [1174.66, 0.11]
  ] as const) {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    oscillator.connect(gain);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.3);
  }
}
