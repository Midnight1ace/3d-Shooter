import { Config, GamePhase, WeaponCatalog } from './core/config.js';
import { state } from './core/state.js';
import { refs, collections } from './core/refs.js';
import { dom } from './core/dom.js';
import { createAudioManager } from './systems/AudioManager.js';
import { createInputManager } from './systems/InputManager.js';
import { createUIController } from './systems/UIController.js';
import { createWeaponSystem } from './systems/WeaponSystem.js';
import { createEntityManager } from './systems/EntityManager.js';
let RAPIER = null;
let PathfindingCtor = null;

/**
 * 3D Shooter Game - Fixed & Improved Version
 * Built with Three.js
 */

let scene, camera, renderer;
let player;
let clock;
let currentLayout = null;
let upgradeOptions = [];
let ammoCrateGeometry = null;
let ammoCrateMaterial = null;
let physics = null;
let pathfinding = null;
const NAV_ZONE_ID = 'arena';
const WORLD_BOUNDARY = 90;

const audio = createAudioManager();
let weaponSystem;
let entityManager;

const ui = createUIController({
    dom,
    state,
    config: Config,
    weaponCatalog: WeaponCatalog,
    audio,
    callbacks: {
        onStart: startGame,
        onResume: resumeGame,
        onRestart: restartGame,
        onSpawnEnemy: () => entityManager?.spawnEnemy(),
        onBuyAmmo: buyAmmo,
        onEquipWeapon: (weaponId) => weaponSystem?.equipWeapon(weaponId),
        getWeapon: () => weaponSystem?.getWeapon(),
        getEnemyCount: () => entityManager?.getEnemyCount() ?? 0
    }
});

entityManager = createEntityManager({
    state,
    config: Config,
    refs,
    collections,
    ui,
    audio,
    callbacks: {
        onWaveCleared: openUpgradeScreen,
        onWaveStart: () => {
            dom.hud?.classList.remove('hidden');
            ui.hideUpgradeScreen();
        },
        onRegenerateMap: regenerateMap,
        onPlayerDamage: takeDamage,
        onTriggerTimeSlow: triggerTimeSlow,
        onEnemyDrop: spawnAmmoCrate
    }
});

const input = createInputManager({
    dom,
    state,
    config: Config,
    callbacks: {
        onPrimaryFire: () => {
            if (weaponSystem?.getWeapon()?.isReloading) {
                weaponSystem?.cancelReload();
                return;
            }
            weaponSystem?.shoot();
        },
        onReload: () => weaponSystem?.reload(),
        onPointerUnlock: () => ui.showPrompt('Click to lock aim', 2000),
        onMouseMove: handleMouseMove,
        onAdjustUiScale: (delta) => ui.adjustUiScale(delta),
        onSetUiScale: (value) => ui.setUiScale(value),
        onStart: startGame,
        onResume: resumeGame,
        onRestart: restartGame,
        onPause: pauseGame,
        onSelectUpgrade: selectUpgrade,
        onBuyAmmo: () => buyAmmo(100, 'mid'),
        onInteract: interact,
        onToggleScreenShake: toggleScreenShake,
        onToggleHitStop: toggleHitStop
    }
});

weaponSystem = createWeaponSystem({
    state,
    config: Config,
    refs,
    collections,
    ui,
    audio,
    input,
    entityManager,
    callbacks: {
        onAddCameraShake: addCameraShake,
        onHitStop: triggerHitStop
    }
});

const shakeOffset = refs.shakeOffset;

ui.startLoading();

async function loadExternalLibraries() {
    const results = await Promise.allSettled([
        import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.19.0'),
        import('https://cdn.skypack.dev/three-pathfinding@1.3.0')
    ]);
    if (results[0].status === 'fulfilled') {
        const mod = results[0].value;
        RAPIER = mod?.default || mod;
    } else {
        console.warn('Rapier failed to load.', results[0].reason);
        RAPIER = null;
    }

    if (results[1].status === 'fulfilled') {
        const mod = results[1].value;
        PathfindingCtor = mod?.Pathfinding
            || mod?.default?.Pathfinding
            || mod?.default
            || mod;
    } else {
        console.warn('three-pathfinding failed to load.', results[1].reason);
        PathfindingCtor = null;
    }
}

async function initPhysics() {
    if (!RAPIER) {
        refs.physics = null;
        return false;
    }
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    const radius = Math.max(0.35, Config.playerRadius * 0.5);
    const halfHeight = Math.max(0.2, (Config.playerHeight * 0.5) - radius);
    const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, Config.playerHeight, 0)
        .setLinearDamping(8)
        .setAngularDamping(10);
    if (playerBodyDesc.lockRotations) {
        playerBodyDesc.lockRotations();
    }
    const playerBody = world.createRigidBody(playerBodyDesc);
    const playerColliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setFriction(1.1)
        .setRestitution(0);
    const playerCollider = world.createCollider(playerColliderDesc, playerBody);

    physics = {
        rapier: RAPIER,
        world,
        playerBody,
        playerCollider
    };
    refs.physics = physics;
    return true;
}

function resetPlayerPhysics() {
    if (!physics?.playerBody) return;
    try {
        physics.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        physics.playerBody.setTranslation({ x: 0, y: Config.playerHeight, z: 0 }, true);
    } catch (error) {
        disablePhysics('Player physics reset failed.', error);
    }
}

