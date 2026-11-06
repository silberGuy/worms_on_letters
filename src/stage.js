import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCutoutGeometry } from './cutoutGeometry.js';
import { WormMesh } from './wormMesh.js';

const FOV = 30;
const HALF_FOV_TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const FRAME_PADDING = 1.35;
const START_DIRECTION = new THREE.Vector3(0.45, 0.2, 1).normalize();
const FRONT_DIRECTION = new THREE.Vector3(0, 0, 1);
const LIGHT_DIRECTION = new THREE.Vector3(-0.4, 0.8, 0.7).normalize();

// The 3D view: renders the Cutout, Floor and Worms, and advances the WormWorld each frame.
export class Stage {
  constructor(host) {
    this.host = host;
    this.world = null;
    this.field = null;
    this.cutout = null;
    this.wormMeshes = new Map();
    this.frontHalfHeight = 8;
    this.frameTarget = new THREE.Vector3(0, 5, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.background = new THREE.Color('#e9e6df');
    this.scene.background = this.background;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e4dc, 1.75));
    this.light = new THREE.DirectionalLight(0xffffff, 2.2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(4096, 4096);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.03;
    this.scene.add(this.light, this.light.target);

    const floorGeometry = new THREE.PlaneGeometry(2000, 2000);
    floorGeometry.rotateX(-Math.PI / 2);
    this.floor = new THREE.Mesh(floorGeometry, new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.perspective = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.orthographicHalfHeight = this.frontHalfHeight;
    this.camera = this.perspective;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2;

    this.#fitLight();
    this.frame(START_DIRECTION);

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(host);
    this.#resize();

    this.animate = this.animate.bind(this);
    this.frameRequest = requestAnimationFrame(this.animate);
  }

  animate() {
    this.frameRequest = requestAnimationFrame(this.animate);
    if (this.world) this.world.step();
    for (const wormMesh of this.wormMeshes.values()) wormMesh.update();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  #aspect() {
    const { clientWidth, clientHeight } = this.host;
    return clientHeight > 0 ? clientWidth / clientHeight : 1;
  }

  #updateProjections() {
    const aspect = this.#aspect();
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const half = this.orthographicHalfHeight;
    this.orthographic.left = -half * aspect;
    this.orthographic.right = half * aspect;
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.updateProjectionMatrix();
  }

  #resize() {
    const { clientWidth, clientHeight } = this.host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.#updateProjections();
  }

  #fitLight() {
    const bounds = this.field?.bounds ?? { left: -5, right: 5, top: 10, bottom: 0 };
    const size = Math.max(bounds.right - bounds.left, bounds.top - bounds.bottom, 1);
    const shadow = this.light.shadow.camera;
    const reach = size * 1.3;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.near = 0.1;
    shadow.far = size * 7;
    shadow.updateProjectionMatrix();
    this.light.target.position.copy(this.frameTarget);
    this.light.position.copy(this.frameTarget).addScaledVector(LIGHT_DIRECTION, size * 3);
  }

  // Points the camera at the whole Cutout from the given direction.
  frame(direction) {
    const bounds = this.field?.bounds ?? { left: -5, right: 5, top: 10, bottom: 0 };
    const width = bounds.right - bounds.left;
    const height = bounds.top - bounds.bottom;
    this.frameTarget.set((bounds.left + bounds.right) / 2, height / 2, 0);
    const half = (Math.max(height, width / this.#aspect()) / 2) * FRAME_PADDING;
    this.frontHalfHeight = half;

    this.controls.target.copy(this.frameTarget);
    this.orthographicHalfHeight = half;
    this.orthographic.zoom = 1;
    const distance = half / HALF_FOV_TAN;
    this.camera.position.copy(this.frameTarget).addScaledVector(direction, distance);
    this.#updateProjections();
    this.controls.update();
  }

  frontView() {
    this.frame(FRONT_DIRECTION);
  }

  setProjection(projection) {
    const next = projection === 'orthographic' ? this.orthographic : this.perspective;
    if (next === this.camera) return;
    const target = this.controls.target;

    if (next === this.orthographic) {
      this.orthographicHalfHeight = this.controls.getDistance() * HALF_FOV_TAN;
      this.orthographic.zoom = 1;
      this.orthographic.position.copy(this.perspective.position);
    } else {
      const half = this.orthographicHalfHeight / this.orthographic.zoom;
      const direction = new THREE.Vector3().subVectors(this.orthographic.position, target).normalize();
      this.perspective.position.copy(target).addScaledVector(direction, half / HALF_FOV_TAN);
    }

    this.camera = next;
    this.controls.object = next;
    this.#updateProjections();
    this.controls.update();
  }

  setBackground(colour) {
    this.background.set(colour);
  }

  // Replaces the Cutout, and removes all Worms from the view.
  setComposition({ field, texture, world, thickness }) {
    this.clearWorms();
    this.#removeCutout();
    this.field = field;
    this.world = world;

    const map = new THREE.CanvasTexture(texture);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
    this.cutout = new THREE.Mesh(buildCutoutGeometry(field), material);
    this.cutout.castShadow = true;
    this.cutout.receiveShadow = true;
    this.cutout.scale.z = thickness;
    this.scene.add(this.cutout);

    this.frame(START_DIRECTION);
    this.#fitLight();
  }

  #removeCutout() {
    if (!this.cutout) return;
    this.scene.remove(this.cutout);
    this.cutout.geometry.dispose();
    this.cutout.material.map.dispose();
    this.cutout.material.dispose();
    this.cutout = null;
  }

  setThickness(thickness) {
    if (this.cutout) this.cutout.scale.z = thickness;
  }

  addWorm(worm, colour) {
    const wormMesh = new WormMesh(worm, colour);
    this.wormMeshes.set(worm.id, wormMesh);
    this.scene.add(wormMesh.mesh);
  }

  removeWorm(id) {
    const wormMesh = this.wormMeshes.get(id);
    if (!wormMesh) return;
    this.scene.remove(wormMesh.mesh);
    wormMesh.dispose();
    this.wormMeshes.delete(id);
  }

  clearWorms() {
    for (const id of [...this.wormMeshes.keys()]) this.removeWorm(id);
  }

  // Renders the current camera view to a PNG whose long edge is `longEdge` pixels.
  exportPng({ longEdge, transparent }) {
    const { renderer, scene } = this;
    const aspect = this.#aspect();
    const width = Math.round(aspect >= 1 ? longEdge : longEdge * aspect);
    const height = Math.round(aspect >= 1 ? longEdge / aspect : longEdge);
    const { clientWidth, clientHeight } = this.host;
    const pixelRatio = renderer.getPixelRatio();

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    scene.background = transparent ? null : this.background;
    renderer.render(scene, this.camera);

    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    output.getContext('2d').drawImage(renderer.domElement, 0, 0);

    scene.background = this.background;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(clientWidth, clientHeight);
    renderer.render(scene, this.camera);

    return new Promise((resolve, reject) => {
      output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be created.'))), 'image/png');
    });
  }

  dispose() {
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.clearWorms();
    this.#removeCutout();
    this.controls.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
