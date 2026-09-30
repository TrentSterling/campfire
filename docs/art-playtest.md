# Art, GPU text and playtest

## What changed

The HUD, chat, input text, journal, settings, nametags and speech now use a shared
SDF glyph atlas and instanced quads. A separate native WebGPU canvas draws the
glyphs and label panels with WGSL pipelines in at most two draws. The initial
WebGL implementation has been replaced. Canvas rasterizes each newly encountered
grapheme into the distance atlas once; entire labels are never canvas textures.
The font is self-hosted Nunito with its OFL license in `assets/fonts/`.

Native controls still provide layout, focus, keyboard editing, selection, IME,
mobile keyboards and accessible names. Their visible text and caret are suppressed;
the GPU draws those pixels. Native browser select menus retain browser text.
Cached DOM ranges supply HUD glyph positions, with GPU clipping for scrolling,
truncation and panels covering other controls. World anchors project through the
same curvature as the scenery, then speech wraps and labels avoid collisions.
Own nametags are quiet, so the foreground character stays readable.

The atlas is bounded to 625 graphemes across regular and bold variants, in one
2048-square R8 texture. Unknown entries after that limit use the replacement
glyph. Accented Latin and emoji editing were exercised. Full contextual shaping
for complex scripts still needs a shaping engine. World labels currently use
screen projection and HUD masking; they do not sample scene depth.

Hats now attach to the live animated head skin, with its actual head rotation
and radius. Decorations and flyer propellers make room for worn hats; the halo
keeps its intentional float. Hat and tackle resource disposal stops geometry
growth during repeated changes and casts. Fishing line curvature matches the
rod and bobber. Close zoom follows the player enough to keep the avatar visible.

The environment has uneven sculpted fir groves, broadleaf clumps, distant forest
silhouettes, worn paths, leaf litter, timber benches with cut ends and growth
rings, shore reeds, a landing, moving water, and independently moving flame licks.
The atmosphere has fewer floating specks. The settings gear saves independent
ambience, effects and voice levels, high/light graphics, particles and nametags.

## Playtest defects fixed in the model pass

1. **Solid props now block walking.** The original bench crossing came within
   0.022 world units of its centre without jumping. It now stops at 0.442.
   All 53 footprints passed: benches, trunks, boulders, stumps, lantern/festoon
   posts and rack posts. Activity paths route around them. NPC seating permission
   is replicated and cleared on release and keeper adoption.
2. **Hat buying is explicit.** Opening the shop and trying another hat preserve
   all 12 test shells and the committed hat. Preview stays local. Buy and wear
   spends the displayed price once, persists ownership and broadcasts the hat.
   Owned and unaffordable items cannot double-spend.
3. **Phone conversation collapses.** At 360 by 740, clear play space increased
   from 241.625 to 284 pixels. Chat expands on demand. Maximum-length names
   truncate without colliding with progress.

## Remaining rough spots

Companions now approach a reachable point, perch above the timber, and exit back
onto a clear walking point. Serpents coil while seated. Flyer and biped bodies need stronger
differences when the flyer wears a hat. The simplest fish have less personality
than Koi, Guppy and Puffer. Small SDF joins remain visible at inspection zoom.
See the [complete ranked model review](model-review.md).

GPU labels do not sample scene depth, so distant names can appear through props.
Complex-script shaping and the bounded atlas remain limitations described above.
The phone HUD still leaves less open scene than desktop.

## Follow-up fixes from the live review

- Native WebGPU glyphs are verified by GPU texture readback in Chrome and Firefox.
  The world renderer still uses WebGL; text uses no WebGL renderer or shaders.
- Labels and buttons suppress native text selection; editable inputs retain it.
  The game suppresses the browser context menu. H opens Controls, with ? retained
  as an alias outside text editing.
- Controls, Settings, Journal and Hats share one drawer, with one close action.
  Hat choices show eight actual model captures; purchase actions stay visible.
  Conversation sits inside the voice dock and starts collapsed.
- The review phone image now preserves its original aspect ratio. Its original
  fixed HTML height had stretched the UI after CSS narrowed the image.
- Board lean uses wrapped heading differences, a bounded bank and clearance.
  Foot targets are placed on the live deck after collision resolution; the
  walking gait no longer plants skating feet on the terrain. Hoppers glide on
  the board and switch back to hopping when dismounted.
- Fishing lines have 33 samples that clear the grass ledge and sand bank. They
  connect to the actual transformed rod tip, including the cast arc and dip.
- Glow sprites apply the same world curvature as their bulb and lantern meshes.
- Activity destinations use reachable approach points, and NPCs follow clear
  waypoints around furniture. Seating, departure and perched poses replicate;
  keeper adoption clears inherited seating state.

The user-reported regression suite checks 96 routes, all six skating families,
eight cast directions, compiled sprite curvature, one visible drawer section,
hat images, five drawer sizes and the phone-image ratio. Firefox captures
external public-relay connection warnings separately from application errors.

Camera extremes, orbiting, shop behavior, a walking bench crossing and phone names
were exercised in an isolated room by `tools/playtest-art.mjs`. Its JSON receipt
is `verify/art-playtest-report.json`; associated PNGs start with `playtest-`.

## Verification

`cd tools; npm test` passed:

```text
COMPLETE model gauntlet: 222 views, 58 production variants
COMPLETE visual gauntlet all checks passed
COMPLETE GPU text, hats and settings all checks passed
COMPLETE P2P voice all checks passed
COMPLETE gameplay gauntlet all checks passed
```

The visual suite covers six viewports, keyboard/touch controls, chat escaping,
rename, journal, and microphone denial. GPU readback proves glyph coverage and
antialiased edges; tests cover native text suppression, Unicode editing, full
wrapped speech, label collisions at DPR 1 and 2, actual audio buses, preferences
after reload, and 48 hat/archetype combinations across 768 animation samples.
Repeated hats and fishing casts return to the same renderer geometry count.

The voice suite sends synthetic microphone audio through real Trystero WebRTC
connections and checks received waveform, inbound RTP, the live volume gain,
mute/deafen/PTT, range, peer mute, late join, departure and capture teardown.
The gameplay suite performs two-peer touch movement, fishing/catches/rewards,
local hat preview, explicit purchases and return-to-fire navigation. These suites
reported no browser errors. NPC seating, convergence, keeper migration and
liveness also passed with no browser errors.
Couch co-op join/leave replication passed with no browser errors. A final camera
check placed the local avatar's feet and head inside the playable scene at the
closest zoom; both stayed above the social dock.