function disablePhysics(reason, error = null) {
    if (!physics && !refs.physics) return;
    if (error) {
        console.warn(reason, error);
    } else {
        console.warn(reason);
    }
    physics = null;
    refs.physics = null;
    collections.enemies.forEach((enemy) => {
        if (!enemy) return;
        enemy.body = null;
        enemy.collider = null;
    });
    collections.mapObstacles.forEach((obstacle) => {
        if (obstacle?.userData) {
            obstacle.userData.colliderHandle = null;
        }
    });
    collections.pickups.forEach((pickup) => {
        if (pickup?.userData) {
            pickup.userData.colliderHandle = null;
        }
    });
}

function stepPhysics(delta) {
    if (!physics?.world) return;
    try {
        if (physics.world.integrationParameters) {
            physics.world.integrationParameters.dt = delta;
        } else if (physics.world.timestep !== undefined) {
            physics.world.timestep = delta;
        }
        physics.world.step();
    } catch (error) {
        disablePhysics('Physics step failed. Disabling physics.', error);
    }
}

function syncPlayerFromPhysics() {
    if (!physics?.playerBody) return;
    try {
        const pos = physics.playerBody.translation();
        const clampedX = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, pos.x));
        const clampedZ = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, pos.z));
        const bodyY = Config.playerHeight;
        if (clampedX !== pos.x || clampedZ !== pos.z || pos.y !== bodyY) {
            physics.playerBody.setTranslation({ x: clampedX, y: bodyY, z: clampedZ }, true);
        }
        camera.position.set(clampedX, bodyY + (player?.viewOffsetY || 0), clampedZ);
    } catch (error) {
        disablePhysics('Sync player from physics failed. Falling back to non-physics movement.', error);
    }
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

function createObstacleCollider(mesh) {
    if (!mesh || !physics?.world) return;
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.userData.boundingBox = box;
    const size = new THREE.Vector3();
    box.getSize(size);
    const half = size.multiplyScalar(0.5);
    const colliderDesc = physics.rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
        .setFriction(1.3)
        .setRestitution(0);
    if (colliderDesc.setRotation) {
        colliderDesc.setRotation({
            x: mesh.quaternion.x,
            y: mesh.quaternion.y,
            z: mesh.quaternion.z,
            w: mesh.quaternion.w
        });
    }
    const collider = physics.world.createCollider(colliderDesc);
    mesh.userData.colliderHandle = getColliderHandle(collider);
}

function removeObstacleCollider(mesh) {
    if (!mesh || !physics?.world) return;
    const handle = getColliderHandle(mesh.userData.colliderHandle);
    if (handle != null) {
        physics.world.removeCollider(handle, true);
    }
    mesh.userData.colliderHandle = null;
}

function createPickupCollider(pickup) {
    if (!pickup || !physics?.world) return;
    const size = 0.45;
    const colliderDesc = physics.rapier.ColliderDesc.cuboid(size, size, size)
        .setTranslation(pickup.position.x, pickup.position.y, pickup.position.z);
    if (colliderDesc.setSensor) {
        colliderDesc.setSensor(true);
    }
    const collider = physics.world.createCollider(colliderDesc);
    pickup.userData.colliderHandle = getColliderHandle(collider);
}

function removePickupCollider(pickup) {
    if (!pickup || !physics?.world) return;
    const handle = getColliderHandle(pickup.userData.colliderHandle);
    if (handle != null) {
        physics.world.removeCollider(handle, true);
    }
    pickup.userData.colliderHandle = null;
}

