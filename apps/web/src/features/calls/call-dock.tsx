"use client";

import { Button, InstrumentPanel } from "@repo/ui";

import { CallPanel } from "./call-panel";
import { useCallControls } from "./provider";

/**
 * The one place a call appears.
 *
 * Fixed to the bottom of the viewport rather than living in a thread, because
 * a call is not a property of the screen you happen to be on. Ringing while
 * you read the feed is the entire reason this exists.
 *
 * It sits above the grain overlay and below nothing else — a call is the most
 * interruptive thing the product does, and pretending otherwise by tucking it
 * into a corner of the current page would be worse, not politer.
 */
export function CallDock() {
  const { session, peer, sfu } = useCallControls();

  if (session.incoming === null && session.call === null) {
    if (session.error === null) return null;

    return (
      <InstrumentPanel
        role="alert"
        tone="raised"
        className="fixed inset-x-2 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 px-4 py-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-right-rail lg:bottom-4"
      >
        <p className="text-body text-danger">{session.error}</p>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={session.clearError}>
            Dismiss
          </Button>
        </div>
      </InstrumentPanel>
    );
  }

  return (
    <div className="fixed inset-x-2 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[28rem] lg:bottom-4">
      {session.incoming !== null && (
        <InstrumentPanel
          tone="raised"
          className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-body text-ink">
            {/* Daylight: something happening now, per the palette rule. */}
            <span className="text-accent">
              {session.incoming.caller.username}
            </span>{" "}
            is calling
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={session.answer} disabled={session.starting}>
              Answer
            </Button>
            <Button variant="ghost" onClick={session.decline}>
              Decline
            </Button>
          </div>
        </InstrumentPanel>
      )}

      {session.call !== null && (
        <InstrumentPanel tone="raised" className="overflow-hidden">
          <CallPanel
            call={session.call}
            peer={peer}
            sfu={sfu}
            peerName={session.label ?? "Call"}
            onHangUp={session.hangUp}
          />
        </InstrumentPanel>
      )}
    </div>
  );
}
