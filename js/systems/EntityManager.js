import { GamePhase } from '../core/config.js';

export function createEntityManager({ state, config, refs, collections, ui, audio, callbacks }) {
    const navigation = {
        pathfinding: null,
        zoneId: null
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

    function getColliderHandle(collider) {
        if (!collider) return null;
        return typeof collider === 'number' ? collider : collider.handle;
    }

    function areCollidersOverlapping(world, colliderA, colliderB) {
        if (!world || colliderA == null || colliderB == null) return false;
        const handleA = getColliderHandle(colliderA);
        const handleB = getColliderHandle(colliderB);
        if (handleA == null || handleB == null) return false;
        if (world.intersectionPair) {
            return world.intersectionPair(handleA, handleB);
        }
        if (world.contactPair) {
            return Boolean(world.contactPair(handleA, handleB));
        }
        if (world.intersectionsWith) {
            let hit = false;
            world.intersectionsWith(handleA, (other) => {
                if (other === handleB) {
                    hit = true;
                    return false;
                }
                return true;
            });
            return hit;
        }
        return false;
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
        if (!physics?.world) return;
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

    function updateEnemyPath(enemy, start, target) {
        if (!navigation.pathfinding || !navigation.zoneId) return;
        try {
            const zoneId = navigation.zoneId;
            const group = navigation.pathfinding.getGroup(zoneId, start);
            if (group == null) {
                enemy.path = null;
                enemy.pathGroup = null;
                enemy.pathIndex = 0;
                return;
            }
            enemy.pathGroup = group;
            enemy.path = navigation.pathfinding.findPath(start, target, zoneId, group) || null;
            enemy.pathIndex = 0;
            enemy.pathTimer = 0.35 + Math.random() * 0.25;
        } catch (error) {
            enemy.path = null;
            enemy.pathGroup = null;
            enemy.pathIndex = 0;
        }
    }

    function setNavigation(pathfinding, zoneId) {
        navigation.pathfinding = pathfinding;
        navigation.zoneId = zoneId;
    }
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

            attachShield(enemy);
            refs.scene.add(enemy);
            const physicsData = createEnemyBody(enemy, baseType.role);
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
                isDying: false,
                body: physicsData?.body || null,
                collider: physicsData?.collider || null,
                path: null,
                pathIndex: 0,
                pathTimer: 0,
                pathGroup: null
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
            removeEnemyPhysics(enemy);
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
            removeEnemyPhysics(enemy);
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
        removeEnemyPhysics(enemy);
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

    function updateEnemies(delta, timeScale = 1) {
        const now = Date.now();
        const scaledDelta = delta * timeScale;
        const physics = getPhysics();
        const world = physics?.world || null;
        const playerCollider = physics?.playerCollider || null;
        const playerPos = physics?.playerBody
            ? new THREE.Vector3(
                physics.playerBody.translation().x,
                physics.playerBody.translation().y,
                physics.playerBody.translation().z
            )
            : refs.camera.position;

        for (let i = collections.enemies.length - 1; i >= 0; i--) {
            const enemy = collections.enemies[i];

            if (enemy.mixer) {
                enemy.mixer.update(scaledDelta);
            }
            if (enemy.isDying) {
                if (enemy.body) {
                    enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                }
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

            const enemyPos = enemy.body
                ? new THREE.Vector3(enemy.body.translation().x, enemy.body.translation().y, enemy.body.translation().z)
                : enemy.mesh.position.clone();
            const direction = new THREE.Vector3().subVectors(playerPos, enemyPos);
            direction.y = 0;
            const distance = direction.length();
            if (distance > 0.001) {
                direction.normalize();
                enemy.mesh.rotation.y = Math.atan2(direction.x, direction.z);
            }

            const speed = enemy.speed * 60 * timeScale;
            let moveDir = direction.clone();

            if (navigation.pathfinding && navigation.zoneId) {
                enemy.pathTimer -= delta;
                if (enemy.pathTimer <= 0) {
                    const start = new THREE.Vector3(enemyPos.x, 0, enemyPos.z);
                    const target = new THREE.Vector3(playerPos.x, 0, playerPos.z);
                    updateEnemyPath(enemy, start, target);
                }
                if (enemy.path && enemy.path.length > 0) {
                    let waypoint = enemy.path[enemy.pathIndex] || null;
                    if (waypoint && waypoint.distanceTo(enemyPos) < 1) {
                        enemy.pathIndex += 1;
                        waypoint = enemy.path[enemy.pathIndex] || null;
                    }
                    if (waypoint) {
                        moveDir = new THREE.Vector3(waypoint.x - enemyPos.x, 0, waypoint.z - enemyPos.z);
                        if (moveDir.length() > 0.001) {
                            moveDir.normalize();
                        }
                    }
                }
            }

            if (enemy.role === 'flanker') {
                const preferred = enemy.preferredRange || 7;
                if (distance <= preferred + 1 && distance > 0.001) {
                    const tangent = new THREE.Vector3(-direction.z, 0, direction.x)
                        .multiplyScalar(enemy.orbitDir);
                    const drift = direction.clone().multiplyScalar(0.35);
                    moveDir = tangent.add(drift).normalize();
                }
            }

            if (distance > 2) {
                if (enemy.body) {
                    enemy.body.setLinvel({ x: moveDir.x * speed, y: 0, z: moveDir.z * speed }, true);
                } else {
                    enemy.mesh.position.addScaledVector(moveDir, enemy.speed * (delta * 60) * timeScale);
                }
                if (enemy.animations) playAnimation(enemy, 'run');
            } else if (enemy.animations) {
                if (enemy.body) {
                    enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                }
                playAnimation(enemy, 'attack');
            }

            if (world && playerCollider && enemy.collider) {
                if (areCollidersOverlapping(world, playerCollider, enemy.collider) && now - enemy.lastAttack > 1100) {
                    enemy.lastAttack = now;
                    callbacks?.onPlayerDamage?.(config.enemyDamage, enemy.mesh.position);
                }
            } else if (distance < 2.2 && now - enemy.lastAttack > 1100) {
                enemy.lastAttack = now;
                callbacks?.onPlayerDamage?.(config.enemyDamage, enemy.mesh.position);
            }

            if (!world || !enemy.body) {
                resolveEnemyCollisions(enemy);
            }
        }
    }

    function resolveEnemyCollisions(enemy) {
        if (!collections.mapObstacles.length) return;
        const radius = getEnemyRadius(enemy.role);
        const pos = enemy.mesh.position;
        const playerY = pos.y;

        for (let i = 0; i < collections.mapObstacles.length; i++) {
            const obstacle = collections.mapObstacles[i];
            if (!obstacle) continue;
            const bounds = obstacle.userData.boundingBox || new THREE.Box3().setFromObject(obstacle);
            obstacle.userData.boundingBox = bounds;

            const box = bounds.clone();
            box.min.x -= radius;
            box.max.x += radius;
            box.min.z -= radius;
            box.max.z += radius;

            if (pos.x < box.min.x || pos.x > box.max.x || pos.z < box.min.z || pos.z > box.max.z) {
                continue;
            }

            if (playerY < box.min.y - 1 || playerY > box.max.y + 1) {
                continue;
            }

            const overlapX = Math.min(box.max.x - pos.x, pos.x - box.min.x);
            const overlapZ = Math.min(box.max.z - pos.z, pos.z - box.min.z);
            if (overlapX < overlapZ) {
                const centerX = (box.min.x + box.max.x) * 0.5;
                pos.x = pos.x < centerX ? box.min.x : box.max.x;
            } else {
                const centerZ = (box.min.z + box.max.z) * 0.5;
                pos.z = pos.z < centerZ ? box.min.z : box.max.z;
            }
        }
    }

    function syncEnemyBodies() {
        for (let i = collections.enemies.length - 1; i >= 0; i--) {
            const enemy = collections.enemies[i];
            if (!enemy?.body) continue;
            const pos = enemy.body.translation();
            enemy.mesh.position.set(pos.x, pos.y, pos.z);
        }
    }

    function getEnemyRadius(role) {
        switch (role) {
            case 'tank':
                return 1.05;
            case 'fast':
                return 0.7;
            case 'flanker':
                return 0.8;
            case 'exploder':
                return 0.85;
            default:
                return 0.8;
        }
    }

    function getEnemyHeight(role) {
        switch (role) {
            case 'tank':
                return 2.2;
            case 'fast':
                return 1.5;
            case 'flanker':
                return 1.7;
            case 'exploder':
                return 1.6;
            default:
                return 1.7;
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