function buildNavMeshGeometry() {
    const halfSize = Config.navMeshSize;
    const cellSize = Config.navMeshCellSize;
    const padding = Config.navMeshPadding;
    const positions = [];
    const obstacleBoxes = collections.mapObstacles.map((mesh) => {
        const bounds = mesh.userData.boundingBox || new THREE.Box3().setFromObject(mesh);
        mesh.userData.boundingBox = bounds;
        return {
            minX: bounds.min.x - padding,
            maxX: bounds.max.x + padding,
            minZ: bounds.min.z - padding,
            maxZ: bounds.max.z + padding
        };
    });

    for (let x = -halfSize; x < halfSize; x += cellSize) {
        for (let z = -halfSize; z < halfSize; z += cellSize) {
            const cx = x + cellSize * 0.5;
            const cz = z + cellSize * 0.5;
            let blocked = false;
            for (let i = 0; i < obstacleBoxes.length; i++) {
                const box = obstacleBoxes[i];
                if (cx >= box.minX && cx <= box.maxX && cz >= box.minZ && cz <= box.maxZ) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
            const x1 = x + cellSize;
            const z1 = z + cellSize;
            positions.push(
                x, 0, z,
                x1, 0, z,
                x1, 0, z1,
                x, 0, z,
                x1, 0, z1,
                x, 0, z1
            );
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

function rebuildNavMesh() {
    if (!pathfinding) return;
    const zoneBuilder = PathfindingCtor?.createZone || pathfinding.createZone;
    if (!zoneBuilder) return;
    try {
        const geometry = buildNavMeshGeometry();
        const zone = zoneBuilder(geometry);
        pathfinding.setZoneData(NAV_ZONE_ID, zone);
        refs.pathfinding = pathfinding;
        refs.navZoneId = NAV_ZONE_ID;
        entityManager?.setNavigation?.(pathfinding, NAV_ZONE_ID);
    } catch (error) {
        console.warn('NavMesh build failed, falling back to direct movement.', error);
    }
}

function releaseParticle(particle) {
    if (!particle) return;
    const type = particle.userData?.poolType;
    if (!type || !collections.particlePools[type]) return;
    particle.visible = false;
    refs.scene?.remove(particle);
    collections.particlePools[type].push(particle);
}

function getAmmoCrateGeometry() {
    if (!ammoCrateGeometry) {
        ammoCrateGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    }
    return ammoCrateGeometry;
}

function getAmmoCrateMaterial() {
    if (!ammoCrateMaterial) {
        ammoCrateMaterial = new THREE.MeshStandardMaterial({
            color: 0x5bff9c,
            emissive: 0x2f7a4f,
            emissiveIntensity: 0.6,
            roughness: 0.5,
            metalness: 0.1
        });
    }
    return ammoCrateMaterial;
}

function spawnAmmoCrate(position) {
    if (Math.random() > Config.ammoDropChance) return;
    if (!refs.scene) return;
    const crate = new THREE.Mesh(getAmmoCrateGeometry(), getAmmoCrateMaterial());
    crate.position.copy(position);
    crate.position.y = 0.45;
    crate.castShadow = !state.lowPowerMode;
    crate.receiveShadow = !state.lowPowerMode;
    crate.userData = {
        type: 'ammo',
        amountMags: Config.ammoDropAmountMags
    };
    refs.scene.add(crate);
    collections.pickups.push(crate);
    createPickupCollider(crate);
}

function clearPickups() {
    collections.pickups.forEach((pickup) => {
        if (pickup) {
            removePickupCollider(pickup);
            refs.scene?.remove(pickup);
        }
    });
    collections.pickups = [];
}

function clearEnemies() {
    collections.enemies.forEach((enemy) => {
        const colliderHandle = getColliderHandle(enemy?.collider);
        if (colliderHandle != null && physics?.world) {
            physics.world.removeCollider(colliderHandle, true);
        }
        if (enemy?.body && physics?.world) {
            const bodyHandle = typeof enemy.body === 'number' ? enemy.body : enemy.body.handle;
            if (bodyHandle != null) {
                physics.world.removeRigidBody(bodyHandle);
            }
        }
        if (enemy?.mesh) {
            refs.scene?.remove(enemy.mesh);
        }
    });
    collections.enemies = [];
    ui.updateHUD();
}

function clearActiveParticles() {
    for (let i = collections.particles.length - 1; i >= 0; i--) {
        const particle = collections.particles[i];
        releaseParticle(particle);
    }
    collections.particles = [];
}


function addCameraShake(amount) {
    if (!state.screenShakeEnabled) return;
    state.cameraShake = Math.min(0.25, state.cameraShake + amount);
}

function getCameraShakeOffset(delta) {
    if (state.cameraShake <= 0) {
        shakeOffset.set(0, 0, 0);
        return shakeOffset;
    }
    state.cameraShake = Math.max(0, state.cameraShake - delta * 2.5);
    const strength = state.cameraShake * state.cameraShake;
    shakeOffset.set(
        (Math.random() - 0.5) * strength,
        (Math.random() - 0.5) * strength,
        0
    );
    return shakeOffset;
}

function updateTimeScale(delta) {
    if (state.timeSlowTimer > 0) {
        state.timeSlowTimer -= delta;
        state.timeScale = state.timeSlowIntensity;
        document.body.classList.add('time-slow');
        return;
    }
    if (state.timeScale < 1) {
        state.timeScale = Math.min(1, state.timeScale + delta / Config.timeSlowRecovery);
        if (state.timeScale >= 1) {
            document.body.classList.remove('time-slow');
        }
    }
}

function triggerTimeSlow() {
    state.timeSlowTimer = state.timeSlowDuration;
    state.timeScale = state.timeSlowIntensity;
    document.body.classList.add('time-slow');
}

function triggerHitStop(multiplier = 1) {
    if (!state.hitStopEnabled) return;
    const duration = Config.hitStopDuration * multiplier;
    state.hitStopTimer = Math.max(state.hitStopTimer, duration);
}

function toggleScreenShake() {
    state.screenShakeEnabled = !state.screenShakeEnabled;
    state.cameraShake = 0;
    ui.showPrompt(`Screen shake: ${state.screenShakeEnabled ? 'On' : 'Off'}`, 1200);
}

function toggleHitStop() {
    state.hitStopEnabled = !state.hitStopEnabled;
    state.hitStopTimer = 0;
    ui.showPrompt(`Hit-stop: ${state.hitStopEnabled ? 'On' : 'Off'}`, 1200);
}

// Initialize the Game
async function init() {
    console.log('Initializing 3D Shooter Game...');
    try {
        await loadExternalLibraries();

        // Create Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 20, 150);
        
        // Create Camera
        camera = new THREE.PerspectiveCamera(
            Config.fov,
            window.innerWidth / window.innerHeight,
            Config.near,
            Config.far
        );
        camera.position.set(0, Config.playerHeight, 0);
        scene.add(camera);

        // Create Renderer
        state.lowPowerMode = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
            (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
        renderer = new THREE.WebGLRenderer({
            canvas: dom.gameCanvas,
            antialias: true
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.lowPowerMode ? 1 : 1.5));
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.shadowMap.enabled = !state.lowPowerMode;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Create Clock
        clock = new THREE.Clock();
        refs.scene = scene;
        refs.camera = camera;
        refs.renderer = renderer;
        refs.clock = clock;
        refs.shieldUniforms = {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x3df2ff) }
        };
        if (typeof PathfindingCtor === 'function') {
            pathfinding = new PathfindingCtor();
            refs.pathfinding = pathfinding;
            refs.navZoneId = NAV_ZONE_ID;
        } else {
            pathfinding = null;
        }

        let physicsReady = false;
        try {
            physicsReady = await initPhysics();
        } catch (error) {
            console.warn('Physics init failed.', error);
            physicsReady = false;
            refs.physics = null;
        }
        if (!physicsReady) {
            console.warn('Physics unavailable. Using fallback collisions.');
        }
        
        // Setup Lighting - Improved
        setupLighting();
        
        // Create Environment - Improved
        createEnvironment();

        // Create Player
        createPlayer();

        // Create Weapon
        weaponSystem.createWeapon();

        // Load animated enemy model (if available)
        entityManager.loadEnemyModel();
        
        // Setup Controls
        setupControls();
        
        // Setup UI
        ui.setupUI();
        
        // Handle Window Resize
        window.addEventListener('resize', onWindowResize);
        
        // Hide Loading Screen
        ui.finishLoading();
        
        // Show Start Screen
        state.phase = GamePhase.START;
        dom.startScreen?.classList.remove('hidden');
        
        console.log('Game initialized successfully!');
    } catch (error) {
        console.error('Failed to initialize game:', error);
        ui.finishLoading();
        state.phase = GamePhase.START;
        dom.startScreen?.classList.remove('hidden');
        ui.showPrompt('Init failed. Check console for details.', 4000);
    }
}

// Setup Lighting - Enhanced
function setupLighting() {
    // Ambient Light - warmer
    const ambientLight = new THREE.AmbientLight(0xffeedd, 0.6);
    scene.add(ambientLight);
    
    // Directional Light (Sun) - bright and warm
    const directionalLight = new THREE.DirectionalLight(0xffffee, 1.0);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = !state.lowPowerMode;
    directionalLight.shadow.mapSize.width = state.lowPowerMode ? 1024 : 2048;
    directionalLight.shadow.mapSize.height = state.lowPowerMode ? 1024 : 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);
    
    // Hemisphere Light - sky/ground colors
    const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x4a6741, 0.5);
    scene.add(hemisphereLight);
    
    // Point lights for atmosphere
    const pointLight1 = new THREE.PointLight(0xff6600, 0.5, 30);
    pointLight1.position.set(20, 5, 20);
    scene.add(pointLight1);
    
    const pointLight2 = new THREE.PointLight(0x0066ff, 0.5, 30);
    pointLight2.position.set(-20, 5, -20);
    scene.add(pointLight2);
}

function loadEnemyModel() {
    entityManager.loadEnemyModel();
}

function addMapObject(mesh) {
    mesh.userData.isObstacle = true;
    if (!mesh.userData.boundingBox) {
        mesh.userData.boundingBox = new THREE.Box3().setFromObject(mesh);
    }
    collections.mapObstacles.push(mesh);
    scene.add(mesh);
    createObstacleCollider(mesh);
}

function clearMapObstacles() {
    collections.mapObstacles.forEach((obj) => {
        removeObstacleCollider(obj);
        scene.remove(obj);
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach((mat) => mat.dispose());
            } else {
                obj.material.dispose();
            }
        }
    });
    collections.mapObstacles = [];
}

