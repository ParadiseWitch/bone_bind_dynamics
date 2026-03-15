/**
 * 原始演示地址：https://mavon.ie/demos/rapierjs-ragdoll
 */

import { OrbitControls, Sky, Timer } from 'three/examples/jsm/Addons.js';
import './styles/style.css';
import RAPIER, { World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RapierDebugRenderer } from './physics/DebugRenderer';
import { RagdollManager } from './ragdoll/RagdollManager';
import { UIController } from './ui/UIController';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const sky = new Sky();
sky.scale.setScalar(450000);

const phi = THREE.MathUtils.degToRad(30);
const theta = THREE.MathUtils.degToRad(180);
const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
sky.material.uniforms.sunPosition.value = sunPosition;

const orbitControls = new OrbitControls(camera, renderer.domElement);

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

const PARAMS = {
  gravity: -9.81,
  debugPhysics: true,
  rigidBodyCount: 0,
  ragdollsCount: 0
};

const timer = new Timer();

async function bootstrap() {
  await RAPIER.init();
  const world = new World({ x: 0, y: PARAMS.gravity, z: 0 });
  const rapierDebugRender = new RapierDebugRenderer(scene, world, PARAMS.debugPhysics);

  const physicsPlane = RAPIER.ColliderDesc.cuboid(10, 0.2, 10);
  const physicsPlaneDesc = RAPIER.RigidBodyDesc.fixed();
  const physicsPlaneRigidBody = world.createRigidBody(physicsPlaneDesc);
  physicsPlaneRigidBody.setTranslation({ x: 0, y: -0.2, z: 0 }, false);
  world.createCollider(physicsPlane, physicsPlaneRigidBody);

  // 布娃娃管理器只负责创建和逐帧同步布娃娃实体。
  const ragdollManager = new RagdollManager(world, scene);
  ragdollManager.addRagdoll();

  // UI 控制器统一管理面板、性能面板以及相关回调。
  const ui = new UIController({
    params: PARAMS,
    onAddRagdoll: () => ragdollManager.addRagdoll(),
    onToggleDebugPhysics: (visible) => rapierDebugRender.toggleVisible(visible),
  });

  function animate() {
    timer.update();
    ui.beginFrame();
    PARAMS.rigidBodyCount = world.bodies.len();
    PARAMS.ragdollsCount = ragdollManager.getCount();

    ui.refresh();

    world.gravity = new RAPIER.Vector3(0, PARAMS.gravity, 0);
    world.step();
    ragdollManager.update(timer.getDelta());
    rapierDebugRender.update();
    orbitControls.update(timer.getDelta());

    renderer.render(scene, camera);

    ui.endFrame();
  }

  renderer.setAnimationLoop(animate);
}

void bootstrap();
