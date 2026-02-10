import { GamePhase, WeaponCatalog } from '../core/config.js';
import { dom } from '../core/dom.js';

export function createWeaponSystem({ state, config, refs, collections, ui, audio, input, entityManager, callbacks }) {
    const weaponInventory = {};

    function createWeapon() {
        refs.weapon = {
            mesh: null,
            damage: config.weaponDamage,
            fireRate: config.weaponFireRate,
            range: config.weaponRange,
            canShoot: true,
            isReloading: false,
            recoil: 0,
            recoilBase: 0.05,
            spread: 0.01,
            pellets: 1,
            name: 'Rifle',
            reserveMax: config.totalAmmo
        };

        initWeaponInventory();
        equipWeapon(state.currentWeaponId, true);
    }

    function initWeaponInventory() {
        WeaponCatalog.forEach((weaponDef) => {
            weaponInventory[weaponDef.id] = {
                ammo: weaponDef.magSize,
                reserve: weaponDef.reserveMax
            };
        });
    }

    function buildWeaponMesh(weaponDef) {
        const weaponGroup = new THREE.Group();

        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            metalness: 0.7,
            roughness: 0.3
        });

        const accentMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ffcc,
            emissive: 0x00aa88,
            emissiveIntensity: 0.4,
            metalness: 0.5,
            roughness: 0.2
        });

        let bodyGeometry;
        let barrelGeometry;
        let gripGeometry;
        let stockGeometry;

        switch (weaponDef.type) {
            case 'pistol':
                bodyGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.6);
                barrelGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.4);
                gripGeometry = new THREE.BoxGeometry(0.15, 0.25, 0.1);
                break;
            case 'shotgun':
                bodyGeometry = new THREE.BoxGeometry(0.4, 0.25, 0.8);
                barrelGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.7);
                stockGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.3);
                break;
            case 'smg':
                bodyGeometry = new THREE.BoxGeometry(0.35, 0.25, 0.7);
                barrelGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.5);
                stockGeometry = new THREE.BoxGeometry(0.2, 0.15, 0.25);
                break;
            case 'rifle':
            default:
                bodyGeometry = new THREE.BoxGeometry(0.4, 0.25, 0.9);
                barrelGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.8);
                stockGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.3);
                break;
        }

        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.set(0, 0, 0);
        weaponGroup.add(body);

        const barrel = new THREE.Mesh(barrelGeometry, accentMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0, -0.6);
        barrel.name = 'barrel';
        weaponGroup.add(barrel);

        if (gripGeometry) {
            const grip = new THREE.Mesh(gripGeometry, bodyMaterial);
            grip.position.set(0, -0.2, 0.15);
            weaponGroup.add(grip);
        }

        if (stockGeometry) {
            const stock = new THREE.Mesh(stockGeometry, bodyMaterial);
            stock.position.set(0, 0, 0.5);
            weaponGroup.add(stock);
        }

        weaponGroup.scale.set(1.2, 1.2, 1.2);
        weaponGroup.position.set(0.3, -0.3, -0.5);
        return weaponGroup;
    }

    function equipWeapon(weaponId, isInitial = false) {
        const weaponDef = WeaponCatalog.find((item) => item.id === weaponId);
        if (!weaponDef) return;

        state.currentWeaponId = weaponId;

        if (refs.weapon.mesh) {
            refs.camera.remove(refs.weapon.mesh);
        }

        const adjustedMag = Math.max(1, Math.round(weaponDef.magSize * state.magSizeMultiplier));
        const adjustedReserve = Math.max(1, Math.round(weaponDef.reserveMax * state.magSizeMultiplier));

        refs.weapon = {
            ...refs.weapon,
            mesh: buildWeaponMesh(weaponDef),
            damage: weaponDef.damage,
            fireRate: weaponDef.fireRate,
            range: weaponDef.range,
            recoilBase: weaponDef.recoil,
            spread: weaponDef.spread,
            pellets: weaponDef.pellets,
            name: weaponDef.name,
            reserveMax: adjustedReserve,
            canShoot: true,
            isReloading: false,
            recoil: 0
        };

        refs.camera.add(refs.weapon.mesh);

        if (!weaponInventory[state.currentWeaponId]) {
            weaponInventory[state.currentWeaponId] = {
                ammo: weaponDef.magSize,
                reserve: weaponDef.reserveMax
            };
        }

        state.maxAmmo = adjustedMag;
        const storedAmmo = weaponInventory[state.currentWeaponId].ammo;
        const storedReserve = weaponInventory[state.currentWeaponId].reserve;
        state.ammo = Math.min(storedAmmo, adjustedMag);
        state.reserveAmmo = Math.min(storedReserve, adjustedReserve);
        syncWeaponInventory();

        if (dom.reloadIndicator) {
            dom.reloadIndicator.classList.add('hidden');
        }
        if (dom.reloadFill) {
            dom.reloadFill.style.width = '0%';
            dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
        }

        if (!isInitial) {
            ui.showPrompt(`Equipped ${weaponDef.name}`, 1400);
        }
        ui.updateHUD();
    }

    function syncWeaponInventory() {
        if (!state.currentWeaponId || !weaponInventory[state.currentWeaponId]) return;
        weaponInventory[state.currentWeaponId].ammo = state.ammo;
        weaponInventory[state.currentWeaponId].reserve = state.reserveAmmo;
    }

    function refreshWeaponStats() {
        if (!refs.weapon || !state.currentWeaponId) return;
        equipWeapon(state.currentWeaponId, true);
    }

    function createBulletTracer() {
        if (state.lowPowerMode) return;
        const startPoint = new THREE.Vector3(0.25, -0.3, -1);
        startPoint.applyMatrix4(refs.camera.matrixWorld);

        const direction = new THREE.Vector3();
        refs.camera.getWorldDirection(direction);
        const raycaster = new THREE.Raycaster(startPoint, direction);
        const obstacleHits = collections.mapObstacles.length
            ? raycaster.intersectObjects(collections.mapObstacles, true)
            : [];
        const maxDistance = obstacleHits.length > 0 ? Math.min(50, obstacleHits[0].distance) : 50;
        const endPoint = startPoint.clone().add(direction.multiplyScalar(maxDistance));

        const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
        const material = new THREE.LineBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8
        });

        const line = new THREE.Line(geometry, material);
        refs.scene.add(line);

        setTimeout(() => {
            refs.scene.remove(line);
            geometry.dispose();
            material.dispose();
        }, 50);
    }

    function shoot() {
        if (!refs.weapon.canShoot || refs.weapon.isReloading) return;
        if (state.ammo <= 0) {
            ui.showPrompt(state.reserveAmmo > 0 ? 'Reload needed' : 'Out of ammo', 1200);
            audio?.playUiSound?.('click');
            return;
        }

        refs.weapon.canShoot = false;
        state.ammo--;
        syncWeaponInventory();
        ui.updateHUD();

        audio?.playShootSound?.();
        callbacks?.onAddCameraShake?.(config.cameraShakeShoot);

        ui.showMuzzleFlash(refs.weapon.mesh);

        refs.weapon.recoil = refs.weapon.recoilBase;
        refs.player.pitch += refs.weapon.recoil;

        createBulletTracer();

        const raycaster = new THREE.Raycaster();
        const pellets = refs.weapon.pellets || 1;
        let hitEnemy = false;
        let killedEnemy = false;

        for (let p = 0; p < pellets; p++) {
            const spreadX = (Math.random() - 0.5) * refs.weapon.spread;
            const spreadY = (Math.random() - 0.5) * refs.weapon.spread;
            raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), refs.camera);

            const obstacleHits = collections.mapObstacles.length
                ? raycaster.intersectObjects(collections.mapObstacles, true)
                : [];
            const obstacleDistance = obstacleHits.length > 0 ? obstacleHits[0].distance : Infinity;

            let closestHit = null;
            let closestEnemyIndex = -1;

            for (let i = collections.enemies.length - 1; i >= 0; i--) {
                const enemy = collections.enemies[i];
                const intersects = raycaster.intersectObject(enemy.mesh, true);
                if (intersects.length > 0) {
                    const hit = intersects[0];
                    if (hit.distance <= refs.weapon.range &&
                        hit.distance < obstacleDistance &&
                        (!closestHit || hit.distance < closestHit.distance)) {
                        closestHit = hit;
                        closestEnemyIndex = i;
                    }
                }
            }

            if (closestHit && closestEnemyIndex >= 0) {
                const enemy = collections.enemies[closestEnemyIndex];
                const damage = refs.weapon.damage * state.damageMultiplier;
                entityManager.flashEnemy(enemy.mesh);
                ui.showHitMarker();
                const killed = entityManager.applyDamage(closestEnemyIndex, damage, closestHit.point);
                if (killed) {
                    killedEnemy = true;
                }
                hitEnemy = true;
            }
        }
        if (hitEnemy) {
            audio?.playUiSound?.('hit');
            callbacks?.onAddCameraShake?.(config.cameraShakeHit);
            callbacks?.onHitStop?.(killedEnemy ? config.hitStopKillMultiplier : config.hitStopHitMultiplier);
        }

        setTimeout(() => {
            refs.weapon.canShoot = true;
        }, refs.weapon.fireRate);
    }

    function reload() {
        if (state.phase !== GamePhase.PLAYING) return;
        if (refs.weapon.isReloading) {
            attemptPerfectReload();
            return;
        }
        if (state.ammo >= state.maxAmmo || state.reserveAmmo <= 0) return;

        refs.weapon.isReloading = true;
        state.reloadStartTime = performance.now();
        state.reloadDurationCurrent = config.reloadDuration * state.reloadSpeedMultiplier;
        const isSprinting = input.keys.shift && refs.player.velocity.length() > 0;
        if (isSprinting) {
            state.reloadDurationCurrent *= config.reloadSprintMultiplier;
        }

        state.ammo = 0;
        syncWeaponInventory();
        ui.updateHUD();

        if (dom.reloadIndicator) {
            dom.reloadIndicator.classList.remove('hidden');
        }
        if (dom.reloadFill) {
            dom.reloadFill.style.width = '0%';
            dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
        }
        if (dom.chipReload) {
            dom.chipReload.classList.add('active');
        }
        audio?.playUiSound?.('reload');

        if (refs.weapon.mesh) {
            refs.weapon.mesh.rotation.x = 0.8;
            refs.weapon.mesh.position.z = -0.2;
        }

        setTimeout(() => finishReload(false), state.reloadDurationCurrent);
    }

    function finishReload(isPerfect) {
        if (!refs.weapon.isReloading) return;

        refs.weapon.isReloading = false;
        const reloadAmount = state.maxAmmo - state.ammo;
        const actualReload = Math.min(reloadAmount, state.reserveAmmo);
        state.ammo += actualReload;
        state.reserveAmmo -= actualReload;

        if (isPerfect) {
            const bonusAmmo = Math.min(state.maxAmmo - state.ammo, config.perfectReloadBonus);
            state.ammo += bonusAmmo;
        }

        syncWeaponInventory();
        ui.updateHUD();

        if (dom.reloadIndicator) {
            dom.reloadIndicator.classList.add('hidden');
        }
        if (dom.chipReload) {
            dom.chipReload.classList.remove('active');
        }
        if (dom.reloadFill) {
            dom.reloadFill.style.width = '0%';
            dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
        }
        if (refs.weapon.mesh) {
            refs.weapon.mesh.rotation.x = 0;
            refs.weapon.mesh.position.z = -0.4;
        }
    }

    function attemptPerfectReload() {
        const elapsed = (performance.now() - state.reloadStartTime) / state.reloadDurationCurrent;
        if (Math.abs(elapsed - 0.5) <= config.perfectReloadWindow) {
            finishReload(true);
            audio?.playUiSound?.('perfect');
            ui.showPrompt('Perfect Reload!', 1000);
        }
    }

    function cancelReload() {
        if (!refs.weapon.isReloading) return;
        refs.weapon.isReloading = false;
        if (dom.reloadIndicator) {
            dom.reloadIndicator.classList.add('hidden');
        }
        if (dom.reloadFill) {
            dom.reloadFill.style.width = '0%';
            dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
        }
        if (dom.chipReload) {
            dom.chipReload.classList.remove('active');
        }
        if (refs.weapon.mesh) {
            refs.weapon.mesh.rotation.x = 0;
            refs.weapon.mesh.position.z = -0.4;
        }
        ui.showPrompt('Reload canceled', 1000);
    }

    function updateReloadIndicator() {
        if (!refs.weapon.isReloading || !dom.reloadFill) return;
        const elapsed = performance.now() - state.reloadStartTime;
        const progress = Math.min(1, elapsed / state.reloadDurationCurrent);
        dom.reloadFill.style.width = `${Math.round(progress * 100)}%`;

        if (Math.abs(progress - 0.5) <= config.perfectReloadWindow) {
            dom.reloadFill.style.background = 'linear-gradient(90deg, #6bff9c, #43d96a)';
        } else {
            dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
        }
    }

    function resetWeaponState() {
        Object.keys(weaponInventory).forEach((key) => delete weaponInventory[key]);
        initWeaponInventory();
        const defaultWeapon = WeaponCatalog.find((item) => item.type === 'rifle') || WeaponCatalog[0];
        if (defaultWeapon) {
            state.currentWeaponId = defaultWeapon.id;
            if (refs.weapon?.mesh) {
                refs.camera.remove(refs.weapon.mesh);
            }
            equipWeapon(state.currentWeaponId, true);
        }
    }

    return {
        createWeapon,
        equipWeapon,
        refreshWeaponStats,
        syncWeaponInventory,
        shoot,
        reload,
        cancelReload,
        updateReloadIndicator,
        resetWeaponState,
        getWeapon: () => refs.weapon,
        getWeaponInventory: () => weaponInventory
    };
}
