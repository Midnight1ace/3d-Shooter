import { Config, GamePhase, WeaponCatalog } from './core/config.js';
import { state } from './core/state.js';
import { refs, collections } from './core/refs.js';
import { dom } from './core/dom.js';
import { createAudioManager } from './systems/AudioManager.js';
import { createInputManager } from './systems/InputManager.js';
import { createUIController } from './systems/UIController.js';
import { createWeaponSystem } from './systems/WeaponSystem.js';
import { createEntityManager } from './systems/EntityManager.js';

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
}

function clearPickups() {
    collections.pickups.forEach((pickup) => {
        if (pickup) refs.scene?.remove(pickup);
    });
    collections.pickups = [];
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
    collections.mapObstacles.push(mesh);
    scene.add(mesh);
}

function clearMapObstacles() {
    collections.mapObstacles.forEach((obj) => {
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
        pitch: 0
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
    entityManager.updateEnemies(delta);
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
        camera.position.y -= 0.04;
        setTimeout(() => {
            camera.position.y = Config.playerHeight;
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
    state.phase = GamePhase.CHOOSING;
    document.exitPointerLock();
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
    collections.enemies.forEach((enemy) => scene.remove(enemy.mesh));
    collections.enemies = [];
    clearPickups();
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    
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
    document.exitPointerLock();
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
    collections.enemies.forEach((enemy) => scene.remove(enemy.mesh));
    collections.enemies = [];
    clearPickups();
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    
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
    document.exitPointerLock();
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
    if (!state.isPointerLocked || state.phase !== GamePhase.PLAYING) return;
    
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
        const speed = baseSpeed * (delta * 60);
        player.velocity.copy(player.direction).multiplyScalar(speed);
    }
    
    // Apply movement with collision
    const desiredPosition = camera.position.clone().add(player.velocity);
    desiredPosition.y = Config.playerHeight;
    const resolvedPosition = resolvePlayerCollisions(desiredPosition);
    camera.position.copy(resolvedPosition);
    
    // Boundary check
    const boundary = 90;
    camera.position.x = Math.max(-boundary, Math.min(boundary, camera.position.x));
    camera.position.z = Math.max(-boundary, Math.min(boundary, camera.position.z));
    
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
        const box = new THREE.Box3().setFromObject(obstacle);
        box.min.x -= radius;
        box.max.x += radius;
        box.min.z -= radius;
        box.max.z += radius;

        if (resolved.x < box.min.x || resolved.x > box.max.x || resolved.z < box.min.z || resolved.z > box.max.z) {
            continue;
        }

        if (playerY < box.min.y - 1 || playerY > box.max.y + 1) {
            continue;
        }

        const overlapX = Math.min(box.max.x - resolved.x, resolved.x - box.min.x);
        const overlapZ = Math.min(box.max.z - resolved.z, resolved.z - box.min.z);
        if (overlapX < overlapZ) {
            const centerX = (box.min.x + box.max.x) * 0.5;
            resolved.x = resolved.x < centerX ? box.min.x : box.max.x;
        } else {
            const centerZ = (box.min.z + box.max.z) * 0.5;
            resolved.z = resolved.z < centerZ ? box.min.z : box.max.z;
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
    updateEnemies(scaledDelta);
    updatePickups(scaledDelta);
    updateParticles(scaledDelta);
    weaponSystem.updateReloadIndicator();

    const shake = getCameraShakeOffset(delta);
    camera.position.add(shake);
    renderer.render(scene, camera);
    camera.position.sub(shake);
}

// Particle Animation
function updateParticles(delta) {
    if (!window.hitParticles) return;
    
    for (let i = window.hitParticles.length - 1; i >= 0; i--) {
        const particle = window.hitParticles[i];
        
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
            scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
            window.hitParticles.splice(i, 1);
        }
    }
}

function updatePickups(delta) {
    if (!collections.pickups.length) return;
    const currentWeapon = weaponSystem.getWeapon();
    if (!currentWeapon) return;
    for (let i = collections.pickups.length - 1; i >= 0; i--) {
        const pickup = collections.pickups[i];
        if (!pickup) {
            collections.pickups.splice(i, 1);
            continue;
        }
        pickup.rotation.y += delta * 1.5;
        const distance = pickup.position.distanceTo(camera.position);
        if (distance <= 2.2) {
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
            refs.scene.remove(pickup);
            collections.pickups.splice(i, 1);
        }
    }
}

// Start the game when the page loads
window.addEventListener('load', init);
