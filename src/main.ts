/**
 * 原始演示地址：https://mavon.ie/demos/rapierjs-ragdoll
 */

import { OrbitControls, Sky, Timer } from 'three/examples/jsm/Addons.js';
import './style.css';
import RAPIER, { World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ClawController } from './claw/ClawController';
import { RapierDebugRenderer } from './physics/DebugRenderer';
import { RagdollManager } from './ragdoll/RagdollManager';
import { UIController } from './ui/UIController';

// Three.js 场景、相机与渲染器负责基础渲染环境。
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// 使用天空盒模拟远处环境光照。
const sky = new Sky();
sky.scale.setScalar(450000);

const phi = THREE.MathUtils.degToRad(30);
const theta = THREE.MathUtils.degToRad(180);
const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
sky.material.uniforms.sunPosition.value = sunPosition;

// 轨道控制器用于调试观察场景。
const orbitControls = new OrbitControls(camera, renderer.domElement);

// 静态地面只负责渲染，真实碰撞体在 Rapier 世界里单独创建。
const plane = new THREE.PlaneGeometry(20, 20, 1);
const planeMesh = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ color: 'lightgray' }));
planeMesh.rotateX(-Math.PI / 2);
planeMesh.receiveShadow = true;

const ambient = new THREE.AmbientLight();
ambient.intensity = 2;

const pointLight = new THREE.PointLight('white', 60, 30, 2);
pointLight.position.set(0, 5, -5);
pointLight.castShadow = true;
pointLight.lookAt(new THREE.Vector3(0, 0, 0));

scene.add(sky, planeMesh, ambient, pointLight);
camera.position.set(0, 4, 3);

// UI 与物理循环共享的运行时状态。
const PARAMS = {
  gravity: -9.81,
  debugPhysics: true,
  rigidBodyCount: 0,
  ragdollsCount: 0
};

const timer = new Timer();

async function bootstrap() {
  // 初始化物理引擎后再创建世界和碰撞体。
  await RAPIER.init();
  const world = new World({ x: 0, y: PARAMS.gravity, z: 0 });
  const rapierDebugRender = new RapierDebugRenderer(scene, world, PARAMS.debugPhysics);

  // 创建固定地面碰撞体，和上面的可视平面保持对应。
  const physicsPlane = RAPIER.ColliderDesc.cuboid(10, 0.2, 10);
  const physicsPlaneDesc = RAPIER.RigidBodyDesc.fixed();
  const physicsPlaneRigidBody = world.createRigidBody(physicsPlaneDesc);
  physicsPlaneRigidBody.setTranslation({ x: 0, y: -0.2, z: 0 }, false);
  world.createCollider(physicsPlane, physicsPlaneRigidBody);

  // 布娃娃管理器只负责创建和逐帧同步布娃娃实体。
  const ragdollManager = new RagdollManager(world, scene);
  ragdollManager.addRagdoll();
  const clawController = await ClawController.create(scene, world);

  // UI 控制器统一管理面板、性能面板以及相关回调。
  const ui = new UIController({
    params: PARAMS,
    onAddRagdoll: () => ragdollManager.addRagdoll(),
    onToggleClaw: () => clawController.toggle(),
    onRaiseClaw: () => clawController.raise(),
    onLowerClaw: () => clawController.lower(),
    onMoveClawUp: () => clawController.moveUp(),
    onMoveClawDown: () => clawController.moveDown(),
    onMoveClawLeft: () => clawController.moveLeft(),
    onMoveClawRight: () => clawController.moveRight(),
    onToggleDebugPhysics: (visible) => rapierDebugRender.toggleVisible(visible),
  });

  function animate() {
    // 先采样帧时间，再更新监控面板显示值。
    timer.update();
    ui.beginFrame();
    PARAMS.rigidBodyCount = world.bodies.len();
    PARAMS.ragdollsCount = ragdollManager.getCount();

    ui.refresh();

    clawController.update(timer.getDelta());
    world.gravity = new RAPIER.Vector3(0, PARAMS.gravity, 0);
    world.step();
    ragdollManager.update(timer.getDelta());
    rapierDebugRender.update();
    orbitControls.update(timer.getDelta());

    renderer.render(scene, camera);

    ui.endFrame();
  }

  // 使用 Three 的动画循环以兼容浏览器渲染节奏。
  renderer.setAnimationLoop(animate);
}

// 显式忽略返回的 Promise，入口只负责启动应用。
void bootstrap();
