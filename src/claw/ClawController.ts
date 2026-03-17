import * as THREE from 'three';
import RAPIER, { World } from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/Addons.js';

const CLAW_NODE_NAMES = ['1', '2', '3'] as const;
const CLAW_CLOSE_ANGLE = THREE.MathUtils.degToRad(38);
const CLAW_TARGET_HEIGHT = 1.6;
const CLAW_GROUND_OFFSET = 0.02;
const CLAW_MOVE_STEP = 0.2;
const CLAW_COLLIDER_NODE_PREFIX = 'b_';
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

type PhysicsPart = {
  body: RAPIER.RigidBody;
  source: THREE.Object3D;
  localOffset: THREE.Vector3;
};

export class ClawController {
  private readonly root: THREE.Object3D;
  private readonly clawNodes: ClawNode[];
  private readonly physicsParts: PhysicsPart[];
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempScale = new THREE.Vector3();
  private readonly tempOffset = new THREE.Vector3();
  private target = 0;
  private progress = 0;

  private constructor(root: THREE.Object3D, clawNodes: ClawNode[], physicsParts: PhysicsPart[]) {
    this.root = root;
    this.clawNodes = clawNodes;
    this.physicsParts = physicsParts;
  }

  static async create(scene: THREE.Scene, world: World) {
    const gltfLoader = new GLTFLoader();
    const clawGltf = await gltfLoader.loadAsync(new URL('../../assets/钩爪.glb', import.meta.url).href);
    const clawRoot = clawGltf.scene;
    const colliderMeshes: THREE.Mesh[] = [];

    clawRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      if (child.name.startsWith(CLAW_COLLIDER_NODE_PREFIX)) {
        child.visible = false;
        child.castShadow = false;
        child.receiveShadow = false;
        colliderMeshes.push(child);
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

    clawRoot.updateMatrixWorld(true);

    const physicsParts = colliderMeshes.map((mesh) => ClawController.createPhysicsPart(world, mesh));

    return new ClawController(clawRoot, clawNodes, physicsParts);
  }

  toggle() {
    this.target = this.target === 0 ? 1 : 0;
  }

  moveLeft() {
    this.root.position.x -= CLAW_MOVE_STEP;
  }

  moveRight() {
    this.root.position.x += CLAW_MOVE_STEP;
  }

  moveUp() {
    this.root.position.z -= CLAW_MOVE_STEP;
  }

  moveDown() {
    this.root.position.z += CLAW_MOVE_STEP;
  }

  raise() {
    this.root.position.y += CLAW_MOVE_STEP;
  }

  lower() {
    this.root.position.y = Math.max(CLAW_GROUND_OFFSET, this.root.position.y - CLAW_MOVE_STEP);
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

    this.root.updateMatrixWorld(true);

    for (const physicsPart of this.physicsParts) {
      physicsPart.source.getWorldQuaternion(this.tempQuaternion);
      physicsPart.source.getWorldPosition(this.tempPosition);
      physicsPart.source.getWorldScale(this.tempScale);

      this.tempOffset.copy(physicsPart.localOffset).multiply(this.tempScale).applyQuaternion(this.tempQuaternion);
      this.tempPosition.add(this.tempOffset);

      physicsPart.body.setNextKinematicTranslation({
        x: this.tempPosition.x,
        y: this.tempPosition.y,
        z: this.tempPosition.z,
      });
      physicsPart.body.setNextKinematicRotation({
        x: this.tempQuaternion.x,
        y: this.tempQuaternion.y,
        z: this.tempQuaternion.z,
        w: this.tempQuaternion.w,
      });
    }
  }

  private static createPhysicsPart(world: World, source: THREE.Object3D) {
    if (!(source instanceof THREE.Mesh)) {
      throw new Error(`Claw physics source must be a mesh: ${source.name}`);
    }

    source.geometry.computeBoundingBox();
    const bounds = source.geometry.boundingBox;

    if (!bounds) {
      throw new Error(`Missing bounding box for claw mesh: ${source.name}`);
    }

    const localCenter = bounds.getCenter(new THREE.Vector3());
    const localSize = bounds.getSize(new THREE.Vector3());
    const worldScale = source.getWorldScale(new THREE.Vector3());
    const halfExtents = localSize.multiply(worldScale).multiplyScalar(0.5);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    source.getWorldPosition(position);
    source.getWorldQuaternion(quaternion);
    position.add(localCenter.clone().multiply(worldScale).applyQuaternion(quaternion));

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(quaternion),
    );

    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    colliderDesc
      .setMass(2)
      .setFriction(1.2)
      .setRestitution(0);

    world.createCollider(colliderDesc, body);

    return { body, source, localOffset: localCenter };
  }
}
