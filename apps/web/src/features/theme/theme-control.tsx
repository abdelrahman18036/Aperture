"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";

import { cn } from "@repo/ui";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "aperture-theme";
const THEME_EVENT = "aperture-theme-change";
const OPTIONS = [
  { value: "system", label: "Use system theme", Icon: Monitor },
  { value: "light", label: "Use light theme", Icon: Sun },
  { value: "dark", label: "Use dark theme", Icon: Moon },
] as const;

function isThemePreference(
  value: string | null | undefined,
): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function storedPreference(): ThemePreference {
  const fromDocument = document.documentElement.dataset.themePreference;
  if (isThemePreference(fromDocument)) return fromDocument;

  const fromStorage = localStorage.getItem(STORAGE_KEY);
  return isThemePreference(fromStorage) ? fromStorage : "system";
}

function applyTheme(preference: ThemePreference): void {
  const resolved =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  const root = document.documentElement;

  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  localStorage.setItem(STORAGE_KEY, preference);
}

function serverPreference(): ThemePreference {
  return "system";
}

function subscribePreference(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemChange = () => {
    if (storedPreference() === "system") applyTheme("system");
  };
  const handleThemeEvent = () => onStoreChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      applyTheme(isThemePreference(event.newValue) ? event.newValue : "system");
      onStoreChange();
    }
  };

  media.addEventListener("change", handleSystemChange);
  window.addEventListener(THEME_EVENT, handleThemeEvent);
  window.addEventListener("storage", handleStorage);
  return () => {
    media.removeEventListener("change", handleSystemChange);
    window.removeEventListener(THEME_EVENT, handleThemeEvent);
    window.removeEventListener("storage", handleStorage);
  };
}

interface ThemeControlProps {
  className?: string;
  label?: string;
  compact?: boolean;
}

/** Compact three-state appearance control with persistent system resolution. */
function ThemeControl({
  className,
  label = "Appearance",
  compact = false,
}: ThemeControlProps): React.JSX.Element {
  const preference = useSyncExternalStore(
    subscribePreference,
    storedPreference,
    serverPreference,
  );

  useLayoutEffect(() => {
    applyTheme(storedPreference());
  }, []);

  function choose(next: ThemePreference): void {
    applyTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  }

  if (compact) {
    const index = OPTIONS.findIndex((option) => option.value === preference);
    const current = OPTIONS[index] ?? OPTIONS[0];
    const next = OPTIONS[(index + 1) % OPTIONS.length] ?? OPTIONS[0];
    const CurrentIcon = current.Icon;
    return (
      <button
        type="button"
        title={`${current.label}. Switch to ${next.label.toLowerCase()}.`}
        aria-label={`${current.label}. Switch to ${next.label.toLowerCase()}.`}
        onClick={() => choose(next.value)}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full text-ink-dim",
          "transition-colors duration-[var(--duration-hover)] hover:bg-accent-soft hover:text-accent",
          className,
        )}
      >
        <CurrentIcon aria-hidden="true" className="size-4" />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="theme-control"
      className={cn(
        "inline-flex max-w-full rounded-control border border-seam bg-key p-1 shadow-key",
        className,
      )}
    >
      {OPTIONS.map(({ value, label: optionLabel, Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            title={optionLabel}
            aria-label={optionLabel}
            aria-pressed={selected}
            onClick={() => choose(value)}
            className={cn(
              "grid place-items-center rounded-[10px] border",
              "size-11",
              "transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-hover)]",
              selected
                ? "border-seam bg-panel-raised text-commit shadow-key"
                : "border-transparent text-ink-dim hover:bg-panel-raised hover:text-ink",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

export { ThemeControl };
export type { ThemeControlProps, ThemePreference };
