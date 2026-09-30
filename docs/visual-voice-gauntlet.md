# Campsite and P2P voice verification

The follow-up art and GPU glyph pass is recorded in [art-playtest.md](art-playtest.md).
`tools/verify-gpu.mjs` is also included in `npm test`.

The old scene had a flat meadow, oversized purple horizon shapes, clipped fire
lighting, and HUD text scattered around the viewport. The pass adds a cool dusk
palette, a grove behind the clearing, lanterns and a light string, softer flame
geometry, a smaller fire bloom, and camera framing around the gathering. Chat
and voice now share a dock, with explicit empty and permission-error states.

The visual gauntlet captures desktop (1440×900), laptop (1280×720), tablet
(768×1024), phone (390×844), small phone (360×740), and landscape (844×390).
It asserts loaded brand art, running frames, viewport containment and non-overlap
of controls (including the activity strip), touch UI availability, escaped chat, keyboard movement after clicking
HUD buttons, rename, fishing journal, and an actionable microphone-denial state.
Screenshots also cover controls plus chat, the journal, and voice denial.
The active voice roster is checked on a small phone; it replaces the conversation
panel while open so the two do not overlap.

Fire, Fish, Skate, and Hats are available as direct touch/mouse actions. Fish
walks to the shore and casts, then highlights the reel-in action when a fish
bites. The catch window is 1.8 seconds. Fire and Hats use waypoints around the
firepit, and manual movement cancels navigation. Touch wave, pet, and hop
controls are labelled native buttons.

`node tools/verify-play.mjs` plays the actual loop in a phone-sized browser with
a second Trystero peer. It verifies a skateboard on both peers, a remote wave,
a frame-sampled hop, walking to the shore, auto-casting, replicated tackle,
visible bite feedback, catching, earned shells and journal entries, the shared
catch brag, returning to the fire, visiting/cycling hats, and cancelling movement.
It captures fishing, catch, journal and hat-rack screenshots.

Screenshot review found and corrected tablet dock/button overlap, phone and
landscape header overlap, a missing SVG response type, exposed pine trunks,
and player framing behind the small-phone conversation panel.

Voice uses `room.addStream` and `room.onPeerStream` on the existing Trystero room.
The browser transports microphone audio through its WebRTC media pipeline.
Each incoming voice has a retained muted audio element, a Web Audio source,
analyser, HRTF panner, and gain node. The avatar supplies listener position;
camera orientation supplies listener direction. A fade ends audible range at
28 world units. Remote speaking state is measured from incoming audio, with
microphone/deafen state sent on an additive `voice` action lane.

Capture starts only after Join voice. Microphone mute and push-to-talk disable
the capture track. Deafen disables the mic and playback. Voice leave stops
capture tracks and disconnects audio nodes. Cancelling a pending permission
request also stops any stream that arrives later. Peer departure removes its
audio element and graph. The existing player/NPC/guest protocol stays additive.

`node tools/verify-voice.mjs` sends a PCM tone through Chrome's fake microphone
into real Trystero peers, then checks a nonzero received waveform and inbound
audio RTP packets/bytes. It exercises keyboard and pointer push-to-talk, mute,
deafen, per-peer mute, distance cutoff, moving panners, a third late peer,
peer departure, actual track termination, rejoin, and cancelled permission.
This is browser transport evidence; physical microphone/headphone quality and
remote-device NAT traversal are outside this local test.

Run from the project root:

```powershell
node tools/visual-gauntlet.mjs
node tools/verify-voice.mjs
node tools/verify-play.mjs
node tools/verify-npcsync.mjs
node tools/verify-coop.mjs
```

The gauntlets fail on browser errors. Screenshots and JSON receipts are written
under `verify/`. A passing visual run ends with
`COMPLETE visual gauntlet all checks passed`; a passing voice run ends with
`COMPLETE P2P voice all checks passed`.
A passing gameplay run ends with `COMPLETE gameplay gauntlet all checks passed`.
