import { Config, GamePhase, WeaponCatalog } from './core/config.js';
import { state } from './core/state.js';
import { refs, collections } from './core/refs.js';
import { dom } from './core/dom.js';
import { createAudioManager } from './systems/engine/AudioManager.js';
import { createInputManager } from './systems/engine/InputManager.js';
import { createUIController } from './systems/ui/UIController.js';
import { createWeaponSystem } from './systems/gameplay/WeaponSystem.js';
import { createEntityManager } from './systems/gameplay/EntityManager.js';
import { createEnvironmentManager } from './systems/gameplay/EnvironmentManager.js';
import { createRuntimeLogger } from './systems/debug/RuntimeLogger.js';
import { createPhysicsSystem } from './systems/engine/PhysicsSystem.js';
import { createEffectsSystem } from './systems/gameplay/EffectsSystem.js';
import { createUpgradeSystem } from './systems/gameplay/UpgradeSystem.js';
import { createPlayerSystem } from './systems/gameplay/PlayerSystem.js';
import { createCollisionSystem } from './systems/engine/CollisionSystem.js';
let RAPIER = null;
let PathfindingCtor = null;
const NAV_ZONE_ID = 'arena';
const WORLD_BOUNDARY = 90;

const audio = createAudioManager();
let weaponSystem;
let entityManager;
let environmentManager;
let physicsSystem;
let effectsSystem;
let upgradeSystem;
let collisionSystem;
let playerSystem;
let scene, camera, renderer, clock;
let animationLoopActive = false;
const runtimeLogger = createRuntimeLogger({
    enabled: ['localhost', '127.0.0.1'].includes(window.location.hostname),
    name: new URLSearchParams(window.location.search).get('logName') || 'gameplay',
    endpoint: '/__logs'
});
runtimeLogger.start();
window.addEventListener('beforeunload', () => {
    runtimeLogger.flush();
});
window.addEventListener('pagehide', () => {
    runtimeLogger.flush();
});

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

effectsSystem = createEffectsSystem({
    state,
    config: Config,
    refs,
    collections,
    dom,
    renderer: null, // Will be set in init
    scene: null,    // Will be set in init
    camera: null    // Will be set in init
});

physicsSystem = createPhysicsSystem({
    state,
    refs,
    collections,
    callbacks: {}
});

collisionSystem = createCollisionSystem({
    state,
    config: Config,
    refs,
    collections
});

entityManager = createEntityManager({
    state,
    config: Config,
    refs,
    collections,
    ui,
    audio,
    collisionSystem,
    callbacks: {
        onWaveCleared: () => upgradeSystem.openUpgradeScreen(),
        onWaveStart: () => {
            dom.hud?.classList.remove('hidden');
            ui.hideUpgradeScreen();
        },
        onRegenerateMap: () => environmentManager?.regenerateMap(),
        onPlayerDamage: takeDamage,
        onTriggerTimeSlow: () => effectsSystem.triggerTimeSlow(),
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
        onMouseMove: (e) => playerSystem.handleMouseMove(e),
        onAdjustUiScale: (delta) => ui.adjustUiScale(delta),
        onSetUiScale: (value) => ui.setUiScale(value),
        onStart: startGame,
        onResume: resumeGame,
        onRestart: restartGame,
        onPause: pauseGame,
        onSelectUpgrade: (i) => upgradeSystem.selectUpgrade(i),
        onBuyAmmo: () => buyAmmo(100, 'mid'),
        onInteract: () => {},
        onToggleScreenShake: () => effectsSystem.toggleScreenShake(ui),
        onToggleHitStop: () => effectsSystem.toggleHitStop(ui)
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
    collisionSystem,
    callbacks: {
        onAddCameraShake: (amt) => effectsSystem.addCameraShake(amt),
        onHitStop: (mult) => effectsSystem.triggerHitStop(mult)
    }
});

upgradeSystem = createUpgradeSystem({
    state,
    dom,
    ui,
    weaponSystem,
    callbacks: {
        onStartWave: startWave,
        onResumeClock: () => clock.start()
    }
});

playerSystem = createPlayerSystem({
    state,
    refs,
    collections,
    dom,
    camera: null, // Will be set in init
    input,
    weaponSystem,
    collisionSystem,
    callbacks: {
        onPhysicsError: (reason, err) => physicsSystem.disablePhysics(reason, err)
    }
});

environmentManager = createEnvironmentManager({
    state,
    refs,
    collections,
    ui,
    audio,
    collisionSystem,
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
        import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.0/+esm'),
        import('https://cdn.jsdelivr.net/npm/three-pathfinding@1.3.0/dist/three-pathfinding.module.js')
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






function releaseParticle(particle) {
    effectsSystem.releaseParticle(particle);
}

function clearEnemies() {
    collections.enemies.forEach((enemy) => {
        const colliderHandle = collisionSystem.getColliderHandle(enemy?.collider);
        if (colliderHandle != null && refs.physics?.world) {
            refs.physics.world.removeCollider(colliderHandle, true);
        }
        if (enemy?.body && refs.physics?.world) {
            const bodyHandle = typeof enemy.body === 'number' ? enemy.body : enemy.body.handle;
            if (bodyHandle != null) {
                refs.physics.world.removeRigidBody(bodyHandle);
            }
        }
        if (enemy?.mesh) {
            refs.scene?.remove(enemy.mesh);
        }
    });
    collections.enemies.length = 0;
    ui.updateHUD();
}

function clearPickups() {
    environmentManager?.clearPickups?.();
}

function clearActiveParticles() {
    effectsSystem.clearActiveParticles();
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

        // Feed references back into systems
        effectsSystem = createEffectsSystem({
            state,
            config: Config,
            refs,
            collections,
            dom,
            renderer,
            scene,
            camera
        });

        playerSystem = createPlayerSystem({
            state,
            refs,
            collections,
            dom,
            camera,
            input,
            weaponSystem,
            callbacks: {
                onPhysicsError: (reason, err) => physicsSystem.disablePhysics(reason, err)
            }
        });

        refs.shieldUniforms = {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x3df2ff) }
        };
        if (typeof PathfindingCtor === 'function') {
            const pathfinding = new PathfindingCtor();
            refs.pathfinding = pathfinding;
            refs.navZoneId = NAV_ZONE_ID;
        }

        try {
            await physicsSystem.initPhysics(RAPIER);
        } catch (error) {
            console.warn('Physics init failed.', error);
            refs.physics = null;
        }
        
        // Create Environment
        environmentManager.createEnvironment();

        // Create Player
        playerSystem.createPlayer();

        // Create Weapon
        weaponSystem.createWeapon();

        // Load animated enemy model
        entityManager.loadEnemyModel();
        
        // Setup Controls
        input.attach();
        
        // Setup UI
        ui.setupUI();
        
        // Setup Post-processing
        effectsSystem.setupPostProcessing();
        
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
        refs.pathfinding = null;
    }
}

