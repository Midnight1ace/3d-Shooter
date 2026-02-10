import { GamePhase } from '../core/config.js';

export function createInputManager({ dom, state, config, callbacks }) {
    const keys = {
        w: false,
        a: false,
        s: false,
        d: false,
        shift: false,
        r: false
    };

    function onPointerLockChange() {
        state.isPointerLocked = document.pointerLockElement === dom.gameCanvas;
        if (!state.isPointerLocked && state.phase === GamePhase.PLAYING) {
            callbacks?.onPointerUnlock?.();
        }
    }

    function onMouseMove(event) {
        if (!state.isPointerLocked || state.phase !== GamePhase.PLAYING) return;
        callbacks?.onMouseMove?.(event);
    }

    function onKeyDown(event) {
        switch (event.code) {
            case 'KeyW': keys.w = true; break;
            case 'KeyA': keys.a = true; break;
            case 'KeyS': keys.s = true; break;
            case 'KeyD': keys.d = true; break;
            case 'ShiftLeft':
            case 'ShiftRight': keys.shift = true; break;
            case 'KeyR':
                callbacks?.onReload?.();
                break;
            case 'KeyE':
                callbacks?.onInteract?.();
                break;
            case 'KeyB':
                if (state.phase === GamePhase.PLAYING) {
                    callbacks?.onBuyAmmo?.();
                }
                break;
            case 'Digit1':
            case 'Numpad1':
                if (state.phase === GamePhase.CHOOSING) {
                    callbacks?.onSelectUpgrade?.(0);
                }
                break;
            case 'Digit2':
            case 'Numpad2':
                if (state.phase === GamePhase.CHOOSING) {
                    callbacks?.onSelectUpgrade?.(1);
                }
                break;
            case 'Digit3':
            case 'Numpad3':
                if (state.phase === GamePhase.CHOOSING) {
                    callbacks?.onSelectUpgrade?.(2);
                }
                break;
            case 'Equal':
            case 'NumpadAdd':
                callbacks?.onAdjustUiScale?.(config.uiScaleStep);
                break;
            case 'Minus':
            case 'NumpadSubtract':
                callbacks?.onAdjustUiScale?.(-config.uiScaleStep);
                break;
            case 'Digit0':
                callbacks?.onSetUiScale?.(1);
                break;
            case 'Enter':
            case 'Space':
                if (state.phase === GamePhase.START) {
                    callbacks?.onStart?.();
                } else if (state.phase === GamePhase.PAUSED) {
                    callbacks?.onResume?.();
                } else if (state.phase === GamePhase.GAME_OVER) {
                    callbacks?.onRestart?.();
                }
                break;
            case 'Escape':
                if (state.phase === GamePhase.PLAYING) {
                    callbacks?.onPause?.();
                } else if (state.phase === GamePhase.PAUSED) {
                    callbacks?.onResume?.();
                }
                break;
            case 'KeyV':
                callbacks?.onToggleScreenShake?.();
                break;
            case 'KeyH':
                callbacks?.onToggleHitStop?.();
                break;
        }
    }

    function onKeyUp(event) {
        switch (event.code) {
            case 'KeyW': keys.w = false; break;
            case 'KeyA': keys.a = false; break;
            case 'KeyS': keys.s = false; break;
            case 'KeyD': keys.d = false; break;
            case 'ShiftLeft':
            case 'ShiftRight': keys.shift = false; break;
        }
    }

    function onMouseDown(event) {
        if (event.button === 0 && state.phase === GamePhase.PLAYING && state.isPointerLocked) {
            callbacks?.onPrimaryFire?.();
        }
    }

    function attach() {
        if (dom.gameCanvas) {
            dom.gameCanvas.addEventListener('click', () => {
                if (state.phase === GamePhase.PLAYING && !state.isPointerLocked) {
                    dom.gameCanvas.requestPointerLock();
                }
            });
        }

        document.addEventListener('pointerlockchange', onPointerLockChange);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('mousedown', onMouseDown);
    }

    return {
        keys,
        attach
    };
}
