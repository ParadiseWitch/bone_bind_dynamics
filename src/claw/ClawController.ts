import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/Addons.js';

const CLAW_NODE_NAMES = ['1', '2', '3'] as const;
const CLAW_CLOSE_ANGLE = THREE.MathUtils.degToRad(38);
const CLAW_TARGET_HEIGHT = 1.6;
const CLAW_GROUND_OFFSET = 0.02;
const CLAW_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#8f98a3',
  metalness: 0.55,
  roughness: 0.28,
});

type ClawNode = THREE.Object3D & {
  userData: THREE.Object3D['userData'] & {
    openQuaternion?: THREE.Quaternion;
  };
};

export class ClawController {
  private readonly root: THREE.Object3D;
  private readonly clawNodes: ClawNode[];
  private target = 0;
  private progress = 0;

  private constructor(root: THREE.Object3D, clawNodes: ClawNode[]) {
    this.root = root;
    this.clawNodes = clawNodes;
  }

  static async create(scene: THREE.Scene) {
    const gltfLoader = new GLTFLoader();
    const clawGltf = await gltfLoader.loadAsync(new URL('../../assets/钩爪.glb', import.meta.url).href);
    const clawRoot = clawGltf.scene;

    clawRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.castShadow = true;
      child.receiveShadow = true;
      child.material = CLAW_MATERIAL;
    });

    clawRoot.updateMatrixWorld(true);
    const clawBounds = new THREE.Box3().setFromObject(clawRoot);
    const clawSize = clawBounds.getSize(new THREE.Vector3());
    const scaleFactor = CLAW_TARGET_HEIGHT / Math.max(clawSize.y, 0.001);
    clawRoot.scale.setScalar(scaleFactor);
    clawRoot.updateMatrixWorld(true);

    const scaledClawBounds = new THREE.Box3().setFromObject(clawRoot);
    const clawCenter = scaledClawBounds.getCenter(new THREE.Vector3());
    clawRoot.position.set(-clawCenter.x, CLAW_GROUND_OFFSET - scaledClawBounds.min.y, -1.2 - clawCenter.z);
    scene.add(clawRoot);

    const clawNodes = CLAW_NODE_NAMES
      .map((name) => clawRoot.getObjectByName(name) as ClawNode | undefined)
      .filter((node): node is ClawNode => Boolean(node));

    clawNodes.forEach((node) => {
      node.userData.openQuaternion = node.quaternion.clone();
    });

    return new ClawController(clawRoot, clawNodes);
  }

  toggle() {
    this.target = this.target === 0 ? 1 : 0;
  }

  update(delta: number) {
    this.progress = THREE.MathUtils.damp(this.progress, this.target, 8, delta);

    this.clawNodes.forEach((node) => {
      const openQuaternion = node.userData.openQuaternion;

      if (!openQuaternion) {
        return;
      }

      node.quaternion.copy(openQuaternion);
      node.rotateX(CLAW_CLOSE_ANGLE * this.progress);
    });
  }

  getObject() {
    return this.root;
  }
}
