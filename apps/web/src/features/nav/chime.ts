"use client";

/**
 * A short tone when a message arrives somewhere you are not looking.
 *
 * **Synthesised rather than a file**, for two reasons that both matter here.
 * An `<audio>` element needs an asset, and this app has no `public/` at all —
 * adding one for a 200ms sound is a build-output change and a network request
 * per notification. And a Web Audio oscillator is already how the call
 * verification generates test tones, so the technique is in the codebase.
 *
 * Two notes rather than one, quiet, and short. A notification sound is
 * competing with whatever somebody is actually listening to, and the ones
 * people turn off are the ones that try to win.
 */

/** Built lazily: constructing an `AudioContext` before a gesture is refused. */
let context: AudioContext | null = null;

export async function chime(): Promise<void> {
  try {
    context ??= new AudioContext();

    // Autoplay policy suspends a context created without a gesture. Resuming
    // succeeds once the person has interacted with the page at all, which by
    // the time a message arrives they almost always have.
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return;

    const now = context.currentTime;
    // A rising fifth: recognisable, and not the sound of something breaking.
    for (const [index, frequency] of [660, 880].entries()) {
      const at = now + index * 0.09;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // An envelope, because a bare oscillator starting and stopping clicks.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.06, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.14);
    }
  } catch {
    // A refused or unavailable AudioContext is not worth a broken render.
    // The count still moved, which is the part that carries the information.
  }
}
