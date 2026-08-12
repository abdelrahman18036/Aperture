"use client";

import { Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Avatar, AvatarFallback, Input, cn } from "@repo/ui";

import { api } from "@/lib/api";

type Person = Schemas["User"];

/** Long enough that a fast typist sends one request, not eight. */
const DEBOUNCE_MS = 250;

/**
 * Finding people.
 *
 * Debounced rather than searched on every keystroke, and the *result* of a
 * stale request is discarded rather than the request cancelled: responses can
 * arrive out of order, and a slow "m" landing after a fast "marko" would
 * repaint the list with the wrong answer. A sequence number is cheaper and
 * more reliable than aborting.
 *
 * Blocking is enforced server-side in `users.selectors.search` — being
 * blocked and still turning up in search is the same failure wearing a hat.
 * Nothing here filters, and nothing here should.
 */
export function Search() {
  const [query, setQuery] = useState("");
  /**
   * The answer, and which question it answered.
   *
   * Holding the term alongside the results is what lets everything else be
   * derived: whether a search is outstanding is `term !== query`, so there is
   * no `searching` flag to set from inside the effect and no way for the two
   * to disagree.
   */
  const [answer, setAnswer] = useState<{ term: string; people: Person[] } | null>(
    null,
  );

  /** Monotonic, so an older response cannot overwrite a newer one. */
  const latest = useRef(0);

  const term = query.trim();

  useEffect(() => {
    if (term === "") return;

    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      void api
        .GET("/api/users/search", { params: { query: { q: term } } })
        .then((response) => {
          // A response to a query the user has already typed past. Discarding
          // the result rather than aborting the request: responses arrive out
          // of order, and a slow "m" landing after a fast "marko" would
          // repaint the list with the wrong answer.
          if (ticket !== latest.current) return;
          setAnswer({ term, people: response.data?.users ?? [] });
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term]);

  const results = answer !== null && answer.term === term ? answer.people : [];
  const searched = answer !== null && answer.term === term;
  const searching = term !== "" && !searched;

  return (
    <div className="py-6">
      <h1 className="px-4 pb-4 font-display text-display-l text-ink">Search</h1>

      <div className="relative px-4">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        />
        <label htmlFor="search-people" className="sr-only">
          Search for people
        </label>
        <Input
          id="search-people"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people"
          className="pl-7"
          autoComplete="off"
          autoFocus
        />
      </div>

      <p className="px-4 pt-2 meta" aria-live="polite">
        {searching
          ? "searching"
          : searched
            ? `${String(results.length)} ${results.length === 1 ? "result" : "results"}`
            : " "}
      </p>

      <ul className="mt-2">
        {results.map((person) => (
          <li key={person.id}>
            <Link
              href={`/u/${person.username}`}
              className={cn(
                "flex items-center gap-3 border-b border-line px-4 py-3",
                "transition-colors duration-[var(--duration-hover)] hover:bg-surface",
              )}
            >
              <Avatar className="size-9 shrink-0">
                <AvatarFallback>{person.username.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-label text-ink">
                  {person.username}
                </span>
                {person.display_name !== "" && (
                  <span className="block truncate text-body text-ink-dim">
                    {person.display_name}
                  </span>
                )}
              </span>
              {person.is_private && (
                <span className="ml-auto shrink-0 meta">private</span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {searched && results.length === 0 && (
        <p className="px-4 py-12 text-center font-display text-display-l text-ink-faint">
          Nobody by that name
        </p>
      )}
    </div>
  );
}