function regenerateMap() {
    clearPickups();
    clearMapObstacles();
    const layouts = ['lanes', 'ring', 'cross', 'scatter'];
    let nextLayout = layouts[Math.floor(Math.random() * layouts.length)];
    if (nextLayout === currentLayout && layouts.length > 1) {
        const idx = (layouts.indexOf(nextLayout) + 1) % layouts.length;
        nextLayout = layouts[idx];
    }
    currentLayout = nextLayout;

    const density = state.lowPowerMode ? 0.6 : 1;
    const castShadow = !state.lowPowerMode;

    switch (nextLayout) {
        case 'ring':
            createLayoutRing(castShadow, density);
            break;
        case 'cross':
            createLayoutCross(castShadow, density);
            break;
        case 'scatter':
            createLayoutScatter(castShadow, density);
            break;
        case 'lanes':
        default:
            createLayoutLanes(castShadow, density);
            break;
    }
    rebuildNavMesh();
}

// Create Environment - Enhanced
function createEnvironment() {
    // Ground - grass texture color
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a7c3f,
        roughness: 0.9,
        metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = !state.lowPowerMode;
    scene.add(ground);
    
    // Create skybox effect with large sphere
    const skyGeometry = new THREE.SphereGeometry(400, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        color: 0x87CEEB,
        side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);
    
    const density = state.lowPowerMode ? 0.5 : 1;

    // Create some obstacles/cover - Improved colors
    regenerateMap();
    
    // Add decorative elements
    createTrees(density);
}

