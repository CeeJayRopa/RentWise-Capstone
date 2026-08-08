import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { XREstimatedLight } from "three/examples/jsm/webxr/XREstimatedLight.js";

// The WebXR Device API (XRSession, XRFrame, XRHitTestSource, navigator.xr, ...) is not
// part of TypeScript's built-in DOM lib, so these are treated as `any` throughout.

export interface PlacedObjectInfo {
  id: string;
  objectId: string;
}

export interface PlacedState {
  placed: PlacedObjectInfo[];
  selectedId: string | null;
  canUndo: boolean;
}

export type ScaleAxis = "x" | "y" | "z";

// Distinguishes *why* no reticle is currently showing, since the underlying causes need
// completely different guidance: "tracking-lost" means the phone doesn't know where it is
// at all (hold steady); "no-results" means tracking is fine but nothing plane-shaped has
// been found yet (keep scanning); "bad-angle" means something WAS found but rejected for
// being too steep to count as a floor (try a flatter spot); "not-stable" means a valid
// floor was found but hasn't been tracked long enough yet to trust; "surface-too-small"
// means the floor found there is a real, classified plane but too small to place on;
// "near-wall" means the floor spot is real but too close to a detected wall for an object
// to sit there without its footprint clipping into the wall.
export type SurfaceIssue =
  | "tracking-lost"
  | "no-results"
  | "bad-angle"
  | "not-stable"
  | "surface-too-small"
  | "near-wall"
  | null;

export interface SelectedMeasurement {
  widthM: number;
  heightM: number;
  depthM: number;
  screenX: number;
  screenY: number;
  visible: boolean;
}

interface AxisScale {
  x: number;
  y: number;
  z: number;
}

interface PlacedObject extends PlacedObjectInfo {
  group: THREE.Group;
  scale: AxisScale;
  groundOffset: number;
  spawnStartTime: number;
  // Set once updateSpawnAnimations has written the exact final scale, so the object's
  // scale isn't touched every frame forever after it finishes popping in.
  spawnAnimDone: boolean;
  // Cumulative manual rotation (degrees) applied via rotateSelected, on top of whatever
  // base facing orientTowardCamera computes. Tracked separately because
  // moveSelectedToReticle recomputes that base facing from scratch on every move, which
  // would otherwise silently wipe out any rotation the user dialed in beforehand.
  userYawDeg: number;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

// How much of each frame's reticle movement to apply (0-1): lower = smoother but laggier,
// higher = snappier but jitterier. Damps out ARCore's frame-to-frame tracking noise. Note
// first acquisition always snaps instantly regardless of this value (see onFrame) — this
// only affects how quickly the reticle keeps up with movement after that.
const RETICLE_SMOOTHING = 0.5;

// Ignore hit-test movement smaller than this (meters) when updating the reticle's target —
// freezes residual sensor noise at the source instead of letting the smoothing filter chase
// tiny, meaningless fluctuations forever.
const RETICLE_POSITION_DEADZONE = 0.004;
const RETICLE_ROTATION_DEADZONE_DEG = 1.5;

// Confidence indicator: the WebXR spec doesn't expose whether a given hit came from a
// fully-classified plane or a rawer point-hit (see the "point" entityType comment in
// onFrame), so this approximates confidence from our own observed stability instead — a
// hit that hasn't moved beyond the deadzone for this many consecutive frames is treated as
// "locked in" (green); anything still settling is "searching" (amber). A hit that DOES
// cross-reference against a real, adequately-sized detected plane (see
// classifyPlaneValidity) short-circuits straight to "locked in" instead of waiting out the
// full frame count, and a hit that lands on a plane too small to trust is shown as
// "invalid" (red) regardless of how stable it's been.
const RETICLE_STABLE_FRAMES_THRESHOLD = 10;
// Fallback for a hit that never gets corroborated by a real detected plane or the
// hardware depth sensor (see the `corroborated` check in onFrame) — e.g. a genuinely
// featureless surface, or a device/moment with no plane data at all. Requiring a much
// longer hold than RETICLE_STABLE_FRAMES_THRESHOLD before trusting an uncorroborated hit
// closes the gap where a wrong-but-stationary point (the deadzone freezes it) could
// otherwise reach "confident" in well under a second just by sitting still — it also gives
// ARCore far more time to actually classify a real plane there first, which would let the
// hit qualify the normal (fast) way instead.
const UNCORROBORATED_FALLBACK_FRAMES = 45;
const RETICLE_COLOR_SEARCHING = 0xffaa00;
const RETICLE_COLOR_CONFIDENT = 0x4caf50;
const RETICLE_COLOR_INVALID = 0xf44336;

// Minimum real-world area (square meters) a detected plane must have for a hit landing
// inside it to be trusted. Deliberately low: ARCore/ARKit often emit small, transient plane
// fragments (well under 0.1m²) before they grow or merge into the true surface, so this
// sits just above that noise floor rather than the footprint of any real placement — a
// small but genuinely usable floor gap in a cluttered market stall should still clear it
// once ARCore has locked onto it at all. A hit that matches NO plane (device without
// plane-detection support, or a point-hit ARCore hasn't classified yet) is never penalized
// by this threshold — see classifyPlaneValidity's "unknown" case. Starting value; expect to
// tune after on-device testing in a real cluttered space.
const MIN_PLANE_AREA_M2 = 0.15;

// Minimum horizontal clearance (meters) a floor placement point must keep from any
// detected vertical (wall-like) plane, so an object's own footprint doesn't visually clip
// into a wall or corner even though it's anchored on the floor right next to it — this is
// the fix for the original "object floats/clips at a wall corner" complaint, now that wall
// placement itself is gone: walls are still detected (see isTooCloseToWall), just to keep
// floor placement clear of them, not to place on them. Uses the Plane Detection API's own
// `orientation` field to find wall-like planes and treats each as an infinite vertical
// barrier rather than bounding the check to its exact polygon extent — a deliberate
// simplification, since market-stall walls/railings are typically continuous runs rather
// than isolated fragments, so being slightly over-cautious past a wall segment's real end
// is an acceptable trade for a simpler, more robust check. Starting value; expect to tune
// after on-device testing.
const WALL_CLEARANCE_M = 0.15;

// Vertical clearance kept between an object's measured lowest point and the floor after a
// floor-contact snap (see snapToFloor), matching the ground-shadow mesh's own epsilon —
// purely to avoid z-fighting with the floor itself, not a meaningful visual gap.
const FLOOR_CONTACT_EPSILON = 0.001;

// Dev-only: set to a specific AR catalog object id, or true for every model, to log
// floor-contact diagnostics (dimensions, original vs. current bounding box, applied
// correction) each time that model is placed/moved/scaled — see snapToFloor, the only
// place this is read. Never fires per-frame. Leave false in normal use.
const DEV_LOG_FLOOR_CONTACT: string | boolean = false;

// Lightweight surface memory: position already snaps instantly on any reacquisition (see
// the `!reticleHasTarget` branch below), so the real gap after recovering from a brief
// tracking-loss is confidence, not position — it still ramps back up from amber even when
// it's clearly the same spot as before. If a hit recovered right after tracking loss lands
// within this radius (meters) of where we were last confident, it's treated as still
// trustworthy immediately instead of re-ramping from zero.
const RECOVERY_SNAP_RADIUS = 0.3;

// Camera-angle guidance: the camera's forward direction's Y-component is negative when
// looking down, ~0 when level, positive when looking up. A phone genuinely being swept
// across the floor is usually well past this threshold; a phone held level/up (a common
// beginner mistake — pointing straight ahead instead of down at the ground) isn't, and
// won't find a floor no matter how long it searches.
const CAMERA_DOWNWARD_THRESHOLD = -0.15;

// Floor acceptance, by angle between the hit-test surface normal and world-up: near 0° is
// a flat floor/tabletop/desk. Anything past this is rejected outright — wall placement was
// removed (the real deployment is a market with railings, not solid walls, which AR can't
// reliably classify as flat surfaces anyway), so there's no separate "wall window" to carve
// out here anymore.
const MAX_FLOOR_TILT_DEG = 25;

// Placement pop-in animation duration, in ms.
const SPAWN_ANIM_DURATION_MS = 220;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// "valid": the hit lands inside a detected plane's polygon whose area clears
// MIN_PLANE_AREA_M2. "invalid": it lands inside a detected plane's polygon that's too
// small to trust. "unknown": no detected plane covers this hit at all (no plane-detection
// support, or ARCore hasn't classified a plane there yet) — deliberately NOT treated the
// same as "invalid", since absence of plane data isn't evidence of a bad surface.
type PlaneValidity = "valid" | "invalid" | "unknown";

// Standard ray-casting (PNPOLY) point-in-polygon test, operating in a plane's local XZ
// space — same convention updatePlaneVisualizations already uses for polygon[i].x/z.
function pointInPolygonXZ(px: number, pz: number, polygon: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const crosses = zi > pz !== zj > pz;
    if (crosses && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Shoelace formula, same local XZ polygon, winding-order independent via Math.abs.
function polygonAreaXZ(polygon: { x: number; z: number }[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[i].z - polygon[j].z);
  }
  return Math.abs(sum) / 2;
}

function cloneWithOwnMaterials(source: THREE.Object3D): THREE.Group {
  const clone = source.clone(true) as THREE.Group;
  clone.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if ((mesh as any).isMesh && mesh.material) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
    }
  });
  return clone;
}

