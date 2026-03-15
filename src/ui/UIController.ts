import Stats from 'three/examples/jsm/libs/stats.module.js';
import { Pane } from 'tweakpane';

export type UIParams = {
  gravity: number;
  debugPhysics: boolean;
  rigidBodyCount: number;
  ragdollsCount: number;
};

type UIControllerOptions = {
  params: UIParams;
  onAddRagdoll: () => void;
  onToggleDebugPhysics: (visible: boolean) => void;
};

// 统一封装 tweakpane 和 stats，避免主入口直接操作 UI 细节。
export class UIController {
  readonly params: UIParams;

  private readonly pane: Pane;
  private readonly stats: Stats;

  constructor(options: UIControllerOptions) {
    this.params = options.params;
    this.pane = new Pane();
    this.stats = new Stats();

    // UI 事件只向外抛出回调，不直接操作业务对象。
    this.pane.addButton({
      title: 'Add Ragdoll',
      label: '',
    }).on('click', options.onAddRagdoll);

    this.pane.addBinding(this.params, 'debugPhysics').on('change', (ev) => {
      options.onToggleDebugPhysics(ev.value);
    });

    // 监视项直接绑定到共享状态对象，主循环只负责更新值。
    this.pane.addBinding(this.params, 'rigidBodyCount', { disabled: true, step: 1 });
    this.pane.addBinding(this.params, 'gravity', {
      step: 0.1,
      max: 10,
      min: -10,
    });
    this.pane.addBinding(this.params, 'ragdollsCount', { disabled: true, step: 1 });

    // 显示 FPS 面板。
    this.stats.showPanel(0);
    document.body.appendChild(this.stats.dom);
  }

  beginFrame() {
    this.stats.begin();
  }

  endFrame() {
    this.stats.end();
  }

  refresh() {
    // 强制刷新面板，确保监视值与本帧状态一致。
    this.pane.refresh();
  }
}