// Create Trees
function createTrees(density = 1) {
    const count = Math.max(8, Math.round(Config.treeCount * density));
    const castShadow = !state.lowPowerMode;
    for (let i = 0; i < count; i++) {
        // Tree trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5D4037 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 1.5;
        trunk.castShadow = castShadow;
        
        // Tree foliage
        const foliageGeometry = new THREE.ConeGeometry(2, 5, 8);
        const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2E7D32 });
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.y = 5;
        foliage.castShadow = castShadow;
        
        const tree = new THREE.Group();
        tree.add(trunk);
        tree.add(foliage);
        
        // Random position (avoiding center)
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 60;
        tree.position.x = Math.cos(angle) * radius;
        tree.position.z = Math.sin(angle) * radius;
        
        scene.add(tree);
    }
}

function createArenaLanes(castShadow, density) {
    const laneMaterial = new THREE.MeshStandardMaterial({
        color: 0x5b646e,
        roughness: 0.9,
        metalness: 0.15
    });
    const wallGeometry = new THREE.BoxGeometry(8, 1.2, 1);
    const laneZ = [-24, 0, 24];
    const laneSpacing = density > 0.8 ? 15 : 20;
    laneZ.forEach((z, laneIndex) => {
        for (let x = -30; x <= 30; x += laneSpacing) {
            if (laneIndex === 1 && Math.abs(x) < 6) continue;
            const wall = new THREE.Mesh(wallGeometry, laneMaterial);
            wall.position.set(x, 0.6, z);
            wall.rotation.y = Math.random() * Math.PI;
            wall.castShadow = castShadow;
            wall.receiveShadow = castShadow;
            addMapObject(wall);
        }
    });
}

function createLayoutLanes(castShadow, density) {
    createArenaLanes(castShadow, density);

    const crateMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.8,
        metalness: 0.1
    });

    const crateCount = Math.max(4, Math.round(Config.crateCount * density));
    for (let i = 0; i < crateCount; i++) {
        const size = 1.4 + Math.random() * 1.5;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const obstacle = new THREE.Mesh(geometry, crateMaterial);
        obstacle.position.x = (Math.random() - 0.5) * 60;
        obstacle.position.z = (Math.random() - 0.5) * 60;
        obstacle.position.y = size / 2;
        obstacle.rotation.y = Math.random() * Math.PI;
        obstacle.castShadow = castShadow;
        obstacle.receiveShadow = castShadow;
        obstacle.userData = { isObstacle: true, isCrate: true };
        addMapObject(obstacle);
    }
}

function createLayoutRing(castShadow, density) {
    const barrierMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 0.9,
        metalness: 0.2
    });
    const ringCount = Math.max(10, Math.round(18 * density));
    for (let i = 0; i < ringCount; i++) {
        const geometry = new THREE.BoxGeometry(4, 1.4, 1.2);
        const barrier = new THREE.Mesh(geometry, barrierMaterial);
        const angle = (i / ringCount) * Math.PI * 2;
        const radius = 26 + Math.random() * 4;
        barrier.position.set(Math.cos(angle) * radius, 0.7, Math.sin(angle) * radius);
        barrier.rotation.y = angle + Math.PI / 2;
        barrier.castShadow = castShadow;
        barrier.receiveShadow = castShadow;
        addMapObject(barrier);
    }
}

function createLayoutCross(castShadow, density) {
    const barrierMaterial = new THREE.MeshStandardMaterial({
        color: 0x6f7680,
        roughness: 0.85,
        metalness: 0.2
    });
    const thickness = 1.6;
    const segments = Math.max(3, Math.round(5 * density));
    for (let i = -segments; i <= segments; i++) {
        const geometry = new THREE.BoxGeometry(6, 1.6, thickness);
        const wall = new THREE.Mesh(geometry, barrierMaterial);
        wall.position.set(i * 6, 0.8, 0);
        wall.castShadow = castShadow;
        wall.receiveShadow = castShadow;
        addMapObject(wall);

        const wall2 = wall.clone();
        wall2.rotation.y = Math.PI / 2;
        wall2.position.set(0, 0.8, i * 6);
        addMapObject(wall2);
    }
}

function createLayoutScatter(castShadow, density) {
    const crateMaterial = new THREE.MeshStandardMaterial({
        color: 0x7c5b3b,
        roughness: 0.85,
        metalness: 0.1
    });
    const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0x606060,
        roughness: 0.5,
        metalness: 0.3
    });
    const crateCount = Math.max(6, Math.round(Config.crateCount * density));
    const pillarCount = Math.max(4, Math.round(Config.pillarCount * density));

    for (let i = 0; i < crateCount; i++) {
        const size = 1.4 + Math.random() * 1.6;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const obstacle = new THREE.Mesh(geometry, crateMaterial);
        obstacle.position.set((Math.random() - 0.5) * 70, size / 2, (Math.random() - 0.5) * 70);
        obstacle.rotation.y = Math.random() * Math.PI;
        obstacle.castShadow = castShadow;
        obstacle.receiveShadow = castShadow;
        addMapObject(obstacle);
    }

    for (let i = 0; i < pillarCount; i++) {
        const geometry = new THREE.CylinderGeometry(0.9, 1.1, 6, 12);
        const pillar = new THREE.Mesh(geometry, pillarMaterial);
        const angle = (i / pillarCount) * Math.PI * 2 + Math.random();
        const radius = 18 + Math.random() * 18;
        pillar.position.set(Math.cos(angle) * radius, 3, Math.sin(angle) * radius);
        pillar.castShadow = castShadow;
        pillar.receiveShadow = castShadow;
        addMapObject(pillar);
    }
}

