import { Config, GamePhase, WeaponCatalog } from './core/config.js';
import { state } from './core/state.js';
import { refs, collections } from './core/refs.js';
import { dom } from './core/dom.js';
import { createAudioManager } from './systems/AudioManager.js';
import { createInputManager } from './systems/InputManager.js';
import { createUIController } from './systems/UIController.js';
import { createWeaponSystem } from './systems/WeaponSystem.js';
import { createEntityManager } from './systems/EntityManager.js';
import { createEnvironmentManager } from './systems/EnvironmentManager.js';
let RAPIER = null;
let PathfindingCtor = null;

/**
 * 3D Shooter Game - Fixed & Improved Version
 * Built with Three.js
 */

let scene, camera, renderer, composer;
let player;
let bloomPass, vignettePass;
let clock;
let currentLayout = null; // Removed
let upgradeOptions = [];
let ammoCrateGeometry = null; // Removed
let ammoCrateMaterial = null; // Removed
let physics = null;
let pathfinding = null;
const NAV_ZONE_ID = 'arena';
const WORLD_BOUNDARY = 90;

const audio = createAudioManager();
let weaponSystem;
let entityManager;
let environmentManager;

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
        onRegenerateMap: () => environmentManager?.regenerateMap(),
        onPlayerDamage: takeDamage,
        onTriggerTimeSlow: triggerTimeSlow,
        onEnemyDrop: (pos) => environmentManager?.spawnAmmoCrate(pos)
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

environmentManager = createEnvironmentManager({
    state,
    refs,
    collections,
    ui,
    audio,
    callbacks: {
        onPickupCollected: (pickup) => {
            if (pickup.userData.type === 'ammo') {
                const currentWeapon = weaponSystem.getWeapon();
                if (!currentWeapon) return false;
                if (state.reserveAmmo >= currentWeapon.reserveMax) {
                    ui.showPrompt('Ammo full', 800);
                    return false;
                }
                const beforeAmmo = state.reserveAmmo;
                const addAmount = Math.max(1, Math.round(state.maxAmmo * (pickup.userData.amountMags || 1)));
                state.reserveAmmo = Math.min(currentWeapon.reserveMax, state.reserveAmmo + addAmount);
                weaponSystem.syncWeaponInventory();
                ui.updateHUD();
                if (state.reserveAmmo > beforeAmmo) {
                    ui.showPrompt('Ammo +1 mag', 1000);
                    return true;
                }
            }
            return false;
        }
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





function releaseParticle(particle) {
    if (!particle) return;
    const type = particle.userData?.poolType;
    if (!type || !collections.particlePools[type]) return;
    particle.visible = false;
    refs.scene?.remove(particle);
    collections.particlePools[type].push(particle);
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
    state.phase = GamePhase.LOADING;
    try {
        await loadExternalLibraries();

        // Create Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x445566);
        scene.fog = new THREE.Fog(0x445566, 30, 180);
        
        // Create Camera
        camera = new THREE.PerspectiveCamera(
            Config.fov,
            window.innerWidth / window.innerHeight,
            Config.near,
            Config.far
        );
        camera.position.set(0, Config.playerHeight, 0);
        scene.add(camera);

        // Add Audio Listener for spatial sound
        const listener = new THREE.AudioListener();
        camera.add(listener);
        audio.setListener(listener);

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
        
        // Create Environment
        environmentManager.createEnvironment();

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
        
        // Setup Post-processing
        setupPostProcessing();
        
        // Handle Window Resize
        window.addEventListener('resize', onWindowResize);
        
        // Hide Loading Screen
        ui.finishLoading();
        
        // Show Start Screen
        state.phase = GamePhase.START;
        dom.startScreen?.classList.remove('hidden');
        
        // Start rendering immediately
        animate();
        
        console.log('Game initialized successfully!');
    } catch (error) {
        console.error('Failed to initialize game:', error);
        ui.finishLoading();
        state.phase = GamePhase.START;
        dom.startScreen?.classList.remove('hidden');
        ui.showPrompt('Init failed. Check console for details.', 4000);
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
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
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

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    const scaledDelta = delta * state.timeScale;
    
    if (state.phase === GamePhase.PLAYING) {
        updateTimeScale(delta);
        
        if (state.hitStopTimer > 0) {
            state.hitStopTimer = Math.max(0, state.hitStopTimer - delta);
        } else {
            updatePlayer(delta);
            updateEnemies(delta);
            stepPhysics(delta);
            entityManager.syncEnemyBodies();
            syncPlayerFromPhysics();
            updateParticles(scaledDelta);
            weaponSystem.updateReloadIndicator();

            if (refs.shieldUniforms) {
                refs.shieldUniforms.uTime.value = clock.getElapsedTime();
            }
        }
    }
    
    const shake = getCameraShakeOffset(delta);
    camera.position.add(shake);
    
    const isPlaying = state.phase === GamePhase.PLAYING;
    const isStart = state.phase === GamePhase.START;
    
    try {
        if (composer && !state.lowPowerMode && (isPlaying || isStart)) {
            composer.render(delta);
        } else {
            renderer.render(scene, camera);
        }
    } catch (e) {
        if (!state._renderErrorLogged) {
            console.error('Render failure:', e);
            state._renderErrorLogged = true;
        }
        renderer.render(scene, camera);
    }
    
    camera.position.sub(shake);
}

function setupPostProcessing() {
    if (state.lowPowerMode) return;
    
    try {
        // Init Composer
        composer = new THREE.EffectComposer(renderer);
        
        // Render Pass
        const renderPass = new THREE.RenderPass(scene, camera);
        composer.addPass(renderPass);
        
        // Bloom Pass
        bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.0,  // Strength (Reduced)
            0.3,  // Radius
            0.5   // Threshold (Increased significantly to only bloom highlights)
        );
        composer.addPass(bloomPass);
        
        // Vignette Pass
        if (THREE.VignetteShader) {
            vignettePass = new THREE.ShaderPass(THREE.VignetteShader);
            vignettePass.uniforms['offset'].value = 1.0;
            vignettePass.uniforms['darkness'].value = 1.3;
            composer.addPass(vignettePass);
        }
    } catch (error) {
        console.warn('Post-processing setup failed. Falling back to standard rendering.', error);
        composer = null;
    }
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



// Start the game when the page loads
window.addEventListener('load', init);
