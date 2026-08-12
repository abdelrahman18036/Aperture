"use client";

/**
 * Every sound the product makes.
 *
 * **Synthesised rather than files**, for two reasons that both matter here.
 * An `<audio>` element needs an asset, and this app has no `public/` at all —
 * adding one for a 200ms sound is a build-output change and a network request
 * per notification. And a Web Audio oscillator is already how the call
 * verification generates test tones, so the technique is in the codebase.
 *
 * Three sounds, and they are deliberately different in kind rather than in
 * pitch:
 *
 * - **A message** is a short rising pair. It happened; you can look when you
 *   like.
 * - **A notification** is one softer note, quieter still. A like is the least
 *   urgent thing that happens in this product and the sound should say so.
 * - **A call** repeats, because it is the only thing here that stops if you
 *   ignore it.
 *
 * All of them are quiet. A notification sound is competing with whatever
 * somebody is actually listening to, and the ones people turn off are the ones
 * that try to win.
 */

/** Built lazily: constructing an `AudioContext` before a gesture is refused. */
let context: AudioContext | null = null;

/**
 * The context, or null if the browser will not give us a running one.
 *
 * Autoplay policy suspends a context created without a gesture. Resuming
 * succeeds once the person has interacted with the page at all, which by the
 * time anything here is called they almost always have — and if they have not,
 * silence is the correct outcome rather than an error.
 */
async function running(): Promise<AudioContext | null> {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
    return context.state === "running" ? context : null;
  } catch {
    return null;
  }
}

/**
 * One note with an envelope.
 *
 * The envelope is not decoration: a bare oscillator starting and stopping at
 * full amplitude clicks, and the click is the part people find unpleasant.
 */
function note(
  audio: AudioContext,
  { at, frequency, gain: peak, length }: {
    at: number;
    frequency: number;
    gain: number;
    length: number;
  },
): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
}

/** A message arrived somewhere you are not looking. A rising fifth. */
export async function chime(): Promise<void> {
  const audio = await running();
  if (audio === null) return;

  const now = audio.currentTime;
  for (const [index, frequency] of [660, 880].entries()) {
    note(audio, {
      at: now + index * 0.09,
      frequency,
      gain: 0.06,
      length: 0.12,
    });
  }
}

/** Somebody liked, followed or commented. One note, softer than a message. */
export async function ping(): Promise<void> {
  const audio = await running();
  if (audio === null) return;

  note(audio, {
    at: audio.currentTime,
    frequency: 784,
    // Quieter than the chime on purpose: a message may want an answer, and a
    // like never does.
    gain: 0.035,
    length: 0.18,
  });
}

/** How often a ring repeats. Close to a telephone's cadence. */
const RING_INTERVAL_MS = 2600;

/**
 * A repeating tone, until it is stopped.
 *
 * `setInterval` over a scheduled Web Audio loop because it has to be
 * *stoppable* the instant somebody answers. Scheduling three minutes of
 * oscillators up front would mean cancelling them individually, and the ring
 * outliving the answer by half a second is exactly the bug worth avoiding.
 */
function repeating(play: () => void): () => void {
  play();
  const timer = window.setInterval(play, RING_INTERVAL_MS);
  return () => {
    window.clearInterval(timer);
  };
}

/**
 * Somebody is calling you. Two notes, twice, then a gap.
 *
 * Returns the stop function. Callers hold it and call it on answer, decline or
 * timeout — an effect cleanup is the natural home.
 */
export function ring(): () => void {
  let stopped = false;
  let stop = (): void => {
    stopped = true;
  };

  void running().then((audio) => {
    if (audio === null || stopped) return;
    const cancel = repeating(() => {
      const now = audio.currentTime;
      // Two short bursts, the shape a phone makes.
      for (const offset of [0, 0.42]) {
        note(audio, { at: now + offset, frequency: 587, gain: 0.05, length: 0.2 });
        note(audio, {
          at: now + offset + 0.22,
          frequency: 494,
          gain: 0.05,
          length: 0.2,
        });
      }
    });
    if (stopped) cancel();
    else stop = cancel;
  });

  return () => {
    stopped = true;
    stop();
  };
}

/**
 * Your call is ringing at the other end.
 *
 * Lower and sparser than the incoming ring, because it is telling you to wait
 * rather than to act — and because hearing the same sound whether you are
 * calling or being called is genuinely confusing.
 */
export function ringback(): () => void {
  let stopped = false;
  let stop = (): void => {
    stopped = true;
  };

  void running().then((audio) => {
    if (audio === null || stopped) return;
    const cancel = repeating(() => {
      note(audio, {
        at: audio.currentTime,
        frequency: 440,
        gain: 0.03,
        length: 0.6,
      });
    });
    if (stopped) cancel();
    else stop = cancel;
  });

  return () => {
    stopped = true;
    stop();
  };
}