// Create Player
function createPlayer() {
    player = {
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        isMoving: false,
        isSprinting: false,
        canShoot: true,
        yaw: 0,
        pitch: 0,
        viewOffsetY: 0
    };
    refs.player = player;
}

// Setup Controls - Fixed
function setupControls() {
    input.attach();
}

function handleMouseMove(event) {
    if (!state.isPointerLocked || state.phase !== GamePhase.PLAYING) return;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    const sensitivity = 0.002;

    player.yaw -= movementX * sensitivity;
    player.pitch -= movementY * sensitivity;

    player.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, player.pitch));

    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
}

function interact() {
    // For future use (pick up items, etc.)
}

// Enemy Management - DEBUG VERSION
function spawnEnemy() {
    entityManager.spawnEnemy();
}

function startWave() {
    entityManager.startWave();
}

function updateEnemies(delta) {
    try {
        entityManager.updateEnemies(delta, state.timeScale);
    } catch (error) {
        console.warn('Enemy update failed. Disabling navmesh.', error);
        entityManager.setNavigation?.(null, null);
        pathfinding = null;
        refs.pathfinding = null;
    }
}

// Take Damage - Fixed
function takeDamage(amount, sourcePosition) {
    state.health = Math.max(0, state.health - amount);
    ui.updateHUD();
    audio.playUiSound('damage');
    ui.showDamageDirection(sourcePosition, camera);
    addCameraShake(Config.cameraShakeDamage);
    
    // Show damage overlay
    let overlay = document.getElementById('damage-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'damage-overlay';
        document.body.appendChild(overlay);
    }
    
    overlay.style.opacity = '1';
    overlay.style.background = `radial-gradient(circle, transparent 30%, rgba(255,0,0,${amount / 100}) 100%)`;
    
    setTimeout(() => {
        overlay.style.opacity = '0';
    }, 300);
    
    if (state.screenShakeEnabled) {
        if (player) {
            player.viewOffsetY = -0.04;
        }
        setTimeout(() => {
            if (player) {
                player.viewOffsetY = 0;
            }
        }, 50);
    }
    
    if (state.health <= 0) {
        ui.updateHUD();
        gameOver();
    }
}

function buyAmmo(cost, source) {
    const currentWeapon = weaponSystem.getWeapon();
    if (!currentWeapon) return;
    const isFreeRefill = !state.freeAmmoUsed && state.score < 50;
    const effectiveCost = isFreeRefill ? 0 : cost;
    if (state.score < effectiveCost) {
        ui.showPrompt('Not enough credits', 1200);
        return;
    }
    if (state.reserveAmmo >= currentWeapon.reserveMax) {
        ui.showPrompt('Ammo already full', 1200);
        return;
    }
    state.score -= effectiveCost;
    if (isFreeRefill) {
        state.freeAmmoUsed = true;
    }
    state.reserveAmmo = Math.min(currentWeapon.reserveMax, state.reserveAmmo + state.maxAmmo);
    weaponSystem.syncWeaponInventory();
    ui.updateHUD();
    if (isFreeRefill) {
        ui.showPrompt('Ammo refilled (free)', 1200);
    } else {
        ui.showPrompt(source === 'armory' ? 'Ammo purchased' : 'Ammo purchased mid-wave', 1200);
    }
}

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
        startWave();
        dom.gameCanvas?.requestPointerLock();
        dom.gameCanvas?.focus();
        clock.start();
        animate();
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
    startWave();
    dom.gameCanvas?.requestPointerLock();
    dom.gameCanvas?.focus();
    clock.start();
    animate();
}

function resetRunStats() {
    state.damageMultiplier = 1;
    state.reloadSpeedMultiplier = 1;
    state.moveSpeedMultiplier = 1;
    state.magSizeMultiplier = 1;
    state.timeSlowIntensity = Config.timeSlowIntensity;
    state.timeSlowDuration = Config.timeSlowDuration;
    state.maxHealth = Config.maxHealth;
    state.freeAmmoUsed = false;
    resetWeaponState();
    state.health = state.maxHealth;
    state.timeScale = 1;
    state.timeSlowTimer = 0;
    document.body.classList.remove('time-slow');
}

function resetWeaponState() {
    weaponSystem.resetWeaponState();
}

// Game State Functions
function startGame() {
    dom.startScreen?.classList.add('hidden');
    dom.hud?.classList.remove('hidden');
    audio.ensureAudioContext();
    
    // Reset game state
    state.score = 0;
    state.wave = 1;
    resetRunStats();
    const activeWeapon = weaponSystem.getWeapon();
    if (activeWeapon) {
        activeWeapon.isReloading = false;
        activeWeapon.canShoot = true;
    }
    weaponSystem.cancelReload();
    
    // Clear existing enemies
    clearEnemies();
    clearPickups();
    clearActiveParticles();
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    player.viewOffsetY = 0;
    resetPlayerPhysics();
    
    ui.hideUpgradeScreen();
    ui.updateHUD();
    state.phase = GamePhase.PLAYING;
    
    ui.clearPrompts();
    ui.queueTutorialPrompts();
    startWave();
    
    // Lock pointer
    dom.gameCanvas?.requestPointerLock();
    dom.gameCanvas?.focus();
    ui.showPrompt('Click to lock aim', 1600);
    
    // Start game loop
    clock.start();
    animate();
}

