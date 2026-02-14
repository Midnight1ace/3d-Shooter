import { GamePhase } from '../core/config.js';

export function createUIController({ dom, state, config, weaponCatalog, audio, callbacks }) {
    let loadingTimer = null;
    let loadingProgress = 0;
    let damageDirectionTimeout = null;
    let lowAmmoPromptCooldown = 0;
    let promptTimeouts = [];
    let promptHideTimeout = null;

    function startLoading() {
        if (!dom.loadingScreen || !dom.loadingFill || !dom.loadingPercent) return;
        loadingProgress = 0;
        updateLoadingUI();
        loadingTimer = setInterval(() => {
            const bump = 3 + Math.random() * 7;
            loadingProgress = Math.min(95, loadingProgress + bump);
            updateLoadingUI();
        }, 120);
    }

    function finishLoading() {
        if (!dom.loadingScreen || !dom.loadingFill || !dom.loadingPercent) return;
        if (loadingTimer) {
            clearInterval(loadingTimer);
            loadingTimer = null;
        }
        loadingProgress = 100;
        updateLoadingUI();
        setTimeout(() => {
            dom.loadingScreen.classList.add('hidden');
        }, 200);
    }

    function updateLoadingUI() {
        if (!dom.loadingFill || !dom.loadingPercent) return;
        dom.loadingFill.style.width = `${loadingProgress}%`;
        dom.loadingPercent.textContent = Math.round(loadingProgress);
    }

    function setUiScale(value) {
        state.uiScale = Math.max(config.minUiScale, Math.min(config.maxUiScale, value));
        document.documentElement.style.setProperty('--ui-scale', state.uiScale.toFixed(2));
        try {
            localStorage.setItem('uiScale', state.uiScale.toFixed(2));
        } catch (e) {
            // Ignore storage errors
        }
    }

    function adjustUiScale(delta) {
        setUiScale(state.uiScale + delta);
        showPrompt(`UI scale: ${Math.round(state.uiScale * 100)}%`, 1200);
    }

    function setupButtonAudio() {
        document.querySelectorAll('button').forEach((button) => {
            button.addEventListener('pointerenter', () => audio?.playUiSound?.('hover'));
            button.addEventListener('click', () => audio?.playUiSound?.('click'));
        });
    }

    function setupArmoryUI() {
        if (dom.buyAmmoRoundButton) {
            dom.buyAmmoRoundButton.addEventListener('click', () => callbacks?.onBuyAmmo?.(50, 'armory'));
        }
    }

    function renderWeaponOptions() {
        if (!dom.weaponOptionsEl) return;
        dom.weaponOptionsEl.innerHTML = '';
        dom.weaponOptionsEl.classList.add('weapon-select-grid');

        const typeOrder = ['pistol', 'smg', 'ar', 'rifle', 'shotgun'];
        const typeLabels = {
            pistol: 'Pistols',
            smg: 'SMGs',
            ar: 'Automatic Rifles',
            rifle: 'Rifles',
            shotgun: 'Shotguns'
        };

        const grouped = typeOrder.reduce((acc, type) => {
            acc[type] = [];
            return acc;
        }, {});

        weaponCatalog.forEach((weaponDef) => {
            if (!grouped[weaponDef.type]) {
                grouped[weaponDef.type] = [];
            }
            grouped[weaponDef.type].push(weaponDef);
        });

        typeOrder.forEach((type) => {
            const items = grouped[type];
            if (!items || items.length === 0) return;
            items.sort((a, b) => a.name.localeCompare(b.name));

            const wrapper = document.createElement('div');
            wrapper.className = 'weapon-select-group';
            if (items.some((item) => item.id === state.currentWeaponId)) {
                wrapper.classList.add('active');
            }

            const label = document.createElement('label');
            label.className = 'weapon-select-label';
            label.textContent = typeLabels[type] || type.toUpperCase();

            const select = document.createElement('select');
            select.className = 'weapon-select';
            select.setAttribute('aria-label', `${label.textContent} selection`);

            items.forEach((weaponDef) => {
                const option = document.createElement('option');
                option.value = weaponDef.id;
                const rpm = Math.round(60000 / weaponDef.fireRate);
                option.textContent = `${weaponDef.name} • DMG ${weaponDef.damage} • RPM ${rpm}`;
                if (weaponDef.id === state.currentWeaponId) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            select.addEventListener('change', (event) => {
                const target = event.target;
                if (!target) return;
                const nextId = target.value;
                callbacks?.onEquipWeapon?.(nextId);
                renderWeaponOptions();
            });
            select.addEventListener('pointerenter', () => audio?.playUiSound?.('hover'));
            select.addEventListener('change', () => audio?.playUiSound?.('click'));

            wrapper.appendChild(label);
            wrapper.appendChild(select);
            dom.weaponOptionsEl.appendChild(wrapper);
        });
    }

    function updateCredits() {
        if (dom.creditsEl) {
            dom.creditsEl.textContent = state.score;
        }
        if (dom.armoryCreditsEl) {
            dom.armoryCreditsEl.textContent = state.score;
        }
    }

    function setupUI() {
        dom.startButton?.addEventListener('click', callbacks?.onStart);
        dom.resumeButton?.addEventListener('click', callbacks?.onResume);
        dom.restartButton?.addEventListener('click', callbacks?.onRestart);
        dom.restartGameButton?.addEventListener('click', callbacks?.onRestart);

        if (dom.spawnButton) {
            state.debugMode = new URLSearchParams(window.location.search).has('debug');
            dom.spawnButton.classList.toggle('hidden', !state.debugMode);
            dom.spawnButton.addEventListener('click', (event) => {
                event.stopPropagation();
                callbacks?.onSpawnEnemy?.();
            });
        }

        setupButtonAudio();
        setupArmoryUI();

        let storedScale = 1;
        try {
            const saved = parseFloat(localStorage.getItem('uiScale'));
            if (!Number.isNaN(saved)) {
                storedScale = saved;
            }
        } catch (e) {
            storedScale = 1;
        }
        setUiScale(storedScale);
        updateHUD();
        if (dom.upgradeScreen) {
            dom.upgradeScreen.classList.add('hidden');
        }
        dom.startButton?.focus();
    }

    function getLowAmmoThreshold() {
        return Math.max(3, Math.round(state.maxAmmo * 0.2));
    }

    function updateHUD() {
        const healthBar = document.getElementById('health-bar');
        const healthContainer = document.getElementById('health-bar-container');
        const healthText = document.getElementById('health-text');
        const currentAmmoEl = document.getElementById('current-ammo');
        const totalAmmoEl = document.getElementById('total-ammo');
        const scoreEl = document.getElementById('score');
        const waveEl = document.getElementById('wave');
        const ammoBar = document.getElementById('ammo-bar');

        const healthPercent = state.maxHealth > 0 ? (state.health / state.maxHealth) * 100 : 0;
        if (healthBar) {
            healthBar.style.width = `${Math.max(0, Math.min(100, healthPercent))}%`;
            if (healthPercent > 60) {
                healthBar.style.background = 'linear-gradient(90deg, #4ecdc4, #44a08d)';
            } else if (healthPercent > 30) {
                healthBar.style.background = 'linear-gradient(90deg, #ffd93d, #ff9500)';
            } else {
                healthBar.style.background = 'linear-gradient(90deg, #ff4444, #cc0000)';
            }
        }
        if (healthContainer) {
            healthContainer.setAttribute('aria-valuenow', Math.max(0, Math.round(state.health)));
            healthContainer.setAttribute('aria-valuemax', Math.round(state.maxHealth));
        }

        if (healthText) healthText.textContent = Math.max(0, Math.round(state.health));
        if (currentAmmoEl) {
            currentAmmoEl.textContent = state.ammo;
            currentAmmoEl.style.color = state.ammo <= getLowAmmoThreshold() ? '#ff4d5a' : '#2bd4c9';
        }
        if (totalAmmoEl) totalAmmoEl.textContent = state.reserveAmmo;
        if (scoreEl) scoreEl.textContent = state.score;
        if (waveEl) waveEl.textContent = state.wave;
        if (dom.enemyCountEl) dom.enemyCountEl.textContent = callbacks?.getEnemyCount?.() ?? 0;
        const weapon = callbacks?.getWeapon?.();
        if (dom.weaponNameEl && weapon) {
            dom.weaponNameEl.textContent = weapon.name;
        }
        updateCredits();
        if (dom.ammoFill) {
            const ammoPercent = state.maxAmmo > 0 ? (state.ammo / state.maxAmmo) * 100 : 0;
            dom.ammoFill.style.width = `${Math.max(0, Math.min(100, ammoPercent))}%`;
        }
        if (ammoBar) {
            ammoBar.setAttribute('aria-valuenow', Math.max(0, Math.round((state.ammo / state.maxAmmo) * 100)));
            ammoBar.setAttribute('aria-valuemax', 100);
        }
        if (dom.chipBuy) {
            const canBuy = state.phase === GamePhase.PLAYING
                && state.score >= 100
                && state.reserveAmmo < (weapon ? weapon.reserveMax : 0);
            dom.chipBuy.classList.toggle('active', canBuy);
        }

        if (dom.lowHealthVignette) {
            const ratio = state.maxHealth > 0 ? state.health / state.maxHealth : 0;
            const intensity = Math.max(0, (0.35 - ratio) / 0.35);
            dom.lowHealthVignette.style.opacity = (intensity * 0.6).toFixed(2);
        }

        if (state.phase === GamePhase.PLAYING && weapon && !weapon.isReloading && state.ammo <= getLowAmmoThreshold()) {
            const now = Date.now();
            if (now > lowAmmoPromptCooldown) {
                const message = state.reserveAmmo > 0 ? 'Low ammo - press R to reload' : 'Out of ammo - keep moving';
                showPrompt(message, 2000);
                lowAmmoPromptCooldown = now + 5000;
            }
        }
    }

    function showPrompt(message, duration = 1600) {
        if (!dom.interactionPrompt) return;
        dom.interactionPrompt.textContent = message;
        dom.interactionPrompt.classList.remove('hidden');
        if (promptHideTimeout) {
            clearTimeout(promptHideTimeout);
        }
        promptHideTimeout = setTimeout(() => {
            dom.interactionPrompt.classList.add('hidden');
        }, duration);
    }

    function clearPrompts() {
        promptTimeouts.forEach((timeout) => clearTimeout(timeout));
        promptTimeouts = [];
        if (promptHideTimeout) {
            clearTimeout(promptHideTimeout);
            promptHideTimeout = null;
        }
        if (dom.interactionPrompt) {
            dom.interactionPrompt.classList.add('hidden');
        }
    }

    function queueTutorialPrompts() {
        clearPrompts();
        const steps = [
            { text: 'WASD to move', delay: 600 },
            { text: 'Move mouse to aim', delay: 2000 },
            { text: 'Left click to shoot', delay: 3400 },
            { text: 'Press R to reload', delay: 5200 }
        ];

        steps.forEach((step) => {
            const timeout = setTimeout(() => {
                showPrompt(step.text, 1600);
            }, step.delay);
            promptTimeouts.push(timeout);
        });
    }

    function showDamageDirection(sourcePosition, camera) {
        if (!dom.damageDirection || !camera) return;
        const direction = new THREE.Vector3();
        direction.subVectors(sourcePosition, camera.position);
        direction.y = 0;
        direction.normalize();

        const angle = Math.atan2(direction.x, direction.z);
        const degrees = THREE.MathUtils.radToDeg(angle);
        dom.damageDirection.style.transform = `translate(-50%, -50%) rotate(${degrees}deg)`;
        dom.damageDirection.classList.add('visible');

        if (damageDirectionTimeout) {
            clearTimeout(damageDirectionTimeout);
        }
        damageDirectionTimeout = setTimeout(() => {
            dom.damageDirection.classList.remove('visible');
        }, 500);
    }

    function showMuzzleFlash(weaponMesh) {
        if (dom.muzzleFlash) {
            dom.muzzleFlash.style.opacity = '1';
            dom.muzzleFlash.style.background = 'radial-gradient(circle, rgba(255,150,50,0.6) 0%, transparent 60%)';
            setTimeout(() => {
                dom.muzzleFlash.style.opacity = '0';
            }, 80);
        }

        if (weaponMesh) {
            const barrel = weaponMesh.getObjectByName('barrel');
            if (barrel && barrel.material) {
                barrel.material.emissive = new THREE.Color(0xffaa00);
                barrel.material.emissiveIntensity = 2;
                setTimeout(() => {
                    barrel.material.emissive = new THREE.Color(0x000000);
                    barrel.material.emissiveIntensity = 0;
                }, 50);
            }
        }
    }

    function showHitMarker() {
        const marker = document.createElement('div');
        marker.className = 'hit-marker';
        marker.style.left = '50%';
        marker.style.top = '50%';
        marker.style.transform = 'translate(-50%, -50%) rotate(45deg)';
        document.body.appendChild(marker);

        setTimeout(() => marker.remove(), 150);
    }

    function renderUpgradeOptions(options, onSelect) {
        if (!dom.upgradeOptionsEl) return;
        dom.upgradeOptionsEl.innerHTML = '';

        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'upgrade-option';
            button.type = 'button';
            button.dataset.index = index.toString();
            button.innerHTML = `
                <div class="upgrade-title">${option.title}</div>
                <div class="upgrade-desc">${option.description}</div>
                <div class="upgrade-tradeoff">${option.tradeoff}</div>
            `;
            button.addEventListener('click', () => onSelect(index));
            button.addEventListener('pointerenter', () => audio?.playUiSound?.('hover'));
            button.addEventListener('click', () => audio?.playUiSound?.('click'));
            dom.upgradeOptionsEl.appendChild(button);
        });
    }

    function showUpgradeScreen() {
        dom.upgradeScreen?.classList.remove('hidden');
    }

    function hideUpgradeScreen() {
        dom.upgradeScreen?.classList.add('hidden');
    }

    return {
        startLoading,
        finishLoading,
        updateLoadingUI,
        setUiScale,
        adjustUiScale,
        setupUI,
        updateHUD,
        updateCredits,
        renderWeaponOptions,
        renderUpgradeOptions,
        showUpgradeScreen,
        hideUpgradeScreen,
        showPrompt,
        clearPrompts,
        queueTutorialPrompts,
        showDamageDirection,
        showMuzzleFlash,
        showHitMarker
    };
}