// Take Damage - Fixed
function takeDamage(amount, sourcePosition) {
    state.health = Math.max(0, state.health - amount);
    ui.updateHUD();
    audio.playUiSound('damage');
    ui.showDamageDirection(sourcePosition, camera);
    effectsSystem.addCameraShake(Config.cameraShakeDamage);
    
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
        if (refs.player) {
            refs.player.viewOffsetY = -0.04;
        }
        setTimeout(() => {
            if (refs.player) {
                refs.player.viewOffsetY = 0;
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
    environmentManager?.clearPickups?.();
    clearActiveParticles();
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    if (refs.player) {
        refs.player.yaw = 0;
        refs.player.pitch = 0;
        refs.player.viewOffsetY = 0;
    }
    physicsSystem.resetPlayerPhysics();
    
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
    // animate() is already running from init()
    
    console.log('Game started');
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
    environmentManager?.clearPickups?.();
    clearActiveParticles();
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    if (refs.player) {
        refs.player.yaw = 0;
        refs.player.pitch = 0;
        refs.player.viewOffsetY = 0;
    }
    physicsSystem.resetPlayerPhysics();
    
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
    const composer = effectsSystem.getComposer();
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Player Movement

function animate() {
    if (!animationLoopActive) {
        animationLoopActive = true;
    } else {
        return;
    }
    animateFrame();
}

function animateFrame() {
    requestAnimationFrame(animateFrame);
    
    // Use a fixed max delta to avoid huge jumps or 0 values
    const delta = Math.min(0.1, clock.getDelta());
    const scaledDelta = delta * state.timeScale;
    
    if (state.phase === GamePhase.PLAYING) {
        effectsSystem.updateTimeScale(delta);
        
        if (state.hitStopTimer > 0) {
            state.hitStopTimer = Math.max(0, state.hitStopTimer - delta);
        } else {
            playerSystem.updatePlayer(delta, clock);
            updateEnemies(delta);
            environmentManager?.update?.(scaledDelta);
            physicsSystem.stepPhysics(delta);
            entityManager.syncEnemyBodies();
            physicsSystem.syncPlayerFromPhysics(camera, refs.player);
            effectsSystem.updateParticles(scaledDelta);
            weaponSystem.updateReloadIndicator();

            if (refs.shieldUniforms) {
                refs.shieldUniforms.uTime.value = clock.getElapsedTime();
            }
        }
    } else {
        // Reduced updates for non-playing phases (e.g. still update particles or uniforms if needed)
        if (refs.shieldUniforms) {
            refs.shieldUniforms.uTime.value = clock.getElapsedTime();
        }
        effectsSystem.updateParticles(scaledDelta);
    }
    
    const shake = effectsSystem.getCameraShakeOffset(delta);
    effectsSystem.render(shake);
}




// Start the game when the page loads
window.addEventListener('load', init);
