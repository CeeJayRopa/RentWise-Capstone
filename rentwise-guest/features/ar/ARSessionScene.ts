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

interface PlacedObject extends PlacedObjectInfo {
  group: THREE.Group;
  scaleMultiplier: number;
  groundOffset: number;
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

// Reject hit-test surfaces tilted more than this from horizontal (walls, slanted objects),
// since the catalog is furniture meant to sit on floors/tables/desks.
const MAX_SURFACE_TILT_DEG = 25;

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

  private modelCache = new Map<string, { template: THREE.Group; groundOffset: number }>();
  private armedObjectId: string | null = null;
  private armedModel: THREE.Group | null = null;
  private armedGroundOffset = 0;
  private scratchCamDir = new THREE.Vector3();
  private scratchLookMatrix = new THREE.Matrix4();

  private placed: PlacedObject[] = [];
  private selected: PlacedObject | null = null;
  private nextInstanceId = 1;

  private onPlacedChange: (state: PlacedState) => void = () => {};
  private onReticleVisible: (visible: boolean) => void = () => {};
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

  setCallbacks(onPlacedChange: (state: PlacedState) => void, onReticleVisible: (visible: boolean) => void) {
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
    this.reticle.visible = false;

    this.placedGroup.clear();
    this.placed = [];
    this.selected = null;
    this.onPlacedChange({ placed: [], selectedId: null });
    this.onReticleVisible(false);
  }

  // Set right before any DOM overlay button's onPress runs (rotate/scale/delete/arm/etc.)
  // so a tap that leaks through to the XR session as a "select" doesn't also place or
  // pick an object — some browsers don't fully suppress the XR select event for taps
  // that land on DOM overlay buttons, causing every button press to spuriously act on
  // the AR scene underneath it too.
  private suppressSelectUntil = 0;

  suppressNextSelect() {
    this.suppressSelectUntil = performance.now() + 400;
  }

  private onSelect(controller: THREE.Object3D) {
    if (performance.now() < this.suppressSelectUntil) return;

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

    const group = cloneWithOwnMaterials(this.armedModel);
    group.matrixAutoUpdate = true;
    group.position.setFromMatrixPosition(this.reticle.matrix);
    this.orientTowardCamera(group);
    group.translateY(this.armedGroundOffset);
    group.scale.setScalar(0.001); // spawn-animated up to full size in onFrame

    const placedObject: PlacedObject = {
      id: `placed-${this.nextInstanceId++}`,
      objectId: this.armedObjectId,
      group,
      scaleMultiplier: 1,
      groundOffset: this.armedGroundOffset,
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
      // Ground offset: shifts the model up/down so its lowest point sits exactly at the
      // reticle instead of floating above or sinking into the surface — depends on where
      // each model's own origin happens to be, so it's computed once per model, not assumed.
      const box = new THREE.Box3().setFromObject(template);
      const groundOffset = Number.isFinite(box.min.y) ? -box.min.y : 0;
      cached = { template, groundOffset };
      this.modelCache.set(objectId, cached);
    }
    this.armedObjectId = objectId;
    this.armedModel = cached.template;
    this.armedGroundOffset = cached.groundOffset;
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

  // Orients `group` to face the same horizontal direction the camera was looking when
  // placed (instead of inheriting the hit-test pose's raw, essentially arbitrary yaw),
  // so every placed object comes in consistently upright and non-twisted.
  private orientTowardCamera(group: THREE.Group) {
    this.camera.getWorldDirection(this.scratchCamDir);
    this.scratchCamDir.y = 0;
    if (this.scratchCamDir.lengthSq() < 1e-6) this.scratchCamDir.set(0, 0, -1);
    this.scratchCamDir.normalize();

    this.scratchLookMatrix.lookAt(new THREE.Vector3(), this.scratchCamDir, ARSessionScene.WORLD_UP);
    group.quaternion.setFromRotationMatrix(this.scratchLookMatrix);
  }

  rotateSelected(deltaDeg: number) {
    if (!this.selected) return;
    this.selected.group.rotateY(THREE.MathUtils.degToRad(deltaDeg));
  }

  scaleSelected(factor: number) {
    if (!this.selected) return;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.selected.scaleMultiplier * factor));
    this.selected.scaleMultiplier = next;
    this.selected.group.scale.setScalar(next);
  }

  moveSelectedToReticle() {
    if (!this.selected || !this.reticle.visible) return;
    this.selected.group.position.setFromMatrixPosition(this.reticle.matrix);
    this.orientTowardCamera(this.selected.group);
    // translateY moves along the local axis irrespective of the group's own scale, so the
    // raw ground offset (measured against the unscaled model) must be scaled up/down to
    // match however big this particular instance currently is.
    this.selected.group.translateY(this.selected.groundOffset * this.selected.scaleMultiplier);
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
      p.group.scale.setScalar(Math.max(0.001, p.scaleMultiplier * t));
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
      const hitMatrix = this.findHorizontalHit(hitTestResults, referenceSpace);

      if (hitMatrix) {
        this.candidatePosition.setFromMatrixPosition(hitMatrix);
        this.candidateQuaternion.setFromRotationMatrix(hitMatrix);

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
        if (!this.reticle.visible) this.onReticleVisible(true);
        this.reticle.visible = true;
      } else {
        this.reticleHasTarget = false;
        if (this.reticle.visible) this.onReticleVisible(false);
        this.reticle.visible = false;
      }
    }

    this.updateSpawnAnimations();
    this.renderer.render(this.scene, this.camera);
  }

  // Returns the transform of whichever horizontal hit-test result (surface normal close to
  // world-up — floor/tabletop/desk, not a wall) is closest to what's currently being
  // tracked, or null if every result is too steep or there are no results at all. Preferring
  // the closest-to-current-target result (instead of always the first) avoids flicker when
  // two valid surfaces are both in view (e.g. a tabletop and the floor beneath it).
  private findHorizontalHit(hitTestResults: any[], referenceSpace: any): THREE.Matrix4 | null {
    let best: THREE.Matrix4 | null = null;
    let bestDist = Infinity;

    for (const result of hitTestResults) {
      const pose = result.getPose(referenceSpace);
      if (!pose) continue;

      this.hitCheckMatrix.fromArray(pose.transform.matrix);
      this.hitCheckNormal.setFromMatrixColumn(this.hitCheckMatrix, 1).normalize();
      const tiltDeg = THREE.MathUtils.radToDeg(this.hitCheckNormal.angleTo(ARSessionScene.WORLD_UP));
      if (tiltDeg > MAX_SURFACE_TILT_DEG) continue;

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
    if (this.session) {
      this.session.end().catch(() => {});
    }
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
    this.renderer = null;
  }
}
