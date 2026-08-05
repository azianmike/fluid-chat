let context: AudioContext | null = null;

/**
 * A short two-tone chime for mentions and DMs. Synthesised so there is no audio
 * asset to ship, and lazily created because browsers block audio before a gesture.
 */
export function playNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    context ??= new AudioContextClass();
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    gain.connect(context.destination);

    for (const [frequency, offset] of [
      [880, 0],
      [1174.66, 0.11]
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      oscillator.connect(gain);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.3);
    }
  } catch {
    // Audio is a nicety; never let it break message delivery.
  }
}
