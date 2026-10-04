# RentWise Guest App — AR Feature: Current State, Problems, and Planned Direction

## 1. What this feature is

The guest-facing web app (`rentwise-guest`, a public website — no login) lets a visitor scan their real surroundings with their phone camera and place 3D furniture/fixture models into the scene, to preview how items would look in a market stall before committing.

- **Tech stack**: WebXR + Three.js, running directly in mobile Chrome. This is *not* a native app — no ARKit, no ARCore SDK, no ViroReact. It's a browser-based AR session (`navigator.xr`), so it works on Android/Chrome with WebXR support; iOS/desktop fall back to a spin-and-inspect model viewer with no placement.
- **Core files**:
  - `features/ar/ARSessionScene.ts` — the actual AR engine: WebXR session setup, hit-testing, plane detection, model loading, placement, scaling.
  - `app/ar-view.tsx` — the UI shell (Rotate/Size/Width/Height/Depth/Move/Delete controls, catalog picker).
  - `services/modelService.ts` — fetches the 3D model list from Firestore and resolves their Firebase Storage download URLs.
- **3D assets**: `.glb` files, stored in Firebase Storage, referenced by a Firestore `arObjects` collection. These are managed **entirely outside the app** — uploaded manually (Firebase Console / an external script), with no in-app authoring/upload tooling and no validation of how each model is exported.

## 2. How placement currently works

