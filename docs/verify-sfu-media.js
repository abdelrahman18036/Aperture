/**
 * Run a real group call on a machine with no camera and no microphone.
 *
 * Paste into the browser console on a signed-in Aperture page, then open a
 * group conversation of three or more and press Call.
 *
 * `docs/verify-sfu.js` dials LiveKit's signalling socket by hand and stops at
 * the JoinResponse — it proves the token Django signs is one LiveKit accepts,
 * and nothing about media. This goes the rest of the way by lying to the
 * *browser* instead of bypassing the app: `getUserMedia` is replaced with a
 * canvas `captureStream` and an oscillator, so `livekit-client` acquires,
 * encodes and publishes genuine `MediaStreamTrack`s through the product's own
 * call UI. Everything except the capture is real.
 *
 * Confirm the far side from the server rather than the browser — a local
 * preview renders whether or not anything was published:
 *
 *     cd apps/api && uv run manage.py shell
 *     >>> exec(open("../../docs/check-sfu-room.py").read())
 *
 * Measured on the development machine: LiveKit held `video/VP8` at 640x480
 * and `audio/red`, both unmuted, from a participant identified by the
 * caller's snowflake.
 */
(() => {
  // A moving frame rather than a still one, so a stalled encoder is visible
  // as a frozen number rather than as a picture that looks fine.
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  let frame = 0;
  setInterval(() => {
    frame += 1;
    context.fillStyle = `hsl(${String(frame % 360)},70%,45%)`;
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = "#fff";
    context.font = "bold 48px sans-serif";
    context.fillText(`SFU ${String(frame)}`, 40, 240);
  }, 40);

  const video = canvas.captureStream(25);

  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  oscillator.frequency.value = 440;
  const destination = audioContext.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  const audio = destination.stream;

  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  // Cloned per call: a track can only be published once, and LiveKit asks
  // for audio and video separately — `setMicrophoneEnabled` then
  // `setCameraEnabled`, which is itself deliberate, so that a machine with
  // no webcam still gets a call with sound.
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const tracks = [];
    if (constraints?.video) tracks.push(video.getVideoTracks()[0].clone());
    if (constraints?.audio) tracks.push(audio.getAudioTracks()[0].clone());
    if (tracks.length === 0) return real(constraints);
    return new MediaStream(tracks);
  };

  // Some paths enumerate before asking. Without this they conclude there is
  // no camera and never call `getUserMedia` at all.
  navigator.mediaDevices.enumerateDevices = async () => [
    {
      deviceId: "synthetic-cam",
      kind: "videoinput",
      label: "Synthetic camera",
      groupId: "synthetic",
    },
    {
      deviceId: "synthetic-mic",
      kind: "audioinput",
      label: "Synthetic microphone",
      groupId: "synthetic",
    },
  ];

  console.log("synthetic hardware installed — now press Call");
})();
