import { GamePhase } from '../../core/config.js';

export function createUpgradeSystem({ state, dom, ui, weaponSystem, callbacks }) {
    let upgradeOptions = [];

    function openUpgradeScreen() {
        if (state.phase !== GamePhase.PLAYING) return;
        const previousPhase = state.phase;
        try {
            state.phase = GamePhase.CHOOSING;
            if (typeof document.exitPointerLock === 'function') {
                document.exitPointerLock();
            }
            ui.clearPrompts();
            dom.hud?.classList.add('hidden');
            state.timeScale = 1;
            state.timeSlowTimer = 0;
            document.body.classList.remove('time-slow');
            upgradeOptions = generateUpgradeOptions();
            ui.renderUpgradeOptions(upgradeOptions, selectUpgrade);

            ui.showUpgradeScreen();
            ui.renderWeaponOptions();
            ui.updateCredits();
            if (dom.armoryWaveEl) {
                dom.armoryWaveEl.textContent = state.wave;
            }
            if (dom.armoryCreditsEl) {
                dom.armoryCreditsEl.textContent = state.score;
            }
            const firstButton = dom.upgradeOptionsEl?.querySelector('button');
            if (firstButton) firstButton.focus();
        } catch (error) {
            console.error('Failed to open upgrade screen. Continuing to next wave.', error);
            state.phase = previousPhase;
            dom.hud?.classList.remove('hidden');
            ui.hideUpgradeScreen();
            callbacks?.onStartWave?.();
            dom.gameCanvas?.requestPointerLock();
            dom.gameCanvas?.focus();
            callbacks?.onResumeClock?.();
        }
    }

    function closeUpgradeScreen() {
        ui.hideUpgradeScreen();
    }

    function generateUpgradeOptions() {
        const pool = [
            {
                title: 'Overclocked Rounds',
                description: '+20% weapon damage.',
                tradeoff: '-10% max health',
                apply: () => {
                    state.damageMultiplier *= 1.2;
                    state.maxHealth = Math.max(60, Math.round(state.maxHealth * 0.9));
                    state.health = Math.min(state.health, state.maxHealth);
                }
            },
            {
                title: 'Reinforced Armor',
                description: '+20 max health.',
                tradeoff: '-8% move speed',
                apply: () => {
                    state.maxHealth += 20;
                    state.health = Math.min(state.maxHealth, state.health + 20);
                    state.moveSpeedMultiplier *= 0.92;
                }
            },
            {
                title: 'Rapid Reload',
                description: 'Reload 20% faster.',
                tradeoff: '-10% max ammo',
                apply: () => {
                    state.reloadSpeedMultiplier *= 0.8;
                    state.magSizeMultiplier *= 0.9;
                }
            },
            {
                title: 'Extended Mag',
                description: '+20% max ammo.',
                tradeoff: '-10% damage',
                apply: () => {
                    state.magSizeMultiplier *= 1.2;
                    state.damageMultiplier *= 0.9;
                }
            },
            {
                title: 'Adrenal Surge',
                description: '+12% move speed.',
                tradeoff: '-10 max health',
                apply: () => {
                    state.moveSpeedMultiplier *= 1.12;
                    state.maxHealth = Math.max(60, state.maxHealth - 10);
                    state.health = Math.min(state.health, state.maxHealth);
                }
            },
            {
                title: 'Chrono Spike',
                description: 'Longer time-slow on kill.',
                tradeoff: 'Slightly slower reload',
                apply: () => {
                    state.timeSlowDuration = Math.min(0.6, state.timeSlowDuration + 0.15);
                    state.reloadSpeedMultiplier *= 1.08;
                }
            }
        ];

        const options = [];
        const used = new Set();
        while (options.length < 3 && used.size < pool.length) {
            const index = Math.floor(Math.random() * pool.length);
            if (used.has(index)) continue;
            used.add(index);
            options.push(pool[index]);
        }
        return options;
    }

    function selectUpgrade(index) {
        if (state.phase !== GamePhase.CHOOSING) return;
        const option = upgradeOptions[index];
        if (!option) return;
        option.apply();
        weaponSystem.refreshWeaponStats();
        closeUpgradeScreen();
        ui.updateHUD();
        state.phase = GamePhase.PLAYING;
        dom.hud?.classList.remove('hidden');
        callbacks?.onStartWave?.();
        dom.gameCanvas?.requestPointerLock();
        dom.gameCanvas?.focus();
        callbacks?.onResumeClock?.();
    }

    return {
        openUpgradeScreen,
        closeUpgradeScreen,
        generateUpgradeOptions,
        selectUpgrade
    };
}
