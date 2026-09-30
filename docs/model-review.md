# Model polish and ranking

This pass reviewed actual production factories, rebuilt the weakest props, then
rendered them again under a fixed camera and light. The final catalog has 58
variants: three seeds for each of six creatures, eight hats, three equipment
models, twelve fish species plus a golden, nine campsite assets and seven flora
assets. Three angles plus 48 worn-hat views produce 222 screenshots; eighteen
additional captures exercise locomotion.

Scores are subjective art judgments out of ten, combining silhouette readability,
construction, detail at play distance and consistency with the dusk campsite.
They are not automated quality scores. Rankings are within each group.

## Creatures

Every family received calmer colour, less white specular/rim glare, removal of
duplicate colour-decal shells, and suppression of most stray ink in smooth-union
overlaps. Seeded anatomy and gait remain intact.

| Rank | Family | Score | Judgment after the pass |
| --- | --- | --- | --- |
| 1 | Multiped | 8.3 | Antennae, spread legs and low body give the clearest moving identity. |
| 2 | Hopper | 8.0 | Ears and squash carry the character; ear-root seams are much quieter. |
| 3 | Quadruped | 7.8 | Lumbering body and little feet read well; calmer skin avoids the glowing gummy look. |
| 4 | Serpent | 7.7 | Raised head and trailing chain read well from the side; frontal views foreshorten it heavily. |
| 5 | Biped | 7.5 | Clean face and arms, but the simplest bodies resemble the flyer. |
| 6 | Flyer | 7.4 | Hover and propeller identify it in motion; body needs distinction when a hat hides the propeller. |

Three seeds per family include one-eyed variants and different ears/decorations.
[Creature sheets: 1](../verify/models-final-critters-0.png),
[2](../verify/models-final-critters-1.png), [3](../verify/models-final-critters-2.png).

## Hats

Every hat was rebuilt. All use the same resting plane and animated skin socket;
the halo retains its intentional float. Head decorations and flyer propellers
make room for worn hats.

| Rank | Hat | Score | Defect addressed |
| --- | --- | --- | --- |
| 1 | Wizard | 8.7 | Bent silhouette, rolled brim and attached five-point stars replace the cone. Review caught buried stars and moved them onto the surface. |
| 2 | Crown | 8.6 | Continuous pointed wall, beading and gems replace isolated cones. |
| 3 | Top hat | 8.5 | Flared crown, rounded brim, ribbon and buckle finish the cylinder. |
| 4 | Toadstool | 8.4 | Flattened cap, cream underside and attached spots replace floating dots. |
| 5 | Propeller beanie | 8.2 | Muted panels, rolled band and rounded blades replace the bright basic dome. |
| 6 | Party cone | 8.1 | Alternating bands, rim and tufted pom finish the starter hat. |
| 7 | Daisy | 7.8 | Shaped petals and centre stamens add definition; intentionally small. |
| 8 | Halo | 7.7 | Thin double ring and restrained emission replace the yellow glow blob. |

[Hat sheets: 1](../verify/models-final-hats-0.png), [2](../verify/models-final-hats-1.png).
All 48 combinations are in [attachment sheets: 1](../verify/models-final-attachments-0.png),
[2](../verify/models-final-attachments-1.png), [3](../verify/models-final-attachments-2.png).
The GPU suite checks attachment during 768 animation samples, including jumps,
squash and heads offset from body centres.

## Equipment

| Rank | Model | Score | Defect addressed |
| --- | --- | --- | --- |
| 1 | Skateboard | 8.3 | Rounded deck, bent ends, visible grip, wood edges, trucks, axles, hubs and bolts replace the box plank. Review caught the initially buried grip. |
| 2 | Bobber | 8.1 | Joined red/cream hemispheres, seam and antenna replace overlapping balls. |
| 3 | Rod | 7.9 | Tapered pole, cork grip, reel and eyelets replace the bare stick. |

[Equipment views](../verify/models-final-equipment-0.png).

## Fish

The shared ellipsoid/cone became species-specific proportions, tails, dorsal
profiles, paired fins, eyes, gills and mouths. Seeded catch data and wire identity
remain unchanged. Self-shadow artifacts were removed. Thin-species stripes now
conform to the skin instead of hiding inside it.

| Rank | Species/variant | Score | Main distinguishing detail |
| --- | --- | --- | --- |
| 1 | Koi | 8.3 | Cream body with rust patches attached to the surface. |
| 2 | Guppy | 8.1 | Oversized fan tail and separate rays. |
| 3 | Puffer | 8.0 | Round body and embedded spines; initial tall disk corrected. |
| 4 | Dab | 7.9 | Flat body and both eyes on one side. |
| 5 | Snapper | 7.8 | Toothed dorsal profile and broad body. |
| 6 | Golden variant | 7.8 | Restrained gold colour/emission preserves the species form. |
| 7 | Wisp | 7.7 | Slender body, long tail and pale stripe. |
| 8 | Carp | 7.6 | Deep body and curved barbels. |
| 9 | Sardine | 7.6 | Narrow body and skin stripe. |
| 10 | Minnow | 7.5 | Small slender profile and stripe. |
| 11 | Gulper | 7.5 | Broad body and exaggerated mouth ring. |
| 12 | Bloop | 7.3 | Bubble shape; excessive vertical stretch corrected. |
| 13 | Chub | 7.2 | Readable ordinary fish, but the least memorable catch. |

