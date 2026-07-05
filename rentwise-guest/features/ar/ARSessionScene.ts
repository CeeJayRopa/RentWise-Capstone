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
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

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

  private modelCache = new Map<string, THREE.Group>();
  private armedObjectId: string | null = null;
  private armedModel: THREE.Group | null = null;

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
    this.reticle.visible = false;

    this.placedGroup.clear();
    this.placed = [];
    this.selected = null;
    this.onPlacedChange({ placed: [], selectedId: null });
    this.onReticleVisible(false);
  }

  private onSelect(controller: THREE.Object3D) {
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
    group.quaternion.setFromRotationMatrix(this.reticle.matrix);

    const placedObject: PlacedObject = {
      id: `placed-${this.nextInstanceId++}`,
      objectId: this.armedObjectId,
      group,
      scaleMultiplier: 1,
    };

    this.placedGroup.add(group);
    this.placed.push(placedObject);
    this.selected = placedObject;
    this.notifyPlacedChange();
  }

  async armObject(objectId: string, modelUrl: string): Promise<void> {
    let template = this.modelCache.get(objectId);
    if (!template) {
      template = await this.loadModel(modelUrl);
      this.modelCache.set(objectId, template);
    }
    this.armedObjectId = objectId;
    this.armedModel = template;
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
    this.selected.group.quaternion.setFromRotationMatrix(this.reticle.matrix);
  }

  deleteSelected() {
    if (!this.selected) return;
    this.placedGroup.remove(this.selected.group);
    this.placed = this.placed.filter((p) => p.id !== this.selected!.id);
    this.selected = null;
    this.notifyPlacedChange();
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
        session.requestHitTestSource({ space: viewerSpace }).then((source: any) => {
          this.hitTestSource = source;
        });
      });
    }

    if (this.hitTestSource && referenceSpace) {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const pose = hitTestResults[0].getPose(referenceSpace);
        this.reticle.visible = true;
        this.reticle.matrix.fromArray(pose.transform.matrix);
        this.onReticleVisible(true);
      } else {
        if (this.reticle.visible) this.onReticleVisible(false);
        this.reticle.visible = false;
      }
    }

    this.renderer.render(this.scene, this.camera);
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
