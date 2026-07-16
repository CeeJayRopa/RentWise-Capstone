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
export type SurfaceType = "floor" | "wall";

// Distinguishes *why* no reticle is currently showing, since the underlying causes need
// completely different guidance: "tracking-lost" means the phone doesn't know where it is
// at all (hold steady); "no-results" means tracking is fine but nothing plane-shaped has
// been found yet (keep scanning); "bad-angle" means something WAS found but rejected for
// being neither floor- nor wall-like (try a flatter spot).
export type SurfaceIssue = "tracking-lost" | "no-results" | "bad-angle" | null;

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
  wallOffset: number;
  surfaceType: SurfaceType;
  spawnStartTime: number;
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
// "locked in" (green); anything still settling is "searching" (amber).
const RETICLE_STABLE_FRAMES_THRESHOLD = 10;
const RETICLE_COLOR_SEARCHING = 0xffaa00;
const RETICLE_COLOR_CONFIDENT = 0x4caf50;

// Lightweight surface memory: position already snaps instantly on any reacquisition (see
// the `!reticleHasTarget` branch below), so the real gap after recovering from a brief
// tracking-loss is confidence, not position — it still ramps back up from amber even when
// it's clearly the same spot as before. If a hit recovered right after tracking loss lands
// within this radius (meters) of where we were last confident, it's treated as still
// trustworthy immediately instead of re-ramping from zero.
const RECOVERY_SNAP_RADIUS = 0.3;

// Surface classification, by angle between the hit-test surface normal and world-up:
// near 0° = floor/tabletop/desk, near 90° = wall. Anything in between (slanted surfaces,
// ramps) is ambiguous and rejected outright.
const MAX_FLOOR_TILT_DEG = 25;
const WALL_TILT_MIN_DEG = 65;
const WALL_TILT_MAX_DEG = 115;

