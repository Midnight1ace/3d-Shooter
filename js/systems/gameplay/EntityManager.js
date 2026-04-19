import { GamePhase } from '../../core/config.js';
import { EnemyArchetypes } from '../../core/archetypes.js';
import { AuthSystem } from '../network/AuthSystem.js';

export function createEntityManager({ state, config, refs, collections, ui, audio, collisionSystem, callbacks }) {

    const enemyPool = { normal: [], flanker: [], exploder: [] };
    const navigation = {
        pathfinding: null,
        zoneId: null
    };

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
        if (!enemy?.mesh) return;
        const leanLerp = Math.min(1, delta * 10);
        enemy.mesh.rotation.z += (target - enemy.mesh.rotation.z) * leanLerp;
    }

    function updateExploderFuseVisual(enemy, progress) {
        const mesh = enemy?.mesh;
        if (!mesh) return;
        const clamped = Math.max(0, Math.min(1, progress));
        const pulse = 0.55 + Math.sin((state.lowPowerMode ? 16 : 26) * clamped) * 0.45;
        mesh.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (!material?.emissive) return;
                material.emissive.setRGB(1, 0.05, 0.05);
                material.emissiveIntensity = 0.3 + clamped * 1.25 + pulse * 0.35;
            });
        });
        const baseScale = mesh.userData.baseScale || new THREE.Vector3(1, 1, 1);
        const scaleBoost = 1 + clamped * 0.12 + pulse * 0.03;
        mesh.scale.set(baseScale.x * scaleBoost, baseScale.y * scaleBoost, baseScale.z * scaleBoost);
    }

    function resetExploderVisual(enemy) {
        const mesh = enemy?.mesh;
        if (!mesh) return;
        mesh.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (!material?.emissive) return;
                const baseEmissive = child.userData.baseEmissive || new THREE.Color(0x000000);
                material.emissive.copy(baseEmissive);
                material.emissiveIntensity = child.userData.baseEmissiveIntensity || 0;
            });
        });
        const baseScale = mesh.userData.baseScale;
        if (baseScale) {
            mesh.scale.copy(baseScale);
        }
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
        if (waveState.spawnedCount <= 0) {
            if (waveState.emergencySpawnAttempts >= 1 || state.phase !== GamePhase.PLAYING) return;
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
                } finally {
                    waveState.pendingSpawns = Math.max(0, waveState.pendingSpawns - 1);
                    maybeCompleteWave();
                }
            }, 200);
            waveState.spawnTimers.add(timerId);
            return;
        }

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
    function loadEnemyModel() {
        // Disabled by user request: Do not use zombies.glb file and reset to procedural enemies
        refs.enemyLoadFailed = true;
        console.warn('Skipping zombie.glb loading. Falling back to procedural enemies.');
    }

    function spawnEnemy(roleOverride = null) {
        if (!refs.scene) return false;

        try {
            const role = roleOverride || pickArchetypeFromMix(waveState.spawnMix || getWaveSpawnMix(state.wave));
            const archetype = getEnemyArchetype(role);
            const healthBoost = Math.min(65, state.wave * 6);
            const speedBoost = Math.min(0.028, state.wave * 0.0018);
            const waveHealthScale = role === 'exploder' ? 0.65 : 1;
            const waveSpeedScale = role === 'exploder' ? 0.6 : 1;

            const angle = Math.random() * Math.PI * 2;
            const radius = 25 + Math.random() * 30;
            const spawnX = refs.camera.position.x + Math.cos(angle) * radius;
            const spawnZ = refs.camera.position.z + Math.sin(angle) * radius;
            const spawnY = 0.2;

            let enemyData;

            if (enemyPool[role] && enemyPool[role].length > 0) {
                enemyData = enemyPool[role].pop();
                enemyData.mesh.visible = true;
                enemyData.mesh.position.set(spawnX, spawnY, spawnZ);
                enemyData.isDying = false;
                enemyData.health = Math.round(archetype.health + healthBoost * waveHealthScale);
                enemyData.speed = archetype.speed + speedBoost * waveSpeedScale;
                enemyData.aiState = 'chase';
                enemyData.fuseTimer = 0;
                enemyData.fuseElapsed = 0;
                enemyData.hitTimer = 0;
                
                if (role === 'exploder') resetExploderVisual(enemyData);
                playAnimation(enemyData, 'idle');
                
                const physicsData = createEnemyBody(enemyData.mesh, role);
                enemyData.body = physicsData?.body || null;
                enemyData.collider = physicsData?.collider || null;
            } else {
                const enemy = createEnemyInstance(role, archetype.color);
                enemy.position.set(spawnX, spawnY, spawnZ);
                enemy.castShadow = !state.lowPowerMode;
                enemy.receiveShadow = !state.lowPowerMode;
                attachShield(enemy);
                refs.scene.add(enemy);
                const physicsData = createEnemyBody(enemy, role);
                
                enemyData = {
                    mesh: enemy,
                    health: Math.round(archetype.health + healthBoost * waveHealthScale),
                    speed: archetype.speed + speedBoost * waveSpeedScale,
                    lastAttack: 0,
                    role,
                    archetype,
                    aiState: 'chase',
                    strafeDir: Math.random() < 0.5 ? -1 : 1,
                    strafeSwitchTimer: randomBetween(1.5, 3),
                    closeBurstTimer: 0,
                    closeBurstCooldown: randomBetween(0.5, 1.2),
                    fuseTimer: 0,
                    fuseElapsed: 0,
                    mixer: enemy.userData.mixer || null,
                    animations: enemy.userData.animations || null,
                    currentAction: null,
                    hitTimer: 0,
                    isDying: false,
                    body: physicsData?.body || null,
                    collider: physicsData?.collider || null
                };
            }

            collections.enemies.push(enemyData);
            ui.updateHUD();
            return true;
        } catch (error) {
            console.error('ERROR creating enemy:', error);
            return false;
        }
    }

    function createEnemyInstance(role, color) {
        const archetype = getEnemyArchetype(role);
        if (refs.enemyPrototype && refs.enemyAnimationsLoaded && THREE.SkeletonUtils) {
            const model = THREE.SkeletonUtils.clone(refs.enemyPrototype);
            model.scale.setScalar(archetype.scale || 1);
            const mixer = new THREE.AnimationMixer(model);
            const animations = {};
            Object.keys(refs.enemyAnimationClips).forEach((name) => {
                animations[name] = mixer.clipAction(refs.enemyAnimationClips[name]);
            });
            model.userData.mixer = mixer;
            model.userData.animations = animations;
            applyArchetypeVisuals(model, role);
            playAnimation(model.userData, 'idle');
            return model;
        }
        const model = createEnemyModel(role, color);
        applyArchetypeVisuals(model, role);
        return model;
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
            if (enemy.mesh) {
                enemy.mesh.visible = false;
                enemy.mesh.position.set(0, -100, 0);
                enemyPool[enemy.role].push(enemy);
            }
            const idx = collections.enemies.indexOf(enemy);
            if (idx >= 0) {
                collections.enemies.splice(idx, 1);
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

        createDeathEffect(enemy.mesh.position);
        if (enemy.role === 'exploder') {
            resetExploderVisual(enemy);
        }

        if (enemy.animations && enemy.animations.die) {
            playAnimation(enemy, 'die');
            scheduleEnemyRemoval(enemy, 1000);
        } else {
            removeEnemyPhysics(enemy);
            enemy.mesh.visible = false;
            enemy.mesh.position.set(0, -100, 0);
            enemyPool[enemy.role].push(enemy);
            collections.enemies.splice(index, 1);
        }

        state.score += archetype.score || 100;
        if (state.activeMatchId) AuthSystem.recordKill(state.activeMatchId, enemy.role);

        callbacks?.onEnemyDrop?.(enemy.mesh.position.clone());
        ui.updateHUD();
        audio?.playUiSound?.('kill');
        audio?.playPositionalSound?.('kill', enemy.mesh.position);
        callbacks?.onTriggerTimeSlow?.();
        maybeCompleteWave();
    }

    function detonateExploder(index, fromKill = false) {
        if (index < 0 || index >= collections.enemies.length) return;
        const enemy = collections.enemies[index];
        if (!enemy || enemy.isDying) return;
        enemy.isDying = true;
        const archetype = enemy.archetype || getEnemyArchetype('exploder');
        resetExploderVisual(enemy);
        const position = enemy.mesh.position.clone();
        createExplosionEffect(position);
        if (fromKill) {
            callbacks?.onEnemyDrop?.(position.clone());
        }
        removeEnemyPhysics(enemy);
        enemy.mesh.visible = false;
        enemy.mesh.position.set(0, -100, 0);
        enemyPool[enemy.role].push(enemy);
        collections.enemies.splice(index, 1);

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

    function updateEnemies(delta, timeScale = 1) {
        const now = Date.now();
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

            let enemyPos;
            if (usePhysics && enemy.body) {
                const ep = enemy.body.translation();
                enemyPos = _tempEnemyPos.set(ep.x, ep.y, ep.z);
            } else {
                enemyPos = enemy.mesh.position;
            }

            const direction = _tempDirection.subVectors(playerPos, enemyPos);
            direction.y = 0;
            const distance = direction.length();
            if (distance > 0.001) {
                direction.normalize();
                enemy.mesh.rotation.y = Math.atan2(direction.x, direction.z);
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
                            moveDir.copy(tangent).addScaledVector(direction, archetype.strafeForwardBias).normalize();
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

            if (shouldMove && moveDir.lengthSq() > 0.0001) {
                moveDir.normalize();
                const speed = enemy.speed * 60 * timeScale;
                if (usePhysics && enemy.body) {
                    try {
                        enemy.body.setLinvel({ x: moveDir.x * speed, y: 0, z: moveDir.z * speed }, true);
                    } catch (error) {
                        enemy.body = null;
                        enemy.collider = null;
                        enemy.mesh.position.addScaledVector(moveDir, enemy.speed * (delta * 60) * timeScale);
                    }
                } else {
                    enemy.mesh.position.addScaledVector(moveDir, enemy.speed * (delta * 60) * timeScale);
                }
                if (enemy.animations) playAnimation(enemy, 'run');
            } else {
                if (usePhysics && enemy.body) {
                    try {
                        enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    } catch (error) {
                        enemy.body = null;
                        enemy.collider = null;
                    }
                }
                if (enemy.animations) {
                    if (archetype.id === 'exploder' && enemy.aiState === 'explode') {
                        playAnimation(enemy, 'idle');
                    } else {
                        playAnimation(enemy, 'attack');
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
                    callbacks?.onPlayerDamage?.(damage, enemy.mesh.position);
                }
            }

            if (!usePhysics || !enemy.body) {
                resolveEnemyCollisions(enemy);
            }
        }
    }

    function resolveEnemyCollisions(enemy) {
        if (!collections.mapObstacles.length) return;
        const radius = getEnemyRadius(enemy.role);
        const pos = enemy.mesh.position;
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
            const pos = enemy.body.translation();
            enemy.mesh.position.set(pos.x, pos.y, pos.z);
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

    function flashEnemy(enemyMesh) {
        enemyMesh.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (!material?.emissive) return;
                if (!child.userData.baseEmissive) {
                    child.userData.baseEmissive = material.emissive
                        ? material.emissive.clone()
                        : new THREE.Color(0x000000);
                    child.userData.baseEmissiveIntensity = material.emissiveIntensity || 0;
                }
                material.emissive = new THREE.Color(0xff0000);
                material.emissiveIntensity = 0.5;
            });
        });

        setTimeout(() => {
            enemyMesh.traverse((child) => {
                if (!child.isMesh || !child.material) return;
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((material) => {
                    if (!material?.emissive) return;
                    const baseEmissive = child.userData.baseEmissive || new THREE.Color(0x000000);
                    material.emissive = baseEmissive.clone();
                    material.emissiveIntensity = child.userData.baseEmissiveIntensity || 0;
                });
            });
        }, 100);
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
