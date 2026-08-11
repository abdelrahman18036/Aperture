import { cn } from "@repo/ui";

/**
 * Three daylight dots, 1.4s loop — `02-DESIGN-SYSTEM.md`, Motion.
 *
 * Daylight because it is something *happening now* rather than something you
 * did. That is the rule that keeps this palette from going generic, and a
 * warm typing indicator would break it in the one place people look most.
 */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-hidden="true"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1 rounded-full bg-daylight animate-typing-dot"
          // Staggered so it reads as a wave rather than three dots blinking.
          style={{ animationDelay: `${String(index * 180)}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * The line under the thread. Announced politely, so a screen reader is told
 * once rather than interrupted every time the animation loops.
 */
export function TypingLine({ names }: { names: string[] }) {
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : `${String(names.length)} people are typing`;

  return (
    <p
      className="flex items-center gap-2 px-4 py-2 meta text-daylight"
      aria-live="polite"
    >
      <TypingDots />
      {label}
    </p>
  );
}
