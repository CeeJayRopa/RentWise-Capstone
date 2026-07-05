import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// The WebXR Device API (XRSession, XRFrame, XRHitTestSource, navigator.xr, ...) is not
// part of TypeScript's built-in DOM lib, so these are treated as `any` throughout.

export interface PlacedObjectInfo {
  id: string;
  objectId: string;
}

export interface PlacedState {
  placed: PlacedObjectInfo[];
  selectedId: string | null;
}

export type ScaleAxis = "x" | "y" | "z";
export type SurfaceType = "floor" | "wall";

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
// higher = snappier but jitterier. Damps out ARCore's frame-to-frame tracking noise.
const RETICLE_SMOOTHING = 0.35;

// Ignore hit-test movement smaller than this (meters) when updating the reticle's target —
// freezes residual sensor noise at the source instead of letting the smoothing filter chase
// tiny, meaningless fluctuations forever.
const RETICLE_POSITION_DEADZONE = 0.004;
const RETICLE_ROTATION_DEADZONE_DEG = 1.5;

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
  private candidatePosition = new THREE.Vector3();
  private candidateQuaternion = new THREE.Quaternion();
  private hitCheckMatrix = new THREE.Matrix4();
  private hitCheckNormal = new THREE.Vector3();
  private hitCheckPosition = new THREE.Vector3();
  private static readonly WORLD_UP = new THREE.Vector3(0, 1, 0);
  private static readonly UNIT_SCALE = new THREE.Vector3(1, 1, 1);

  private modelCache = new Map<string, { template: THREE.Group; groundOffset: number; wallOffset: number }>();
  private armedObjectId: string | null = null;
  private armedModel: THREE.Group | null = null;
  private armedGroundOffset = 0;
  private armedWallOffset = 0;
  private currentSurfaceType: SurfaceType | null = null;
  private scratchCamDir = new THREE.Vector3();
  private scratchLookMatrix = new THREE.Matrix4();

  private placed: PlacedObject[] = [];
  private selected: PlacedObject | null = null;
  private nextInstanceId = 1;

  private onPlacedChange: (state: PlacedState) => void = () => {};
  private onReticleVisible: (visible: boolean, surfaceType: SurfaceType | null) => void = () => {};
  private resizeHandler = () => this.handleResize();

  constructor() {
    const geometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x8b7355 });
    this.reticle = new THREE.Mesh(geometry, material);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.scene.add(this.placedGroup);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(0.5, 1, 0.25);
    this.scene.add(directional);
  }

  setCallbacks(
    onPlacedChange: (state: PlacedState) => void,
    onReticleVisible: (visible: boolean, surfaceType: SurfaceType | null) => void
  ) {
    this.onPlacedChange = onPlacedChange;
    this.onReticleVisible = onReticleVisible;
  }

  mount(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    (renderer.xr as any).enabled = true;
    (renderer.xr as any).setReferenceSpaceType("local");
    renderer.setAnimationLoop((time: number, frame: any) => this.onFrame(frame));

    this.renderer = renderer;
    window.addEventListener("resize", this.resizeHandler);
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
      optionalFeatures: ["dom-overlay"],
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

  private onSessionEnd() {
    this.session = null;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.reticleHasTarget = false;
    this.currentSurfaceType = null;
    this.reticle.visible = false;

    this.placedGroup.clear();
    this.placed = [];
    this.selected = null;
    this.onPlacedChange({ placed: [], selectedId: null });
    this.onReticleVisible(false, null);
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

    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    const hit = this.raycaster.intersectObjects(this.placedGroup.children, true)[0];
    if (hit) {
      const placedObject = this.placed.find((p) => p.group === hit.object || p.group.getObjectById(hit.object.id));
      if (placedObject) {
        this.selectPlaced(placedObject);
        return;
      }
    }

    if (this.reticle.visible && this.armedModel) {
      this.placeArmedAtReticle();
    }
  }

  private selectPlaced(placedObject: PlacedObject) {
    this.selected = placedObject;
    this.notifyPlacedChange();
  }

  private notifyPlacedChange() {
    this.onPlacedChange({
      placed: this.placed.map(({ id, objectId }) => ({ id, objectId })),
      selectedId: this.selected?.id ?? null,
    });
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
      cached = { template, groundOffset, wallOffset };
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
    const prev = this.selected.scale[axis];
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
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
    this.placedGroup.remove(this.selected.group);
    this.placed = this.placed.filter((p) => p.id !== this.selected!.id);
    this.selected = null;
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

  private onFrame(frame: any) {
    if (!frame || !this.renderer || !this.session) return;

    const referenceSpace = this.renderer.xr.getReferenceSpace();

    // Kick off hit-test-source setup once, without awaiting: an XRFrame is only valid
    // synchronously during this callback, so any `await` here would leave later lines
    // (getHitTestResults, render) operating on a stale frame on the very first tick.
    if (!this.hitTestSourceRequested) {
      this.hitTestSourceRequested = true;
      const session = this.session;
      session.requestReferenceSpace("viewer").then((viewerSpace: any) => {
        session.requestHitTestSource({ space: viewerSpace, entityTypes: ["plane"] }).then((source: any) => {
          this.hitTestSource = source;
        });
      });
    }

    if (this.hitTestSource && referenceSpace) {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      const hit = this.findValidHit(hitTestResults, referenceSpace);

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
        } else {
          // Deadzone: ignore movement below the noise floor so the smoothing filter isn't
          // perpetually chasing tiny fluctuations even while the phone is essentially still.
          const movedDist = this.candidatePosition.distanceTo(this.reticleTargetPosition);
          const movedDeg = THREE.MathUtils.radToDeg(this.candidateQuaternion.angleTo(this.reticleTargetQuaternion));
          if (movedDist > RETICLE_POSITION_DEADZONE || movedDeg > RETICLE_ROTATION_DEADZONE_DEG) {
            this.reticleTargetPosition.copy(this.candidatePosition);
            this.reticleTargetQuaternion.copy(this.candidateQuaternion);
          }
          this.reticlePosition.lerp(this.reticleTargetPosition, RETICLE_SMOOTHING);
          this.reticleQuaternion.slerp(this.reticleTargetQuaternion, RETICLE_SMOOTHING);
        }

        this.reticle.matrix.compose(this.reticlePosition, this.reticleQuaternion, ARSessionScene.UNIT_SCALE);
        if (!this.reticle.visible || typeChanged) this.onReticleVisible(true, hit.surfaceType);
        this.reticle.visible = true;
      } else {
        this.reticleHasTarget = false;
        this.currentSurfaceType = null;
        if (this.reticle.visible) this.onReticleVisible(false, null);
        this.reticle.visible = false;
      }
    }

    this.updateSpawnAnimations();
    this.renderer.render(this.scene, this.camera);
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
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
    this.renderer = null;
  }
}
