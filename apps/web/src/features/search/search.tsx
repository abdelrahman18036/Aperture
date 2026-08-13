"use client";

import { ArrowRight, Compass, Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, Input, InstrumentPanel, SurfaceState, cn } from "@repo/ui";

import { UserAvatar } from "@/features/profile/user-avatar";
import { api } from "@/lib/api";

type Person = Schemas["User"];

const DEBOUNCE_MS = 250;

export function Search() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{
    term: string;
    people: Person[];
  } | null>(null);
  const [failedTerm, setFailedTerm] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef(0);
  const term = query.trim();

  useEffect(() => {
    if (term === "") return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      void api
        .GET("/api/users/search", { params: { query: { q: term } } })
        .then((response) => {
          if (ticket !== latest.current) return;
          if (response.data === undefined) {
            setFailedTerm(term);
            return;
          }
          setFailedTerm(null);
          setAnswer({ term, people: response.data.users });
        })
        .catch(() => {
          if (ticket !== latest.current) return;
          setFailedTerm(term);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, retry]);

  const results = answer !== null && answer.term === term ? answer.people : [];
  const failed = failedTerm === term;
  const searched = answer !== null && answer.term === term && !failed;
  const searching = term !== "" && !searched && !failed;

  return (
    <div data-wide className="mx-auto w-full max-w-[72rem] py-3 sm:py-6">
      <header className="mb-7 border-b border-seam pb-6">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">
          Search
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-dim sm:text-base">
          Find photographers and visual creators by name, then move straight
          into their work.
        </p>
      </header>

      <InstrumentPanel className="overflow-hidden">
        <div className="border-b border-seam p-4 sm:p-6">
          <div className="relative max-w-3xl">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-faint"
            />
            <label htmlFor="search-people" className="sr-only">
              Search for creators
            </label>
            <Input
              id="search-people"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setFailedTerm(null);
              }}
              placeholder="Username or name"
              className="min-h-14 bg-panel-raised pl-12 text-base text-ink shadow-none"
              autoComplete="off"
              autoFocus
            />
          </div>
          <p className="mt-2 min-h-5 text-sm text-ink-dim" aria-live="polite">
            {searching
              ? "Searching directory..."
              : searched
                ? `${String(results.length)} ${results.length === 1 ? "creator" : "creators"} found`
                : failed
                  ? "Search unavailable"
                  : "Ready for input"}
          </p>
        </div>

        {term === "" ? (
          <section className="grid min-h-80 md:grid-cols-[1.15fr_0.85fr]">
            <div className="flex flex-col justify-center px-6 py-10 sm:px-10">
              <h2 className="max-w-md text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-3xl">
                Start with a name you remember.
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-ink-dim">
                Results update as you type. Search works with usernames and
                display names, so exact spelling is not required.
              </p>
            </div>
            <div className="flex flex-col justify-center border-t border-seam bg-panel-raised px-6 py-10 md:border-l md:border-t-0 sm:px-8">
              <Compass className="size-6 text-commit" aria-hidden="true" />
              <h2 className="mt-5 text-lg font-semibold text-ink">
                Looking for new work?
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-dim">
                Explore shows public posts with creator and response details.
              </p>
              <Link
                href="/explore"
                className="mt-5 inline-flex min-h-11 w-fit items-center gap-2 font-semibold text-commit hover:text-commit-hover"
              >
                Open Explore
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        ) : null}

        {searching ? (
          <SurfaceState
            variant="loading"
            title="Searching creators"
            description={`Looking for “${term}”.`}
          />
        ) : null}

        {failed ? (
          <SurfaceState
            variant="error"
            title="Search could not connect"
            description="Your query is still here. Retry when the connection is ready."
            action={
              <Button
                variant="secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry search
              </Button>
            }
          />
        ) : null}

        {searched && results.length === 0 ? (
          <SurfaceState
            variant="empty"
            title="No matching creators"
            description={`No one matched “${term}”. Check the spelling or try a shorter name.`}
          />
        ) : null}

        {searched && results.length > 0 ? (
          <ul
            aria-label="Creator search results"
            className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6"
          >
            {results.map((person) => (
              <li key={person.id}>
                <Link
                  href={`/u/${person.username}`}
                  className={cn(
                    "flex min-h-24 items-center gap-4 rounded-control border border-seam bg-panel-raised p-4",
                    "transition-[border-color,background-color] duration-[var(--duration-hover)] hover:border-seam-strong hover:bg-key",
                  )}
                >
                  <UserAvatar user={person} className="size-12 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {person.display_name || person.username}
                    </span>
                    <span className="block truncate text-sm text-ink-dim">
                      @{person.username}
                    </span>
                  </span>
                  {person.is_private ? (
                    <span className="ml-auto shrink-0 rounded-full bg-key px-3 py-1 text-xs font-medium text-ink-dim">
                      Private
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </InstrumentPanel>
    </div>
  );
}
