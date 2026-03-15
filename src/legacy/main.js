import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * 物理引擎管理器
 */
class PhysicsWorld {
  constructor() {
    this.world = null;
  }

  async init() {
    await RAPIER.init();
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // 创建物理地面
    const groundDesc = RAPIER.ColliderDesc.cuboid(25, 0.1, 25)
      .setTranslation(0, -0.1, 0);
    this.world.createCollider(groundDesc);
  }

  step() {
    if (this.world) this.world.step();
  }
}

/**
 * 布娃娃管理器：处理 Three.js 骨骼与 Rapier 刚体的映射与同步
 */
class Ragdoll {
  constructor(model, physicsWorld, scene) {
    this.model = model;
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.bonesMap = [];

    // 预分配用于同步的临时对象，减少 GC
    this._tempVec = new THREE.Vector3();
    this._tempQuat = new THREE.Quaternion();
    this._tempMat = new THREE.Matrix4();
    this._tempMat2 = new THREE.Matrix4();
    this._tempPos = new THREE.Vector3();
    this._tempScale = new THREE.Vector3();
  }

  init() {
    console.log('--- Model Hierarchy ---');
    this._dumpHierarchy(this.model, 0);

    this.model.updateMatrixWorld(true);

    // 1. 创建刚体
    this.model.traverse(child => {
      const isLikelyBone = child.isBone || (child.isObject3D && !child.isMesh && !child.isLight && !child.isCamera && child.name.toLowerCase().includes('bone'));
      const isArmatureChild = child.parent && (child.parent.name.toLowerCase().includes('armature') || child.parent.name.includes('骨骼'));

      if (child.isBone || isLikelyBone || isArmatureChild) {
        this._createBonePhysics(child);
      }
    });

    // 2. 建立约束
    this._setupConstraints();
  }

  _dumpHierarchy(obj, depth) {
    console.log('  '.repeat(depth) + `- ${obj.name} [${obj.type}]`);
    obj.children.forEach(child => this._dumpHierarchy(child, depth + 1));
  }

  _createBonePhysics(bone) {
    const name = bone.name;

    if (this.bonesMap.find(e => e.bone === bone)) return;

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    bone.getWorldPosition(worldPos);
    bone.getWorldQuaternion(worldQuat);

    let length = 0.2;
    let direction = new THREE.Vector3(0, 1, 0);
    let hasChild = false;

    const childBone = bone.children.find(c => c.isBone || (c.isObject3D && !c.isMesh));
    if (childBone) {
      const childPos = childBone.position;
      length = childPos.length();
      if (length > 0.001) {
        direction.copy(childPos).normalize();
        hasChild = true;
      }
    }

    if (!hasChild && bone.parent) {
      const selfPos = bone.position;
      length = selfPos.length() * 0.8;
      if (length < 0.05) length = 0.2;

      if (selfPos.length() > 0.001) {
        direction.copy(selfPos).normalize();
      }
    }

    const halfLength = length * 0.5;
    const localOffset = direction.clone().multiplyScalar(halfLength);
    const worldOffset = localOffset.clone().applyQuaternion(worldQuat);
    const centerPos = worldPos.clone().add(worldOffset);

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(centerPos.x, centerPos.y, centerPos.z)
      .setRotation(worldQuat)
      .setLinearDamping(0.8)
      .setAngularDamping(0.8);

    const body = this.physicsWorld.world.createRigidBody(rbDesc);

    const size = Math.max(0.02, Math.min(halfLength, 0.4));
    const hx = Math.abs(direction.x) > 0.5 ? size : 0.04;
    const hy = Math.abs(direction.y) > 0.5 ? size : 0.04;
    const hz = Math.abs(direction.z) > 0.5 ? size : 0.04;

    const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    this.physicsWorld.world.createCollider(colDesc, body);

    const labelDiv = document.createElement('div');
    labelDiv.className = 'bone-label';
    labelDiv.textContent = name;
    labelDiv.style.color = '#00ff00';
    labelDiv.style.backgroundColor = 'rgba(0,0,0,0.8)';
    labelDiv.style.padding = '2px 8px';
    labelDiv.style.borderRadius = '10px';
    labelDiv.style.fontSize = '14px';
    labelDiv.style.fontWeight = 'bold';
    labelDiv.style.pointerEvents = 'none';
    labelDiv.style.border = '1px solid #00ff00';

    const label = new CSS2DObject(labelDiv);
    label.position.set(centerPos.x, centerPos.y, centerPos.z);
    this.scene.add(label);

    this.bonesMap.push({ bone, body, offset: localOffset, label });
    console.log(`Created physics & label for: ${name}`);
  }

