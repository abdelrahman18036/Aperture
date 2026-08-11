# Features

One folder per domain — `feed/`, `post/`, `profile/`, `messages/` — with that
feature's components and hooks colocated.

The dividing line against `packages/ui` is whether a component would make
sense in a different product. `Button` and `DevelopImage` would, so they live
in `packages/ui`. `PostCard` would not, so it lives here.

Empty until Phase 2 starts filling it. See `01-ARCHITECTURE.md` §2.
