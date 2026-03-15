import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, LineSegments, BufferGeometry, LineBasicMaterial, BufferAttribute } from 'three';

// 将 Rapier 输出的调试线框同步到 Three.js 场景里。
export class RapierDebugRenderer {
  mesh;
  world;
  enabled;

  constructor(scene: Scene, world: RAPIER.World, enabled: boolean) {
    this.world = world;
    this.mesh = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffffff, vertexColors: true }));
    this.mesh.frustumCulled = false;
    this.enabled = enabled;
    scene.add(this.mesh);
  }

  toggleVisible(visible: boolean) {
    this.enabled = visible;
  }

  update() {
    if (this.enabled) {
      // 每帧从 Rapier 拉取最新的调试顶点与颜色数据。
      const { vertices, colors } = this.world.debugRender();
      this.mesh.geometry.setAttribute('position', new BufferAttribute(vertices, 3));
      this.mesh.geometry.setAttribute('color', new BufferAttribute(colors, 4));
      this.mesh.visible = true;
    } else {
      this.mesh.visible = false;
    }
  }
}