function pauseGame() {
    state.phase = GamePhase.PAUSED;
    dom.pauseScreen?.classList.remove('hidden');
    if (typeof document.exitPointerLock === 'function') {
        document.exitPointerLock();
    }
    ui.clearPrompts();
    state.timeScale = 1;
    state.timeSlowTimer = 0;
    document.body.classList.remove('time-slow');
    dom.resumeButton?.focus();
}

function resumeGame() {
    state.phase = GamePhase.PLAYING;
    dom.pauseScreen?.classList.add('hidden');
    dom.gameCanvas?.requestPointerLock();
    dom.gameCanvas?.focus();
    ui.showPrompt('Back in action', 1200);
    
    clock.start();
    animate();
}

function restartGame() {
    dom.pauseScreen?.classList.add('hidden');
    dom.gameOverScreen?.classList.add('hidden');
    dom.hud?.classList.remove('hidden');
    
    // Reset game state
    state.score = 0;
    state.wave = 1;
    resetRunStats();
    const activeWeapon = weaponSystem.getWeapon();
    if (activeWeapon) {
        activeWeapon.isReloading = false;
        activeWeapon.canShoot = true;
    }
    weaponSystem.cancelReload();
    
    // Clear existing enemies
    clearEnemies();
    clearPickups();
    clearActiveParticles();
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    player.viewOffsetY = 0;
    resetPlayerPhysics();
    
    ui.hideUpgradeScreen();
    ui.updateHUD();
    state.phase = GamePhase.PLAYING;
    
    // Lock pointer
    dom.gameCanvas?.requestPointerLock();
    dom.gameCanvas?.focus();
    
    // Start waves
    startWave();
    ui.clearPrompts();
    ui.queueTutorialPrompts();
    
    clock.start();
    animate();
}

function gameOver() {
    state.phase = GamePhase.GAME_OVER;
    dom.hud?.classList.add('hidden');
    dom.gameOverScreen?.classList.remove('hidden');
    ui.hideUpgradeScreen();
    document.body.classList.remove('time-slow');
    document.getElementById('final-score').textContent = state.score;
    document.getElementById('final-wave').textContent = state.wave;
    if (typeof document.exitPointerLock === 'function') {
        document.exitPointerLock();
    }
    ui.clearPrompts();
    dom.restartGameButton?.focus();
}

// Window Resize Handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.lowPowerMode ? 1 : 1.5));
}

// Player Movement
function updatePlayer(delta) {
    if (state.phase !== GamePhase.PLAYING) return;
    
    player.velocity.set(0, 0, 0);
    player.direction.set(0, 0, 0);
    
    // Get forward and right vectors based on yaw only
    const forward = new THREE.Vector3(
        Math.sin(player.yaw),
        0,
        Math.cos(player.yaw)
    );
    
    const right = new THREE.Vector3(
        Math.sin(player.yaw + Math.PI / 2),
        0,
        Math.cos(player.yaw + Math.PI / 2)
    );
    
    // Calculate movement direction
    if (input.keys.w) player.direction.sub(forward); // Forward - camera looks forward
    if (input.keys.s) player.direction.add(forward); // Backward
    if (input.keys.a) player.direction.sub(right);
    if (input.keys.d) player.direction.add(right);
    
    // Normalize and apply speed
    if (player.direction.length() > 0) {
        player.direction.normalize();
        const baseSpeed = input.keys.shift
            ? Config.playerSpeed * Config.playerSprintMultiplier * state.moveSpeedMultiplier
            : Config.playerSpeed * state.moveSpeedMultiplier;
        const speed = baseSpeed * 60;
        player.velocity.copy(player.direction).multiplyScalar(speed);
    }

    const body = refs.physics?.playerBody;
    if (body) {
        try {
            body.setLinvel({ x: player.velocity.x, y: 0, z: player.velocity.z }, true);
        } catch (error) {
            disablePhysics('Player movement physics failed. Falling back to non-physics movement.', error);
            const desiredPosition = camera.position.clone().addScaledVector(player.velocity, delta);
            desiredPosition.y = Config.playerHeight;
            const resolvedPosition = resolvePlayerCollisions(desiredPosition);
            camera.position.copy(resolvedPosition);
            camera.position.x = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.x));
            camera.position.z = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.z));
        }
    } else {
        const desiredPosition = camera.position.clone().addScaledVector(player.velocity, delta);
        desiredPosition.y = Config.playerHeight;
        const resolvedPosition = resolvePlayerCollisions(desiredPosition);
        camera.position.copy(resolvedPosition);
        camera.position.x = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.x));
        camera.position.z = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.z));
    }
    
    const activeWeapon = weaponSystem.getWeapon();
    const weaponMesh = activeWeapon?.mesh;
    if (weaponMesh) {
        if (player.velocity.length() > 0) {
            const time = clock.getElapsedTime();
            weaponMesh.position.x = 0.25 + Math.sin(time * 12) * 0.015;
            weaponMesh.position.y = -0.35 + Math.cos(time * 18) * 0.01;
        } else {
            const time = clock.getElapsedTime();
            weaponMesh.position.x = 0.25 + Math.sin(time * 2) * 0.005;
            weaponMesh.position.y = -0.35 + Math.cos(time * 3) * 0.003;
        }
    }
    
    // Recoil recovery
    if (activeWeapon && activeWeapon.recoil > 0) {
        activeWeapon.recoil *= 0.85;
        player.pitch -= activeWeapon.recoil * 0.5;
        camera.rotation.x = player.pitch;
    }

    dom.chipSprint?.classList.toggle('active', input.keys.shift && player.velocity.length() > 0);
}

