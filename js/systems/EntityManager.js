import { GamePhase } from '../core/config.js';

export function createEntityManager({ state, config, refs, collections, ui, audio, callbacks }) {
    function loadEnemyModel() {
        if (refs.enemyAnimationsLoaded || refs.enemyLoadFailed) return;
        if (!THREE.GLTFLoader) {
            console.warn('GLTFLoader not available. Falling back to procedural enemies.');
            refs.enemyLoadFailed = true;
            return;
        }

        const loader = new THREE.GLTFLoader();
        loader.load(
            'models/enemy.glb',
            (gltf) => {
                refs.enemyPrototype = gltf.scene;
                refs.enemyPrototype.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = !state.lowPowerMode;
                        child.receiveShadow = !state.lowPowerMode;
                    }
                });
                refs.enemyAnimationClips = {};
                gltf.animations.forEach((clip) => {
                    refs.enemyAnimationClips[clip.name.toLowerCase()] = clip;
                });
                refs.enemyAnimationsLoaded = true;
                console.log('Enemy model loaded with animations:', Object.keys(refs.enemyAnimationClips));
            },
            undefined,
            (error) => {
                console.warn('Failed to load enemy model. Using procedural enemies.', error);
                refs.enemyLoadFailed = true;
            }
        );
    }

    function spawnEnemy() {
        if (!refs.scene) {
            console.error('ERROR: scene is undefined!');
            return;
        }

        try {
            const enemyTypes = [
                { role: 'fast', color: 0xff5d4d, speed: 0.075, health: 70 },
                { role: 'tank', color: 0xffb84d, speed: 0.045, health: 150 },
                { role: 'flanker', color: 0x7ac9ff, speed: 0.06, health: 90, preferredRange: 7 },
                { role: 'exploder', color: 0x7cff7a, speed: 0.055, health: 85 }
            ];

            const roll = Math.random();
            let baseType = enemyTypes[0];
            if (state.wave >= 2) {
                if (roll < 0.45) baseType = enemyTypes[0];
                else if (roll < 0.7) baseType = enemyTypes[1];
                else if (roll < 0.9) baseType = enemyTypes[2];
                else baseType = enemyTypes[3];
            }

            const healthBoost = Math.min(70, state.wave * 6);
            const speedBoost = Math.min(0.035, state.wave * 0.002);

            const enemy = createEnemyInstance(baseType.role, baseType.color);

            const angle = Math.random() * Math.PI * 2;
            const radius = 25 + Math.random() * 30;
            enemy.position.x = refs.camera.position.x + Math.cos(angle) * radius;
            enemy.position.z = refs.camera.position.z + Math.sin(angle) * radius;
            enemy.position.y = baseType.role === 'tank' ? 0.35 : 0.2;
            enemy.castShadow = !state.lowPowerMode;
            enemy.receiveShadow = !state.lowPowerMode;

            refs.scene.add(enemy);
            collections.enemies.push({
                mesh: enemy,
                health: baseType.health + healthBoost,
                speed: baseType.speed + speedBoost,
                lastAttack: 0,
                role: baseType.role,
                preferredRange: baseType.preferredRange || 0,
                orbitDir: Math.random() < 0.5 ? -1 : 1,
                mixer: enemy.userData.mixer || null,
                animations: enemy.userData.animations || null,
                currentAction: null,
                hitTimer: 0,
                isDying: false
            });
            ui.updateHUD();
        } catch (error) {
            console.error('ERROR creating enemy:', error);
        }
    }

    function createEnemyInstance(role, color) {
        if (refs.enemyPrototype && refs.enemyAnimationsLoaded && THREE.SkeletonUtils) {
            const model = THREE.SkeletonUtils.clone(refs.enemyPrototype);
            model.scale.setScalar(role === 'tank' ? 1.15 : role === 'fast' ? 0.95 : 1);
            const mixer = new THREE.AnimationMixer(model);
            const animations = {};
            Object.keys(refs.enemyAnimationClips).forEach((name) => {
                animations[name] = mixer.clipAction(refs.enemyAnimationClips[name]);
            });
            model.userData.mixer = mixer;
            model.userData.animations = animations;
            playAnimation(model.userData, 'idle');
            return model;
        }
        return createEnemyModel(role, color);
    }

    function playAnimation(enemyData, name) {
        if (!enemyData || !enemyData.animations) return;
        const key = name.toLowerCase();
        const action = enemyData.animations[key];
        if (!action) return;

        if (enemyData.currentAction === key) return;
        Object.values(enemyData.animations).forEach((clipAction) => {
            clipAction.stop();
        });
        action.reset().play();
        enemyData.currentAction = key;
    }

    function triggerHitAnimation(enemyData) {
        if (!enemyData || !enemyData.animations || !enemyData.animations.hit) return;
        enemyData.hitTimer = 0.2;
        playAnimation(enemyData, 'hit');
    }

    function scheduleEnemyRemoval(enemy, delay = 900) {
        if (!enemy) return;
        enemy.isDying = true;
        setTimeout(() => {
            if (enemy.mesh) {
                refs.scene.remove(enemy.mesh);
            }
            const idx = collections.enemies.indexOf(enemy);
            if (idx >= 0) {
                collections.enemies.splice(idx, 1);
            }
        }, delay);
    }

    function createEnemyModel(role, color) {
        const group = new THREE.Group();
        const scale = role === 'tank' ? 1.25 : role === 'fast' ? 0.9 : 1;
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.6,
            metalness: 0.2
        });
        const darkMaterial = new THREE.MeshStandardMaterial({
            color: 0x2b2b2b,
            roughness: 0.8,
            metalness: 0.1
        });

        const torso = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 1.8 * scale, 0.8 * scale), bodyMaterial);
        torso.position.y = 1.4 * scale;
        group.add(torso);

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.45 * scale, 10, 10), bodyMaterial);
        head.position.y = 2.6 * scale;
        group.add(head);

        const armGeometry = new THREE.BoxGeometry(0.35 * scale, 1.2 * scale, 0.35 * scale);
        const leftArm = new THREE.Mesh(armGeometry, darkMaterial);
        leftArm.position.set(-0.9 * scale, 1.4 * scale, 0);
        group.add(leftArm);

        const rightArm = new THREE.Mesh(armGeometry, darkMaterial);
        rightArm.position.set(0.9 * scale, 1.4 * scale, 0);
        group.add(rightArm);

        const legGeometry = new THREE.BoxGeometry(0.4 * scale, 1.2 * scale, 0.4 * scale);
        const leftLeg = new THREE.Mesh(legGeometry, darkMaterial);
        leftLeg.position.set(-0.4 * scale, 0.4 * scale, 0);
        group.add(leftLeg);

        const rightLeg = new THREE.Mesh(legGeometry, darkMaterial);
        rightLeg.position.set(0.4 * scale, 0.4 * scale, 0);
        group.add(rightLeg);

        if (role === 'tank') {
            const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.8 * scale, 0.5 * scale, 1.0 * scale), bodyMaterial);
            shoulder.position.y = 2.0 * scale;
            group.add(shoulder);
        }

        if (role === 'exploder') {
            const coreMaterial = new THREE.MeshStandardMaterial({
                color: 0x7cff7a,
                emissive: 0x55ff66,
                emissiveIntensity: 0.9,
                roughness: 0.4,
                metalness: 0.1
            });
            const core = new THREE.Mesh(new THREE.SphereGeometry(0.4 * scale, 10, 10), coreMaterial);
            core.position.set(0, 1.4 * scale, 0.55 * scale);
            group.add(core);
        }

        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = !state.lowPowerMode;
                child.receiveShadow = !state.lowPowerMode;
            }
        });

        return group;
    }

    function killEnemy(index) {
        if (index < 0 || index >= collections.enemies.length) return;

        const enemy = collections.enemies[index];

        if (enemy.role === 'exploder') {
            explodeEnemy(index, true);
            return;
        }

        createDeathEffect(enemy.mesh.position);

        if (enemy.animations && enemy.animations.die) {
            playAnimation(enemy, 'die');
            scheduleEnemyRemoval(enemy, 1000);
        } else {
            refs.scene.remove(enemy.mesh);
            collections.enemies.splice(index, 1);
        }

        state.score += 100;
        callbacks?.onEnemyDrop?.(enemy.mesh.position.clone());
        ui.updateHUD();
        audio?.playUiSound?.('kill');
        callbacks?.onTriggerTimeSlow?.();

        if (collections.enemies.length === 0) {
            state.wave += 1;
            ui.updateHUD();
            setTimeout(() => {
                if (state.phase === GamePhase.PLAYING) {
                    callbacks?.onWaveCleared?.();
                }
            }, 1200);
        }
    }

    function explodeEnemy(index, fromKill = false) {
        if (index < 0 || index >= collections.enemies.length) return;
        const enemy = collections.enemies[index];
        const position = enemy.mesh.position.clone();
        createExplosionEffect(position);
        callbacks?.onEnemyDrop?.(position.clone());
        refs.scene.remove(enemy.mesh);
        collections.enemies.splice(index, 1);

        const distance = refs.camera.position.distanceTo(position);
        if (distance < 6) {
            const intensity = Math.max(0.4, 1 - distance / 6);
            callbacks?.onPlayerDamage?.(Math.round(config.enemyDamage * 2 * intensity), position);
        }

        state.score += fromKill ? 120 : 80;
        ui.updateHUD();
        audio?.playUiSound?.('kill');
        callbacks?.onTriggerTimeSlow?.();

        if (collections.enemies.length === 0) {
            state.wave += 1;
            ui.updateHUD();
            setTimeout(() => {
                if (state.phase === GamePhase.PLAYING) {
                    callbacks?.onWaveCleared?.();
                }
            }, 1200);
        }
    }

    function createDeathEffect(position) {
        const particleCount = state.lowPowerMode ? 10 : 22;
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.1, 4, 4);
            const material = new THREE.MeshBasicMaterial({
                color: 0x8B0000,
                transparent: true
            });
            const particle = new THREE.Mesh(geometry, material);

            particle.position.copy(position);
            particle.position.y += 1;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                Math.random() * 3,
                (Math.random() - 0.5) * 4
            );

            particle.userData = {
                velocity,
                lifetime: 1.3,
                maxLifetime: 1.3
            };

            refs.scene.add(particle);

            if (!window.hitParticles) window.hitParticles = [];
            window.hitParticles.push(particle);
        }
    }

    function createExplosionEffect(position) {
        const particleCount = state.lowPowerMode ? 18 : 32;
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.12, 6, 6);
            const material = new THREE.MeshBasicMaterial({
                color: i % 2 === 0 ? 0xffa500 : 0xff4d4d,
                transparent: true
            });
            const particle = new THREE.Mesh(geometry, material);

            particle.position.copy(position);
            particle.position.y += 1;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 6,
                Math.random() * 5,
                (Math.random() - 0.5) * 6
            );

            particle.userData = {
                velocity,
                lifetime: 1.1,
                maxLifetime: 1.1
            };

            refs.scene.add(particle);

            if (!window.hitParticles) window.hitParticles = [];
            window.hitParticles.push(particle);
        }
    }

    function startWave() {
        callbacks?.onWaveStart?.();
        if (state.phase === GamePhase.CHOOSING) {
            state.phase = GamePhase.PLAYING;
        }
        if (state.phase !== GamePhase.PLAYING) return;
        callbacks?.onRegenerateMap?.();
        const enemyCount = 3 + state.wave * 2;
        for (let i = 0; i < enemyCount; i++) {
            setTimeout(() => spawnEnemy(), i * 500);
        }
        ui.showPrompt(`Wave ${state.wave} incoming`, 1400);
    }

    function updateEnemies(delta) {
        const now = Date.now();

        for (let i = collections.enemies.length - 1; i >= 0; i--) {
            const enemy = collections.enemies[i];

            if (enemy.mixer) {
                enemy.mixer.update(delta);
            }
            if (enemy.isDying) {
                continue;
            }

            if (enemy.hitTimer > 0) {
                enemy.hitTimer -= delta;
                if (enemy.hitTimer <= 0 && enemy.animations) {
                    playAnimation(enemy, 'idle');
                } else {
                    continue;
                }
            }

            const direction = new THREE.Vector3();
            direction.subVectors(refs.camera.position, enemy.mesh.position);
            direction.y = 0;
            const distance = direction.length();
            direction.normalize();

            if (distance > 0.001) {
                // Face the player on the Y axis only.
                enemy.mesh.rotation.y = Math.atan2(direction.x, direction.z);
            }

            const step = enemy.speed * (delta * 60);

            if (enemy.role === 'flanker') {
                const preferred = enemy.preferredRange || 7;
                if (distance > preferred + 1) {
                    enemy.mesh.position.addScaledVector(direction, step);
                    if (enemy.animations) playAnimation(enemy, 'run');
                } else {
                    const tangent = new THREE.Vector3(-direction.z, 0, direction.x)
                        .multiplyScalar(enemy.orbitDir);
                    const drift = direction.clone().multiplyScalar(0.35);
                    const move = tangent.add(drift).normalize();
                    enemy.mesh.position.addScaledVector(move, step);
                    if (enemy.animations) playAnimation(enemy, 'run');
                }
            } else {
                if (distance > 2) {
                    enemy.mesh.position.addScaledVector(direction, step);
                    if (enemy.animations) playAnimation(enemy, 'run');
                } else if (enemy.animations) {
                    playAnimation(enemy, 'attack');
                }
            }

            if (distance < 2.2 && now - enemy.lastAttack > 1100) {
                enemy.lastAttack = now;
                callbacks?.onPlayerDamage?.(config.enemyDamage, enemy.mesh.position);
            }
        }
    }

    function applyDamage(enemyIndex, damage, hitPoint) {
        const enemy = collections.enemies[enemyIndex];
        if (!enemy) return false;
        enemy.health -= damage;
        triggerHitAnimation(enemy);
        createHitEffect(hitPoint);
        if (enemy.health <= 0) {
            killEnemy(enemyIndex);
            return true;
        }
        return false;
    }

    function flashEnemy(enemyMesh) {
        enemyMesh.traverse((child) => {
            if (child.isMesh) {
                if (!child.userData.baseEmissive) {
                    child.userData.baseEmissive = child.material.emissive
                        ? child.material.emissive.clone()
                        : new THREE.Color(0x000000);
                    child.userData.baseEmissiveIntensity = child.material.emissiveIntensity || 0;
                }
                child.material.emissive = new THREE.Color(0xff0000);
                child.material.emissiveIntensity = 0.5;
            }
        });

        setTimeout(() => {
            enemyMesh.traverse((child) => {
                if (child.isMesh) {
                    const baseEmissive = child.userData.baseEmissive || new THREE.Color(0x000000);
                    child.material.emissive = baseEmissive.clone();
                    child.material.emissiveIntensity = child.userData.baseEmissiveIntensity || 0;
                }
            });
        }, 100);
    }

    function createHitEffect(position) {
        const particleCount = state.lowPowerMode ? 10 : 18;
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.06, 6, 6);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffd166,
                transparent: true
            });
            const particle = new THREE.Mesh(geometry, material);

            particle.position.copy(position);
            particle.position.y += 0.2;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 3,
                Math.random() * 2.5,
                (Math.random() - 0.5) * 3
            );

            particle.userData = {
                velocity,
                lifetime: 0.8,
                maxLifetime: 0.8
            };

            refs.scene.add(particle);

            if (!window.hitParticles) window.hitParticles = [];
            window.hitParticles.push(particle);
        }
    }

    return {
        loadEnemyModel,
        spawnEnemy,
        startWave,
        updateEnemies,
        applyDamage,
        flashEnemy,
        getEnemyCount: () => collections.enemies.length
    };
}