1. WebXR hit-testing requests both `"plane"` and `"point"` entity types (the latter included specifically to speed up initial detection, at the cost of less reliable orientation data).
2. Every frame, the best hit-test result is filtered by the angle of its surface normal relative to world-up: only near-0° (flat, facing up) results are accepted as a candidate floor spot. Anything past 25° tilt is rejected outright — there is no wall classification anymore (see §3).
3. That candidate is then cross-referenced against `frame.detectedPlanes` (WebXR's Plane Detection API — already read for drawing the translucent plane outlines) to determine whether it falls inside a real, adequately-sized classified plane (`"valid"`), a real but too-small plane (`"invalid"`), or no known plane at all yet (`"unknown"`, e.g. still-classifying or an unsupported device).
4. Confidence to place requires: the plane check isn't `"invalid"`, the spot hasn't drifted for enough consecutive frames (fewer frames needed if plane- or depth-sensor-corroborated, many more if not), and it isn't within 15cm of any detected *vertical* plane (wall-clearance check). The reticle reflects this as three colors — amber (searching/stabilizing), green (confident, placeable), red (found but rejected: too small or too close to a wall).
5. Tapping the screen only places when the reticle is green. Placement clones the currently "armed" model, positions and rotates it, then **measures the object's actual current world-space bounding box after that transform** and vertically snaps it so its true lowest point sits exactly on the detected floor Y — see §3 for why this replaced the original cached-offset approach.

## 3. Fixes made since the original report

Everything below was implemented and is live in the codebase (commits `f026cdf`, `7a26d53`, `495b1e4`, `f96497f`):

- **Wall placement removed entirely.** The real deployment market has railings, not solid walls — WebXR/ARCore plane detection can't reliably classify a railing as a flat surface regardless of any code fix, so all wall-specific code (classification, orientation, offsets) was deleted rather than left dormant. Floor/surface placement only, going forward.
- **Plane-vs-point disambiguation**, worked around a real WebXR spec limitation (hit-test results don't expose which entity type produced them) by cross-referencing each hit's position against `frame.detectedPlanes` polygons after the fact, using a point-in-polygon test plus a minimum real-world area (0.15m², tunable) to distinguish a genuine classified plane from a noisy raw point-hit.
- **Confidence actually gates placement now.** The stability-frame counter existed before but only affected reticle *color*; tapping was gated purely on `reticle.visible`. It's now a real placement gate, and a hit with neither plane nor depth-sensor corroboration has to hold steady far longer (45 frames vs. 10) before it's trusted — closing a gap where a wrong-but-motionless point (e.g. a stray feature point in cluttered geometry) could reach placement in under a second.
- **Wall-corner exclusion zone.** Walls are still *detected* (via the Plane Detection API's `orientation` field) purely to keep floor placement clear of them — a floor spot within 15cm of a detected vertical plane is blocked (red reticle), so an object's own footprint can't clip through a wall/corner even though it's anchored on the floor next to it.
- **`.glb` bounding-box diagnostics.** Each model is sanity-checked once on load (non-finite/zero-size/off-origin bounding box, extreme aspect ratio, implausible real-world scale) and any warning is both logged and shown as an on-screen banner during testing, since `chrome://inspect` needs a tethered desktop that isn't always available on-device.
- **Floor-contact drift fix (the most significant one).** The original approach cached a `groundOffset` once from a model's *original, untransformed* bounding box and trusted it to still be correct after rotation/scaling. That math is actually exact on paper for this file's floor-only, yaw-only placement (a pure Y-axis rotation can't move a point's Y-coordinate) — so whatever caused real drift was something the math couldn't see: GLTF export quirks, a bounding box measured before the loader's matrices settled, accumulated float error across repeated edits. Placement, move, and per-axis scale now each **re-measure the object's real, current, fully-transformed bounding box** and snap its position so the true lowest point matches the floor, rather than trusting a cached number. The ground-shadow decal follows the same measured value so it can't visually drift out of sync with the model.

## 4. Status of the two originally reported problems

**A. Objects near a wall corner appear to float/clip through the corner.**
Addressed two ways: wall placement itself is gone (nothing gets placed *on* the corner anymore), and the wall-clearance check now actively refuses floor placement too close to one, showing red instead of letting an object's footprint clip into it. A device test confirms this triggers correctly (see §5).

**B. Objects sometimes float generally (not corner-specific).**
Addressed by the floor-contact drift fix in §3 — placement, move, and scale all now correct against a freshly-measured bounding box instead of a cached one. Still needs a full device re-test across multiple models to confirm it's fully resolved (only the code fix has landed; results below are from testing done *before* this specific fix).

## 5. New findings from the latest device test

Three fresh observations, worth treating as three **separate** issues rather than one:

1. **Red reticle right at a corner** — this is the wall-clearance fix (§3) working as intended, not a new bug. Confirmed by the "Too close to a wall" hint text showing alongside it.
2. **A specific model ("Empty-Crate") triggers a bounding-box warning**: *"'s origin is outside its own bounding box — placement offsets (ground) may look wrong."* This is a real authoring problem in that specific `.glb` file (its pivot point sits outside its own geometry) — not something the placement code can fix; the asset itself needs to be re-exported with a correct origin.
3. **Green (confident) reticle on a surface that clearly isn't the floor** — observed on what appears to be the flat top of a plastic-wrapped bundle/package, not the ground. This is a genuine, still-open gap: none of the checks added so far (tilt angle, plane validity/area, stability, wall clearance) actually verify a surface *is the floor* specifically — they only verify it's flat, real, stable, and not near a wall. Any sufficiently flat, adequately-sized, stable surface at any height can pass every check, including an elevated tabletop or the top of a wrapped item.

## 6. Open question for further input

Given #5.3: is there a reasonable way — within WebXR's available APIs (hit-testing, plane detection, depth sensing) — to distinguish "the actual ground/floor plane" from "any flat elevated surface that happens to pass every other check"? Candidate directions not yet evaluated:
- Track the lowest confidently-detected plane per session and treat that (or planes near its height) as "the floor," rejecting flat surfaces detected well above it.
- Use the depth sensor (where available) to reason about relative height above the true ground rather than just distance-agreement with the hit-test.
- Accept this as an inherent limitation of markerless AR without a fixed reference point, and rely on user judgment (the reticle still shows confident/green correctly — it just doesn't know "floor" from "any flat thing").