  _setupConstraints() {
    this.bonesMap.forEach(entry => {
      const bone = entry.bone;
      const parent = bone.parent;
      if (parent && parent.isBone) {
        const parentEntry = this.bonesMap.find(e => e.bone === parent);
        if (parentEntry) {
          const childLocalAnchor = {
            x: -entry.offset.x,
            y: -entry.offset.y,
            z: -entry.offset.z
          };

          const parentLocalAnchor = {
            x: bone.position.x - parentEntry.offset.x,
            y: bone.position.y - parentEntry.offset.y,
            z: bone.position.z - parentEntry.offset.z
          };

          const jointData = RAPIER.JointData.spherical(parentLocalAnchor, childLocalAnchor);
          this.physicsWorld.world.createImpulseJoint(jointData, parentEntry.body, entry.body, true);
        }
      }
    });
  }

  update() {
    this.model.updateMatrixWorld();

    this.bonesMap.forEach(({ bone, body, offset, label }) => {
      const translation = body.translation();
      const rotation = body.rotation();

      this._tempQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this._tempPos.set(translation.x, translation.y, translation.z);

      label.position.set(translation.x, translation.y, translation.z);

      const worldOffset = this._tempVec.copy(offset).applyQuaternion(this._tempQuat);
      const jointWorldPos = this._tempPos.sub(worldOffset);

      this._tempMat.makeRotationFromQuaternion(this._tempQuat).setPosition(jointWorldPos);

      if (bone.parent && bone.parent.isBone) {
        this._tempMat2.copy(bone.parent.matrixWorld).invert();
        this._tempMat.premultiply(this._tempMat2);
      }

      this._tempMat.decompose(bone.position, bone.quaternion, this._tempScale);

      bone.updateMatrix();
      if (bone.parent) {
        bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
      } else {
        bone.matrixWorld.copy(bone.matrix);
      }
    });
  }
}

/**
 * 演示应用主类
 */
class App {
  constructor() {
    this.scene = new THREE.Scene();
    this.physics = new PhysicsWorld();
    this.ragdoll = null;

    this._initScene();
    this._initLights();
  }

  _initScene() {
    this.scene.background = new THREE.Color(0x222222);
    this.scene.fog = new THREE.Fog(0x222222, 10, 100);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(10, 10, 15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    document.body.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 2, 0);
    this.controls.update();

    window.addEventListener('resize', () => this._onResize());

    this.scene.add(new THREE.GridHelper(50, 25, 0x888888, 0x444444));
  }

  _initLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    dir.shadow.camera.left = -20;
    dir.shadow.camera.right = 20;
    dir.shadow.camera.top = 20;
    dir.shadow.camera.bottom = -20;
    this.scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0x444444 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  async start() {
    await this.physics.init();
    this._loadModel();
  }

  _loadModel() {
    const loader = new GLTFLoader();
    loader.load('assets/骨骼测试.glb', (gltf) => {
      const model = gltf.scene;
      model.position.y = 8;
      this.scene.add(model);

      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = false;
        }
      });

      this.ragdoll = new Ragdoll(model, this.physics, this.scene);
      this.ragdoll.init();

      this.scene.add(new THREE.SkeletonHelper(model));

      this._animate();
    });
  }

  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    this.physics.step();
    if (this.ragdoll) this.ragdoll.update();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}

new App().start();
