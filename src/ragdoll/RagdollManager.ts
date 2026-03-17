import { World } from '@dimforge/rapier3d-compat';
import { Scene } from 'three';
import { DRACOLoader, GLTFLoader } from 'three/examples/jsm/Addons.js';
import { Ragdoll } from './Ragdoll';

// 管理多个布娃娃实例及其共享资源。
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

    // Draco 解码器跟随项目一起发布，避免 GitHub Pages 环境访问外链或子路径出错。
    dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/gltf/`);
    this.loader.setDRACOLoader(dracoLoader);
  }

  addRagdoll() {
    // 新布娃娃共享同一个加载器与物理世界，但各自拥有独立刚体。
    this.ragdolls.push(new Ragdoll(this.world, this.scene, this.loader));
  }

  update(delta: number) {
    // 逐个把物理结果写回对应角色骨骼。
    for (const ragdoll of this.ragdolls) {
      ragdoll.update(delta);
    }
  }

  getCount() {
    return this.ragdolls.length;
  }
}