The simpler species still share a construction language. More individuality would
come from mouth/fin animation and stronger markings.
[Fish sheets: 1](../verify/models-final-fish-0.png),
[2](../verify/models-final-fish-1.png), [3](../verify/models-final-fish-2.png).

## Campsite

| Rank | Asset | Score | Defect addressed |
| --- | --- | --- | --- |
| 1 | Fire, stones and logs | 8.5 | Irregular stones, grain, charred ends and ember rings support the layered moving flames. |
| 2 | Lantern | 8.4 | Framed glass, tapered roof, handle and collar replace the box. The post ends below the glass. |
| 3 | Log bench | 8.3 | Wobbly bark, cut faces, growth rings and supports finish the cylinder. |
| 4 | Dock | 8.2 | Grain, uneven planks, nails, beams, posts and rope wraps give it construction. |
| 5 | Fir | 8.1 | Lobed bent tiers and varied widths replace perfect stacked cones. |
| 6 | Hat rack | 8.0 | Textured posts, metal feet, nails and hat pictogram replace the blank sign and sticks. |
| 7 | Reeds | 7.8 | Curved ribbon blades replace cones. |
| 8 | Festoon | 7.8 | Bulb caps/sockets complete the cable; strongest as composition. |
| 9 | Broadleaf | 7.6 | Bark and forked branches improve the trunk; canopy remains visibly assembled from clumps. |

[Campsite sheets: 1](../verify/models-final-world-0.png), [2](../verify/models-final-world-1.png).

## Flora

Every factory was rebuilt with actual blades, petals, caps, cut timber or stone
clumps. Small plants no longer receive coarse self-shadow patterns. Grass,
flowers and reeds share quiet wind motion. Planting is deterministic.

| Rank | Asset | Score | Defect addressed |
| --- | --- | --- | --- |
| 1 | Stump | 8.2 | Bark, roots, cut face and rings replace the smooth blob. |
| 2 | Mushroom | 8.1 | Shaped cap, cream underside and conforming spots replace the bright lollipop. |
| 3 | Flower | 8.0 | Paired stems, petals, centres and leaves replace coloured spheres. |
| 4 | Grass | 7.7 | Curved ribbons and varied heights replace stiff spikes. |
| 5 | Bush | 7.6 | Muted clumps and small berries settle it into the grove. |
| 6 | Boulder | 7.5 | Irregular clustered stones replace smooth purple blobs. |
| 7 | Pebble | 7.3 | Quiet facets and clustered sizes; simple at play distance. |

[Flora sheets: 1](../verify/models-final-flora-0.png), [2](../verify/models-final-flora-1.png).

## Scene review and remaining weaknesses

The [live campsite](../verify/art-polished.png) also covers ground, clearing,
leaf litter, shore, moving water, distant hills/forest, sparks, fireflies,
butterflies, bees and pollen. Sky stars/moon depend on camera direction and were
retained. Distant forest and hill variation were softened to support the grove.

The strongest improvement is consistency: timber looks related across benches,
posts and dock, hats have finished edges, plants look botanical, and fish have
different silhouettes. Remaining visual priorities are a proper companion perched
pose, stronger flyer/biped body differences and more distinctive Chub/Bloop catches.
The live capture shows a serpent overlapping a bench during its sitting vignette.
Replicated seating permission fixes collision disagreement but does not create a
crafted sitting animation. Small SDF join irregularities remain visible at
inspection zoom. Broadleaf and bush clumps remain simple secondary assets.

## Evidence and reproduction

`cd tools; npm test` includes production-model, visual, GPU, voice and gameplay
checks. The final run ended with:

```text
COMPLETE model gauntlet: 222 views, 58 production variants
COMPLETE visual gauntlet all checks passed
COMPLETE GPU text, hats and settings all checks passed
COMPLETE P2P voice all checks passed
COMPLETE gameplay gauntlet all checks passed
```

`node tools/playtest-art.mjs` passed all 53 solid prop footprints, explicit hat
preview/buy behaviour, camera extremes and collapsed phone layout. The bench
crossing stopped 0.442 world units from its centre without a jump. At 360 by 740,
collapsed chat leaves 284 pixels of clear scene, up from 241.625. NPC seating,
convergence, keeper migration and liveness, plus couch guest join/leave, passed
with zero browser errors. Repeated hats/casts held the warmed renderer geometry
count at 324 in the final GPU run.

Run `python tools/model-sheets.py final` after the model suite to rebuild contact
sheets (requires Pillow). `tools/model-review.html` exposes the production catalog
for isolated browser inspection. The JSON receipt is `verify/models-final-report.json`.
Baseline views remain under `models-baseline-*` and `model-baseline-*`. Screenshots
and profiles are local QA artifacts under the ignored `verify/` directory.
