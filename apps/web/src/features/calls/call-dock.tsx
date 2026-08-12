"use client";

import { Button } from "@repo/ui";

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
      <div
        role="alert"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised px-4 py-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-right-rail sm:rounded-dialog sm:border"
      >
        <p className="text-body text-danger">{session.error}</p>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={session.clearError}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[28rem]">
      {session.incoming !== null && (
        <div className="flex items-center justify-between border-t border-line bg-raised px-4 py-3 sm:rounded-dialog sm:border">
          <p className="text-body text-ink">
            {/* Daylight: something happening now, per the palette rule. */}
            <span className="text-daylight">
              {session.incoming.caller.username}
            </span>{" "}
            is calling
          </p>
          <div className="flex gap-2">
            <Button onClick={session.answer} disabled={session.starting}>
              Answer
            </Button>
            <Button variant="ghost" onClick={session.decline}>
              Decline
            </Button>
          </div>
        </div>
      )}

      {session.call !== null && (
        <div className="border-t border-line bg-raised sm:rounded-dialog sm:border">
          <CallPanel
            call={session.call}
            peer={peer}
            sfu={sfu}
            peerName={session.label ?? "Call"}
            onHangUp={session.hangUp}
          />
        </div>
      )}
    </div>
  );
}