export class ARSessionScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20);
  private scene = new THREE.Scene();
  private reticle: THREE.Mesh;
  private placedGroup = new THREE.Group();

  private session: any = null;
  private hitTestSource: any = null;
  private hitTestSourceRequested = false;
  private raycaster = new THREE.Raycaster();
  private tempMatrix = new THREE.Matrix4();

  // Smoothed reticle transform (see RETICLE_SMOOTHING) and scratch space for the
  // per-result horizontal-surface check, reused every frame to avoid GC churn.
  private reticlePosition = new THREE.Vector3();
  private reticleQuaternion = new THREE.Quaternion();
  private reticleTargetPosition = new THREE.Vector3();
  private reticleTargetQuaternion = new THREE.Quaternion();
  private reticleHasTarget = false;
  private reticleStableFrames = 0;
  private lastKnownGoodPosition = new THREE.Vector3();
  private hasLastKnownGood = false;
  private wasTrackingLost = false;
  private candidatePosition = new THREE.Vector3();
  private candidateQuaternion = new THREE.Quaternion();
  private hitCheckMatrix = new THREE.Matrix4();
  private hitCheckNormal = new THREE.Vector3();
  private hitCheckPosition = new THREE.Vector3();
  private static readonly WORLD_UP = new THREE.Vector3(0, 1, 0);
  private static readonly UNIT_SCALE = new THREE.Vector3(1, 1, 1);

  private modelCache = new Map<
    string,
    { template: THREE.Group; groundOffset: number; boundingBox: THREE.Box3 }
  >();
  private armedObjectId: string | null = null;
  private armedModel: THREE.Group | null = null;
  private armedGroundOffset = 0;
  private scratchCamDir = new THREE.Vector3();
  private scratchLookMatrix = new THREE.Matrix4();
  // Scratch space for classifyPlaneValidity's per-plane local-space hit transform, reused
  // to avoid GC churn (same convention as the reticle scratch fields above).
  private scratchPlaneInverse = new THREE.Matrix4();
  private scratchLocalHit = new THREE.Vector3();
  // Whether the currently-tracked reticle position is confident+valid enough to place on —
  // read by onSelect's placement gate. Written every frame in onFrame (see there for the
  // combined stability + plane-validity logic).
  private isPlacementConfident = false;
  // Set true for the current frame only when tryDepthConfidenceBoost's hardware corroboration
  // actually fired — distinct from reticleStableFrames itself, since that counter also rises
  // from plain frame-to-frame stillness alone, which onFrame's confidence gate now treats as
  // weaker evidence than a real depth-sensor or plane match.
  private depthCorroborated = false;

  // Wireframe box that reparents onto whichever placed object is currently selected, so it
  // inherits that object's position/rotation/scale automatically instead of needing to be
  // repositioned every frame.
  private selectionOutline: THREE.LineSegments;

  // Shared radial-gradient "blob" texture used for every placed object's contact shadow —
  // a cheap approximation (no real shadow-mapping/lighting cost) that still makes objects
  // read as resting on the floor instead of floating.
  private groundShadowTexture: THREE.Texture;

  // Fixed fallback lighting, used until (and unless) real WebXR light estimation kicks in —
  // see mount()'s xrLight wiring, which swaps to/from these on estimationstart/estimationend.
  private fallbackHemisphereLight: THREE.HemisphereLight;
  private fallbackDirectionalLight: THREE.DirectionalLight;
  private xrLight: XREstimatedLight | null = null;

  // Detected-surface extent visualization (separate WebXR feature from hit-testing — see
  // "plane-detection" in startSession's optionalFeatures). Degrades safely to "nothing
  // shown" on browsers that don't support it, since frame.detectedPlanes is just undefined
  // there. Keyed by the browser's own XRPlane objects so each gets one persistent mesh
  // instead of being recreated every frame.
  private detectedPlaneMeshes = new Map<any, THREE.Mesh>();
  private planeVisualizationMaterial = new THREE.MeshBasicMaterial({
    color: 0x4caf50,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private placed: PlacedObject[] = [];
  private selected: PlacedObject | null = null;
  private nextInstanceId = 1;

  // Undo history — deliberately scoped to just place/delete (the two truly destructive,
  // easy-to-regret actions), not rotate/resize/move, which are already trivially reversible
  // by pressing the opposite control.
  private history: Array<
    | { type: "place"; object: PlacedObject }
    | { type: "delete"; object: PlacedObject; index: number }
  > = [];

  // Resolved from inside onFrame, right after that frame's render() call — see mount()'s
  // preserveDrawingBuffer comment for why it can't just be read synchronously from outside
  // the render loop.
  private pendingCapture: ((dataUrl: string | null) => void) | null = null;

  private onPlacedChange: (state: PlacedState) => void = () => {};
  private onReticleVisible: (visible: boolean) => void = () => {};
  private onMeasurementChange: (measurement: SelectedMeasurement | null) => void = () => {};
  private onSurfaceIssue: (issue: SurfaceIssue) => void = () => {};
  private lastSurfaceIssue: SurfaceIssue = null;
  private onLightLevelChange: (isDim: boolean) => void = () => {};
  private lastReportedDim: boolean | null = null;
  private onCameraAngleChange: (isPointingWrong: boolean) => void = () => {};
  private lastReportedPointingWrong: boolean | null = null;
  // Relays validateBoundingBox's console warnings on-screen too — chrome://inspect needs a
  // tethered desktop, which isn't always available while testing on an actual device.
  private onModelWarning: (objectId: string, message: string) => void = () => {};
  private scratchCameraForward = new THREE.Vector3();
  private resizeHandler = () => this.handleResize();

  // Scratch space for the per-frame selected-object measurement/label projection, reused to
  // avoid GC churn (same convention as the reticle scratch fields above).
  private scratchMeasureSize = new THREE.Vector3();
  private scratchMeasurePos = new THREE.Vector3();

  constructor() {
    const geometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: RETICLE_COLOR_SEARCHING });
    this.reticle = new THREE.Mesh(geometry, material);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.scene.add(this.placedGroup);

    this.fallbackHemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.scene.add(this.fallbackHemisphereLight);
    this.fallbackDirectionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.fallbackDirectionalLight.position.set(0.5, 1, 0.25);
    this.scene.add(this.fallbackDirectionalLight);

    this.groundShadowTexture = this.createGroundShadowTexture();

    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selectionOutline = new THREE.LineSegments(
      outlineGeometry,
      // depthTest: false + a high renderOrder guarantee this always draws on top of the
      // model's own mesh, instead of potentially being hidden/z-fighting behind surfaces
      // that sit exactly on (or inside) the bounding box the outline is sized to.
      new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false, toneMapped: false })
    );
    this.selectionOutline.renderOrder = 999;
    this.selectionOutline.visible = false;
  }

  setCallbacks(onPlacedChange: (state: PlacedState) => void, onReticleVisible: (visible: boolean) => void) {
    this.onPlacedChange = onPlacedChange;
    this.onReticleVisible = onReticleVisible;
  }

  setMeasurementCallback(onMeasurementChange: (measurement: SelectedMeasurement | null) => void) {
    this.onMeasurementChange = onMeasurementChange;
  }

  setSurfaceIssueCallback(onSurfaceIssue: (issue: SurfaceIssue) => void) {
    this.onSurfaceIssue = onSurfaceIssue;
  }

  setLightLevelCallback(onLightLevelChange: (isDim: boolean) => void) {
    this.onLightLevelChange = onLightLevelChange;
  }

  setCameraAngleCallback(onCameraAngleChange: (isPointingWrong: boolean) => void) {
    this.onCameraAngleChange = onCameraAngleChange;
  }

  setModelWarningCallback(onModelWarning: (objectId: string, message: string) => void) {
    this.onModelWarning = onModelWarning;
  }

  // Only fires the callback when the cause actually changes, so the UI layer's own
  // time-based escalation (e.g. "still searching after 5s") isn't reset every single frame.
  private reportSurfaceIssue(issue: SurfaceIssue) {
    if (issue === this.lastSurfaceIssue) return;
    this.lastSurfaceIssue = issue;
    this.onSurfaceIssue(issue);
  }

  mount(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    // Capped at 2x -- above that, sharpness gains are imperceptible on a phone screen
    // while GPU cost keeps climbing (roughly with the square of the ratio), competing
    // with the same per-frame budget WebXR needs for hit-testing/plane detection.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    (renderer.xr as any).enabled = true;
    (renderer.xr as any).setReferenceSpaceType("local");
    renderer.setAnimationLoop((time: number, frame: any) => this.onFrame(frame));

    this.renderer = renderer;
    window.addEventListener("resize", this.resizeHandler);

    // Self-manages via renderer.xr's own sessionstart/sessionend events (requests a light
    // probe automatically whenever "light-estimation" was granted — see startSession's
    // optionalFeatures below). Swaps the scene from the fixed fallback lights to the room's
    // actual estimated lighting once real values start arriving, and back on session end.
    const xrLight = new XREstimatedLight(renderer);
    xrLight.addEventListener("estimationstart", () => {
      this.scene.add(xrLight);
      this.scene.remove(this.fallbackHemisphereLight);
      this.scene.remove(this.fallbackDirectionalLight);
      if (xrLight.environment) this.scene.environment = xrLight.environment;
    });
    xrLight.addEventListener("estimationend", () => {
      this.scene.remove(xrLight);
      this.scene.add(this.fallbackHemisphereLight);
      this.scene.add(this.fallbackDirectionalLight);
      this.scene.environment = null;
    });
    this.xrLight = xrLight;
  }

  private handleResize() {
    if (!this.renderer) return;
    const canvas = this.renderer.domElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }

  async startSession(overlayRoot: HTMLElement): Promise<void> {
    const nav = navigator as any;
    if (!this.renderer || !nav.xr) throw new Error("AR is not available in this browser.");

    const session = await nav.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "light-estimation", "plane-detection", "depth-sensing"],
      depthSensing: {
        usagePreference: ["cpu-optimized"],
        dataFormatPreference: ["luminance-alpha"],
      },
      domOverlay: { root: overlayRoot },
    });

    this.session = session;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    session.addEventListener("end", () => this.onSessionEnd());

    const controller = this.renderer.xr.getController(0);
    controller.addEventListener("select", () => this.onSelect(controller));
    this.scene.add(controller);

    await this.renderer.xr.setSession(session);
  }

  async endSession() {
    if (this.session) {
      await this.session.end();
    }
  }

  // Captures exactly what's currently on screen (real camera passthrough + placed 3D
  // objects, already composited by the XR layer) as a JPEG data URL. Resolves null if
  // nothing renders within one second (e.g. session already ended).
  capturePhoto(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingCapture = null;
        resolve(null);
      }, 1000);
      this.pendingCapture = (dataUrl) => {
        clearTimeout(timeout);
        resolve(dataUrl);
      };
    });
  }

  // canvas.toDataURL() does NOT work during an active WebXR session: once the session
  // starts, rendering targets the XR compositor's own framebuffer
  // (session.renderState.baseLayer.framebuffer), not the canvas element's default
  // backbuffer — so the canvas itself stays blank from the page's own perspective even
  // though the real composited frame (camera passthrough + placed objects) is visibly on
  // screen. The fix is reading pixels directly from whichever framebuffer is actually bound
  // at render time, via gl.readPixels(), then hand-building an ordinary 2D image from that
  // raw pixel data (which toDataURL() *does* work on, since it's a normal, non-XR canvas).
  private readXRFramePixels(): string | null {
    if (!this.renderer || !this.session) return null;
    try {
      const gl = this.renderer.getContext() as WebGLRenderingContext;
      const layer = this.session.renderState.baseLayer;
      const width: number = layer.framebufferWidth;
      const height: number = layer.framebufferHeight;

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // readPixels' origin is bottom-left (OpenGL convention); canvas/image formats expect
      // top-left, so each row is flipped into a fresh, correctly-oriented buffer.
      const flipped = new Uint8ClampedArray(width * height * 4);
      const rowBytes = width * 4;
      for (let y = 0; y < height; y++) {
        const srcStart = y * rowBytes;
        const dstStart = (height - y - 1) * rowBytes;
        flipped.set(pixels.subarray(srcStart, srcStart + rowBytes), dstStart);
      }

      const outCanvas = document.createElement("canvas");
      outCanvas.width = width;
      outCanvas.height = height;
      const ctx = outCanvas.getContext("2d")!;
      ctx.putImageData(new ImageData(flipped, width, height), 0, 0);
      return outCanvas.toDataURL("image/jpeg", 0.92);
    } catch (err) {
      console.error("[AR] photo capture failed:", err);
      return null;
    }
  }

  private onSessionEnd() {
    this.session = null;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.reticleHasTarget = false;
    this.reticleStableFrames = 0;
    this.hasLastKnownGood = false;
    this.wasTrackingLost = false;
    this.isPlacementConfident = false;
    this.depthCorroborated = false;
    this.reticle.visible = false;

    this.placedGroup.clear();
    this.placed = [];
    this.selected = null;
    this.updateSelectionOutline();
    this.history = [];
    this.onPlacedChange({ placed: [], selectedId: null, canUndo: false });
    this.onReticleVisible(false);
    this.onMeasurementChange(null);
    this.reportSurfaceIssue(null);
    this.lastReportedDim = null;
    this.onLightLevelChange(false);
    this.lastReportedPointingWrong = null;
    this.onCameraAngleChange(false);

    for (const mesh of this.detectedPlaneMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.detectedPlaneMeshes.clear();
  }

  // Active for the full duration of any DOM overlay button press (touch-down through
  // shortly after release) so a tap that leaks through to the XR session as a "select"
  // doesn't also place or pick an object — some browsers don't fully suppress the XR
  // select event for taps landing on DOM overlay buttons. Starting the suppression on
  // touch-*down* (not inside the button's onPress, which fires at release) matters: the
  // XR select event fires around release time too, and there's no guarantee React's
  // onPress handler runs before it, so setting the flag only in onPress can be too late.
  private uiInteractionActive = false;
  private uiInteractionClearTimer: any = null;

  beginUIInteraction() {
    this.uiInteractionActive = true;
    if (this.uiInteractionClearTimer) clearTimeout(this.uiInteractionClearTimer);
  }

  endUIInteraction() {
    if (this.uiInteractionClearTimer) clearTimeout(this.uiInteractionClearTimer);
    // Small grace period in case the XR select event fires a tick after pointer-up.
    this.uiInteractionClearTimer = setTimeout(() => {
      this.uiInteractionActive = false;
    }, 300);
  }

  private onSelect(controller: THREE.Object3D) {
    if (this.uiInteractionActive) return;

    // If something is armed, a tap always tries to place it at the reticle — even when the
    // tap also geometrically lines up with an already-placed object. This matters because
    // placing a second item ON or right next to the first (the whole point of arranging
    // multiple objects together) means the reticle and an existing object's mesh are often
    // in the same direction, and placement should win that ambiguity, not object-selection.
    // Still returns (doesn't fall through to tap-to-select below) even when not yet
    // confident — the per-frame "not-stable"/"surface-too-small" surface-issue hint already
    // tells the user why nothing happened, and an impatient tap shouldn't accidentally
    // select an unrelated placed object instead.
    if (this.reticle.visible && this.armedModel) {
      if (this.isPlacementConfident) this.placeArmedAtReticle();
      return;
    }

    // Nothing armed: fall back to tap-to-select an already-placed object.
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    const hit = this.raycaster.intersectObjects(this.placedGroup.children, true)[0];
    if (hit) {
      const placedObject = this.placed.find((p) => p.group === hit.object || p.group.getObjectById(hit.object.id));
      if (placedObject) {
        this.selectPlaced(placedObject);
      }
    }
  }

  private selectPlaced(placedObject: PlacedObject) {
    this.selected = placedObject;
    this.updateSelectionOutline();
    this.notifyPlacedChange();
  }

  private notifyPlacedChange() {
    this.onPlacedChange({
      placed: this.placed.map(({ id, objectId }) => ({ id, objectId })),
      selectedId: this.selected?.id ?? null,
      canUndo: this.history.length > 0,
    });
  }

  // Reparents the shared outline box onto whichever object is currently selected, sized to
  // that model's own local bounding box, so it visually tracks the object's position,
  // rotation, and scale automatically (as a child, it inherits all of those for free).
  private updateSelectionOutline() {
    if (!this.selected) {
      if (this.selectionOutline.parent) this.selectionOutline.parent.remove(this.selectionOutline);
      this.selectionOutline.visible = false;
      return;
    }

    const cached = this.modelCache.get(this.selected.objectId);
    if (!cached) {
      this.selectionOutline.visible = false;
      return;
    }

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    cached.boundingBox.getSize(size);
    cached.boundingBox.getCenter(center);

    // Slightly larger than the exact bounding box so it reads as a highlight around the
    // object rather than sitting flush on its surface.
    const OUTLINE_MARGIN = 1.08;
    this.selectionOutline.scale.copy(size).multiplyScalar(OUTLINE_MARGIN);
    this.selectionOutline.position.copy(center);
    if (this.selectionOutline.parent !== this.selected.group) {
      this.selected.group.add(this.selectionOutline);
    }
    this.selectionOutline.visible = true;
  }

  // Draws a soft radial-gradient "blob" once, shared by every placed object's contact
  // shadow — cheaper than real shadow-mapping and doesn't need any scene lights configured
  // to cast/receive shadows.
  private createGroundShadowTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.35)");
    gradient.addColorStop(0.7, "rgba(0,0,0,0.16)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  // Sized to the model's own local footprint so bigger objects get bigger shadows.
  // `localFloorY` is the shadow's own vertical position, expressed in the SAME local
  // (pre-parent-transform) space the model's geometry lives in — this comes from whichever
  // caller placed/moved the object (see placeArmedAtReticle), not from `cached.boundingBox`
  // directly, since once the model's own floor contact is corrected by snapToFloor rather
  // than trusted from the cached box, using the stale cached value here too would let the
  // shadow drift out of sync with where the model actually ends up resting.
  private createGroundShadowMesh(cached: { boundingBox: THREE.Box3 }, localFloorY: number): THREE.Mesh {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    cached.boundingBox.getSize(size);
    cached.boundingBox.getCenter(center);

    const footprint = Math.max(size.x, size.z) * 1.4;
    const geometry = new THREE.PlaneGeometry(footprint, footprint).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: this.groundShadowTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(center.x, localFloorY + FLOOR_CONTACT_EPSILON, center.z);
    mesh.renderOrder = -1;
    return mesh;
  }

  // Computes the object's CURRENT, fully-transformed world-space bounding box — unlike
  // `cached.boundingBox` from armObject (the model's original, untransformed geometry),
  // this reflects reality after whatever position/rotation/scale is applied right now.
  // Forces an explicit matrix-world update first: a position/rotation/scale change isn't
  // reflected in matrixWorld until the next render pass otherwise, and this is always
  // called before that pass happens (see snapToFloor, the only real consumer).
  private computeWorldBoundingBox(group: THREE.Group): THREE.Box3 {
    group.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(group);
  }

  // The authoritative floor-contact fix: measures the object's CURRENT world-space
  // bounding box and vertically corrects its position so the box's true lowest point sits
  // exactly at targetFloorY (plus a tiny epsilon), instead of trusting the model's cached,
  // pre-transform groundOffset math to still be accurate after rotation/scaling. On paper
  // that math is exact for this file's floor-only, yaw-only rotation (a pure Y-axis
  // rotation never changes a point's Y-coordinate, so box.min.y shouldn't move) — but
  // measuring reality after the fact is robust to whatever's actually causing drift in
  // practice (GLTF export quirks, a bounding box computed before the loader's matrices
  // were fully settled, accumulated float error across repeated scale/move operations,
  // etc.) without needing to chase each cause individually. Called only at discrete events
  // (place/move/scale) — never per-frame, see onFrame, which doesn't call this at all.
  private snapToFloor(group: THREE.Group, targetFloorY: number, objectId?: string): void {
    const box = this.computeWorldBoundingBox(group);
    if (!Number.isFinite(box.min.y)) return;

    const delta = targetFloorY + FLOOR_CONTACT_EPSILON - box.min.y;
    group.position.y += delta;

    if (objectId && (DEV_LOG_FLOOR_CONTACT === true || DEV_LOG_FLOOR_CONTACT === objectId)) {
      const cached = this.modelCache.get(objectId);
      const size = new THREE.Vector3();
      box.getSize(size);
      console.log(`[AR floor-contact] "${objectId}"`, {
        originalLocalMinY: cached ? -cached.groundOffset : undefined,
        originalLocalMaxY: cached?.boundingBox.max.y,
        currentWorldMinY: box.min.y,
        currentWorldMaxY: box.max.y,
        dimensions: { x: size.x, y: size.y, z: size.z },
        targetFloorY,
        appliedCorrection: delta,
      });
    }
  }

  private placeArmedAtReticle() {
    if (!this.armedModel || !this.armedObjectId) return;

    const group = cloneWithOwnMaterials(this.armedModel);
    group.matrixAutoUpdate = true;
    const floorY = this.reticlePosition.y;
    group.position.setFromMatrixPosition(this.reticle.matrix);
    this.orientTowardCamera(group);

    // Calibrate floor contact at the object's real target scale (always uniform 1 for a
    // fresh placement) BEFORE shrinking for the spawn-in animation below — snapping at the
    // tiny spawn-start scale instead would leave the object resting slightly off the floor
    // once it finishes growing to full size, since the correction wouldn't be measured at
    // the scale it actually settles at.
    group.scale.set(1, 1, 1);
    this.snapToFloor(group, floorY, this.armedObjectId);

    const cached = this.modelCache.get(this.armedObjectId);
    if (cached) {
      const localFloorY = floorY - group.position.y;
      group.add(this.createGroundShadowMesh(cached, localFloorY));
    }

    group.scale.setScalar(0.001); // spawn-animated up to full size in onFrame

    const placedObject: PlacedObject = {
      id: `placed-${this.nextInstanceId++}`,
      objectId: this.armedObjectId,
      group,
      scale: { x: 1, y: 1, z: 1 },
      groundOffset: this.armedGroundOffset,
      spawnStartTime: performance.now(),
      spawnAnimDone: false,
      userYawDeg: 0,
    };

    this.placedGroup.add(group);
    this.placed.push(placedObject);
    this.selected = placedObject;
    this.updateSelectionOutline();
    this.history.push({ type: "place", object: placedObject });

    // Consume the armed item: without this, it stays armed forever, meaning every future
    // tap keeps placing new copies instead of ever falling through to tap-to-select an
    // existing object. Placing the next item requires an explicit re-tap on a catalog
    // thumbnail, which is what re-arms it (see armObject).
    this.armedObjectId = null;
    this.armedModel = null;

    this.notifyPlacedChange();
  }

  async armObject(objectId: string, modelUrl: string): Promise<void> {
    let cached = this.modelCache.get(objectId);
    if (!cached) {
      const template = await this.loadModel(modelUrl);
      const box = new THREE.Box3().setFromObject(template);
      this.validateBoundingBox(box, objectId);
      // Ground offset: shifts the model up/down so its lowest point sits exactly at the
      // reticle instead of floating above or sinking into a floor/tabletop. Measured once
      // per model here, not assumed, since it depends on where each .glb's own origin
      // happens to be.
      const groundOffset = Number.isFinite(box.min.y) ? -box.min.y : 0;
      cached = { template, groundOffset, boundingBox: box };
      this.modelCache.set(objectId, cached);
    }
    this.armedObjectId = objectId;
    this.armedModel = cached.template;
    this.armedGroundOffset = cached.groundOffset;
  }

  // .glb catalog assets are authored entirely outside this app (manual Firebase upload, no
  // in-app validation pipeline) — this is a cheap sanity check on load, flagging models
  // whose exported geometry/origin/scale looks suspicious, so a bad export shows up as a
  // console warning during testing instead of a silently mysterious "floating/sunk object"
  // bug report later. Runs once per model load (guarded by the `!cached` check above), not
  // once per placement.
  private validateBoundingBox(box: THREE.Box3, objectId: string): void {
    const warn = (message: string) => {
      console.warn(`[AR] "${objectId}" ${message}`);
      this.onModelWarning(objectId, message);
    };

    const size = new THREE.Vector3();
    box.getSize(size);

    const finite =
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.min.y) &&
      Number.isFinite(box.min.z) &&
      Number.isFinite(box.max.x) &&
      Number.isFinite(box.max.y) &&
      Number.isFinite(box.max.z);
    if (!finite) {
      warn("has a non-finite bounding box — model geometry may be malformed.");
      return; // further checks below assume finite values
    }

    if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
      warn("has a zero-size bounding box on at least one axis — model may be empty or degenerate.");
    }

    if (!box.containsPoint(new THREE.Vector3(0, 0, 0))) {
      warn("'s origin is outside its own bounding box — placement offsets (ground) may look wrong.");
    }

    const maxDim = Math.max(size.x, size.y, size.z);
    const minDim = Math.min(size.x, size.y, size.z);
    if (minDim > 0 && maxDim / minDim > 20) {
      warn(`has an extreme aspect ratio (${(maxDim / minDim).toFixed(1)}:1) — check for stray/misplaced geometry.`);
    }

    if (maxDim > 10 || (minDim > 0 && minDim < 0.01)) {
      warn(
        `has implausible real-world scale (size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m) — check the .glb's export scale/units.`
      );
    }
  }

  private loadModel(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        (error) => reject(error)
      );
    });
  }

  // Builds a pure-yaw orientation (object stays upright, no pitch/roll) with the object's
  // forward (-Z) facing `direction`, flattened to the horizontal plane.
  private applyYawOrientation(group: THREE.Group, direction: THREE.Vector3) {
    this.scratchCamDir.copy(direction);
    this.scratchCamDir.y = 0;
    if (this.scratchCamDir.lengthSq() < 1e-6) this.scratchCamDir.set(0, 0, -1);
    this.scratchCamDir.normalize();

    this.scratchLookMatrix.lookAt(new THREE.Vector3(), this.scratchCamDir, ARSessionScene.WORLD_UP);
    group.quaternion.setFromRotationMatrix(this.scratchLookMatrix);
  }

  // Orients `group` to face the same horizontal direction the camera was looking when
  // placed (instead of inheriting the hit-test pose's raw, essentially arbitrary yaw),
  // so every placed object comes in consistently upright and non-twisted.
  private orientTowardCamera(group: THREE.Group) {
    this.camera.getWorldDirection(this.scratchCamDir);
    this.applyYawOrientation(group, this.scratchCamDir);
  }

  rotateSelected(deltaDeg: number) {
    if (!this.selected) return;
    this.selected.group.rotateY(THREE.MathUtils.degToRad(deltaDeg));
    this.selected.userYawDeg += deltaDeg;
  }

  // Scales a single axis independently — "width" (x), "height" (y), or "depth" (z) — so an
  // item can be stretched/squashed to fit a spot rather than only resized uniformly.
  scaleSelectedAxis(axis: ScaleAxis, factor: number) {
    if (!this.selected) return;
    this.setAxisScale(axis, this.selected.scale[axis] * factor);
  }

  // Applies the base per-axis scale/anchor logic; scaleSelectedAxis is the public entry
  // point, kept separate so other callers could set an absolute value if ever needed.
  private setAxisScale(axis: ScaleAxis, targetValue: number) {
    if (!this.selected) return;

    // Read where the object is CURRENTLY resting before touching its scale at all — this
    // is "the floor" for the purposes of this operation, not a value re-derived from the
    // live reticle (which might not even be visible, or pointed elsewhere, while the user
    // is scaling an already-placed object).
    const preScaleBox = this.computeWorldBoundingBox(this.selected.group);
    const floorY = Number.isFinite(preScaleBox.min.y) ? preScaleBox.min.y : null;

    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetValue));
    this.selected.scale[axis] = next;
    this.selected.group.scale.set(this.selected.scale.x, this.selected.scale.y, this.selected.scale.z);

    // Re-snap to that same floor Y regardless of which axis changed (cheap — one measured
    // bounding box per button press, not per frame) instead of only correcting for Y-axis
    // scale via the object's cached, pre-transform groundOffset — see snapToFloor's own
    // comment for why measuring reality after the fact is the robust choice here.
    if (floorY !== null) this.snapToFloor(this.selected.group, floorY, this.selected.objectId);
  }

  moveSelectedToReticle() {
    if (!this.selected || !this.reticle.visible) return;
    const floorY = this.reticlePosition.y;
    this.selected.group.position.setFromMatrixPosition(this.reticle.matrix);

    this.orientTowardCamera(this.selected.group);

    // orientTowardCamera above just reset the group's facing to a fresh base orientation
    // for the new spot — reapply whatever manual rotation the user had already dialed in so
    // the object keeps facing the way they left it, instead of snapping back to that
    // default facing on every move.
    if (this.selected.userYawDeg !== 0) {
      this.selected.group.rotateY(THREE.MathUtils.degToRad(this.selected.userYawDeg));
    }

    this.snapToFloor(this.selected.group, floorY, this.selected.objectId);
  }

  deleteSelected() {
    if (!this.selected) return;
    const toRemove = this.selected;
    const index = this.placed.findIndex((p) => p.id === toRemove.id);
    this.selected = null;
    this.updateSelectionOutline(); // detaches the outline from toRemove.group before it's removed
    this.placedGroup.remove(toRemove.group);
    this.placed = this.placed.filter((p) => p.id !== toRemove.id);
    this.history.push({ type: "delete", object: toRemove, index });
    this.notifyPlacedChange();
  }

  // Reverses the most recent place or delete action. Deliberately not a general redo/undo
  // stack beyond that — see the `history` field's own comment for why rotate/resize/move
  // aren't included.
  undo() {
    const last = this.history.pop();
    if (!last) return;

    if (last.type === "place") {
      this.placedGroup.remove(last.object.group);
      this.placed = this.placed.filter((p) => p.id !== last.object.id);
      if (this.selected?.id === last.object.id) {
        this.selected = null;
        this.updateSelectionOutline();
      }
    } else {
      this.placedGroup.add(last.object.group);
      this.placed.splice(Math.min(last.index, this.placed.length), 0, last.object);
      this.selected = last.object;
      this.updateSelectionOutline();
    }

    this.notifyPlacedChange();
  }

  // Eases each recently-placed object's scale from ~0 up to its real size, giving a quick
  // pop-in instead of the object just instantly appearing at full size.
  private updateSpawnAnimations() {
    const now = performance.now();
    for (const p of this.placed) {
      if (p.spawnAnimDone) continue; // already finalized -- skip entirely (hot-path perf)

      const elapsed = now - p.spawnStartTime;
      if (elapsed >= SPAWN_ANIM_DURATION_MS) {
        // Snap to the exact target once, however late this frame landed -- covers the
        // case where a hitch (GC pause, GPU upload) skipped the frame that would have
        // hit t===1 exactly, which used to leave the object frozen mid-animation forever.
        p.group.scale.set(p.scale.x, p.scale.y, p.scale.z);
        p.spawnAnimDone = true;
        continue;
      }

      const t = easeOutCubic(elapsed / SPAWN_ANIM_DURATION_MS);
      p.group.scale.set(
        Math.max(0.001, p.scale.x * t),
        Math.max(0.001, p.scale.y * t),
        Math.max(0.001, p.scale.z * t)
      );
    }
  }

  // Projects the currently-selected object's true physical size (its cached local bounding
  // box × its current per-axis scale — deliberately NOT a world-space AABB, since rotating
  // an object around Y doesn't change its actual physical dimensions, only its facing) into
  // a screen-space label position above it. Runs every frame the camera/object might have
  // moved, not just on selection change.
  private updateMeasurementLabel() {
    if (!this.selected || !this.renderer) {
      this.onMeasurementChange(null);
      return;
    }
    const cached = this.modelCache.get(this.selected.objectId);
    if (!cached) {
      this.onMeasurementChange(null);
      return;
    }

    cached.boundingBox.getSize(this.scratchMeasureSize);
    const widthM = this.scratchMeasureSize.x * this.selected.scale.x;
    const heightM = this.scratchMeasureSize.y * this.selected.scale.y;
    const depthM = this.scratchMeasureSize.z * this.selected.scale.z;

    // Label floats above the object's actual top point in world space.
    this.selected.group.getWorldPosition(this.scratchMeasurePos);
    this.scratchMeasurePos.y += heightM;
    this.scratchMeasurePos.project(this.camera);

    const canvas = this.renderer.domElement;
    const screenX = (this.scratchMeasurePos.x * 0.5 + 0.5) * canvas.clientWidth;
    const screenY = (-this.scratchMeasurePos.y * 0.5 + 0.5) * canvas.clientHeight;
    // z > 1 in NDC means the point is behind the camera — hide the label rather than let it
    // jump to a nonsensical on-screen position.
    const visible = this.scratchMeasurePos.z < 1;

    this.onMeasurementChange({ widthM, heightM, depthM, screenX, screenY, visible });
  }

  // Renders each currently-tracked plane's real boundary as a translucent green overlay, so
  // the user can see how big the detected floor/table actually is, not just a small
  // fixed-size ring at the raycast point. Meshes are reused across frames (only rebuilt when
  // a plane's polygon actually changes, per its lastChangedTime) since recreating geometry
  // every frame for every tracked plane would be wasteful.
  private updatePlaneVisualizations(frame: any, referenceSpace: any) {
    const detectedPlanes: Set<any> | undefined = frame.detectedPlanes;
    if (!detectedPlanes) return; // Browser doesn't support/grant plane-detection — no-op.

    for (const [plane, mesh] of this.detectedPlaneMeshes) {
      if (!detectedPlanes.has(plane)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.detectedPlaneMeshes.delete(plane);
      }
    }

    for (const plane of detectedPlanes) {
      const pose = frame.getPose(plane.planeSpace, referenceSpace);
      if (!pose) continue;

      let mesh = this.detectedPlaneMeshes.get(plane);
      const changed = !mesh || mesh.userData.lastChangedTime !== plane.lastChangedTime;
      if (changed) {
        const polygon = plane.polygon as { x: number; y: number; z: number }[];
        if (polygon.length >= 3) {
          const shape = new THREE.Shape();
          shape.moveTo(polygon[0].x, polygon[0].z);
          for (let i = 1; i < polygon.length; i++) shape.lineTo(polygon[i].x, polygon[i].z);
          shape.closePath();
          // Shapes build flat in local XY by default — rotated to XZ (same convention as
          // the reticle's own RingGeometry) to match the plane's local coordinate frame,
          // where WebXR defines the plane's normal as its local Y-axis.
          const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);

          if (mesh) {
            mesh.geometry.dispose();
            mesh.geometry = geometry;
          } else {
            mesh = new THREE.Mesh(geometry, this.planeVisualizationMaterial);
            mesh.matrixAutoUpdate = false;
            this.detectedPlaneMeshes.set(plane, mesh);
            this.scene.add(mesh);
          }
          mesh.userData.lastChangedTime = plane.lastChangedTime;
        }
      }

      if (mesh) mesh.matrix.fromArray(pose.transform.matrix);
    }
  }

  // Answers "is this hit-test position actually on a real, adequately-sized detected
  // plane" by reusing the same frame.detectedPlanes data updatePlaneVisualizations reads
  // for visualization — the WebXR spec doesn't expose which entityType (plane vs point)
  // produced a given hit-test result (see the "point" entityType comment in onFrame), so
  // this is how "prefer plane hits" is actually implemented: not by inspecting the hit
  // itself, but by cross-referencing its position against the plane boundaries already
  // being tracked. Deliberately recomputes each plane's pose independently rather than
  // sharing updatePlaneVisualizations' pose lookup from earlier in the same frame — plane
  // counts are small ("a handful," per that method's own comment), so the extra per-frame
  // cost is negligible, and it keeps the two code paths decoupled.
  private classifyPlaneValidity(hitWorldPos: THREE.Vector3, frame: any, referenceSpace: any): PlaneValidity {
    const detectedPlanes: Set<any> | undefined = frame.detectedPlanes;
    if (!detectedPlanes || detectedPlanes.size === 0) return "unknown";

    for (const plane of detectedPlanes) {
      const pose = frame.getPose(plane.planeSpace, referenceSpace);
      if (!pose) continue;

      this.scratchPlaneInverse.fromArray(pose.transform.matrix).invert();
      this.scratchLocalHit.copy(hitWorldPos).applyMatrix4(this.scratchPlaneInverse);

      const polygon = plane.polygon as { x: number; z: number }[];
      if (polygon.length < 3) continue;
      if (!pointInPolygonXZ(this.scratchLocalHit.x, this.scratchLocalHit.z, polygon)) continue;

      return polygonAreaXZ(polygon) >= MIN_PLANE_AREA_M2 ? "valid" : "invalid";
    }
    // No plane covers this hit at all — could mean no plane-detection support, or a
    // point-hit ARCore hasn't classified into a plane yet. Neither is negative evidence.
    return "unknown";
  }

  // Guards floor placement from clipping into a nearby wall/corner: for each detected
  // vertical plane, a plane's own local Y axis is always its surface normal by WebXR
  // convention (true regardless of whether the plane itself is horizontal or vertical), so
  // the local-space hit's Y component is directly the hit's perpendicular distance to that
  // wall — the same transform trick classifyPlaneValidity uses, just reading a different
  // axis of the result. Deliberately does NOT bound the check to the wall's own polygon
  // extent (see WALL_CLEARANCE_M's own comment for why that's an acceptable trade-off).
  private isTooCloseToWall(hitWorldPos: THREE.Vector3, frame: any, referenceSpace: any): boolean {
    const detectedPlanes: Set<any> | undefined = frame.detectedPlanes;
    if (!detectedPlanes) return false;

    for (const plane of detectedPlanes) {
      if (plane.orientation !== "vertical") continue;
      const pose = frame.getPose(plane.planeSpace, referenceSpace);
      if (!pose) continue;

      this.scratchPlaneInverse.fromArray(pose.transform.matrix).invert();
      this.scratchLocalHit.copy(hitWorldPos).applyMatrix4(this.scratchPlaneInverse);

      if (Math.abs(this.scratchLocalHit.y) < WALL_CLEARANCE_M) return true;
    }
    return false;
  }

  // Progressive upgrade: on devices with a real depth sensor (LiDAR on iPhone Pro models,
  // time-of-flight on some higher-end Android phones), the sensor measures distance
  // directly instead of piecing it together from camera-motion parallax like standard
  // hit-testing does. Rather than inventing placement geometry from that reading alone
  // (a single depth sample tells you distance, not a surface's true orientation — using it
  // to place an object could put it at a wrong angle), it's used as a second, independent
  // confirmation: if the depth sensor's straight-ahead distance reading roughly agrees with
  // how far the current hit-test reticle already is, that's real hardware corroboration
  // this is a genuine surface, so confidence can jump ahead instead of waiting out the full
  // frame count. No-ops entirely on devices without the sensor (frame.getDepthInformation
  // is simply absent there) — every device keeps exactly what it already had.
  private tryDepthConfidenceBoost(frame: any, viewerPose: any) {
    if (!this.reticleHasTarget || !viewerPose?.views?.length) return;
    if (typeof frame.getDepthInformation !== "function") return;

    let depthInfo: any;
    try {
      depthInfo = frame.getDepthInformation(viewerPose.views[0]);
    } catch {
      return;
    }
    if (!depthInfo) return;

    const depthMeters = depthInfo.getDepthInMeters(0.5, 0.5);
    if (!Number.isFinite(depthMeters)) return;

    const reticleDistance = this.camera.position.distanceTo(this.reticlePosition);
    if (Math.abs(reticleDistance - depthMeters) < 0.15) {
      this.reticleStableFrames = Math.max(this.reticleStableFrames, RETICLE_STABLE_FRAMES_THRESHOLD);
      this.depthCorroborated = true;
    }
  }

  private onFrame(frame: any) {
    if (!frame || !this.renderer || !this.session) return;

    // xrLight.directionalLight.intensity is a WebXR light-estimation scalar clamped to a
    // floor of 1.0 (see XREstimatedLight's own source) — meaning it sits at exactly that
    // floor whenever the room is genuinely dim, and rises above it in brighter rooms. Only
    // meaningful once estimation has actually started (xrLight.parent === this.scene, set
    // by the estimationstart listener in mount()) — before that there's no real reading yet.
    if (this.xrLight && this.xrLight.parent === this.scene) {
      const isDim = this.xrLight.directionalLight.intensity <= 1.05;
      if (isDim !== this.lastReportedDim) {
        this.lastReportedDim = isDim;
        this.onLightLevelChange(isDim);
      }
    }

    // Camera-angle guidance: computed every frame regardless of search state (cheap), so
    // it's already known the instant the UI layer wants to show it — same pattern as the
    // lighting check above.
    this.camera.getWorldDirection(this.scratchCameraForward);
    const isPointingWrong = this.scratchCameraForward.y > CAMERA_DOWNWARD_THRESHOLD;
    if (isPointingWrong !== this.lastReportedPointingWrong) {
      this.lastReportedPointingWrong = isPointingWrong;
      this.onCameraAngleChange(isPointingWrong);
    }

    const referenceSpace = this.renderer.xr.getReferenceSpace();

    if (referenceSpace) this.updatePlaneVisualizations(frame, referenceSpace);

    // Kick off hit-test-source setup once, without awaiting: an XRFrame is only valid
    // synchronously during this callback, so any `await` here would leave later lines
    // (getHitTestResults, render) operating on a stale frame on the very first tick.
    if (!this.hitTestSourceRequested) {
      this.hitTestSourceRequested = true;
      const session = this.session;
      session.requestReferenceSpace("viewer").then((viewerSpace: any) => {
        // "plane" alone only returns results once ARCore/ARKit has fully classified a
        // surface, which takes a few frames of camera motion. Adding "point" (raw
        // feature-point hits) lets a result come back sooner, before classification
        // finishes — the standard technique for faster time-to-first-detection. Trade-off:
        // the WebXR spec doesn't expose which entityType produced a given result, so
        // findValidHit's tilt-angle filter below has to treat all results the same way —
        // a point hit's orientation is occasionally less reliable than a classified
        // plane's, which is an accepted cost for detecting noticeably faster in practice.
        // (classifyPlaneValidity, called below once a hit is found, is what recovers the
        // plane-vs-point distinction after the fact, by cross-referencing the hit's
        // position against frame.detectedPlanes.)
        session.requestHitTestSource({ space: viewerSpace, entityTypes: ["plane", "point"] }).then((source: any) => {
          this.hitTestSource = source;
        });
      });
    }

    if (this.hitTestSource && referenceSpace) {
      // getViewerPose returns null when the device has lost track of where it is in space
      // entirely (fast motion, a blank/textureless view, etc.) — a fundamentally different
      // problem from "tracking is fine, just no surface found yet", so it's checked and
      // reported separately before even looking at hit-test results.
      const viewerPose = frame.getViewerPose(referenceSpace);
      const hitTestResults = viewerPose ? frame.getHitTestResults(this.hitTestSource) : [];
      const hit = viewerPose ? this.findValidHit(hitTestResults, referenceSpace) : null;

      if (hit) {
        const wasVisible = this.reticle.visible;
        this.candidatePosition.setFromMatrixPosition(hit);
        this.candidateQuaternion.setFromRotationMatrix(hit);

        if (!this.reticleHasTarget) {
          // First acquisition this session: snap instead of lerping from the origin.
          this.reticleTargetPosition.copy(this.candidatePosition);
          this.reticleTargetQuaternion.copy(this.candidateQuaternion);
          this.reticlePosition.copy(this.candidatePosition);
          this.reticleQuaternion.copy(this.candidateQuaternion);
          this.reticleHasTarget = true;

          // Recovered right after tracking loss, near where we were last confident? Trust
          // it immediately instead of re-ramping confidence from zero — see
          // RECOVERY_SNAP_RADIUS's own comment.
          this.reticleStableFrames =
            this.wasTrackingLost &&
            this.hasLastKnownGood &&
            this.candidatePosition.distanceTo(this.lastKnownGoodPosition) < RECOVERY_SNAP_RADIUS
              ? RETICLE_STABLE_FRAMES_THRESHOLD
              : 0;
          this.wasTrackingLost = false;
        } else {
          // Deadzone: ignore movement below the noise floor so the smoothing filter isn't
          // perpetually chasing tiny fluctuations even while the phone is essentially still.
          const movedDist = this.candidatePosition.distanceTo(this.reticleTargetPosition);
          const movedDeg = THREE.MathUtils.radToDeg(this.candidateQuaternion.angleTo(this.reticleTargetQuaternion));
          if (movedDist > RETICLE_POSITION_DEADZONE || movedDeg > RETICLE_ROTATION_DEADZONE_DEG) {
            this.reticleTargetPosition.copy(this.candidatePosition);
            this.reticleTargetQuaternion.copy(this.candidateQuaternion);
            this.reticleStableFrames = 0;
          } else {
            this.reticleStableFrames++;
          }
          this.reticlePosition.lerp(this.reticleTargetPosition, RETICLE_SMOOTHING);
          this.reticleQuaternion.slerp(this.reticleTargetQuaternion, RETICLE_SMOOTHING);
        }

        this.depthCorroborated = false;
        this.tryDepthConfidenceBoost(frame, viewerPose);

        const planeValidity = this.classifyPlaneValidity(this.candidatePosition, frame, referenceSpace);
        if (planeValidity === "valid") {
          // Real, adequately-sized detected plane under the hit is strong independent
          // evidence — same corroboration pattern as tryDepthConfidenceBoost above, so
          // confidence can jump ahead instead of waiting out the full stable-frame count.
          this.reticleStableFrames = Math.max(this.reticleStableFrames, RETICLE_STABLE_FRAMES_THRESHOLD);
        }
        const tooCloseToWall = this.isTooCloseToWall(this.candidatePosition, frame, referenceSpace);

        this.reticle.matrix.compose(this.reticlePosition, this.reticleQuaternion, ARSessionScene.UNIT_SCALE);
        // A hit backed by neither a real detected plane nor hardware depth agreement is
        // just "stationary," not "verified" — plain stillness alone (RETICLE_STABLE_FRAMES_
        // THRESHOLD) used to be enough to place on, which let a wrong-but-motionless point
        // hit (e.g. a stray feature point among cluttered geometry) reach placement in well
        // under a second. Requiring the much longer UNCORROBORATED_FALLBACK_FRAMES hold in
        // that case closes that gap while still not blocking placement forever on a device
        // or moment with no plane/depth data at all.
        const corroborated = planeValidity === "valid" || this.depthCorroborated;
        const isConfident =
          planeValidity !== "invalid" &&
          !tooCloseToWall &&
          this.reticleStableFrames >= (corroborated ? RETICLE_STABLE_FRAMES_THRESHOLD : UNCORROBORATED_FALLBACK_FRAMES);
        this.isPlacementConfident = isConfident;
        if (isConfident) {
          this.lastKnownGoodPosition.copy(this.reticlePosition);
          this.hasLastKnownGood = true;
        }
        (this.reticle.material as THREE.MeshBasicMaterial).color.setHex(
          planeValidity === "invalid" || tooCloseToWall
            ? RETICLE_COLOR_INVALID
            : isConfident
            ? RETICLE_COLOR_CONFIDENT
            : RETICLE_COLOR_SEARCHING
        );
        if (!wasVisible) this.onReticleVisible(true);
        this.reticle.visible = true;

        if (tooCloseToWall) {
          this.reportSurfaceIssue("near-wall");
        } else if (planeValidity === "invalid") {
          this.reportSurfaceIssue("surface-too-small");
        } else if (!isConfident) {
          this.reportSurfaceIssue("not-stable");
        } else {
          this.reportSurfaceIssue(null);
        }
      } else {
        this.reticleHasTarget = false;
        this.reticleStableFrames = 0;
        this.isPlacementConfident = false;
        this.depthCorroborated = false;
        if (this.reticle.visible) this.onReticleVisible(false);
        this.reticle.visible = false;

        if (!viewerPose) {
          this.reportSurfaceIssue("tracking-lost");
          this.wasTrackingLost = true;
        } else if (hitTestResults.length === 0) {
          this.reportSurfaceIssue("no-results");
        } else {
          this.reportSurfaceIssue("bad-angle");
        }
      }
    }

    this.updateSpawnAnimations();
    this.updateMeasurementLabel();
    this.renderer.render(this.scene, this.camera);

    if (this.pendingCapture) {
      const resolve = this.pendingCapture;
      this.pendingCapture = null;
      resolve(this.readXRFramePixels());
    }
  }

  // Returns whichever valid hit-test result (floor/tabletop/desk, per the surface normal's
  // angle from world-up — anything past MAX_FLOOR_TILT_DEG is rejected) is closest to what's
  // currently being tracked, or null if nothing qualifies. Preferring the
  // closest-to-current-target result (instead of always the first) avoids flicker when two
  // valid surfaces are both in view (e.g. a tabletop and the floor beneath it).
  private findValidHit(hitTestResults: any[], referenceSpace: any): THREE.Matrix4 | null {
    let best: THREE.Matrix4 | null = null;
    let bestDist = Infinity;

    for (const result of hitTestResults) {
      const pose = result.getPose(referenceSpace);
      if (!pose) continue;

      this.hitCheckMatrix.fromArray(pose.transform.matrix);
      this.hitCheckNormal.setFromMatrixColumn(this.hitCheckMatrix, 1).normalize();
      const tiltDeg = THREE.MathUtils.radToDeg(this.hitCheckNormal.angleTo(ARSessionScene.WORLD_UP));
      if (tiltDeg > MAX_FLOOR_TILT_DEG) continue;

      if (!this.reticleHasTarget) return this.hitCheckMatrix.clone();

      const dist = this.hitCheckPosition
        .setFromMatrixPosition(this.hitCheckMatrix)
        .distanceTo(this.reticleTargetPosition);
      if (dist < bestDist) {
        bestDist = dist;
        best = this.hitCheckMatrix.clone();
      }
    }
    return best;
  }

  dispose() {
    window.removeEventListener("resize", this.resizeHandler);
    if (this.uiInteractionClearTimer) clearTimeout(this.uiInteractionClearTimer);
    if (this.session) {
      this.session.end().catch(() => {});
    }
    (this.xrLight as any)?.dispose();
    this.xrLight = null;
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
    this.renderer = null;
  }
}
