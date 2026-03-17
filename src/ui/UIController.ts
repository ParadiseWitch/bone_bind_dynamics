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
  onGrabClaw: () => void;
  onMoveClawForward: (delta: number) => void;
  onMoveClawBackward: (delta: number) => void;
  onMoveClawLeft: (delta: number) => void;
  onMoveClawRight: (delta: number) => void;
  onToggleDebugPhysics: (visible: boolean) => void;
};

type HeldDirection = 'forward' | 'backward' | 'left' | 'right';

// 统一封装 tweakpane 和 stats，避免主入口直接操作 UI 细节。
export class UIController {
  readonly params: UIParams;

  private readonly pane: Pane;
  private readonly stats: Stats;
  private readonly controlsRoot: HTMLDivElement;
  private readonly activeDirections = new Set<HeldDirection>();
  private readonly moveHandlers: Record<HeldDirection, (delta: number) => void>;

  constructor(options: UIControllerOptions) {
    this.params = options.params;
    this.pane = new Pane();
    this.stats = new Stats();
    this.controlsRoot = document.createElement('div');
    this.controlsRoot.className = 'gamepad-controls';
    this.moveHandlers = {
      forward: options.onMoveClawForward,
      backward: options.onMoveClawBackward,
      left: options.onMoveClawLeft,
      right: options.onMoveClawRight,
    };

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
    document.body.appendChild(this.controlsRoot);

    this.controlsRoot.append(
      this.createDirectionalPad(),
      this.createGrabButton(options.onGrabClaw),
    );
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

  update(delta: number) {
    for (const direction of this.activeDirections) {
      this.moveHandlers[direction](delta);
    }
  }

  private createDirectionalPad() {
    const pad = document.createElement('div');
    pad.className = 'direction-pad';

    pad.append(
      this.createDirectionalButton('direction-button direction-button--forward', '前', 'forward'),
      this.createDirectionalButton('direction-button direction-button--left', '左', 'left'),
      this.createDirectionalButton('direction-button direction-button--right', '右', 'right'),
      this.createDirectionalButton('direction-button direction-button--backward', '后', 'backward'),
    );

    return pad;
  }

  private createGrabButton(onGrab: () => void) {
    return this.createControlButton('grab-button', 'GO!', onGrab);
  }

  private createControlButton(className: string, label: string, onClick: () => void) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private createDirectionalButton(className: string, label: string, direction: HeldDirection) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.textContent = label;

    const activate = () => {
      this.activeDirections.add(direction);
    };
    const release = () => {
      this.activeDirections.delete(direction);
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      activate();
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', () => {
      if (!button.matches(':active')) {
        release();
      }
    });
    button.addEventListener('lostpointercapture', release);

    return button;
  }
}
