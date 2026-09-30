# Campfire

A little room in the woods. Walk, fish, skate and talk around a shared fire as
a procedural creature. Movement and opt-in spatial voice use Trystero/WebRTC
peer-to-peer connections.

[Play Campfire](https://tront.xyz/campfire/) ·
[Visual update tour and test receipts](https://tront.xyz/campfire/updates.html)

## v1.8

- Native WebGPU glyphs for the HUD, chat, names and speech; GPU readback verified
  in Chrome and Firefox. The world renderer uses Three.js/WebGL.
- One drawer for Controls, Settings, Journal and Hats, with real hat images.
- Hats follow the animated head; skating uses a stance anchored to the deck.
- Fishing lines clear the bank, glows align with their fixtures, and activity
  paths navigate around props.
- Companions perch, leave their seats and keep wandering across keeper migration.
- Correct phone proportions, integrated chat/voice, H for Controls and suppressed
  game-label selection and browser context menus.

## Controls

WASD or arrows to move, drag to orbit, scroll to zoom, Space to hop, Enter to
chat and H for Controls. The Fire, Fish, Skate and Hats buttons work with a
mouse or touch. Extra gamepads can join on the same screen.

Choose Join voice and allow microphone access. Open mic and push-to-talk are
available, with microphone mute, deafen, per-peer mute and saved volume settings.
Invite a friend shares the current fire; `?room=name` selects a private fire.

This repository is the static GitHub Pages publication. Development source and
the automated browser harness live in
[campfire-dev](https://github.com/TrentSterling/campfire-dev) (private).
