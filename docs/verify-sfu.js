/**
 * Verify the SFU path, without a camera and without three people.
 *
 * Paste into the browser console on any signed-in Aperture page, with
 * CONVERSATION_ID set to a group of three or more.
 *
 * `docs/verify-call-media.js` covers the 1:1 mesh — two peer connections and
 * synthetic tracks, end to end. This covers the other branch, which is the
 * one nothing had ever exercised: at `SFU_THRESHOLD` participants a call
 * stops being a mesh and becomes a room, and the chain that has to hold is
 *
 *   participant count -> mode "sfu" -> room name -> a token Django signs
 *   -> LiveKit validating that token -> a room join
 *
 * The last two links are the interesting ones, because they are the only
 * place `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are proven to match what
 * the server holds. A token that is well-formed and signed with the wrong
 * secret looks perfect from Django's side and is refused at the door.
 *
 * It stops at the JoinResponse rather than publishing media. Past that point
 * the media path is LiveKit's own, tested by LiveKit; what belongs to this
 * codebase is everything up to the join.
 */
const CONVERSATION_ID = "REPLACE_WITH_A_GROUP_CONVERSATION_ID";

(async () => {
  const csrf =
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("aperture_csrftoken="))
      ?.slice("aperture_csrftoken=".length) ?? "";

  const call = await fetch("/api/calls/start", {
    method: "POST",
    headers: { "content-type": "application/json", "X-CSRFToken": csrf },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID }),
  }).then((r) => r.json());

  console.log("mode:", call.mode, "participants:", call.participant_ids?.length);

  if (call.mode !== "sfu") {
    console.error(
      "Not an SFU call. Needs a conversation with at least SFU_THRESHOLD members.",
    );
    return;
  }
  if (!call.livekit_token || !call.livekit_url) {
    console.error("No room token. LIVEKIT_* is not configured.");
    return;
  }

  // The signalling endpoint, dialled by hand rather than through
  // `livekit-client`, so this runs from a console with nothing imported.
  const url =
    `${call.livekit_url}/rtc` +
    `?access_token=${encodeURIComponent(call.livekit_token)}` +
    `&auto_subscribe=true&protocol=15&sdk=js`;

  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";

  const timer = setTimeout(() => {
    console.error("No response from LiveKit within 8s.");
    socket.close();
  }, 8000);

  socket.onmessage = (event) => {
    clearTimeout(timer);
    // A JoinResponse. Its arrival is the proof: LiveKit sends nothing at all
    // to a socket whose token it rejected — it closes with 1006 instead.
    console.log(
      "joined — LiveKit accepted the token,",
      event.data.byteLength ?? String(event.data).length,
      "byte JoinResponse",
    );
    socket.close();
  };

  socket.onclose = (event) => {
    clearTimeout(timer);
    if (event.code !== 1000 && event.code !== 1005) {
      // 1006 with no reason is what a bad signature looks like from here.
      console.error("refused:", event.code, event.reason || "(no reason)");
    }
  };
})();
