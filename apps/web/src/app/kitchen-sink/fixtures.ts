/**
 * Fixtures for `/kitchen-sink`.
 *
 * The blurhash and dominant colour were computed from the real files with
 * `blurhash-python` and Pillow — the same libraries the Phase 3 media worker
 * uses — so these are the shape a `media` row will actually hold rather than
 * plausible-looking values typed by hand.
 */

export interface MediaFixture {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly blurhash: string;
  readonly dominantColor: string;
}

export const mediaFixtures: readonly MediaFixture[] = [
  {
    src: "/kitchen-sink/portrait.jpg",
    alt: "Synthetic portrait fixture: warm blush and violet fields.",
    width: 1080,
    height: 1350,
    blurhash: "LMHT,g[*G9Sj4mFsOFsC1%J-+$o0",
    dominantColor: "#917078",
  },
  {
    src: "/kitchen-sink/square.jpg",
    alt: "Synthetic square fixture: teal and green fields.",
    width: 1080,
    height: 1080,
    blurhash: "LPAz22RIZiotDNm,jWbuqtaIcDjs",
    dominantColor: "#58a697",
  },
  {
    src: "/kitchen-sink/landscape.jpg",
    alt: "Synthetic landscape fixture: amber and magenta fields.",
    width: 1600,
    height: 900,
    blurhash: "LRHKhT$[OqR:0cE*R:smN5I[#msm",
    dominantColor: "#8e7771",
  },
];

/**
 * Measured WCAG contrast, computed from the OKLCH tokens themselves rather
 * than eyeballed. `need` is what the quality floor in `02-DESIGN-SYSTEM.md`
 * asks of each: 4.5:1 for body text, 3:1 for the meta role.
 */
export interface ContrastRow {
  readonly token: string;
  readonly onBase: number;
  readonly onSurface: number;
  readonly onRaised: number;
  readonly need: number;
  readonly note?: string;
}

export const contrastTable: readonly ContrastRow[] = [
  { token: "ink", onBase: 17.62, onSurface: 16.59, onRaised: 15.23, need: 4.5 },
  {
    token: "ink-dim",
    onBase: 7.41,
    onSurface: 6.98,
    onRaised: 6.4,
    need: 4.5,
  },
  {
    token: "ink-faint",
    onBase: 3.99,
    onSurface: 3.76,
    onRaised: 3.45,
    need: 3,
    note: "the meta role — verified, no lift needed",
  },
  {
    token: "safelight",
    onBase: 8.82,
    onSurface: 8.31,
    onRaised: 7.63,
    need: 4.5,
  },
  {
    token: "daylight",
    onBase: 12.67,
    onSurface: 11.93,
    onRaised: 10.95,
    need: 4.5,
  },
  {
    token: "danger",
    onBase: 5.38,
    onSurface: 5.06,
    onRaised: 4.65,
    need: 4.5,
  },
  {
    token: "success",
    onBase: 9.72,
    onSurface: 9.15,
    onRaised: 8.4,
    need: 4.5,
  },
  {
    token: "safelight-dim",
    onBase: 2.81,
    onSurface: 2.65,
    onRaised: 2.43,
    need: 3,
    note: "focus ring — under WCAG 1.4.11, flagged in the handoff",
  },
];
