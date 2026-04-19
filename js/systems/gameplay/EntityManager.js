import { GamePhase } from '../../core/config.js';
import { EnemyArchetypes } from '../../core/archetypes.js';
import { AuthSystem } from '../network/AuthSystem.js';

export function createEntityManager({ state, config, refs, collections, ui, audio, collisionSystem, callbacks }) {

    const MAX_ENEMIES = 25;
    const CULL_DISTANCE = 60;
    const enemyPool = { normal: [], flanker: [], exploder: [] };
    const navigation = {
        pathfinding: null,
        zoneId: null
    };

    // INSTANCED RENDERING SETUP
    const INSTANCE_MAX = 250;
    let _instanceManager = null;

    // Optimization: Pre-allocate reusable objects to prevent GC lag in update loop
    const _tempPlayerPos = new THREE.Vector3();
    const _tempEnemyPos = new THREE.Vector3();
    const _tempDirection = new THREE.Vector3();
    const _tempMoveDir = new THREE.Vector3();
    const _tempTangent = new THREE.Vector3();
    const waveState = {
        spawnTimers: new Set(),
        clearTimer: null,
        pendingSpawns: 0,
        spawnedCount: 0,
        emergencySpawnAttempts: 0,
        token: 0,
        active: false,
        spawnMix: { normal: 1, flanker: 0, exploder: 0 }
    };
    const particleGeometries = {
        hit: new THREE.SphereGeometry(0.06, 6, 6),
        death: new THREE.SphereGeometry(0.1, 4, 4),
        explosion: new THREE.SphereGeometry(0.12, 6, 6)
    };
    const particleColors = {
        hit: 0xffd166,
        death: 0x8B0000,
        explosion: [0xffa500, 0xff4d4d]
    };

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function getEnemyArchetype(role) {
        return EnemyArchetypes[role] || EnemyArchetypes.normal;
    }

    function getWaveSpawnMix(wave) {
        if (wave <= 2) {
            return { normal: 1, flanker: 0, exploder: 0 };
        }
        if (wave <= 4) {
            return { normal: 0.8, flanker: 0.2, exploder: 0 };
        }
        const flanker = Math.min(0.45, 0.2 + (wave - 4) * 0.03);
        const exploder = Math.min(0.25, 0.15 + (wave - 5) * 0.02);
        const normal = Math.max(0.15, 1 - flanker - exploder);
        const total = normal + flanker + exploder;
        return {
            normal: normal / total,
            flanker: flanker / total,
            exploder: exploder / total
        };
    }

    function pickArchetypeFromMix(mix) {
        const roll = Math.random();
        if (roll < mix.flanker) return 'flanker';
        if (roll < mix.flanker + mix.exploder) return 'exploder';
        return 'normal';
    }

    function applyArchetypeVisuals(mesh, role) {
        if (!mesh) return;
        mesh.userData.archetypeRole = role;
        mesh.userData.baseScale = mesh.scale.clone();

        mesh.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat) => mat.clone());
            } else {
                child.material = child.material.clone();
            }
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (!material) return;
                if (material.color) {
                    if (role === 'flanker') {
                        material.color.lerp(new THREE.Color(0x6aa8ff), 0.45);
                    } else if (role === 'exploder') {
                        material.color.lerp(new THREE.Color(0xff7f7f), 0.35);
                    }
                }
                if (material.emissive) {
                    child.userData.baseEmissive = material.emissive.clone();
                    child.userData.baseEmissiveIntensity = material.emissiveIntensity || 0;
                    if (role === 'exploder') {
                        material.emissive.setHex(0x330000);
                        material.emissiveIntensity = Math.max(0.2, material.emissiveIntensity || 0.2);
                    }
                }
            });
        });
    }

    function setFlankerLean(enemy, target, delta) {
        const leanLerp = Math.min(1, delta * 10);
        enemy.lean = (enemy.lean || 0) + (target - (enemy.lean || 0)) * leanLerp;
    }

    function updateExploderFuseVisual(enemy, progress) {
        // Handled in InstancedMesh logic
    }

    function resetExploderVisual(enemy) {
        // Redundant with InstancedMesh; reset via instance logic
    }

    function clearWaveTimers() {
        waveState.spawnTimers.forEach((timerId) => clearTimeout(timerId));
        waveState.spawnTimers.clear();
        if (waveState.clearTimer) {
            clearTimeout(waveState.clearTimer);
            waveState.clearTimer = null;
        }
        waveState.pendingSpawns = 0;
        waveState.spawnedCount = 0;
        waveState.emergencySpawnAttempts = 0;
        waveState.active = false;
        waveState.spawnMix = { normal: 1, flanker: 0, exploder: 0 };
        waveState.token += 1;
    }

    function maybeCompleteWave() {
        if (!waveState.active) return;
        if (waveState.pendingSpawns > 0) return;
        if (collections.enemies.length > 0) return;

        // EMERGENCY SPAWN: If everything cleared but we never spawned anything (failsafe)
        if (waveState.spawnedCount <= 0) {
            if (waveState.emergencySpawnAttempts >= 3 || state.phase !== GamePhase.PLAYING) {
                // Total failure to spawn, forced clear to prevent hang
                waveState.active = false;
                state.wave += 1;
                ui.updateHUD();
                callbacks?.onWaveCleared?.();
                return;
            }
            
            waveState.emergencySpawnAttempts += 1;
            waveState.pendingSpawns += 1;
            const token = waveState.token;
            
            const timerId = setTimeout(() => {
                waveState.spawnTimers.delete(timerId);
                if (token !== waveState.token) return;
                try {
                    if (spawnEnemy('normal')) {
                        waveState.spawnedCount += 1;
                    }
                } catch (e) {
                    console.warn('Emergency spawn error:', e);
                } finally {
                    waveState.pendingSpawns = Math.max(0, waveState.pendingSpawns - 1);
                    // Single-tick delay recursion for safety
                    requestAnimationFrame(() => maybeCompleteWave());
                }
            }, 500); // Slower retry
            waveState.spawnTimers.add(timerId);
            return;
        }

        // Normal wave completion logic
        waveState.active = false;
        state.wave += 1;
        ui.updateHUD();

        if (waveState.clearTimer) {
            clearTimeout(waveState.clearTimer);
        }
        waveState.clearTimer = setTimeout(() => {
            waveState.clearTimer = null;
            if (state.phase === GamePhase.PLAYING) {
                callbacks?.onWaveCleared?.();
            }
        }, 1200);
    }

    function acquireParticle(type) {
        const pool = collections.particlePools[type];
        let particle = pool.pop();
        if (!particle) {
            const material = new THREE.MeshBasicMaterial({
                color: particleColors[type] instanceof Array ? particleColors[type][0] : particleColors[type],
                transparent: true
            });
            particle = new THREE.Mesh(particleGeometries[type], material);
            particle.userData.poolType = type;
        }
        particle.material.opacity = 1;
        particle.visible = true;
        return particle;
    }

    function getPhysics() {
        return refs.physics;
    }

    function areCollidersOverlapping(world, colliderA, colliderB) {
        return collisionSystem.areCollidersOverlapping(world, colliderA, colliderB);
    }
    
    function getColliderHandle(collider) {
        return collisionSystem.getColliderHandle(collider);
    }

    function createEnemyBody(enemy, role) {
        const physics = getPhysics();
        if (!physics?.world || !physics?.rapier) return null;
        const R = physics.rapier;
        const radius = getEnemyRadius(role);
        const height = getEnemyHeight(role);
        const halfHeight = Math.max(0.2, (height * 0.5) - radius);
        const bodyDesc = R.RigidBodyDesc.dynamic()
            .setTranslation(enemy.position.x, enemy.position.y, enemy.position.z)
            .setLinearDamping(8)
            .setAngularDamping(10);
        if (bodyDesc.lockRotations) {
            bodyDesc.lockRotations();
        }
        const body = physics.world.createRigidBody(bodyDesc);
        const colliderDesc = R.ColliderDesc.capsule(halfHeight, radius)
            .setFriction(1.2)
            .setRestitution(0);
        const collider = physics.world.createCollider(colliderDesc, body);
        return { body, collider };
    }

    function removeEnemyPhysics(enemy) {
        const physics = getPhysics();
        if (physics?.world) {
            const colliderHandle = getColliderHandle(enemy?.collider);
            try {
                if (colliderHandle != null) {
                    physics.world.removeCollider(colliderHandle, true);
                }
            } catch (error) {
                // Ignore removal errors to keep the loop alive.
            }
            if (enemy?.body) {
                const bodyHandle = typeof enemy.body === 'number' ? enemy.body : enemy.body.handle;
                try {
                    if (bodyHandle != null) {
                        physics.world.removeRigidBody(bodyHandle);
                    }
                } catch (error) {
                    // Ignore removal errors to keep the loop alive.
                }
            }
        }
        enemy.collider = null;
        enemy.body = null;
    }

    function attachShield(enemyMesh) {
        if (!enemyMesh || !refs.shieldUniforms) return;
        const box = new THREE.Box3().setFromObject(enemyMesh);
        const size = new THREE.Vector3();
        box.getSize(size);
        const radius = Math.max(size.x, size.z) * 0.6;
        const height = Math.max(1, size.y);
        const geometry = new THREE.SphereGeometry(1, 18, 18);
        const material = new THREE.ShaderMaterial({
            uniforms: refs.shieldUniforms,
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vWorldPos;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                varying vec3 vNormal;
                varying vec3 vWorldPos;
                void main() {
                    float fresnel = pow(1.0 - abs(vNormal.z), 2.2);
                    float scan = sin((vWorldPos.y + uTime * 2.4) * 6.0) * 0.5 + 0.5;
                    float pulse = sin(uTime * 4.0) * 0.5 + 0.5;
                    float alpha = 0.15 + 0.35 * scan + 0.25 * pulse + 0.4 * fresnel;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const shield = new THREE.Mesh(geometry, material);
        shield.scale.set(radius, height * 0.55, radius);
        shield.position.copy(box.getCenter(new THREE.Vector3()));
        shield.renderOrder = 2;
        enemyMesh.add(shield);
        enemyMesh.userData.shield = shield;
    }

    function setNavigation(pathfinding, zoneId) {
        navigation.pathfinding = pathfinding;
        navigation.zoneId = zoneId;
    }

    function initInstanceManager() {
        if (_instanceManager) return;
        
        
        
        const instancedMeshes = {};
        const slots = new Uint8Array(INSTANCE_MAX); // 0 = free, 1 = occupied
        
        // Parts: torso, head, eyeL, eyeR, armL, armR, legL, legR, core (exploder only)
        const parts = [
            { name: 'torso', geo: new THREE.BoxGeometry(1.4, 1.8, 0.8), matType: 'body' },
            { name: 'head', geo: new THREE.SphereGeometry(0.45, 10, 10), matType: 'body' },
            { name: 'eyeL', geo: new THREE.SphereGeometry(0.08, 8, 8), matType: 'eye' },
            { name: 'eyeR', geo: new THREE.SphereGeometry(0.08, 8, 8), matType: 'eye' },
            { name: 'armL', geo: new THREE.BoxGeometry(0.35, 1.2, 0.35), matType: 'dark' },
            { name: 'armR', geo: new THREE.BoxGeometry(0.35, 1.2, 0.35), matType: 'dark' },
            { name: 'legL', geo: new THREE.BoxGeometry(0.4, 1.2, 0.4), matType: 'dark' },
            { name: 'legR', geo: new THREE.BoxGeometry(0.4, 1.2, 0.4), matType: 'dark' },
            { name: 'core', geo: new THREE.SphereGeometry(0.4, 10, 10), matType: 'core' }
        ];

        const materials = {
            body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4 }),
            eye: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0 }),
            dark: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.8, metalness: 0.1 }),
            core: new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff0000, emissiveIntensity: 2.5 })
        };

        parts.forEach(part => {
            const mat = materials[part.matType];
            const imesh = new THREE.InstancedMesh(part.geo, mat, INSTANCE_MAX);
            imesh.castShadow = !state.lowPowerMode;
            imesh.receiveShadow = !state.lowPowerMode;
            // Initialize with zero scale
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            for (let i = 0; i < INSTANCE_MAX; i++) {
                imesh.setMatrixAt(i, dummy.matrix);
            }
            imesh.instanceMatrix.needsUpdate = true;
            refs.scene.add(imesh);
            instancedMeshes[part.name] = imesh;
        });

        _instanceManager = {
            instancedMeshes,
            slots,
            allocateSlot() {
                for (let i = 0; i < INSTANCE_MAX; i++) {
                    if (slots[i] === 0) {
                        slots[i] = 1;
                        return i;
                    }
                }
                return -1;
            },
            freeSlot(id) {
                if (id >= 0 && id < INSTANCE_MAX) {
                    slots[id] = 0;
                    const dummy = new THREE.Object3D();
                    dummy.scale.set(0, 0, 0);
                    dummy.updateMatrix();
                    Object.values(instancedMeshes).forEach(imesh => {
                        imesh.setMatrixAt(id, dummy.matrix);
                        imesh.instanceMatrix.needsUpdate = true;
                    });
                }
            }
        };
    }
    function loadEnemyModel() {
        // Disabled by user request: Do not use zombies.glb file and reset to procedural enemies
        refs.enemyLoadFailed = true;
        console.warn('Skipping zombie.glb loading. Falling back to procedural enemies.');
    }

    function spawnEnemy(roleOverride = null) {
        if (!refs.scene) {
            return false;
        }
        initInstanceManager();
        
        if (collections.enemies.length >= MAX_ENEMIES) {
            waveState.pendingSpawns++;
            return false;
        }

        try {
            const role = roleOverride || pickArchetypeFromMix(waveState.spawnMix || getWaveSpawnMix(state.wave));
            const archetype = getEnemyArchetype(role);
            const instanceId = _instanceManager.allocateSlot();
            if (instanceId === -1) {
                return false;
            }
            const healthBoost = Math.min(65, state.wave * 6);
            const speedBoost = Math.min(0.028, state.wave * 0.0018);
            const waveHealthScale = role === 'exploder' ? 0.65 : 1;
            const waveSpeedScale = role === 'exploder' ? 0.6 : 1;

            const angle = Math.random() * Math.PI * 2;
            const radius = 25 + Math.random() * 30;
            const spawnX = refs.camera.position.x + Math.cos(angle) * radius;
            const spawnZ = refs.camera.position.z + Math.sin(angle) * radius;
            const spawnY = 0.2;

            const enemyData = {
                instanceId,
                role,
                archetype,
                position: new THREE.Vector3(spawnX, spawnY, spawnZ),
                rotation: 0,
                health: Math.round(archetype.health + healthBoost * waveHealthScale),
                speed: archetype.speed + speedBoost * waveSpeedScale,
                lastAttack: 0,
                aiState: 'chase',
                strafeDir: Math.random() < 0.5 ? -1 : 1,
                strafeSwitchTimer: randomBetween(1.5, 3),
                closeBurstTimer: 0,
                closeBurstCooldown: randomBetween(0.5, 1.2),
                fuseTimer: 0,
                fuseElapsed: 0,
                hitTimer: 0,
                isDying: false,
                body: null,
                collider: null
            };

            const physicsData = createEnemyBody(enemyData, role);
            enemyData.body = physicsData?.body || null;
            enemyData.collider = physicsData?.collider || null;

            collections.enemies.push(enemyData);
            
            if (collisionSystem?.rebuildEnemySpatialGrid) {
                collisionSystem.rebuildEnemySpatialGrid();
            }
            
            ui.updateHUD();
            return true;
        } catch (error) {
            console.error('ERROR creating enemy:', error);
            return false;
        }
    }

    function createEnemyInstance(role, color) {
        return null; // Deprecated
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
            removeEnemyPhysics(enemy);
            const idx = collections.enemies.indexOf(enemy);
            if (idx >= 0) {
                collections.enemies.splice(idx, 1);
                if (collisionSystem?.rebuildEnemySpatialGrid) {
                    collisionSystem.rebuildEnemySpatialGrid();
                }
            }
            ui.updateHUD();
            maybeCompleteWave();
        }, delay);
    }

    function createEnemyModel(role, color) {
        const archetype = getEnemyArchetype(role);
        const group = new THREE.Group();
        const scale = archetype.scale || 1;
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
            metalness: 0.4,
            emissive: color,
            emissiveIntensity: 0.25
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

        // Glowing Eyes
        const eyeGeometry = new THREE.SphereGeometry(0.08 * scale, 8, 8);
        const eyeMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 2.0
        });
        
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.18 * scale, 2.7 * scale, 0.35 * scale);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.18 * scale, 2.7 * scale, 0.35 * scale);
        group.add(rightEye);

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

        if (role === 'exploder') {
            const coreMaterial = new THREE.MeshStandardMaterial({
                color: 0xff3333,
                emissive: 0xff0000,
                emissiveIntensity: 2.5,  // Dramatic bloom
                roughness: 0.2,
                metalness: 0.8
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
        if (!enemy || enemy.isDying) return;
        const archetype = enemy.archetype || getEnemyArchetype(enemy.role);

        createDeathEffect(enemy.position);
        _instanceManager.freeSlot(enemy.instanceId);
        removeEnemyPhysics(enemy);
        collections.enemies.splice(index, 1);
        
        if (collisionSystem?.rebuildEnemySpatialGrid) {
            collisionSystem.rebuildEnemySpatialGrid();
        }

        state.score += archetype.score || 100;
        if (state.activeMatchId) AuthSystem.recordKill(state.activeMatchId, enemy.role);

        callbacks?.onEnemyDrop?.(enemy.position.clone());
        ui.updateHUD();
        audio?.playUiSound?.('kill');
        audio?.playPositionalSound?.('kill', enemy.position);
        callbacks?.onTriggerTimeSlow?.();
        maybeCompleteWave();
    }

    function detonateExploder(index, fromKill = false) {
        if (index < 0 || index >= collections.enemies.length) return;
        const enemy = collections.enemies[index];
        if (!enemy || enemy.isDying) return;
        enemy.isDying = true;
        const archetype = enemy.archetype || getEnemyArchetype('exploder');
        const position = enemy.position.clone();
        createExplosionEffect(position);
        if (fromKill) {
            callbacks?.onEnemyDrop?.(position.clone());
        }
        _instanceManager.freeSlot(enemy.instanceId);
        removeEnemyPhysics(enemy);
        collections.enemies.splice(index, 1);
        if (collisionSystem?.rebuildEnemySpatialGrid) {
            collisionSystem.rebuildEnemySpatialGrid();
        }

        const blastRadius = archetype.blastRadius || 6;
        const distance = refs.camera.position.distanceTo(position);
        if (distance < blastRadius) {
            const falloff = Math.max(0.2, 1 - (distance / blastRadius));
            const damage = Math.round(config.enemyDamage * (archetype.blastDamageMultiplier || 2.4) * falloff);
            callbacks?.onPlayerDamage?.(damage, position);
        }

        if (!fromKill) {
            state.score += Math.max(25, Math.round((archetype.score || 90) * 0.5));
            if (state.activeMatchId) AuthSystem.recordKill(state.activeMatchId, enemy.role);
        }
        ui.updateHUD();
        audio?.playUiSound?.('damage');
        audio?.playPositionalSound?.('explosion', position);
        maybeCompleteWave();
    }

    function createDeathEffect(position) {
        const particleCount = state.lowPowerMode ? 10 : 22;
        for (let i = 0; i < particleCount; i++) {
            const particle = acquireParticle('death');

            particle.position.copy(position);
            particle.position.y += 1;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                Math.random() * 3,
                (Math.random() - 0.5) * 4
            );

            particle.userData.velocity = velocity;
            particle.userData.lifetime = 1.3;
            particle.userData.maxLifetime = 1.3;

            refs.scene.add(particle);
            collections.particles.push(particle);
        }
    }

    function createExplosionEffect(position) {
        const particleCount = state.lowPowerMode ? 18 : 32;
        for (let i = 0; i < particleCount; i++) {
            const particle = acquireParticle('explosion');
            const color = particleColors.explosion[i % particleColors.explosion.length];
            if (particle.material?.color) {
                particle.material.color.setHex(color);
            }

            particle.position.copy(position);
            particle.position.y += 1;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 6,
                Math.random() * 5,
                (Math.random() - 0.5) * 6
            );

            particle.userData.velocity = velocity;
            particle.userData.lifetime = 1.1;
            particle.userData.maxLifetime = 1.1;

            refs.scene.add(particle);
            collections.particles.push(particle);
        }
    }

    function startWave() {
        clearWaveTimers();
        callbacks?.onWaveStart?.();
        if (state.phase === GamePhase.CHOOSING) {
            state.phase = GamePhase.PLAYING;
        }
        if (state.phase !== GamePhase.PLAYING) return;
        callbacks?.onRegenerateMap?.();
        const enemyCount = 3 + state.wave * 2;
        waveState.spawnMix = getWaveSpawnMix(state.wave);
        waveState.spawnedCount = 0;
        waveState.emergencySpawnAttempts = 0;
        waveState.token += 1;
        const token = waveState.token;
        waveState.pendingSpawns = enemyCount;
        waveState.active = true;
        for (let i = 0; i < enemyCount; i++) {
            const timerId = setTimeout(() => {
                waveState.spawnTimers.delete(timerId);
                if (token !== waveState.token) return;
                try {
                    if (spawnEnemy()) {
                        waveState.spawnedCount += 1;
                    }
                } finally {
                    waveState.pendingSpawns = Math.max(0, waveState.pendingSpawns - 1);
                    maybeCompleteWave();
                }
            }, i * 500);
            waveState.spawnTimers.add(timerId);
        }
        ui.showPrompt(`Wave ${state.wave} incoming`, 1400);
    }

    let _frameCounter = 0;
    
    function updateEnemies(delta, timeScale = 1) {
        const now = Date.now();
        
        _frameCounter++;
        if (_frameCounter >= 60) {
            _frameCounter = 0;
            if (collisionSystem?.rebuildEnemySpatialGrid && collections.enemies.length > 0) {
                collisionSystem.rebuildEnemySpatialGrid();
            }
        }
        const scaledDelta = delta * timeScale;
        const physics = getPhysics();
        const world = physics?.world || null;
        const usePhysics = Boolean(world);
        const playerCollider = physics?.playerCollider || null;
        let playerPos;
        if (physics?.playerBody) {
            const t = physics.playerBody.translation();
            playerPos = _tempPlayerPos.set(t.x, t.y, t.z);
        } else {
            playerPos = refs.camera.position;
        }

        for (let i = collections.enemies.length - 1; i >= 0; i--) {
            const enemy = collections.enemies[i];
            const archetype = enemy.archetype || getEnemyArchetype(enemy.role);
            enemy.archetype = archetype;
            
            let enemyPos;
            if (usePhysics && enemy.body) {
                const ep = enemy.body.translation();
                enemyPos = _tempEnemyPos.set(ep.x, ep.y, ep.z);
            } else {
                enemyPos = enemy.position;
            }
            
            const distToPlayer = playerPos.distanceTo(enemyPos);
            const isFarAway = distToPlayer > CULL_DISTANCE;

            if (enemy.mixer) {
                enemy.mixer.update(scaledDelta);
            }
            if (enemy.isDying) {
                if (usePhysics && enemy.body) {
                    try {
                        enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    } catch (error) {
                        enemy.body = null;
                        enemy.collider = null;
                    }
                }
                setFlankerLean(enemy, 0, scaledDelta);
                continue;
            }

            if (enemy.hitTimer > 0) {
                enemy.hitTimer -= scaledDelta;
                if (enemy.hitTimer <= 0 && enemy.animations) {
                    playAnimation(enemy, 'idle');
                } else {
                    continue;
                }
            }

            const direction = _tempDirection.subVectors(playerPos, enemyPos);
            direction.y = 0;
            const distance = direction.length();
            if (distance > 0.0001) { // Hard epsilon
                direction.normalize();
                enemy.rotation = Math.atan2(direction.x, direction.z);
            } else {
                // If distance is effectively zero, use current rotation to avoid NaN
                direction.set(0, 0, 0);
            }

            // FRUSTUM CULLING: Skip complex AI for distant enemies
            if (isFarAway) {
                const moveDirFar = _tempMoveDir.copy(direction);
                const shouldMoveFar = distance > archetype.attackRange;
                const shouldAttackFar = !shouldMoveFar;
                
                if (shouldMoveFar && moveDirFar.lengthSq() > 0.00001) {
                    moveDirFar.normalize();
                    const speed = enemy.speed * 60 * timeScale;
                    if (usePhysics && enemy.body) {
                        try {
                            enemy.body.setLinvel({ x: moveDirFar.x * speed, y: 0, z: moveDirFar.z * speed }, true);
                        } catch (error) {
                            enemy.body = null;
                            enemy.collider = null;
                            enemy.position.addScaledVector(moveDirFar, enemy.speed * (delta * 60) * timeScale);
                        }
                    } else {
                        enemy.position.addScaledVector(moveDirFar, enemy.speed * (delta * 60) * timeScale);
                    }
                }
                continue;
            }

            const moveDir = _tempMoveDir.copy(direction);
            let shouldMove = distance > archetype.attackRange;
            let shouldAttack = !shouldMove;
            let targetLean = 0;

            if (archetype.id === 'flanker') {
                if (distance > archetype.mediumRange) {
                    enemy.aiState = 'chase';
                } else {
                    enemy.aiState = 'strafe';
                }
                enemy.closeBurstCooldown = Math.max(0, enemy.closeBurstCooldown - scaledDelta);

                if (enemy.aiState === 'strafe') {
                    enemy.strafeSwitchTimer -= scaledDelta;
                    if (enemy.strafeSwitchTimer <= 0) {
                        enemy.strafeDir *= -1;
                        enemy.strafeSwitchTimer = randomBetween(archetype.strafeSwitchMin, archetype.strafeSwitchMax);
                    }

                    if (enemy.closeBurstTimer > 0) {
                        enemy.closeBurstTimer -= scaledDelta;
                        moveDir.copy(direction);
                    } else {
                        const startBurstChance = archetype.closeBurstChancePerSec * scaledDelta;
                        if (enemy.closeBurstCooldown <= 0 && Math.random() < startBurstChance) {
                            enemy.closeBurstTimer = randomBetween(archetype.closeBurstMin, archetype.closeBurstMax);
                            enemy.closeBurstCooldown = randomBetween(archetype.closeBurstCooldownMin, archetype.closeBurstCooldownMax);
                            moveDir.copy(direction);
                        } else {
                            const tangent = _tempTangent.set(-direction.z, 0, direction.x).multiplyScalar(enemy.strafeDir || 1);
                            moveDir.copy(tangent).addScaledVector(direction, archetype.strafeForwardBias);
                            if (moveDir.lengthSq() > 0.00001) {
                                moveDir.normalize();
                            } else {
                                moveDir.copy(direction); // Fallback to chase if tangent calculation fails
                            }
                            targetLean = -(enemy.strafeDir || 1) * archetype.leanAngle;
                        }
                    }
                }
                shouldMove = distance > archetype.attackRange || enemy.closeBurstTimer > 0;
                shouldAttack = distance <= archetype.attackRange && enemy.closeBurstTimer <= 0;
            } else if (archetype.id === 'exploder') {
                shouldAttack = false;
                if (enemy.aiState !== 'explode' && distance <= archetype.triggerRange) {
                    enemy.aiState = 'explode';
                    enemy.fuseTimer = archetype.fuseDuration;
                    enemy.fuseElapsed = 0;
                }
                if (enemy.aiState === 'explode') {
                    enemy.fuseTimer = Math.max(0, enemy.fuseTimer - scaledDelta);
                    enemy.fuseElapsed += scaledDelta;
                    const progress = 1 - (enemy.fuseTimer / Math.max(0.001, archetype.fuseDuration));
                    updateExploderFuseVisual(enemy, progress);
                    shouldMove = false;
                    if (enemy.fuseTimer <= 0) {
                        if (usePhysics && enemy.body) {
                            try {
                                enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                            } catch (error) {
                                enemy.body = null;
                                enemy.collider = null;
                            }
                        }
                        detonateExploder(i, false);
                        continue;
                    }
                } else {
                    resetExploderVisual(enemy);
                    shouldMove = distance > archetype.triggerRange * 0.75;
                }
            }

            setFlankerLean(enemy, archetype.id === 'flanker' ? targetLean : 0, scaledDelta);

            if (shouldMove && moveDir.lengthSq() > 0.00001) {
                moveDir.normalize();
                const speed = enemy.speed * 60 * timeScale;
                if (usePhysics && enemy.body) {
                    try {
                        enemy.body.setLinvel({ x: moveDir.x * speed, y: 0, z: moveDir.z * speed }, true);
                    } catch (error) {
                        enemy.body = null;
                        enemy.collider = null;
                        enemy.position.addScaledVector(moveDir, enemy.speed * (delta * 60) * timeScale);
                    }
                } else {
                    enemy.position.addScaledVector(moveDir, enemy.speed * (delta * 60) * timeScale);
                }
            } else {
                if (usePhysics && enemy.body) {
                    try {
                        enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    } catch (error) {
                        enemy.body = null;
                        enemy.collider = null;
                    }
                }
            }

            if (shouldAttack && archetype.damageMultiplier > 0) {
                // Reliable distance-based attack check
                const attackRange = archetype.attackRange || 2.2;
                const canHit = distance < (attackRange + refs.player.radius * 0.5);
                
                if (canHit && now - enemy.lastAttack > archetype.attackCooldown) {
                    enemy.lastAttack = now;
                    const damage = Math.max(1, Math.round(config.enemyDamage * archetype.damageMultiplier));
                    callbacks?.onPlayerDamage?.(damage, enemyPos);
                }
            }

            if (!usePhysics || !enemy.body) {
                resolveEnemyCollisions(enemy);
            }
            
            updateEnemyInstanceMatrix(enemy, enemyPos);
        }
        
        if (_instanceManager) {
            Object.values(_instanceManager.instancedMeshes).forEach(imesh => {
                imesh.instanceMatrix.needsUpdate = true;
            });
        }
    }

    const _dummyInstance = new THREE.Object3D();
    const _hitColor = new THREE.Color(0xff4444);
    const _whiteColor = new THREE.Color(0xffffff);

    function updateEnemyInstanceMatrix(enemy, pos) {
        if (!_instanceManager) return;
        const arc = enemy.archetype;
        const scale = arc.scale || 1;
        const id = enemy.instanceId;
        const yaw = enemy.rotation || 0;
        const lean = enemy.lean || 0;
        
        let visualScale = scale;
        let visualColor = new THREE.Color(arc.color);

        // Fuse visual for exploders
        if (enemy.role === 'exploder' && enemy.aiState === 'explode') {
            const progress = 1 - (enemy.fuseTimer / (arc.fuseDuration || 1));
            const pulse = 0.55 + Math.sin(26 * progress) * 0.45;
            visualScale *= (1 + progress * 0.12 + pulse * 0.03);
            visualColor.lerp(_hitColor, progress * 0.8);
        }

        // Hit flash
        if (enemy.hitTimer > 0) {
            visualColor.lerp(_whiteColor, 0.4);
            visualScale *= 1.05;
        }

        const imeshes = _instanceManager.instancedMeshes;
        _dummyInstance.rotation.set(0, yaw, lean);
        _dummyInstance.scale.set(visualScale, visualScale, visualScale);
        
        // torso
        _dummyInstance.position.set(pos.x, pos.y + 1.4 * visualScale, pos.z);
        _dummyInstance.updateMatrix();
        imeshes.torso.setMatrixAt(id, _dummyInstance.matrix);
        
        // head
        _dummyInstance.position.set(pos.x, pos.y + 2.6 * visualScale, pos.z);
        _dummyInstance.updateMatrix();
        imeshes.head.setMatrixAt(id, _dummyInstance.matrix);
        
        // eyes
        const eyeOffset = 0.35 * visualScale;
        _dummyInstance.position.set(pos.x, pos.y + 2.7 * visualScale, pos.z);
        _dummyInstance.rotation.set(0, yaw, 0);
        
        // eyeL
        _dummyInstance.translateX(-0.18 * visualScale);
        _dummyInstance.translateZ(eyeOffset);
        _dummyInstance.updateMatrix();
        imeshes.eyeL.setMatrixAt(id, _dummyInstance.matrix);
        
        // eyeR
        _dummyInstance.rotation.set(0, yaw, 0); 
        _dummyInstance.position.set(pos.x, pos.y + 2.7 * visualScale, pos.z);
        _dummyInstance.translateX(0.18 * visualScale);
        _dummyInstance.translateZ(eyeOffset);
        _dummyInstance.updateMatrix();
        imeshes.eyeR.setMatrixAt(id, _dummyInstance.matrix);
        
        // arms & legs
        _dummyInstance.rotation.set(0, yaw, 0);
        _dummyInstance.position.set(pos.x, pos.y + 1.4 * visualScale, pos.z);
        _dummyInstance.translateX(-0.9 * visualScale);
        _dummyInstance.updateMatrix();
        imeshes.armL.setMatrixAt(id, _dummyInstance.matrix);
        
        _dummyInstance.rotation.set(0, yaw, 0);
        _dummyInstance.position.set(pos.x, pos.y + 1.4 * visualScale, pos.z);
        _dummyInstance.translateX(0.9 * visualScale);
        _dummyInstance.updateMatrix();
        imeshes.armR.setMatrixAt(id, _dummyInstance.matrix);
        
        _dummyInstance.rotation.set(0, yaw, 0);
        _dummyInstance.position.set(pos.x, pos.y + 0.4 * visualScale, pos.z);
        _dummyInstance.translateX(-0.4 * visualScale);
        _dummyInstance.updateMatrix();
        imeshes.legL.setMatrixAt(id, _dummyInstance.matrix);
        
        _dummyInstance.rotation.set(0, yaw, 0);
        _dummyInstance.position.set(pos.x, pos.y + 0.4 * visualScale, pos.z);
        _dummyInstance.translateX(0.4 * visualScale);
        _dummyInstance.updateMatrix();
        imeshes.legR.setMatrixAt(id, _dummyInstance.matrix);
        
        // core
        if (enemy.role === 'exploder') {
            _dummyInstance.rotation.set(0, yaw, 0);
            _dummyInstance.position.set(pos.x, pos.y + 1.4 * visualScale, pos.z);
            _dummyInstance.translateZ(0.55 * visualScale);
            _dummyInstance.updateMatrix();
            imeshes.core.setMatrixAt(id, _dummyInstance.matrix);
        } else {
            _dummyInstance.scale.set(0, 0, 0);
            _dummyInstance.updateMatrix();
            imeshes.core.setMatrixAt(id, _dummyInstance.matrix);
        }
    }

    function resolveEnemyCollisions(enemy) {
        if (!collections.mapObstacles.length) return;
        const radius = getEnemyRadius(enemy.role);
        const pos = enemy.position;
        const enemyY = pos.y;

        for (let i = 0; i < collections.mapObstacles.length; i++) {
            const obstacle = collections.mapObstacles[i];
            if (!obstacle) continue;
            
            const bounds = obstacle.userData.boundingBox;
            if (!bounds) continue;

            const minX = bounds.min.x - radius;
            const maxX = bounds.max.x + radius;
            const minZ = bounds.min.z - radius;
            const maxZ = bounds.max.z + radius;

            if (pos.x < minX || pos.x > maxX || pos.z < minZ || pos.z > maxZ) {
                continue;
            }
            
            // Vertical check (simplified)
            if (enemyY < bounds.min.y - 1 || enemyY > bounds.max.y + 1) {
                continue;
            }

            const overlapX = Math.min(maxX - pos.x, pos.x - minX);
            const overlapZ = Math.min(maxZ - pos.z, pos.z - minZ);
            
            if (overlapX < overlapZ) {
                pos.x = pos.x < (minX + maxX) * 0.5 ? minX : maxX;
            } else {
                pos.z = pos.z < (minZ + maxZ) * 0.5 ? minZ : maxZ;
            }
        }
    }
    function syncEnemyBodies() {
        const world = getPhysics()?.world || null;
        if (!world) return;
        for (let i = collections.enemies.length - 1; i >= 0; i--) {
            const enemy = collections.enemies[i];
            if (!enemy?.body) continue;
            const t = enemy.body.translation();
            enemy.position.set(t.x, t.y, t.z);
        }
    }

    function getEnemyRadius(role) {
        return getEnemyArchetype(role).radius || 0.82;
    }

    function getEnemyHeight(role) {
        return getEnemyArchetype(role).height || 1.75;
    }

    function applyDamage(enemyIndex, damage, hitPoint) {
        const enemy = collections.enemies[enemyIndex];
        if (!enemy || enemy.isDying) return false;
        enemy.health -= damage;
        triggerHitAnimation(enemy);
        createHitEffect(hitPoint);
        if (enemy.health <= 0) {
            killEnemy(enemyIndex);
            return true;
        }
        return false;
    }

    function flashEnemy(enemyData) {
        if (!enemyData) return;
        enemyData.hitTimer = 0.12;
    }

    function createHitEffect(position) {
        const particleCount = state.lowPowerMode ? 10 : 18;
        for (let i = 0; i < particleCount; i++) {
            const particle = acquireParticle('hit');
            if (particle.material?.color) {
                particle.material.color.setHex(particleColors.hit);
            }

            particle.position.copy(position);
            particle.position.y += 0.2;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 3,
                Math.random() * 2.5,
                (Math.random() - 0.5) * 3
            );

            particle.userData.velocity = velocity;
            particle.userData.lifetime = 0.8;
            particle.userData.maxLifetime = 0.8;

            refs.scene.add(particle);
            collections.particles.push(particle);
        }
    }

    return {
        loadEnemyModel,
        spawnEnemy,
        startWave,
        updateEnemies,
        syncEnemyBodies,
        applyDamage,
        flashEnemy,
        setNavigation,
        getEnemyCount: () => collections.enemies.length
    };
}
