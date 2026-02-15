import { GamePhase, WeaponCatalog } from '../core/config.js';
import { dom } from '../core/dom.js';

export function createWeaponSystem({ state, config, refs, collections, ui, audio, input, entityManager, callbacks }) {
    const weaponInventory = {};
    const weaponModelCache = new Map();
    const weaponModelFolders = {
        pistol: 'assets/Pistols',
        smg: 'assets/SMGs',
        ar: 'assets/AutomaticRifles',
        rifle: 'assets/Rifles',
        shotgun: 'assets/Shotguns'
    };
    const weaponModelTargets = {
        pistol: 0.7,
        smg: 0.9,
        ar: 1.0,
        rifle: 1.2,
        shotgun: 1.1
    };
    const gltfLoader = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
        ? new THREE.GLTFLoader()
        : null;

    function hashString(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function mulberry32(seed) {
        let value = seed >>> 0;
        return () => {
            value += 0x6D2B79F5;
            let t = value;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function getWeaponModelPath(weaponDef) {
        if (!weaponDef?.model) return null;
        const folder = weaponModelFolders[weaponDef.type];
        if (!folder) return null;
        return `${folder}/${weaponDef.model}.glb`;
    }

    function normalizeWeaponModel(model, type) {
        const box = new THREE.Box3().setFromObject(model);
        if (!Number.isFinite(box.min.x)) return;
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const target = weaponModelTargets[type] || 1;
        const scale = target / maxDim;
        model.scale.setScalar(scale);

        const scaledBox = new THREE.Box3().setFromObject(model);
        const center = new THREE.Vector3();
        scaledBox.getCenter(center);
        model.position.sub(center);
    }

    function applyModelToGroup(group, modelScene, weaponDef, modelPath) {
        if (!group || group.userData?.modelPath !== modelPath) return;
        const clone = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(modelScene) : modelScene.clone(true);
        clone.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = !state.lowPowerMode;
                child.receiveShadow = !state.lowPowerMode;
            }
        });
        normalizeWeaponModel(clone, weaponDef.type);
        group.clear();
        group.add(clone);
    }

    function tryLoadExternalModel(weaponDef, group) {
        const modelPath = getWeaponModelPath(weaponDef);
        if (!modelPath || !gltfLoader || !group) return;
        group.userData.modelPath = modelPath;

        const existing = weaponModelCache.get(modelPath);
        if (existing?.status === 'ready' && existing.scene) {
            applyModelToGroup(group, existing.scene, weaponDef, modelPath);
            return;
        }
        if (existing?.status === 'error') {
            return;
        }

        const entry = existing || { status: 'loading', callbacks: [] };
        entry.callbacks.push((scene) => applyModelToGroup(group, scene, weaponDef, modelPath));
        if (!existing) {
            weaponModelCache.set(modelPath, entry);
            gltfLoader.load(
                modelPath,
                (gltf) => {
                    entry.status = 'ready';
                    entry.scene = gltf.scene;
                    const callbacks = entry.callbacks.slice();
                    entry.callbacks.length = 0;
                    callbacks.forEach((cb) => cb(gltf.scene));
                },
                undefined,
                (error) => {
                    entry.status = 'error';
                    entry.error = error;
                    entry.callbacks.length = 0;
                    console.warn(`Weapon model not found: ${modelPath}`);
                }
            );
        }
    }

    function acquireTracer() {
        const pool = collections.tracerPool;
        let tracer = pool.pop();
        if (!tracer) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
            const material = new THREE.LineBasicMaterial({
                color: 0xffffaa,
                transparent: true,
                opacity: 0.9,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            tracer = new THREE.Line(geometry, material);
        }
        tracer.visible = true;
        refs.scene.add(tracer);
        return tracer;
    }

    function releaseTracer(tracer) {
        if (!tracer) return;
        tracer.visible = false;
        refs.scene.remove(tracer);
        collections.tracerPool.push(tracer);
    }

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
        const seed = weaponDef.seed ?? hashString(weaponDef.model || weaponDef.id || weaponDef.name || 'weapon');
        const rng = mulberry32(seed);
        const pick = (min, max) => min + (max - min) * rng();

        const baseHue = (0.05 + rng() * 0.12) % 1;
        const accentHue = (baseHue + 0.45 + rng() * 0.2) % 1;
        const bodyColor = new THREE.Color().setHSL(baseHue, 0.12, 0.18 + rng() * 0.05);
        const accentColor = new THREE.Color().setHSL(accentHue, 0.65, 0.55);

        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: bodyColor,
            metalness: 0.65,
            roughness: 0.35
        });

        const accentMaterial = new THREE.MeshStandardMaterial({
            color: accentColor,
            emissive: accentColor,
            emissiveIntensity: 1.5,
            metalness: 0.5,
            roughness: 0.2
        });

        const darkMaterial = new THREE.MeshStandardMaterial({
            color: 0x1e1e1e,
            metalness: 0.3,
            roughness: 0.6
        });

        const addBox = (name, w, h, d, x, y, z, material, rotation) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
            mesh.position.set(x, y, z);
            if (rotation) {
                mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
            }
            if (name) mesh.name = name;
            weaponGroup.add(mesh);
            return mesh;
        };

        const addCylinderZ = (name, radius, length, x, y, z, material) => {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(x, y, z);
            if (name) mesh.name = name;
            weaponGroup.add(mesh);
            return mesh;
        };

        const type = weaponDef.type || 'rifle';

        if (type === 'pistol') {
            const bodyLength = pick(0.52, 0.68);
            const bodyHeight = pick(0.18, 0.24);
            const bodyWidth = pick(0.22, 0.3);
            addBox('body', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);

            const barrelLength = pick(0.28, 0.42);
            const barrelRadius = pick(0.02, 0.03);
            const barrelZ = -bodyLength / 2 - barrelLength / 2 + 0.05;
            addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, barrelZ, accentMaterial);

            const gripHeight = pick(0.22, 0.3);
            const gripWidth = pick(0.12, 0.16);
            const gripLength = pick(0.12, 0.18);
            addBox('grip', gripWidth, gripHeight, gripLength, 0, -bodyHeight / 2 - gripHeight / 2 + 0.02, bodyLength * 0.18, bodyMaterial);

            addBox(null, gripWidth * 0.9, 0.06, gripLength * 0.6, 0, -bodyHeight / 2 + 0.01, bodyLength * 0.08, darkMaterial);

            if (rng() > 0.4) {
                addBox(null, bodyWidth * 0.7, 0.03, bodyLength * 0.35, 0, bodyHeight / 2 + 0.02, -bodyLength * 0.05, accentMaterial);
            }
            if (rng() > 0.5) {
                addBox(null, bodyWidth * 0.18, 0.05, 0.06, 0, bodyHeight / 2 + 0.03, -bodyLength / 2 + 0.08, accentMaterial);
                addBox(null, bodyWidth * 0.2, 0.06, 0.08, 0, bodyHeight / 2 + 0.03, bodyLength / 2 - 0.1, accentMaterial);
            }
        } else if (type === 'smg') {
            const bodyLength = pick(0.62, 0.82);
            const bodyHeight = pick(0.22, 0.3);
            const bodyWidth = pick(0.28, 0.38);
            addBox('receiver', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);

            const handguardLength = pick(0.2, 0.3);
            addBox('handguard', bodyWidth * 0.9, bodyHeight * 0.8, handguardLength, 0, -0.02, -bodyLength / 2 + handguardLength / 2, darkMaterial);

            const barrelLength = pick(0.35, 0.55);
            const barrelRadius = pick(0.022, 0.03);
            const barrelZ = -bodyLength / 2 - barrelLength / 2 + 0.04;
            addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, barrelZ, accentMaterial);

            const gripHeight = pick(0.2, 0.28);
            const gripWidth = pick(0.12, 0.16);
            const gripLength = pick(0.12, 0.18);
            addBox('grip', gripWidth, gripHeight, gripLength, 0, -bodyHeight / 2 - gripHeight / 2 + 0.01, bodyLength * 0.15, bodyMaterial);

            const magHeight = pick(0.26, 0.38);
            const magWidth = pick(0.14, 0.2);
            const magLength = pick(0.14, 0.22);
            addBox('mag', magWidth, magHeight, magLength, 0, -bodyHeight / 2 - magHeight / 2 + 0.01, bodyLength * 0.05, darkMaterial);

            const stockLength = pick(0.18, 0.3);
            const stockHeight = pick(0.16, 0.22);
            const stockWidth = pick(0.16, 0.22);
            addBox('stock', stockWidth, stockHeight, stockLength, 0, -0.02, bodyLength / 2 + stockLength / 2 - 0.05, bodyMaterial);

            if (rng() > 0.45) {
                addBox(null, bodyWidth * 0.65, 0.04, bodyLength * 0.25, 0, bodyHeight / 2 + 0.02, -bodyLength * 0.05, accentMaterial);
            }
        } else if (type === 'shotgun') {
            const bodyLength = pick(0.72, 0.9);
            const bodyHeight = pick(0.22, 0.3);
            const bodyWidth = pick(0.32, 0.42);
            addBox('receiver', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);

            const barrelLength = pick(0.85, 1.1);
            const barrelRadius = pick(0.03, 0.045);
            const barrelZ = -bodyLength / 2 - barrelLength / 2 + 0.08;
            addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, barrelZ, accentMaterial);

            const pumpLength = pick(0.28, 0.42);
            addBox('pump', bodyWidth * 0.85, bodyHeight * 0.75, pumpLength, 0, -0.04, -bodyLength / 2 + pumpLength / 2 + 0.08, darkMaterial);

            const tubeLength = barrelLength * pick(0.6, 0.8);
            addCylinderZ('tube', barrelRadius * 0.7, tubeLength, 0, -bodyHeight / 2 + 0.05, -bodyLength / 2 - tubeLength / 2 + 0.12, darkMaterial);

            const stockLength = pick(0.35, 0.5);
            const stockHeight = pick(0.22, 0.28);
            const stockWidth = pick(0.22, 0.28);
            addBox('stock', stockWidth, stockHeight, stockLength, 0, -0.02, bodyLength / 2 + stockLength / 2 - 0.05, bodyMaterial);

            if (rng() > 0.5) {
                addBox(null, bodyWidth * 0.15, 0.05, 0.06, 0, bodyHeight / 2 + 0.03, -bodyLength / 2 + 0.1, accentMaterial);
            }
        } else {
            const isAr = type === 'ar';
            const bodyLength = isAr ? pick(0.75, 0.95) : pick(0.85, 1.05);
            const bodyHeight = isAr ? pick(0.24, 0.32) : pick(0.24, 0.34);
            const bodyWidth = isAr ? pick(0.3, 0.4) : pick(0.32, 0.42);
            addBox('receiver', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);

            const handguardLength = isAr ? pick(0.35, 0.55) : pick(0.4, 0.6);
            addBox('handguard', bodyWidth * 0.85, bodyHeight * 0.75, handguardLength, 0, -0.02, -bodyLength / 2 + handguardLength / 2, darkMaterial);

            const barrelLength = isAr ? pick(0.55, 0.8) : pick(0.8, 1.2);
            const barrelRadius = isAr ? pick(0.026, 0.036) : pick(0.03, 0.04);
            const barrelZ = -bodyLength / 2 - barrelLength / 2 + 0.05;
            addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, barrelZ, accentMaterial);

            const gripHeight = pick(0.22, 0.3);
            const gripWidth = pick(0.12, 0.17);
            const gripLength = pick(0.12, 0.2);
            addBox('grip', gripWidth, gripHeight, gripLength, 0, -bodyHeight / 2 - gripHeight / 2 + 0.02, bodyLength * 0.2, bodyMaterial);

            const magHeight = pick(0.26, 0.4);
            const magWidth = pick(0.16, 0.22);
            const magLength = pick(0.16, 0.26);
            addBox('mag', magWidth, magHeight, magLength, 0, -bodyHeight / 2 - magHeight / 2 + 0.02, bodyLength * 0.05, darkMaterial);

            const stockLength = isAr ? pick(0.28, 0.42) : pick(0.35, 0.5);
            const stockHeight = pick(0.22, 0.3);
            const stockWidth = pick(0.22, 0.3);
            addBox('stock', stockWidth, stockHeight, stockLength, 0, -0.02, bodyLength / 2 + stockLength / 2 - 0.05, bodyMaterial);

            if (isAr && rng() > 0.4) {
                addBox(null, bodyWidth * 0.5, 0.05, 0.18, 0, bodyHeight / 2 + 0.03, -bodyLength * 0.1, accentMaterial);
            }

            const scopeChance = isAr ? 0.55 : 0.8;
            if (rng() < scopeChance) {
                const scopeLength = pick(0.22, 0.32);
                const scopeRadius = pick(0.045, 0.06);
                addCylinderZ(null, scopeRadius, scopeLength, 0, bodyHeight / 2 + 0.05, -bodyLength * 0.05, accentMaterial);
                addBox(null, bodyWidth * 0.2, 0.04, scopeLength * 0.8, 0, bodyHeight / 2, -bodyLength * 0.05, darkMaterial);
            } else {
                addBox(null, bodyWidth * 0.15, 0.05, 0.06, 0, bodyHeight / 2 + 0.03, -bodyLength / 2 + 0.08, accentMaterial);
                addBox(null, bodyWidth * 0.2, 0.06, 0.08, 0, bodyHeight / 2 + 0.03, bodyLength / 2 - 0.1, accentMaterial);
            }

            if (rng() > 0.5) {
                addCylinderZ(null, barrelRadius * 1.2, 0.12, 0, 0, barrelZ - barrelLength / 2 - 0.04, accentMaterial);
            }

            if (!isAr && rng() > 0.55) {
                const legHeight = pick(0.12, 0.18);
                const legWidth = 0.04;
                const legLength = 0.14;
                const legZ = barrelZ - barrelLength * 0.35;
                addBox(null, legWidth, legHeight, legLength, -0.08, -bodyHeight / 2 - legHeight / 2, legZ, darkMaterial, { x: 0.25 });
                addBox(null, legWidth, legHeight, legLength, 0.08, -bodyHeight / 2 - legHeight / 2, legZ, darkMaterial, { x: 0.25 });
            }
        }

        weaponGroup.scale.set(1.2, 1.2, 1.2);
        weaponGroup.position.set(0.3, -0.3, -0.5);
        tryLoadExternalModel(weaponDef, weaponGroup);
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

        const line = acquireTracer();
        const positions = line.geometry.attributes.position.array;
        positions[0] = startPoint.x;
        positions[1] = startPoint.y;
        positions[2] = startPoint.z;
        positions[3] = endPoint.x;
        positions[4] = endPoint.y;
        positions[5] = endPoint.z;
        line.geometry.attributes.position.needsUpdate = true;
        line.geometry.computeBoundingSphere();

        setTimeout(() => {
            releaseTracer(line);
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
        const defaultWeapon = WeaponCatalog.find((item) => item.id === state.currentWeaponId)
            || WeaponCatalog.find((item) => item.type === 'ar')
            || WeaponCatalog.find((item) => item.type === 'rifle')
            || WeaponCatalog[0];
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
