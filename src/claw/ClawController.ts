import * as THREE from 'three';
import RAPIER, { World } from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/Addons.js';

const CLAW_NODE_NAMES = ['1', '2', '3'] as const;
// 爪指完全闭合时的旋转角度。
const CLAW_CLOSE_ANGLE = THREE.MathUtils.degToRad(38);
// 模型缩放后的目标高度。
const CLAW_TARGET_HEIGHT = 1.6;
// 让模型底部略微离开地面，避免视觉穿插。
const CLAW_GROUND_OFFSET = 0.02;
const CLAW_MOVE_SPEED = 1.8;
const CLAW_HOME_HEIGHT = 2.35;
const CLAW_HOME_POSITION = new THREE.Vector3(0, CLAW_HOME_HEIGHT, 0);
// 抓取下落时允许到达的最低高度。
const CLAW_MIN_GRAB_HEIGHT = 0.72;
const CLAW_GRAB_DROP_DISTANCE = 1.45;
// 抓取流程中移动速度更“钝化”，减少剧烈位移。
const CLAW_GRAB_TRAVEL_DAMPING = 3.2;
const CLAW_POSE_DAMPING = 10;
const CLAW_POSITION_DAMPING = 8;
// 以此前缀命名的网格只用于物理碰撞，不参与可视渲染。
const CLAW_COLLIDER_NODE_PREFIX = 'b_';
const CLAW_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#8f98a3',
  metalness: 0.55,
  roughness: 0.28,
});