// Placement pop-in animation duration, in ms.
const SPAWN_ANIM_DURATION_MS = 220;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
    { template: THREE.Group; groundOffset: number; wallOffset: number; boundingBox: THREE.Box3 }
  >();
  private armedObjectId: string | null = null;
  private armedModel: THREE.Group | null = null;
  private armedGroundOffset = 0;
  private armedWallOffset = 0;
  private currentSurfaceType: SurfaceType | null = null;
  private scratchCamDir = new THREE.Vector3();
  private scratchLookMatrix = new THREE.Matrix4();

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
  private onReticleVisible: (visible: boolean, surfaceType: SurfaceType | null) => void = () => {};
  private onMeasurementChange: (measurement: SelectedMeasurement | null) => void = () => {};
  private onSurfaceIssue: (issue: SurfaceIssue) => void = () => {};
  private lastSurfaceIssue: SurfaceIssue = null;
  private onLightLevelChange: (isDim: boolean) => void = () => {};
  private lastReportedDim: boolean | null = null;
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

  setCallbacks(
    onPlacedChange: (state: PlacedState) => void,
    onReticleVisible: (visible: boolean, surfaceType: SurfaceType | null) => void
  ) {
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

  // Only fires the callback when the cause actually changes, so the UI layer's own
  // time-based escalation (e.g. "still searching after 5s") isn't reset every single frame.
  private reportSurfaceIssue(issue: SurfaceIssue) {
    if (issue === this.lastSurfaceIssue) return;
    this.lastSurfaceIssue = issue;
    this.onSurfaceIssue(issue);
  }

  mount(canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer: true is required for capturePhoto() below — during an XR
    // session, the framebuffer is otherwise cleared/swapped immediately after each frame's
    // render call, before a canvas.toDataURL() read from outside the render loop could ever
    // see it. This keeps the just-rendered frame (camera passthrough + placed objects,
    // exactly as composited by the XR layer) readable for one extra tick.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
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
      optionalFeatures: ["dom-overlay", "light-estimation", "plane-detection"],
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

  private onSessionEnd() {
    this.session = null;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.reticleHasTarget = false;
    this.reticleStableFrames = 0;
    this.hasLastKnownGood = false;
    this.wasTrackingLost = false;
    this.currentSurfaceType = null;
    this.reticle.visible = false;

    this.placedGroup.clear();
    this.placed = [];
    this.selected = null;
    this.updateSelectionOutline();
    this.history = [];
    this.onPlacedChange({ placed: [], selectedId: null, canUndo: false });
    this.onReticleVisible(false, null);
    this.onMeasurementChange(null);
    this.reportSurfaceIssue(null);
    this.lastReportedDim = null;
    this.onLightLevelChange(false);

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

    // If something is armed, a tap always places it at the reticle — even when the tap also
    // geometrically lines up with an already-placed object. This matters because placing a
    // second item ON or right next to the first (the whole point of arranging multiple
    // objects together) means the reticle and an existing object's mesh are often in the
    // same direction, and placement should win that ambiguity, not object-selection.
    if (this.reticle.visible && this.armedModel) {
      this.placeArmedAtReticle();
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

  // Sized to the model's own local footprint so bigger objects get bigger shadows, and
  // positioned at the model's own local bottom (not just local Y=0) so it sits flush under
  // the model regardless of where the source .glb's own origin happens to be.
  private createGroundShadowMesh(cached: { boundingBox: THREE.Box3 }): THREE.Mesh {
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
    mesh.position.set(center.x, cached.boundingBox.min.y + 0.001, center.z);
    mesh.renderOrder = -1;
    return mesh;
  }

  private placeArmedAtReticle() {
    if (!this.armedModel || !this.armedObjectId) return;

    const surfaceType = this.currentSurfaceType ?? "floor";
    const group = cloneWithOwnMaterials(this.armedModel);
    group.matrixAutoUpdate = true;
    group.position.setFromMatrixPosition(this.reticle.matrix);

    if (surfaceType === "wall") {
      this.orientTowardWall(group);
      group.translateZ(this.armedWallOffset);
    } else {
      this.orientTowardCamera(group);
      group.translateY(this.armedGroundOffset);

      // Wall-mounted items don't rest on a floor, so a ground blob doesn't make sense there.
      const cached = this.modelCache.get(this.armedObjectId);
      if (cached) group.add(this.createGroundShadowMesh(cached));
    }

    group.scale.setScalar(0.001); // spawn-animated up to full size in onFrame

    const placedObject: PlacedObject = {
      id: `placed-${this.nextInstanceId++}`,
      objectId: this.armedObjectId,
      group,
      scale: { x: 1, y: 1, z: 1 },
      groundOffset: this.armedGroundOffset,
      wallOffset: this.armedWallOffset,
      surfaceType,
      spawnStartTime: performance.now(),
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
      // Ground offset: shifts the model up/down so its lowest point sits exactly at the
      // reticle instead of floating above or sinking into a floor/tabletop.
      const groundOffset = Number.isFinite(box.min.y) ? -box.min.y : 0;
      // Wall offset: same idea but for depth — shifts the model so its back (assumed to be
      // the +Z side, given the glTF/three.js front-is--Z convention) sits flush against a
      // wall instead of floating in front of it or clipping through it. Both are measured
      // once per model here, not assumed, since it depends on where each .glb's own origin
      // and orientation happen to be.
      const wallOffset = Number.isFinite(box.max.z) ? -box.max.z : 0;
      cached = { template, groundOffset, wallOffset, boundingBox: box };
      this.modelCache.set(objectId, cached);
    }
    this.armedObjectId = objectId;
    this.armedModel = cached.template;
    this.armedGroundOffset = cached.groundOffset;
    this.armedWallOffset = cached.wallOffset;
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
  // forward (-Z) facing `direction`, flattened to the horizontal plane. Shared by floor
  // placement (faces the camera) and wall placement (faces away from the wall, into the
  // room) — both just need a horizontal facing direction, nothing else differs.
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

  // Orients `group` to face away from the wall it's being placed on (into the room), using
  // the wall's own surface normal — derived from the current (smoothed) reticle orientation,
  // since a hit-test pose's local Y-axis always represents the surface normal by convention.
  private orientTowardWall(group: THREE.Group) {
    const wallNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.reticleQuaternion);
    this.applyYawOrientation(group, wallNormal);
  }

  rotateSelected(deltaDeg: number) {
    if (!this.selected) return;
    this.selected.group.rotateY(THREE.MathUtils.degToRad(deltaDeg));
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
    const prev = this.selected.scale[axis];
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetValue));
    this.selected.scale[axis] = next;
    this.selected.group.scale.set(this.selected.scale.x, this.selected.scale.y, this.selected.scale.z);

    if (this.selected.surfaceType === "wall" && axis === "z") {
      // Keep the object's back flush against the wall as its depth changes, instead of
      // growing/shrinking from its origin point (which would push it through the wall or
      // pull it away as the depth scale changes).
      this.selected.group.translateZ(this.selected.wallOffset * (next - prev));
    } else if (this.selected.surfaceType !== "wall" && axis === "y") {
      // Same idea for floor placement: keep the base anchored as height changes.
      this.selected.group.translateY(this.selected.groundOffset * (next - prev));
    }
  }

  moveSelectedToReticle() {
    if (!this.selected || !this.reticle.visible) return;
    const surfaceType = this.currentSurfaceType ?? "floor";
    this.selected.surfaceType = surfaceType;
    this.selected.group.position.setFromMatrixPosition(this.reticle.matrix);

    // translate* moves along the local axis irrespective of the group's own scale, so the
    // raw offset (measured against the unscaled model) must be scaled up/down to match
    // however big this particular instance currently is.
    if (surfaceType === "wall") {
      this.orientTowardWall(this.selected.group);
      this.selected.group.translateZ(this.selected.wallOffset * this.selected.scale.z);
    } else {
      this.orientTowardCamera(this.selected.group);
      this.selected.group.translateY(this.selected.groundOffset * this.selected.scale.y);
    }
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
      if (now - p.spawnStartTime >= SPAWN_ANIM_DURATION_MS) continue;
      const t = easeOutCubic(Math.min(1, (now - p.spawnStartTime) / SPAWN_ANIM_DURATION_MS));
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
  // the user can see how big the detected floor/table/wall actually is, not just a small
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
        const typeChanged = this.currentSurfaceType !== hit.surfaceType;
        this.currentSurfaceType = hit.surfaceType;
        this.candidatePosition.setFromMatrixPosition(hit.matrix);
        this.candidateQuaternion.setFromRotationMatrix(hit.matrix);

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

        this.reticle.matrix.compose(this.reticlePosition, this.reticleQuaternion, ARSessionScene.UNIT_SCALE);
        const isConfident = this.reticleStableFrames >= RETICLE_STABLE_FRAMES_THRESHOLD;
        if (isConfident) {
          this.lastKnownGoodPosition.copy(this.reticlePosition);
          this.hasLastKnownGood = true;
        }
        (this.reticle.material as THREE.MeshBasicMaterial).color.setHex(
          isConfident ? RETICLE_COLOR_CONFIDENT : RETICLE_COLOR_SEARCHING
        );
        if (!this.reticle.visible || typeChanged) this.onReticleVisible(true, hit.surfaceType);
        this.reticle.visible = true;
        this.reportSurfaceIssue(null);
      } else {
        this.reticleHasTarget = false;
        this.reticleStableFrames = 0;
        this.currentSurfaceType = null;
        if (this.reticle.visible) this.onReticleVisible(false, null);
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
      try {
        resolve(this.renderer.domElement.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve(null);
      }
    }
  }

  // Returns whichever valid hit-test result (floor/tabletop/desk OR wall, per the surface
  // normal's angle from world-up — slanted surfaces in between are rejected) is closest to
  // what's currently being tracked, or null if nothing qualifies. Preferring the
  // closest-to-current-target result (instead of always the first) avoids flicker when two
  // valid surfaces are both in view (e.g. a tabletop and the floor beneath it, or a wall and
  // the floor meeting it in a corner).
  private findValidHit(
    hitTestResults: any[],
    referenceSpace: any
  ): { matrix: THREE.Matrix4; surfaceType: SurfaceType } | null {
    let best: THREE.Matrix4 | null = null;
    let bestType: SurfaceType | null = null;
    let bestDist = Infinity;

    for (const result of hitTestResults) {
      const pose = result.getPose(referenceSpace);
      if (!pose) continue;

      this.hitCheckMatrix.fromArray(pose.transform.matrix);
      this.hitCheckNormal.setFromMatrixColumn(this.hitCheckMatrix, 1).normalize();
      const tiltDeg = THREE.MathUtils.radToDeg(this.hitCheckNormal.angleTo(ARSessionScene.WORLD_UP));

      let surfaceType: SurfaceType | null = null;
      if (tiltDeg <= MAX_FLOOR_TILT_DEG) surfaceType = "floor";
      else if (tiltDeg >= WALL_TILT_MIN_DEG && tiltDeg <= WALL_TILT_MAX_DEG) surfaceType = "wall";
      if (!surfaceType) continue;

      if (!this.reticleHasTarget) return { matrix: this.hitCheckMatrix.clone(), surfaceType };

      const dist = this.hitCheckPosition
        .setFromMatrixPosition(this.hitCheckMatrix)
        .distanceTo(this.reticleTargetPosition);
      if (dist < bestDist) {
        bestDist = dist;
        best = this.hitCheckMatrix.clone();
        bestType = surfaceType;
      }
    }
    return best && bestType ? { matrix: best, surfaceType: bestType } : null;
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
