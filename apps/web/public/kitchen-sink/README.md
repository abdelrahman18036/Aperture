# Kitchen-sink fixtures

Synthetic images, generated once, that exist only so `/kitchen-sink` can
demonstrate the develop-in and the ambient glow against something with real
pixels, real dimensions and a real blurhash.

They are not product assets and nothing outside that route may use them. When
Phase 3 makes real uploads possible, these can go.

Their blurhash and dominant colour were computed with the same libraries the
media worker will use — `blurhash-python` and Pillow — so the values in
`apps/web/src/app/kitchen-sink/fixtures.ts` are the shape the `media` table
will actually hold, not something plausible-looking typed by hand.