// 抓取状态机：张开 -> 下落 -> 闭合 -> 上升 -> 回原点。
enum GrabPhase {
  Idle,
  Opening,
  Descending,
  Closing,
  Ascending,
  Returning,
}

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
  private readonly homePosition = CLAW_HOME_POSITION.clone();
  private readonly positionTarget = new THREE.Vector3();
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempScale = new THREE.Vector3();
  private readonly tempOffset = new THREE.Vector3();
  private gripTarget = 1;
  private gripProgress = 1;
  private phase = GrabPhase.Idle;

  private constructor(root: THREE.Object3D, clawNodes: ClawNode[], physicsParts: PhysicsPart[]) {
    this.root = root;
    this.clawNodes = clawNodes;
    this.physicsParts = physicsParts;
    this.positionTarget.copy(this.homePosition);
    this.root.position.copy(this.homePosition);
    this.applyGripPose();
    this.root.updateMatrixWorld(true);
  }

  static async create(scene: THREE.Scene, world: World) {
    // 加载钩爪模型，并区分可见网格与仅用于碰撞的隐藏网格。
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
    // 将模型统一缩放到预期高度，避免资源尺寸变化影响玩法。
    const scaleFactor = CLAW_TARGET_HEIGHT / Math.max(clawSize.y, 0.001);
    clawRoot.scale.setScalar(scaleFactor);
    clawRoot.updateMatrixWorld(true);

    const scaledClawBounds = new THREE.Box3().setFromObject(clawRoot);
    const clawCenter = scaledClawBounds.getCenter(new THREE.Vector3());
    // 将模型底部对齐到目标高度附近，并让中心落在场景原点上方。
    clawRoot.position.set(-clawCenter.x, CLAW_GROUND_OFFSET - scaledClawBounds.min.y, -clawCenter.z);
    scene.add(clawRoot);

    const clawNodes = CLAW_NODE_NAMES
      .map((name) => clawRoot.getObjectByName(name) as ClawNode | undefined)
      .filter((node): node is ClawNode => Boolean(node));

    clawNodes.forEach((node) => {
      // 记录张开状态的初始姿态，后续每帧都从这个姿态插值闭合。
      node.userData.openQuaternion = node.quaternion.clone();
    });

    clawRoot.updateMatrixWorld(true);

    const physicsParts = colliderMeshes.map((mesh) => ClawController.createPhysicsPart(world, mesh));

    return new ClawController(clawRoot, clawNodes, physicsParts);
  }

  moveLeft(delta: number) {
    if (!this.isIdle()) {
      return;
    }

    this.positionTarget.x -= CLAW_MOVE_SPEED * delta;
  }

  moveRight(delta: number) {
    if (!this.isIdle()) {
      return;
    }

    this.positionTarget.x += CLAW_MOVE_SPEED * delta;
  }

  moveForward(delta: number) {
    if (!this.isIdle()) {
      return;
    }

    this.positionTarget.z -= CLAW_MOVE_SPEED * delta;
  }

  moveBackward(delta: number) {
    if (!this.isIdle()) {
      return;
    }

    this.positionTarget.z += CLAW_MOVE_SPEED * delta;
  }

  grab() {
    if (!this.isIdle()) {
      return;
    }

    // 启动一次完整抓取流程，先张开爪子再开始下落。
    this.phase = GrabPhase.Opening;
    this.gripTarget = 0;
  }

  update(delta: number) {
    // 先推进抓取状态机，再对位置和姿态做阻尼插值。
    this.updateGrabSequence();
    const positionDamping = this.isIdle() ? CLAW_POSITION_DAMPING : CLAW_GRAB_TRAVEL_DAMPING;
    this.gripProgress = THREE.MathUtils.damp(this.gripProgress, this.gripTarget, CLAW_POSE_DAMPING, delta);
    this.root.position.set(
      THREE.MathUtils.damp(this.root.position.x, this.positionTarget.x, positionDamping, delta),
      THREE.MathUtils.damp(this.root.position.y, this.positionTarget.y, positionDamping, delta),
      THREE.MathUtils.damp(this.root.position.z, this.positionTarget.z, positionDamping, delta),
    );
    this.applyGripPose();
    this.root.updateMatrixWorld(true);

    for (const physicsPart of this.physicsParts) {
      // 将可视模型节点的世界变换同步到 Rapier 的运动学刚体。
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

  private updateGrabSequence() {
    if (this.phase === GrabPhase.Idle) {
      return;
    }

    // 各阶段只在接近目标值时切换，避免因阻尼运动造成状态跳变。
    switch (this.phase) {
      case GrabPhase.Opening:
        if (!this.isGripNear(0)) {
          break;
        }

        this.phase = GrabPhase.Descending;
        this.positionTarget.y = Math.max(CLAW_MIN_GRAB_HEIGHT, this.homePosition.y - CLAW_GRAB_DROP_DISTANCE);
        break;
      case GrabPhase.Descending:
        if (!this.isPositionNearY(this.positionTarget.y)) {
          break;
        }

        this.phase = GrabPhase.Closing;
        this.gripTarget = 1;
        break;
      case GrabPhase.Closing:
        if (!this.isGripNear(1)) {
          break;
        }

        this.phase = GrabPhase.Ascending;
        this.positionTarget.y = this.homePosition.y;
        break;
      case GrabPhase.Ascending:
        if (!this.isPositionNearY(this.homePosition.y)) {
          break;
        }

        this.phase = GrabPhase.Returning;
        this.positionTarget.copy(this.homePosition);
        break;
      case GrabPhase.Returning:
        if (!this.isPositionNear(this.homePosition)) {
          break;
        }

        this.root.position.copy(this.homePosition);
        this.positionTarget.copy(this.homePosition);
        this.phase = GrabPhase.Idle;
        break;
      default:
        break;
    }
  }

  private applyGripPose() {
    this.clawNodes.forEach((node) => {
      const openQuaternion = node.userData.openQuaternion;

      if (!openQuaternion) {
        return;
      }

      // 每帧从张开姿态重置，再叠加闭合角度，避免误差累积。
      node.quaternion.copy(openQuaternion);
      node.rotateX(CLAW_CLOSE_ANGLE * this.gripProgress);
    });
  }

  private isIdle() {
    return this.phase === GrabPhase.Idle;
  }

  private isGripNear(value: number) {
    return Math.abs(this.gripProgress - value) < 0.03;
  }

  private isPositionNearY(value: number) {
    return Math.abs(this.root.position.y - value) < 0.03;
  }

  private isPositionNear(value: THREE.Vector3) {
    return this.root.position.distanceToSquared(value) < 0.0025;
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
    // 基于网格包围盒创建简单盒碰撞体，兼顾性能与足够稳定的抓取效果。
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
