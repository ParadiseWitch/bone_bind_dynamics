import { World } from '@dimforge/rapier3d-compat';
import { Scene } from 'three';
import { DRACOLoader, GLTFLoader } from 'three/examples/jsm/Addons.js';
import { Ragdoll } from './Ragdoll';

export class RagdollManager {
  private readonly ragdolls: Ragdoll[] = [];
  private readonly loader: GLTFLoader;

  constructor(
    private readonly world: World,
    private readonly scene: Scene
  ) {
    // 统一在管理器内部准备角色模型加载器，避免 main.ts 关心布娃娃资源细节。
    this.loader = new GLTFLoader();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://raw.githubusercontent.com/google/draco/refs/heads/main/javascript/');
    this.loader.setDRACOLoader(dracoLoader);
  }

  addRagdoll() {
    this.ragdolls.push(new Ragdoll(this.world, this.scene, this.loader));
  }

  update(delta: number) {
    for (const ragdoll of this.ragdolls) {
      ragdoll.update(delta);
    }
  }

  getCount() {
    return this.ragdolls.length;
  }
}
