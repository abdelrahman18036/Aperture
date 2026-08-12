/**
 * Verify that a call actually carries media, without a camera.
 *
 * Paste into the browser console on any signed-in Aperture page.
 *
 * The trick is synthetic tracks: a canvas `captureStream` and an oscillator
 * produce genuine `MediaStreamTrack`s with no hardware behind them, so the
 * whole negotiate-encode-send-decode path runs on a machine with no webcam or
 * in a browser that refuses to grant one. Everything except the capture is
 * real — real ICE servers from the API, real coturn, real codecs.
 *
 * Set RELAY_ONLY to true to force every candidate through TURN. Frames
 * arriving under that policy is proof the relay works, because nothing else
 * is permitted to succeed.
 */
const RELAY_ONLY = false;
const CONVERSATION_ID = "REPLACE_WITH_A_CONVERSATION_ID";

(async () => {
  const csrf = document.cookie
    .split("; ")
    .find((c) => c.startsWith("aperture_csrftoken="))
    ?.slice("aperture_csrftoken=".length) ?? "";

  const call = await fetch("/api/calls/start", {
    method: "POST",
    headers: { "content-type": "application/json", "X-CSRFToken": csrf },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID }),
  }).then((r) => r.json());

  // A canvas that changes every frame. A static one can encode to almost
  // nothing and never move the frame counter, which reads as a broken test.
  const canvas = Object.assign(document.createElement("canvas"), {
    width: 320,
    height: 240,
  });
  const ctx = canvas.getContext("2d");
  let tick = 0;
  const paint = setInterval(() => {
    tick += 1;
    ctx.fillStyle = `hsl(${(tick * 11) % 360} 70% 50%)`;
    ctx.fillRect(0, 0, 320, 240);
  }, 33);

  const audioCtx = new AudioContext();
  const osc = audioCtx.createOscillator();
  const dest = audioCtx.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();

  const local = new MediaStream([
    canvas.captureStream(30).getVideoTracks()[0],
    dest.stream.getAudioTracks()[0],
  ]);

  const config = {
    iceServers: call.ice_servers,
    ...(RELAY_ONLY ? { iceTransportPolicy: "relay" } : {}),
  };
  const a = new RTCPeerConnection(config);
  const b = new RTCPeerConnection(config);
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  for (const track of local.getTracks()) a.addTrack(track, local);

  const offer = await a.createOffer();
  await a.setLocalDescription(offer);
  await b.setRemoteDescription(offer);
  const answer = await b.createAnswer();
  await b.setLocalDescription(answer);
  await a.setRemoteDescription(answer);

  await new Promise((r) => setTimeout(r, 12000));

  const stats = await b.getStats();
  const result = { state: a.connectionState, inbound: {}, pair: null };
  for (const report of stats.values()) {
    if (report.type === "inbound-rtp") {
      result.inbound[report.kind] = {
        bytes: report.bytesReceived,
        frames: report.framesDecoded ?? null,
      };
    }
    if (
      report.type === "candidate-pair" &&
      (report.selected || report.state === "succeeded")
    ) {
      const localCandidate = stats.get(report.localCandidateId);
      result.pair = {
        type: localCandidate?.candidateType,
        relayProtocol: localCandidate?.relayProtocol,
        url: localCandidate?.url,
      };
    }
  }

  clearInterval(paint);
  osc.stop();
  await audioCtx.close();
  a.close();
  b.close();

  console.log(result);
})();
