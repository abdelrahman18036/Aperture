import type { Metadata } from "next";

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Skeleton,
} from "@repo/ui";

import { DevelopDemo } from "./develop-demo";
import { contrastTable, mediaFixtures } from "./fixtures";

export const metadata: Metadata = {
  title: "Kitchen sink — Aperture",
  description: "Every design-system primitive in every state.",
};

/**
 * `/kitchen-sink` — the Phase 2 deliverable and the review surface.
 *
 * Every primitive in every state, the type scale, both accent families, and
 * the develop-in against real pixels. It is a development route, not product
 * UI: nothing here is reachable from the app, and Phase 4 will not link to it.
 */

function Section({
  title,
  rule,
  children,
}: {
  title: string;
  rule?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-8">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-display-l text-ink">{title}</h2>
        {rule ? <p className="meta max-w-prose">{rule}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Swatch({
  name,
  className,
}: {
  name: string;
  className: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-14 rounded-image border border-line ${className}`} />
      <span className="meta">{name}</span>
    </div>
  );
}

export default function KitchenSinkPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-display-xl text-ink">Kitchen sink</h1>
        <p className="max-w-prose text-body text-ink-dim">
          Every primitive in every state. Tab through this page — focus must be
          visible on everything. Turn on reduced motion and reload — the
          develop-in should cross-fade in 120ms with no blur and no
          desaturation.
        </p>
        <p className="meta">
          darkroom · warm is you · cool is live · grain at 2.5%
        </p>
      </header>

      <Section
        title="Color"
        rule="Two light sources. Safelight and daylight never appear in the same component. Accents at small scale and low frequency — the photographs are the color."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Swatch name="base" className="bg-base" />
          <Swatch name="surface" className="bg-surface" />
          <Swatch name="raised" className="bg-raised" />
          <Swatch name="line" className="bg-line" />
          <Swatch name="ink" className="bg-ink" />
          <Swatch name="ink-dim" className="bg-ink-dim" />
          <Swatch name="ink-faint" className="bg-ink-faint" />
          <Swatch name="safelight" className="bg-safelight" />
          <Swatch name="safelight-dim" className="bg-safelight-dim" />
          <Swatch name="daylight" className="bg-daylight" />
          <Swatch name="daylight-dim" className="bg-daylight-dim" />
          <Swatch name="danger" className="bg-danger" />
          <Swatch name="success" className="bg-success" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="meta py-2">token</th>
                <th className="meta py-2 text-right">on base</th>
                <th className="meta py-2 text-right">on surface</th>
                <th className="meta py-2 text-right">on raised</th>
                <th className="meta py-2 text-right">needs</th>
                <th className="meta py-2 pl-4">note</th>
              </tr>
            </thead>
            <tbody>
              {contrastTable.map((row) => {
                const worst = Math.min(row.onBase, row.onSurface, row.onRaised);
                const passes = worst >= row.need;
                return (
                  <tr key={row.token} className="border-b border-line/50">
                    <td className="py-2 font-mono text-label text-ink">
                      {row.token}
                    </td>
                    <td className="py-2 text-right font-mono text-label text-ink-dim">
                      {row.onBase.toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono text-label text-ink-dim">
                      {row.onSurface.toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono text-label text-ink-dim">
                      {row.onRaised.toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono text-label text-ink-faint">
                      {row.need.toFixed(1)}
                    </td>
                    <td
                      className={`py-2 pl-4 text-label ${
                        passes ? "text-success" : "text-danger"
                      }`}
                    >
                      {passes ? "pass" : "under"}
                      {row.note ? ` — ${row.note}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Type"
        rule="Three roles, three faces. Display is Bricolage Grotesque and appears nowhere below 24px. Body and UI are Geist Sans. The meta role is Geist Mono, and it is the thing people will recognise."
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <span className="meta">display-xl · 48/1.0 · -0.03em</span>
            <p className="font-display text-display-xl text-ink">
              A print develops
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="meta">display-l · 32/1.1 · -0.02em</span>
            <p className="font-display text-display-l text-ink">
              A print develops
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="meta">title · 20/1.3 · -0.01em</span>
            <p className="text-title text-ink">A print develops</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="meta">body · 15/1.55</span>
            <p className="max-w-prose text-body text-ink">
              Most social apps in dark mode look like a dark SaaS dashboard:
              neutral gray surfaces, one bright accent, rounded cards. Nothing
              about it says photography.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="meta">label · 13/1.4 · 0.01em</span>
            <p className="text-label text-ink-dim">Add alt text</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="meta">meta · 11/1.3 · 0.06em · mono, uppercase</span>
            <p className="meta">2.4K likes · 1080×1350 · 14 aug</p>
          </div>
        </div>
      </Section>

      <Section
        title="Button"
        rule="Primary is safelight text on transparent with a safelight-dim border, never a filled warm block. Filled exists only for destructive confirmation. Hover is 120ms, color only — no lift, no scale."
      >
        <div className="flex flex-col gap-6">
          {(["primary", "secondary", "ghost", "destructive", "link"] as const).map(
            (variant) => (
              <div key={variant} className="flex flex-col gap-2">
                <span className="meta">{variant}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant={variant} size="sm">
                    Small
                  </Button>
                  <Button variant={variant}>Default</Button>
                  <Button variant={variant} size="lg">
                    Large — 40px ceiling
                  </Button>
                  <Button variant={variant} disabled>
                    Disabled
                  </Button>
                </div>
              </div>
            ),
          )}
        </div>
      </Section>

      <Section
        title="Input"
        rule="No background fill. A 1px bottom border only, which goes safelight on focus. Full-box inputs make a dark UI feel like a form; a photo app should feel like a viewer."
      >
        <div className="grid max-w-md gap-6">
          <label className="flex flex-col gap-2">
            <span className="meta">default</span>
            <Input placeholder="marko" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="meta">filled</span>
            <Input defaultValue="Shot on Portra 400, pushed one stop." />
          </label>
          <label className="flex flex-col gap-2">
            <span className="meta">invalid</span>
            <Input aria-invalid defaultValue="not-an-email" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="meta">disabled</span>
            <Input disabled placeholder="Unavailable" />
          </label>
        </div>
      </Section>

      <Section
        title="Avatar"
        rule="A 1px line ring always, a daylight ring when the user is online, never a gradient. The ring going cool means something is happening now — it does not mean this person is important."
      >
        <div className="flex flex-wrap items-end gap-8">
          <div className="flex flex-col items-center gap-2">
            <Avatar size="sm">
              <AvatarFallback>mk</AvatarFallback>
            </Avatar>
            <span className="meta">sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Avatar>
              <AvatarImage
                src={mediaFixtures[1]?.src}
                alt="Marko's avatar"
              />
              <AvatarFallback>mk</AvatarFallback>
            </Avatar>
            <span className="meta">default</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Avatar size="lg">
              <AvatarImage
                src={mediaFixtures[0]?.src}
                alt="Marko's avatar"
              />
              <AvatarFallback>mk</AvatarFallback>
            </Avatar>
            <span className="meta">lg</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Avatar online>
              <AvatarFallback>on</AvatarFallback>
            </Avatar>
            <span className="meta">online — daylight</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <AvatarGroup>
              <Avatar size="sm">
                <AvatarFallback>a</AvatarFallback>
              </Avatar>
              <Avatar size="sm">
                <AvatarFallback>b</AvatarFallback>
              </Avatar>
              <Avatar size="sm">
                <AvatarFallback>c</AvatarFallback>
              </Avatar>
            </AvatarGroup>
            <span className="meta">group</span>
          </div>
        </div>
      </Section>

      <Section
        title="Dialog"
        rule="Raised surface, 12px radius, backdrop blur(8px) over base at 70%. The only place besides controls with a radius above 2px — a modal genuinely is a container floating over the page."
      >
        <Dialog>
          <DialogTrigger render={<Button variant="secondary" />}>
            Open dialog
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this post?</DialogTitle>
              <DialogDescription>
                It disappears from every feed immediately. The file is removed
                for good by the scheduled hard delete.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>
                Keep it
              </DialogClose>
              <DialogClose render={<Button variant="destructive" />}>
                Delete
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section
        title="Skeleton"
        rule="Solid surface, no shimmer. A shimmer on a photo grid competes with the develop-in, and the develop-in is the motion budget."
      >
        <div className="flex max-w-md flex-col gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
          <Skeleton className="aspect-[4/5] w-full" />
          <Skeleton className="h-3 w-48" />
        </div>
      </Section>

      <Section
        title="Develop-in"
        rule="Blurhash canvas, then 380ms: opacity 0 to 1 with blur(12px) saturate(0.4) resolving to blur(0) saturate(1), on cubic-bezier(0.16, 1, 0.3, 1). Once per image, on first paint into the viewport. The glow behind each is its dominant colour at 8%."
      >
        <DevelopDemo fixtures={mediaFixtures} />
      </Section>

      <Section
        title="Layout"
        rule="Nav rail 72px collapsed and 240px expanded. Feed column fixed at 640px, centred, never fluid — a photo feed that reflows on window resize feels unstable. Right rail 320px, dropped below 1280px."
      >
        <div className="flex gap-3 overflow-x-auto">
          <div className="flex h-40 w-nav-rail shrink-0 items-end justify-center rounded-image border border-line bg-surface p-2">
            <span className="meta">72</span>
          </div>
          <div className="flex h-40 w-nav-rail-open shrink-0 items-end justify-center rounded-image border border-line bg-surface p-2">
            <span className="meta">240</span>
          </div>
          <div className="flex h-40 w-feed shrink-0 items-end justify-center rounded-image border border-line bg-surface p-2">
            <span className="meta">640 — feed</span>
          </div>
          <div className="flex h-40 w-right-rail shrink-0 items-end justify-center rounded-image border border-line bg-surface p-2">
            <span className="meta">320</span>
          </div>
        </div>
      </Section>
    </main>
  );
}