function resolvePlayerCollisions(position) {
    if (!collections.mapObstacles.length) return position;
    const resolved = position.clone();
    const radius = Config.playerRadius;
    const playerY = Config.playerHeight;

    for (let i = 0; i < collections.mapObstacles.length; i++) {
        const obstacle = collections.mapObstacles[i];
        if (!obstacle) continue;
        const box = obstacle.userData.boundingBox || new THREE.Box3().setFromObject(obstacle);
        obstacle.userData.boundingBox = box;
        const expanded = box.clone();
        expanded.min.x -= radius;
        expanded.max.x += radius;
        expanded.min.z -= radius;
        expanded.max.z += radius;

        if (resolved.x < expanded.min.x || resolved.x > expanded.max.x || resolved.z < expanded.min.z || resolved.z > expanded.max.z) {
            continue;
        }

        if (playerY < expanded.min.y - 1 || playerY > expanded.max.y + 1) {
            continue;
        }

        const overlapX = Math.min(expanded.max.x - resolved.x, resolved.x - expanded.min.x);
        const overlapZ = Math.min(expanded.max.z - resolved.z, resolved.z - expanded.min.z);
        if (overlapX < overlapZ) {
            const centerX = (expanded.min.x + expanded.max.x) * 0.5;
            resolved.x = resolved.x < centerX ? expanded.min.x : expanded.max.x;
        } else {
            const centerZ = (expanded.min.z + expanded.max.z) * 0.5;
            resolved.z = resolved.z < centerZ ? expanded.min.z : expanded.max.z;
        }
    }

    return resolved;
}

// Game Loop
function animate() {
    if (state.phase !== GamePhase.PLAYING) return;
    
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    updateTimeScale(delta);
    if (state.hitStopTimer > 0) {
        state.hitStopTimer = Math.max(0, state.hitStopTimer - delta);
        const shake = getCameraShakeOffset(delta);
        camera.position.add(shake);
        renderer.render(scene, camera);
        camera.position.sub(shake);
        return;
    }
    const scaledDelta = delta * state.timeScale;
    
    updatePlayer(delta);
    updateEnemies(delta);
    stepPhysics(delta);
    entityManager.syncEnemyBodies();
    syncPlayerFromPhysics();
    updatePickups(scaledDelta);
    updateParticles(scaledDelta);
    weaponSystem.updateReloadIndicator();

    if (refs.shieldUniforms) {
        refs.shieldUniforms.uTime.value = clock.getElapsedTime();
    }

    const shake = getCameraShakeOffset(delta);
    camera.position.add(shake);
    renderer.render(scene, camera);
    camera.position.sub(shake);
}

// Particle Animation
function updateParticles(delta) {
    if (!collections.particles.length) return;
    
    for (let i = collections.particles.length - 1; i >= 0; i--) {
        const particle = collections.particles[i];
        
        // Update position
        particle.position.addScaledVector(particle.userData.velocity, delta);
        particle.userData.velocity.y -= 9.8 * delta; // Gravity
        
        // Update lifetime
        particle.userData.lifetime -= delta;
        const lifeRatio = particle.userData.maxLifetime > 0
            ? particle.userData.lifetime / particle.userData.maxLifetime
            : 0;
        particle.material.opacity = Math.max(0, Math.min(1, lifeRatio));
        
        // Remove dead particles
        if (particle.userData.lifetime <= 0 || particle.position.y < 0) {
            collections.particles.splice(i, 1);
            releaseParticle(particle);
        }
    }
}

function updatePickups(delta) {
    if (!collections.pickups.length) return;
    const currentWeapon = weaponSystem.getWeapon();
    if (!currentWeapon) return;
    const world = refs.physics?.world || null;
    const playerCollider = refs.physics?.playerCollider || null;
    for (let i = collections.pickups.length - 1; i >= 0; i--) {
        const pickup = collections.pickups[i];
        if (!pickup) {
            collections.pickups.splice(i, 1);
            continue;
        }
        pickup.rotation.y += delta * 1.5;
        let shouldPickup = false;
        if (world && playerCollider && pickup.userData?.colliderHandle != null) {
            shouldPickup = areCollidersOverlapping(world, playerCollider, pickup.userData.colliderHandle);
        } else {
            const distance = pickup.position.distanceTo(camera.position);
            shouldPickup = distance <= 2.2;
        }
        if (shouldPickup) {
            const beforeAmmo = state.reserveAmmo;
            const addAmount = Math.max(1, Math.round(state.maxAmmo * (pickup.userData.amountMags || 1)));
            state.reserveAmmo = Math.min(currentWeapon.reserveMax, state.reserveAmmo + addAmount);
            weaponSystem.syncWeaponInventory();
            ui.updateHUD();
            if (state.reserveAmmo > beforeAmmo) {
                ui.showPrompt('Ammo +1 mag', 1000);
            } else {
                ui.showPrompt('Ammo full', 800);
            }
            removePickupCollider(pickup);
            refs.scene.remove(pickup);
            collections.pickups.splice(i, 1);
        }
    }
}

// Start the game when the page loads
window.addEventListener('load', init);
