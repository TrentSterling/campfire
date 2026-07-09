// src/critter/palette.js : genPalette (OG verbatim). Draws from the CURRENT rng
// stream (seeded during recipe generation) so palettes replicate across clients.
import * as THREE from 'three'
import { pick, rand } from '../engine/rng.js'

// Campfire night grade washes pastels toward gray, so creature saturation gets a
// ~1.6x boost here (deterministic: same multiplier on every client) to keep the
// toys popping red/purple/blue/pink against the dusky meadow at gameplay distance.
const NIGHT_SAT = 1.6
function hsl(h, s, l) { const c = new THREE.Color(); c.setHSL((((h % 360) + 360) % 360) / 360, Math.min(1, s * NIGHT_SAT), l); return [c.r, c.g, c.b] }

export function genPalette(hue, family) {
  family = family || pick(['pastel', 'pastel', 'pastel', 'dusty', 'twotone', 'contrast'])
  let s = 0.52, l = 0.55, bellyHue = hue + 8, accL = 0.50
  if (family === 'dusty') { s = 0.30; l = 0.50 }
  else if (family === 'twotone') { bellyHue = hue + 150 }
  else if (family === 'contrast') { l = 0.42; accL = 0.68 }
  return {
    base: hsl(hue, s, l),
    belly: hsl(bellyHue, Math.min(0.48, s), l + 0.13),
    limb: hsl(hue - 6, s * 0.96, l - 0.08),
    dark: hsl(hue + 14, s * 0.77, 0.23),
    accent: hsl(hue + 140 + rand() * 80, 0.55, accL),
    spot: hsl(bellyHue - 4, Math.min(0.5, s), l + 0.11),
    outline: '#' + new THREE.Color().setHSL((((hue % 360) + 360) % 360) / 360, 0.5, 0.13).getHexString(),
  }
}
