/**
 * 3D Shooter Game - Fixed & Improved Version
 * Built with Three.js
 */

// Game State
const GameState = {
    LOADING: 'loading',
    START: 'start',
    PLAYING: 'playing',
    PAUSED: 'paused',
    CHOOSING: 'choosing',
    GAME_OVER: 'game_over'
};

// Game Configuration
const Config = {
    // Scene
    fov: 80,
    near: 0.1,
    far: 1000,
    
    // Player
    playerHeight: 1.7,
    playerSpeed: 0.12,
    playerSprintMultiplier: 1.8,
    
    // Weapons
    weaponFireRate: 80, // ms between shots
    weaponDamage: 35,
    weaponRange: 200,
    reloadDuration: 1500,
    reloadSprintMultiplier: 1.35,
    perfectReloadWindow: 0.18,
    perfectReloadBonus: 2,
    
    // Enemies
    enemySpawnRate: 3000,
    enemySpeed: 0.06,
    enemyDamage: 15,
    lowAmmoThreshold: 5,
    timeSlowIntensity: 0.6,
    timeSlowDuration: 0.35,
    timeSlowRecovery: 0.2,
    
    // Game
    maxHealth: 100,
    maxAmmo: 25,
    totalAmmo: 100,
    minUiScale: 0.85,
    maxUiScale: 1.25,
    uiScaleStep: 0.05,
    treeCount: 30,
    crateCount: 15,
    barrierCount: 10,
    pillarCount: 6
};

const WeaponCatalog = [
    {
        id: 'pistol-vx9',
        name: 'VX-9 Pistol',
        type: 'pistol',
        damage: 22,
        fireRate: 220,
        range: 140,
        magSize: 12,
        reserveMax: 72,
        recoil: 0.05,
        spread: 0.01,
        pellets: 1,
        model: 'pistol'
    },
    {
        id: 'pistol-mk2',
        name: 'MK-2 Sidearm',
        type: 'pistol',
        damage: 18,
        fireRate: 160,
        range: 130,
        magSize: 15,
        reserveMax: 90,
        recoil: 0.04,
        spread: 0.012,
        pellets: 1,
        model: 'pistol'
    },
    {
        id: 'smg-rapid',
        name: 'Rapid SMG',
        type: 'smg',
        damage: 14,
        fireRate: 75,
        range: 110,
        magSize: 28,
        reserveMax: 140,
        recoil: 0.04,
        spread: 0.018,
        pellets: 1,
        model: 'smg'
    },
    {
        id: 'smg-compact',
        name: 'Compact SMG',
        type: 'smg',
        damage: 16,
        fireRate: 90,
        range: 115,
        magSize: 24,
        reserveMax: 120,
        recoil: 0.05,
        spread: 0.016,
        pellets: 1,
        model: 'smg'
    },
    {
        id: 'rifle-guardian',
        name: 'Guardian Rifle',
        type: 'rifle',
        damage: 26,
        fireRate: 140,
        range: 190,
        magSize: 25,
        reserveMax: 125,
        recoil: 0.06,
        spread: 0.012,
        pellets: 1,
        model: 'rifle'
    },
    {
        id: 'rifle-horizon',
        name: 'Horizon Rifle',
        type: 'rifle',
        damage: 30,
        fireRate: 170,
        range: 200,
        magSize: 22,
        reserveMax: 110,
        recoil: 0.07,
        spread: 0.011,
        pellets: 1,
        model: 'rifle'
    },
    {
        id: 'shotgun-breach',
        name: 'Breach Shotgun',
        type: 'shotgun',
        damage: 12,
        fireRate: 420,
        range: 80,
        magSize: 8,
        reserveMax: 40,
        recoil: 0.1,
        spread: 0.07,
        pellets: 6,
        model: 'shotgun'
    },
    {
        id: 'shotgun-heavy',
        name: 'Atlas Shotgun',
        type: 'shotgun',
        damage: 14,
        fireRate: 460,
        range: 85,
        magSize: 6,
        reserveMax: 36,
        recoil: 0.12,
        spread: 0.08,
        pellets: 7,
        model: 'shotgun'
    }
];

// Global Variables
let scene, camera, renderer;
let player, weapon;
let enemies = [];
let bullets = [];
let mapObstacles = [];
let currentLayout = null;
let clock;
let gameState = GameState.LOADING;
let score = 0;
let wave = 1;
let maxHealth = Config.maxHealth;
let health = Config.maxHealth;
let maxAmmo = Config.maxAmmo;
let ammo = Config.maxAmmo;
let reserveAmmo = Config.totalAmmo;
let isPointerLocked = false;
let audioContext = null;
let uiScale = 1;
let lowPowerMode = false;
let loadingTimer = null;
let loadingProgress = 0;
let reloadStartTime = 0;
let reloadDurationCurrent = Config.reloadDuration;
let damageDirectionTimeout = null;
let lowAmmoPromptCooldown = 0;
let promptTimeouts = [];
let promptHideTimeout = null;
let debugMode = false;
let damageMultiplier = 1;
let reloadSpeedMultiplier = 1;
let moveSpeedMultiplier = 1;
let magSizeMultiplier = 1;
let timeSlowIntensity = Config.timeSlowIntensity;
let timeSlowDuration = Config.timeSlowDuration;
let timeScale = 1;
let timeSlowTimer = 0;
let cameraShake = 0;
const shakeOffset = new THREE.Vector3();
let upgradeOptions = [];
let currentWeaponId = 'rifle-guardian';
let weaponInventory = {};

// DOM Elements
const gameCanvas = document.getElementById('game-canvas');
const hud = document.getElementById('hud');
const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const loadingScreen = document.getElementById('loading-screen');
const startButton = document.getElementById('start-button');
const resumeButton = document.getElementById('resume-button');
const restartButton = document.getElementById('restart-button');
const restartGameButton = document.getElementById('restart-game-button');
const enemyCountEl = document.getElementById('enemy-count');
const ammoFill = document.getElementById('ammo-fill');
const reloadIndicator = document.getElementById('reload-indicator');
const reloadFill = document.getElementById('reload-fill');
const interactionPrompt = document.getElementById('interaction-prompt');
const damageDirection = document.getElementById('damage-direction');
const loadingBar = document.getElementById('loading-bar');
const loadingFill = document.getElementById('loading-fill');
const loadingPercent = document.getElementById('loading-percent');
const chipSprint = document.getElementById('chip-sprint');
const chipReload = document.getElementById('chip-reload');
const chipBuy = document.getElementById('chip-buy');
const upgradeScreen = document.getElementById('upgrade-screen');
const upgradeOptionsEl = document.getElementById('upgrade-options');
const lowHealthVignette = document.getElementById('low-health-vignette');
const weaponNameEl = document.getElementById('weapon-name');
const weaponOptionsEl = document.getElementById('weapon-options');
const buyAmmoRoundButton = document.getElementById('buy-ammo-round-button');
const creditsEl = document.getElementById('credits');
const armoryWaveEl = document.getElementById('armory-wave');
const armoryCreditsEl = document.getElementById('armory-credits');

startLoading();

function startLoading() {
    if (!loadingScreen || !loadingFill || !loadingPercent) return;
    loadingProgress = 0;
    updateLoadingUI();
    loadingTimer = setInterval(() => {
        const bump = 3 + Math.random() * 7;
        loadingProgress = Math.min(95, loadingProgress + bump);
        updateLoadingUI();
    }, 120);
}

function finishLoading() {
    if (!loadingScreen || !loadingFill || !loadingPercent) return;
    if (loadingTimer) {
        clearInterval(loadingTimer);
        loadingTimer = null;
    }
    loadingProgress = 100;
    updateLoadingUI();
    setTimeout(() => {
        loadingScreen.classList.add('hidden');
    }, 200);
}

function updateLoadingUI() {
    if (!loadingFill || !loadingPercent) return;
    loadingFill.style.width = `${loadingProgress}%`;
    loadingPercent.textContent = Math.round(loadingProgress);
}

function addCameraShake(amount) {
    cameraShake = Math.min(0.25, cameraShake + amount);
}

function getCameraShakeOffset(delta) {
    if (cameraShake <= 0) {
        shakeOffset.set(0, 0, 0);
        return shakeOffset;
    }
    cameraShake = Math.max(0, cameraShake - delta * 2.5);
    const strength = cameraShake * cameraShake;
    shakeOffset.set(
        (Math.random() - 0.5) * strength,
        (Math.random() - 0.5) * strength,
        0
    );
    return shakeOffset;
}

function updateTimeScale(delta) {
    if (timeSlowTimer > 0) {
        timeSlowTimer -= delta;
        timeScale = timeSlowIntensity;
        document.body.classList.add('time-slow');
        return;
    }
    if (timeScale < 1) {
        timeScale = Math.min(1, timeScale + delta / Config.timeSlowRecovery);
        if (timeScale >= 1) {
            document.body.classList.remove('time-slow');
        }
    }
}

function triggerTimeSlow() {
    timeSlowTimer = timeSlowDuration;
    timeScale = timeSlowIntensity;
    document.body.classList.add('time-slow');
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

    // Create Renderer
    lowPowerMode = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    renderer = new THREE.WebGLRenderer({
        canvas: gameCanvas,
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPowerMode ? 1 : 1.5));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = !lowPowerMode;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Create Clock
    clock = new THREE.Clock();
    
    // Setup Lighting - Improved
    setupLighting();
    
    // Create Environment - Improved
    createEnvironment();
    
    // Create Player
    createPlayer();
    
    // Create Weapon
    createWeapon();
    
    // Setup Controls
    setupControls();
    
    // Setup UI
    setupUI();
    
    // Handle Window Resize
    window.addEventListener('resize', onWindowResize);
    
    // Hide Loading Screen
    finishLoading();
    
    // Show Start Screen
    gameState = GameState.START;
    startScreen.classList.remove('hidden');
    
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
    directionalLight.castShadow = !lowPowerMode;
    directionalLight.shadow.mapSize.width = lowPowerMode ? 1024 : 2048;
    directionalLight.shadow.mapSize.height = lowPowerMode ? 1024 : 2048;
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

function addMapObject(mesh) {
    mapObstacles.push(mesh);
    scene.add(mesh);
}

function clearMapObstacles() {
    mapObstacles.forEach((obj) => {
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
    mapObstacles = [];
}

function regenerateMap() {
    clearMapObstacles();
    const layouts = ['lanes', 'ring', 'cross', 'scatter'];
    let nextLayout = layouts[Math.floor(Math.random() * layouts.length)];
    if (nextLayout === currentLayout && layouts.length > 1) {
        const idx = (layouts.indexOf(nextLayout) + 1) % layouts.length;
        nextLayout = layouts[idx];
    }
    currentLayout = nextLayout;

    const density = lowPowerMode ? 0.6 : 1;
    const castShadow = !lowPowerMode;

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
    ground.receiveShadow = !lowPowerMode;
    scene.add(ground);
    
    // Create skybox effect with large sphere
    const skyGeometry = new THREE.SphereGeometry(400, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        color: 0x87CEEB,
        side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);
    
    const density = lowPowerMode ? 0.5 : 1;

    // Create some obstacles/cover - Improved colors
    regenerateMap();
    
    // Add decorative elements
    createTrees(density);
}

// Create Trees
function createTrees(density = 1) {
    const count = Math.max(8, Math.round(Config.treeCount * density));
    const castShadow = !lowPowerMode;
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
}

// Create Weapon - Enhanced
function createWeapon() {
    initWeaponInventory();
    weapon = {
        mesh: null,
        fireRate: Config.weaponFireRate,
        damage: Config.weaponDamage,
        range: Config.weaponRange,
        recoil: 0,
        recoilBase: 0.06,
        spread: 0.01,
        pellets: 1,
        magSize: Config.maxAmmo,
        reserveMax: Config.totalAmmo,
        name: 'VX-9 Rifle',
        isReloading: false,
        canShoot: true
    };

    equipWeapon(currentWeaponId, true);
    scene.add(camera);
}

function initWeaponInventory() {
    weaponInventory = {};
    WeaponCatalog.forEach((weaponDef) => {
        weaponInventory[weaponDef.id] = {
            ammo: weaponDef.magSize,
            reserve: weaponDef.reserveMax
        };
    });
}

function buildWeaponMesh(weaponDef) {
    const group = new THREE.Group();
    const darkMaterial = new THREE.MeshStandardMaterial({
        color: 0x1e232b,
        roughness: 0.35,
        metalness: 0.8
    });
    const midMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a414a,
        roughness: 0.45,
        metalness: 0.6
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
        color: 0x8da4b8,
        roughness: 0.3,
        metalness: 0.7
    });

    if (weaponDef.model === 'pistol') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.32), darkMaterial);
        body.position.z = -0.2;
        group.add(body);

        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.24), midMaterial);
        slide.position.set(0, 0.05, -0.22);
        group.add(slide);

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), accentMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.34);
        barrel.name = 'barrel';
        group.add(barrel);

        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), midMaterial);
        grip.position.set(0, -0.14, -0.1);
        grip.rotation.x = 0.25;
        group.add(grip);
    } else if (weaponDef.model === 'smg') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.5), darkMaterial);
        body.position.z = -0.32;
        group.add(body);

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8), accentMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.62);
        barrel.name = 'barrel';
        group.add(barrel);

        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), midMaterial);
        mag.position.set(0, -0.22, -0.2);
        mag.rotation.x = -0.1;
        group.add(mag);

        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.2), darkMaterial);
        stock.position.set(0, 0.03, 0.05);
        group.add(stock);
    } else if (weaponDef.model === 'shotgun') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.55), darkMaterial);
        body.position.z = -0.25;
        group.add(body);

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.7, 10), accentMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.04, -0.7);
        barrel.name = 'barrel';
        group.add(barrel);

        const pump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.18), midMaterial);
        pump.position.set(0, -0.03, -0.55);
        group.add(pump);

        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.25), darkMaterial);
        stock.position.set(0, 0.03, 0.1);
        group.add(stock);
    } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.7), darkMaterial);
        body.position.z = -0.35;
        group.add(body);

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.6, 8), accentMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.03, -0.8);
        barrel.name = 'barrel';
        group.add(barrel);

        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), midMaterial);
        mag.position.set(0, -0.25, -0.05);
        mag.rotation.x = -0.1;
        group.add(mag);

        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), accentMaterial);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.12, -0.3);
        group.add(scope);
    }

    group.position.set(0.25, -0.35, -0.4);
    return group;
}

function equipWeapon(weaponId, isInitial = false) {
    const weaponDef = WeaponCatalog.find((item) => item.id === weaponId);
    if (!weaponDef) return;

    syncWeaponInventory();

    if (weapon && weapon.mesh) {
        camera.remove(weapon.mesh);
    }

    const mesh = buildWeaponMesh(weaponDef);
    camera.add(mesh);

    weapon.mesh = mesh;
    weapon.fireRate = weaponDef.fireRate;
    weapon.damage = weaponDef.damage;
    weapon.range = weaponDef.range;
    weapon.recoilBase = weaponDef.recoil;
    weapon.spread = weaponDef.spread;
    weapon.pellets = weaponDef.pellets;
    const adjustedMag = Math.max(6, Math.round(weaponDef.magSize * magSizeMultiplier));
    const adjustedReserve = Math.max(adjustedMag * 3, Math.round(weaponDef.reserveMax * magSizeMultiplier));
    weapon.magSize = adjustedMag;
    weapon.reserveMax = adjustedReserve;
    weapon.name = weaponDef.name;
    weapon.canShoot = true;
    weapon.isReloading = false;
    currentWeaponId = weaponDef.id;

    if (!weaponInventory[currentWeaponId]) {
        weaponInventory[currentWeaponId] = {
            ammo: weaponDef.magSize,
            reserve: weaponDef.reserveMax
        };
    }

    maxAmmo = adjustedMag;
    const storedAmmo = weaponInventory[currentWeaponId].ammo;
    const storedReserve = weaponInventory[currentWeaponId].reserve;
    ammo = Math.min(storedAmmo, adjustedMag);
    reserveAmmo = Math.min(storedReserve, adjustedReserve);
    syncWeaponInventory();

    if (reloadIndicator) {
        reloadIndicator.classList.add('hidden');
    }
    if (reloadFill) {
        reloadFill.style.width = '0%';
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }

    if (!isInitial) {
        showPrompt(`Equipped ${weaponDef.name}`, 1400);
    }
    updateHUD();
}

function syncWeaponInventory() {
    if (!currentWeaponId || !weaponInventory[currentWeaponId]) return;
    weaponInventory[currentWeaponId].ammo = ammo;
    weaponInventory[currentWeaponId].reserve = reserveAmmo;
}

function refreshWeaponStats() {
    if (!weapon || !currentWeaponId) return;
    equipWeapon(currentWeaponId, true);
}

// Setup Controls - Fixed
function setupControls() {
    // Pointer Lock - click anywhere to lock
    gameCanvas.addEventListener('click', () => {
        if (gameState === GameState.PLAYING && !isPointerLocked) {
            gameCanvas.requestPointerLock();
        }
    });
    
    document.addEventListener('pointerlockchange', () => {
        isPointerLocked = document.pointerLockElement === gameCanvas;
        if (!isPointerLocked && gameState === GameState.PLAYING) {
            showPrompt('Click to lock aim', 2000);
        }
    });
    
    // Mouse Movement
    document.addEventListener('mousemove', onMouseMove);
    
    // Keyboard
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    
    // Shooting - use mousedown on document for better reliability
    document.addEventListener('mousedown', onMouseDown);
}

// Mouse Movement Handler - Fixed
function onMouseMove(event) {
    if (!isPointerLocked || gameState !== GameState.PLAYING) return;
    
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    
    // Adjust sensitivity
    const sensitivity = 0.002;
    
    // Update yaw (horizontal rotation)
    player.yaw -= movementX * sensitivity;
    
    // Update pitch (vertical rotation)
    player.pitch -= movementY * sensitivity;
    
    // Clamp pitch to prevent flipping
    player.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, player.pitch));
    
    // Apply rotations to camera
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
}

// Keyboard State
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
    r: false
};

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': keys.w = true; break;
        case 'KeyA': keys.a = true; break;
        case 'KeyS': keys.s = true; break;
        case 'KeyD': keys.d = true; break;
        case 'ShiftLeft':
        case 'ShiftRight': keys.shift = true; break;
        case 'KeyR': reload(); break;
        case 'KeyE': interact(); break;
        case 'KeyB':
            if (gameState === GameState.PLAYING) {
                buyAmmo(100, 'mid');
            }
            break;
        case 'Digit1':
        case 'Numpad1':
            if (gameState === GameState.CHOOSING) {
                selectUpgrade(0);
            }
            break;
        case 'Digit2':
        case 'Numpad2':
            if (gameState === GameState.CHOOSING) {
                selectUpgrade(1);
            }
            break;
        case 'Digit3':
        case 'Numpad3':
            if (gameState === GameState.CHOOSING) {
                selectUpgrade(2);
            }
            break;
        case 'Equal':
        case 'NumpadAdd':
            adjustUiScale(Config.uiScaleStep);
            break;
        case 'Minus':
        case 'NumpadSubtract':
            adjustUiScale(-Config.uiScaleStep);
            break;
        case 'Digit0':
            setUiScale(1);
            break;
        case 'Enter':
        case 'Space':
            if (gameState === GameState.START) {
                startGame();
            } else if (gameState === GameState.PAUSED) {
                resumeGame();
            } else if (gameState === GameState.GAME_OVER) {
                restartGame();
            }
            break;
        case 'Escape':
            if (gameState === GameState.PLAYING) {
                pauseGame();
            } else if (gameState === GameState.PAUSED) {
                resumeGame();
            }
            break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': keys.w = false; break;
        case 'KeyA': keys.a = false; break;
        case 'KeyS': keys.s = false; break;
        case 'KeyD': keys.d = false; break;
        case 'ShiftLeft':
        case 'ShiftRight': keys.shift = false; break;
    }
}

// Interact function
function interact() {
    // For future use (pick up items, etc.)
}

function setUiScale(value) {
    uiScale = Math.max(Config.minUiScale, Math.min(Config.maxUiScale, value));
    document.documentElement.style.setProperty('--ui-scale', uiScale.toFixed(2));
    try {
        localStorage.setItem('uiScale', uiScale.toFixed(2));
    } catch (e) {
        // Ignore storage errors
    }
}

function adjustUiScale(delta) {
    setUiScale(uiScale + delta);
    showPrompt(`UI scale: ${Math.round(uiScale * 100)}%`, 1200);
}

// Mouse Down Handler - Fixed
function onMouseDown(event) {
    if (event.button === 0 && gameState === GameState.PLAYING && isPointerLocked) {
        if (weapon.isReloading) {
            cancelReload();
            return;
        }
        shoot();
    }
}

// Shoot Function - Fixed
function shoot() {
    if (!weapon.canShoot || weapon.isReloading) return;
    if (ammo <= 0) {
        showPrompt(reserveAmmo > 0 ? 'Reload needed' : 'Out of ammo', 1200);
        playUiSound('click');
        return;
    }
    
    weapon.canShoot = false;
    ammo--;
    syncWeaponInventory();
    updateHUD();
    
    // Play sound
    playShootSound();
    addCameraShake(0.02);
    
    // Muzzle flash
    showMuzzleFlash();
    
    // Apply recoil
    weapon.recoil = weapon.recoilBase;
    player.pitch += weapon.recoil;
    
    // Create bullet tracer
    createBulletTracer();
    
    // Raycast for hits - improved
    const raycaster = new THREE.Raycaster();
    const pellets = weapon.pellets || 1;
    let hitEnemy = false;

    for (let p = 0; p < pellets; p++) {
        const spreadX = (Math.random() - 0.5) * weapon.spread;
        const spreadY = (Math.random() - 0.5) * weapon.spread;
        raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);

        let closestHit = null;
        let closestEnemyIndex = -1;

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            const intersects = raycaster.intersectObject(enemy.mesh, true);
            if (intersects.length > 0) {
                const hit = intersects[0];
                if (hit.distance <= weapon.range && (!closestHit || hit.distance < closestHit.distance)) {
                    closestHit = hit;
                    closestEnemyIndex = i;
                }
            }
        }

        if (closestHit && closestEnemyIndex >= 0) {
            const enemy = enemies[closestEnemyIndex];
            const damage = weapon.damage * damageMultiplier;
            enemy.health -= damage;
            showHitMarker();
            flashEnemy(enemy.mesh);
            createHitEffect(closestHit.point);
            if (enemy.health <= 0) {
                killEnemy(closestEnemyIndex);
            }
            hitEnemy = true;
        }
    }
    if (hitEnemy) {
        playUiSound('hit');
        addCameraShake(0.01);
    }
    
    // Reset fire rate
    setTimeout(() => {
        weapon.canShoot = true;
    }, weapon.fireRate);
}

// Flash enemy red
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

// Create Bullet Tracer
function createBulletTracer() {
    if (lowPowerMode) return;
    const startPoint = new THREE.Vector3(0.25, -0.3, -1);
    startPoint.applyMatrix4(camera.matrixWorld);
    
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const endPoint = startPoint.clone().add(direction.multiplyScalar(50));
    
    const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
    const material = new THREE.LineBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0.8
    });
    
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    
    setTimeout(() => {
        scene.remove(line);
        geometry.dispose();
        material.dispose();
    }, 50);
}

// Reload Function
function reload() {
    if (gameState !== GameState.PLAYING) return;
    if (weapon.isReloading) {
        attemptPerfectReload();
        return;
    }
    if (ammo >= maxAmmo || reserveAmmo <= 0) return;

    weapon.isReloading = true;
    reloadStartTime = performance.now();
    reloadDurationCurrent = Config.reloadDuration * reloadSpeedMultiplier;
    const isSprinting = keys.shift && player.velocity.length() > 0;
    if (isSprinting) {
        reloadDurationCurrent *= Config.reloadSprintMultiplier;
    }

    ammo = 0;
    playUiSound('reload');
    syncWeaponInventory();
    updateHUD();

    // Show reload indicator
    if (reloadIndicator) {
        reloadIndicator.classList.remove('hidden');
    }
    if (reloadFill) {
        reloadFill.style.width = '0%';
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
    if (chipReload) {
        chipReload.classList.add('active');
    }

    // Animate weapon
    weapon.mesh.rotation.x = 0.8;
    weapon.mesh.position.z = -0.2;
    
    setTimeout(() => {
        if (!weapon.isReloading) return;
        finishReload(false);
    }, reloadDurationCurrent);
}

function finishReload(isPerfect) {
    const needed = maxAmmo - ammo;
    const loaded = Math.min(needed, reserveAmmo);
    ammo += loaded;
    reserveAmmo -= loaded;

    if (isPerfect && reserveAmmo > 0) {
        const bonus = Math.min(Config.perfectReloadBonus, reserveAmmo);
        ammo = Math.min(maxAmmo, ammo + bonus);
        reserveAmmo -= bonus;
        showPrompt('Perfect reload!', 1200);
        playUiSound('perfect');
    }

    weapon.isReloading = false;
    weapon.mesh.rotation.x = 0;
    weapon.mesh.position.z = -0.4;

    if (reloadIndicator) {
        reloadIndicator.classList.add('hidden');
    }
    if (chipReload) {
        chipReload.classList.remove('active');
    }
    if (reloadFill) {
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }

    syncWeaponInventory();
    updateHUD();
}

function attemptPerfectReload() {
    if (!weapon.isReloading) return;
    const progress = (performance.now() - reloadStartTime) / reloadDurationCurrent;
    if (progress >= 1 - Config.perfectReloadWindow) {
        finishReload(true);
    } else {
        cancelReload();
    }
}

function cancelReload() {
    if (!weapon.isReloading) return;
    weapon.isReloading = false;
    weapon.mesh.rotation.x = 0;
    weapon.mesh.position.z = -0.4;

    if (reloadIndicator) {
        reloadIndicator.classList.add('hidden');
    }
    if (reloadFill) {
        reloadFill.style.width = '0%';
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
    if (chipReload) {
        chipReload.classList.remove('active');
    }

    showPrompt('Reload canceled', 1000);
    syncWeaponInventory();
    updateHUD();
}

function updateReloadIndicator() {
    if (!weapon || !weapon.isReloading || !reloadFill) return;
    const progress = (performance.now() - reloadStartTime) / reloadDurationCurrent;
    const clamped = Math.min(1, Math.max(0, progress));
    reloadFill.style.width = `${clamped * 100}%`;
    if (clamped >= 1 - Config.perfectReloadWindow) {
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #2bd4c9)';
    } else {
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
}

// Create Hit Effect
function createHitEffect(position) {
    const particleCount = lowPowerMode ? 8 : 15;
    
    for (let i = 0; i < particleCount; i++) {
        const geometry = new THREE.SphereGeometry(0.05, 4, 4);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff3300,
            transparent: true
        });
        const particle = new THREE.Mesh(geometry, material);
        
        particle.position.copy(position);
        
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            Math.random() * 3,
            (Math.random() - 0.5) * 3
        );
        
        particle.userData = {
            velocity: velocity,
            lifetime: 0.5,
            maxLifetime: 0.5
        };
        
        scene.add(particle);
        
        if (!window.hitParticles) window.hitParticles = [];
        window.hitParticles.push(particle);
    }
}

// Show Muzzle Flash
function showMuzzleFlash() {
    const flash = document.getElementById('muzzle-flash');
    if (flash) {
        flash.style.opacity = '1';
        flash.style.background = `radial-gradient(circle, rgba(255,150,50,0.6) 0%, transparent 60%)`;
        setTimeout(() => {
            flash.style.opacity = '0';
        }, 80);
    }
    
    // Also flash the barrel
    const barrel = weapon.mesh.getObjectByName('barrel');
    if (barrel && barrel.material) {
        barrel.material.emissive = new THREE.Color(0xffaa00);
        barrel.material.emissiveIntensity = 2;
        setTimeout(() => {
            barrel.material.emissive = new THREE.Color(0x000000);
            barrel.material.emissiveIntensity = 0;
        }, 50);
    }
}

// Show Hit Marker - Fixed position
function showHitMarker() {
    const marker = document.createElement('div');
    marker.className = 'hit-marker';
    marker.style.left = '50%';
    marker.style.top = '50%';
    marker.style.transform = 'translate(-50%, -50%) rotate(45deg)';
    document.body.appendChild(marker);
    
    setTimeout(() => marker.remove(), 150);
}

function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Play Shoot Sound - Improved
function playShootSound() {
    try {
        ensureAudioContext();
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Gunshot sound
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.15);
        
        // Add noise for more realistic sound
        const bufferSize = audioContext.sampleRate * 0.1;
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.5;
        }
        
        const noiseSource = audioContext.createBufferSource();
        const noiseGain = audioContext.createGain();
        noiseSource.buffer = buffer;
        noiseGain.gain.setValueAtTime(0.3, audioContext.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        noiseSource.connect(noiseGain);
        noiseGain.connect(audioContext.destination);
        noiseSource.start();
    } catch (e) {
        console.log('Audio not supported');
    }
}

function playUiSound(type) {
    try {
        ensureAudioContext();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        const now = audioContext.currentTime;
        let frequency = 360;
        let duration = 0.08;
        let volume = 0.08;

        switch (type) {
            case 'hover':
                frequency = 520;
                duration = 0.05;
                volume = 0.05;
                break;
            case 'click':
                frequency = 240;
                duration = 0.09;
                volume = 0.08;
                break;
            case 'reload':
                frequency = 180;
                duration = 0.12;
                volume = 0.07;
                break;
            case 'perfect':
                frequency = 620;
                duration = 0.12;
                volume = 0.1;
                break;
            case 'damage':
                frequency = 120;
                duration = 0.16;
                volume = 0.12;
                break;
            case 'hit':
                frequency = 420;
                duration = 0.06;
                volume = 0.06;
                break;
            case 'kill':
                frequency = 320;
                duration = 0.14;
                volume = 0.09;
                break;
        }

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        gainNode.gain.setValueAtTime(volume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
        oscillator.start(now);
        oscillator.stop(now + duration);
    } catch (e) {
        console.log('Audio not supported');
    }
}

// Enemy Management - DEBUG VERSION
function spawnEnemy() {
    console.log('=== SPAWN ENEMY CALLED ===');
    console.log('gameState:', gameState);
    console.log('scene exists:', !!scene);
    console.log('camera exists:', !!camera);
    
    if (!scene) {
        console.error('ERROR: scene is undefined!');
        return;
    }
    
    try {
        // Enemy roles with tactical behavior
        const enemyTypes = [
            {
                role: 'fast',
                color: 0xff5d4d,
                speed: 0.075,
                health: 70
            },
            {
                role: 'tank',
                color: 0xffb84d,
                speed: 0.045,
                health: 150
            },
            {
                role: 'flanker',
                color: 0x7ac9ff,
                speed: 0.06,
                health: 90,
                preferredRange: 7
            },
            {
                role: 'exploder',
                color: 0x7cff7a,
                speed: 0.055,
                health: 85
            }
        ];

        const roll = Math.random();
        let baseType = enemyTypes[0];
        if (wave >= 2) {
            if (roll < 0.45) baseType = enemyTypes[0];
            else if (roll < 0.7) baseType = enemyTypes[1];
            else if (roll < 0.9) baseType = enemyTypes[2];
            else baseType = enemyTypes[3];
        }

        const healthBoost = Math.min(70, wave * 6);
        const speedBoost = Math.min(0.035, wave * 0.002);

        const enemy = createEnemyModel(baseType.role, baseType.color);
        
        // Position around the player
        const angle = Math.random() * Math.PI * 2;
        const radius = 25 + Math.random() * 30;
        enemy.position.x = camera.position.x + Math.cos(angle) * radius;
        enemy.position.z = camera.position.z + Math.sin(angle) * radius;
        enemy.position.y = baseType.role === 'tank' ? 0.35 : 0.2;
        enemy.castShadow = !lowPowerMode;
        enemy.receiveShadow = !lowPowerMode;
        
        scene.add(enemy);
        enemies.push({
            mesh: enemy,
            health: baseType.health + healthBoost,
            speed: baseType.speed + speedBoost,
            lastAttack: 0,
            role: baseType.role,
            preferredRange: baseType.preferredRange || 0,
            orbitDir: Math.random() < 0.5 ? -1 : 1
        });
        updateHUD();
        
        console.log('SUCCESS: Enemy created and added! Total:', enemies.length);
        
    } catch (error) {
        console.error('ERROR creating enemy:', error);
    }
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
            child.castShadow = !lowPowerMode;
            child.receiveShadow = !lowPowerMode;
        }
    });

    return group;
}

function killEnemy(index) {
    if (index < 0 || index >= enemies.length) return;
    
    const enemy = enemies[index];
    
    if (enemy.role === 'exploder') {
        explodeEnemy(index, true);
        return;
    }

    // Death effect
    createDeathEffect(enemy.mesh.position);
    
    scene.remove(enemy.mesh);
    enemies.splice(index, 1);
    
    score += 100;
    updateHUD();
    playUiSound('kill');
    triggerTimeSlow();
    
    // Check wave completion
    if (enemies.length === 0) {
        wave++;
        updateHUD();
        setTimeout(() => {
            if (gameState === GameState.PLAYING) {
                openUpgradeScreen();
            }
        }, 1200);
    }
}

function explodeEnemy(index, fromKill = false) {
    if (index < 0 || index >= enemies.length) return;
    const enemy = enemies[index];
    const position = enemy.mesh.position.clone();
    createExplosionEffect(position);
    scene.remove(enemy.mesh);
    enemies.splice(index, 1);

    const distance = camera.position.distanceTo(position);
    if (distance < 6) {
        const intensity = Math.max(0.4, 1 - distance / 6);
        takeDamage(Math.round(Config.enemyDamage * 2 * intensity), position);
    }

    score += fromKill ? 120 : 80;
    updateHUD();
    playUiSound('kill');
    triggerTimeSlow();

    if (enemies.length === 0) {
        wave++;
        updateHUD();
        setTimeout(() => {
            if (gameState === GameState.PLAYING) {
                openUpgradeScreen();
            }
        }, 1200);
    }
}

// Create Death Effect
function createDeathEffect(position) {
    const particleCount = lowPowerMode ? 10 : 22;
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
            velocity: velocity,
            lifetime: 1.3,
            maxLifetime: 1.3
        };
        
        scene.add(particle);
        
        if (!window.hitParticles) window.hitParticles = [];
        window.hitParticles.push(particle);
    }
}

function startWave() {
    if (upgradeScreen) {
        upgradeScreen.classList.add('hidden');
    }
    hud.classList.remove('hidden');
    if (gameState === GameState.CHOOSING) {
        gameState = GameState.PLAYING;
    }
    if (gameState !== GameState.PLAYING) return;
    regenerateMap();
    // Spawn enemies quickly
    const enemyCount = 3 + wave * 2;  // More enemies at start!
    for (let i = 0; i < enemyCount; i++) {
        setTimeout(() => spawnEnemy(), i * 500);
    }
    showPrompt(`Wave ${wave} incoming`, 1400);
    console.log('Spawning', enemyCount, 'enemies!');
}

// Update Enemies - Fixed
function updateEnemies(delta) {
    const now = Date.now();

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

        // Calculate direction to player
        const direction = new THREE.Vector3();
        direction.subVectors(camera.position, enemy.mesh.position);
        direction.y = 0;
        const distance = direction.length();
        direction.normalize();

        const step = enemy.speed * (delta * 60);

        if (enemy.role === 'flanker') {
            const preferred = enemy.preferredRange || 7;
            if (distance > preferred + 1) {
                enemy.mesh.position.addScaledVector(direction, step);
            } else {
                const tangent = new THREE.Vector3(-direction.z, 0, direction.x)
                    .multiplyScalar(enemy.orbitDir);
                const drift = direction.clone().multiplyScalar(0.35);
                const move = tangent.add(drift).normalize();
                enemy.mesh.position.addScaledVector(move, step);
            }
        } else {
            if (distance > 2) {
                enemy.mesh.position.addScaledVector(direction, step);
            }
        }

        // Look at player
        enemy.mesh.lookAt(camera.position.x, 1, camera.position.z);

        if (enemy.role === 'exploder' && distance < 2.8) {
            explodeEnemy(i);
            continue;
        }

        // Attack player if close
        if (distance < 2.5) {
            if (now - enemy.lastAttack > 1000) {
                takeDamage(Config.enemyDamage, enemy.mesh.position);
                enemy.lastAttack = now;

                // Push enemy back slightly
                enemy.mesh.position.subScaledVector(direction, 1);
            }
        }
    }
}

function createExplosionEffect(position) {
    const particleCount = lowPowerMode ? 16 : 32;
    for (let i = 0; i < particleCount; i++) {
        const geometry = new THREE.SphereGeometry(0.12, 4, 4);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true
        });
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        particle.position.y += 1;

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 6,
            Math.random() * 4,
            (Math.random() - 0.5) * 6
        );

        particle.userData = {
            velocity: velocity,
            lifetime: 1.1,
            maxLifetime: 1.1
        };

        scene.add(particle);

        if (!window.hitParticles) window.hitParticles = [];
        window.hitParticles.push(particle);
    }

    addCameraShake(0.12);
}

// Take Damage - Fixed
function takeDamage(amount, sourcePosition) {
    health = Math.max(0, health - amount);
    updateHUD();
    playUiSound('damage');
    showDamageDirection(sourcePosition);
    addCameraShake(0.08);
    
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
    
    // Screen shake effect
    camera.position.y -= 0.04;
    setTimeout(() => {
        camera.position.y = Config.playerHeight;
    }, 50);
    
    if (health <= 0) {
        updateHUD();
        gameOver();
    }
}

function showDamageDirection(sourcePosition) {
    if (!damageDirection || !sourcePosition) return;
    const direction = new THREE.Vector3().subVectors(sourcePosition, camera.position);
    const angle = Math.atan2(direction.x, direction.z) - player.yaw;
    damageDirection.style.opacity = '1';
    damageDirection.style.transform = `translate(-50%, -50%) rotate(${angle}rad) translateY(-120px)`;
    if (damageDirectionTimeout) {
        clearTimeout(damageDirectionTimeout);
    }
    damageDirectionTimeout = setTimeout(() => {
        damageDirection.style.opacity = '0';
    }, 400);
}

// Setup UI
function setupUI() {
    startButton.addEventListener('click', startGame);
    resumeButton.addEventListener('click', resumeGame);
    restartButton.addEventListener('click', restartGame);
    restartGameButton.addEventListener('click', restartGame);
    
    // Debug spawn button - works anytime!
    const spawnBtn = document.getElementById('spawn-btn');
    if (spawnBtn) {
        debugMode = new URLSearchParams(window.location.search).has('debug');
        spawnBtn.classList.toggle('hidden', !debugMode);
        spawnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('=== MANUAL SPAWN BUTTON CLICKED ===');
            spawnEnemy();
        });
    }

    setupButtonAudio();
    setupArmoryUI();
    let storedScale = 1;
    try {
        const saved = parseFloat(localStorage.getItem('uiScale'));
        if (!Number.isNaN(saved)) {
            storedScale = saved;
        }
    } catch (e) {
        storedScale = 1;
    }
    setUiScale(storedScale);
    updateHUD();
    if (upgradeScreen) {
        upgradeScreen.classList.add('hidden');
    }
    if (startButton) {
        startButton.focus();
    }
}

function setupButtonAudio() {
    document.querySelectorAll('button').forEach((button) => {
        button.addEventListener('pointerenter', () => playUiSound('hover'));
        button.addEventListener('click', () => playUiSound('click'));
    });
}

function setupArmoryUI() {
    if (buyAmmoRoundButton) {
        buyAmmoRoundButton.addEventListener('click', () => buyAmmo(50, 'armory'));
    }
}

function renderWeaponOptions() {
    if (!weaponOptionsEl) return;
    weaponOptionsEl.innerHTML = '';
    WeaponCatalog.forEach((weaponDef) => {
        const button = document.createElement('button');
        button.className = 'weapon-option';
        if (weaponDef.id === currentWeaponId) {
            button.classList.add('active');
        }
        button.type = 'button';
        button.innerHTML = `
            <div class="weapon-name-label">${weaponDef.name}</div>
            <div class="weapon-stat">${weaponDef.type.toUpperCase()} | DMG ${weaponDef.damage}</div>
            <div class="weapon-stat">Mag ${weaponDef.magSize} | RPM ${Math.round(60000 / weaponDef.fireRate)}</div>
        `;
        button.addEventListener('click', () => {
            equipWeapon(weaponDef.id);
            renderWeaponOptions();
        });
        button.addEventListener('pointerenter', () => playUiSound('hover'));
        button.addEventListener('click', () => playUiSound('click'));
        weaponOptionsEl.appendChild(button);
    });
}

function updateCredits() {
    if (creditsEl) {
        creditsEl.textContent = score;
    }
    if (armoryCreditsEl) {
        armoryCreditsEl.textContent = score;
    }
}

function buyAmmo(cost, source) {
    if (!weapon) return;
    if (score < cost) {
        showPrompt('Not enough credits', 1200);
        return;
    }
    if (reserveAmmo >= weapon.reserveMax) {
        showPrompt('Ammo already full', 1200);
        return;
    }
    score -= cost;
    reserveAmmo = Math.min(weapon.reserveMax, reserveAmmo + maxAmmo);
    syncWeaponInventory();
    updateHUD();
    showPrompt(source === 'armory' ? 'Ammo purchased' : 'Ammo purchased mid-wave', 1200);
}

function openUpgradeScreen() {
    if (!upgradeScreen || !upgradeOptionsEl) return;
    if (gameState !== GameState.PLAYING) return;
    gameState = GameState.CHOOSING;
    document.exitPointerLock();
    clearPrompts();
    hud.classList.add('hidden');
    timeScale = 1;
    timeSlowTimer = 0;
    document.body.classList.remove('time-slow');
    upgradeOptions = generateUpgradeOptions();
    upgradeOptionsEl.innerHTML = '';

    upgradeOptions.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'upgrade-option';
        button.type = 'button';
        button.dataset.index = index.toString();
        button.innerHTML = `
            <div class="upgrade-title">${option.title}</div>
            <div class="upgrade-desc">${option.description}</div>
            <div class="upgrade-tradeoff">${option.tradeoff}</div>
        `;
        button.addEventListener('click', () => selectUpgrade(index));
        button.addEventListener('pointerenter', () => playUiSound('hover'));
        button.addEventListener('click', () => playUiSound('click'));
        upgradeOptionsEl.appendChild(button);
    });

    upgradeScreen.classList.remove('hidden');
    renderWeaponOptions();
    updateCredits();
    if (armoryWaveEl) {
        armoryWaveEl.textContent = wave;
    }
    if (armoryCreditsEl) {
        armoryCreditsEl.textContent = score;
    }
    const firstButton = upgradeOptionsEl.querySelector('button');
    if (firstButton) firstButton.focus();
}

function closeUpgradeScreen() {
    if (!upgradeScreen) return;
    upgradeScreen.classList.add('hidden');
}

function generateUpgradeOptions() {
    const pool = [
        {
            title: 'Overclocked Rounds',
            description: '+20% weapon damage.',
            tradeoff: '-10% max health',
            apply: () => {
                damageMultiplier *= 1.2;
                maxHealth = Math.max(60, Math.round(maxHealth * 0.9));
                health = Math.min(health, maxHealth);
            }
        },
        {
            title: 'Reinforced Armor',
            description: '+20 max health.',
            tradeoff: '-8% move speed',
            apply: () => {
                maxHealth += 20;
                health = Math.min(maxHealth, health + 20);
                moveSpeedMultiplier *= 0.92;
            }
        },
        {
            title: 'Rapid Reload',
            description: 'Reload 20% faster.',
            tradeoff: '-10% max ammo',
            apply: () => {
                reloadSpeedMultiplier *= 0.8;
                magSizeMultiplier *= 0.9;
            }
        },
        {
            title: 'Extended Mag',
            description: '+20% max ammo.',
            tradeoff: '-10% damage',
            apply: () => {
                magSizeMultiplier *= 1.2;
                damageMultiplier *= 0.9;
            }
        },
        {
            title: 'Adrenal Surge',
            description: '+12% move speed.',
            tradeoff: '-10 max health',
            apply: () => {
                moveSpeedMultiplier *= 1.12;
                maxHealth = Math.max(60, maxHealth - 10);
                health = Math.min(health, maxHealth);
            }
        },
        {
            title: 'Chrono Spike',
            description: 'Longer time-slow on kill.',
            tradeoff: 'Slightly slower reload',
            apply: () => {
                timeSlowDuration = Math.min(0.6, timeSlowDuration + 0.15);
                reloadSpeedMultiplier *= 1.08;
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
    if (gameState !== GameState.CHOOSING) return;
    const option = upgradeOptions[index];
    if (!option) return;
    option.apply();
    refreshWeaponStats();
    closeUpgradeScreen();
    updateHUD();
    gameState = GameState.PLAYING;
    hud.classList.remove('hidden');
    startWave();
    gameCanvas.requestPointerLock();
    gameCanvas.focus();
    clock.start();
    animate();
}

// Update HUD
function updateHUD() {
    const healthBar = document.getElementById('health-bar');
    const healthContainer = document.getElementById('health-bar-container');
    const healthText = document.getElementById('health-text');
    const currentAmmoEl = document.getElementById('current-ammo');
    const totalAmmoEl = document.getElementById('total-ammo');
    const scoreEl = document.getElementById('score');
    const waveEl = document.getElementById('wave');
    const ammoBar = document.getElementById('ammo-bar');
    
    const healthPercent = maxHealth > 0 ? (health / maxHealth) * 100 : 0;
    if (healthBar) {
        healthBar.style.width = `${Math.max(0, Math.min(100, healthPercent))}%`;
        // Change color based on health
        if (healthPercent > 60) {
            healthBar.style.background = 'linear-gradient(90deg, #4ecdc4, #44a08d)';
        } else if (healthPercent > 30) {
            healthBar.style.background = 'linear-gradient(90deg, #ffd93d, #ff9500)';
        } else {
            healthBar.style.background = 'linear-gradient(90deg, #ff4444, #cc0000)';
        }
    }
    if (healthContainer) {
        healthContainer.setAttribute('aria-valuenow', Math.max(0, Math.round(health)));
        healthContainer.setAttribute('aria-valuemax', Math.round(maxHealth));
    }
    
    if (healthText) healthText.textContent = Math.max(0, Math.round(health));
    if (currentAmmoEl) {
        currentAmmoEl.textContent = ammo;
        currentAmmoEl.style.color = ammo <= getLowAmmoThreshold() ? '#ff4d5a' : '#2bd4c9';
    }
    if (totalAmmoEl) totalAmmoEl.textContent = reserveAmmo;
    if (scoreEl) scoreEl.textContent = score;
    if (waveEl) waveEl.textContent = wave;
    if (enemyCountEl) enemyCountEl.textContent = enemies.length;
    if (weaponNameEl && weapon) {
        weaponNameEl.textContent = weapon.name;
    }
    updateCredits();
    if (ammoFill) {
        const ammoPercent = maxAmmo > 0 ? (ammo / maxAmmo) * 100 : 0;
        ammoFill.style.width = `${Math.max(0, Math.min(100, ammoPercent))}%`;
    }
    if (ammoBar) {
        ammoBar.setAttribute('aria-valuenow', Math.max(0, Math.round((ammo / maxAmmo) * 100)));
        ammoBar.setAttribute('aria-valuemax', 100);
    }
    if (chipBuy) {
        const canBuy = gameState === GameState.PLAYING && score >= 100 && reserveAmmo < (weapon ? weapon.reserveMax : 0);
        chipBuy.classList.toggle('active', canBuy);
    }

    if (lowHealthVignette) {
        const ratio = maxHealth > 0 ? health / maxHealth : 0;
        const intensity = Math.max(0, (0.35 - ratio) / 0.35);
        lowHealthVignette.style.opacity = (intensity * 0.6).toFixed(2);
    }

    if (gameState === GameState.PLAYING && weapon && !weapon.isReloading && ammo <= getLowAmmoThreshold()) {
        const now = Date.now();
        if (now > lowAmmoPromptCooldown) {
            const message = reserveAmmo > 0 ? 'Low ammo - press R to reload' : 'Out of ammo - keep moving';
            showPrompt(message, 2000);
            lowAmmoPromptCooldown = now + 5000;
        }
    }
}

function getLowAmmoThreshold() {
    return Math.max(3, Math.round(maxAmmo * 0.2));
}

function showPrompt(message, duration = 1600) {
    if (!interactionPrompt) return;
    interactionPrompt.textContent = message;
    interactionPrompt.classList.remove('hidden');
    if (promptHideTimeout) {
        clearTimeout(promptHideTimeout);
    }
    promptHideTimeout = setTimeout(() => {
        interactionPrompt.classList.add('hidden');
    }, duration);
}

function clearPrompts() {
    promptTimeouts.forEach((timeout) => clearTimeout(timeout));
    promptTimeouts = [];
    if (promptHideTimeout) {
        clearTimeout(promptHideTimeout);
        promptHideTimeout = null;
    }
    if (interactionPrompt) {
        interactionPrompt.classList.add('hidden');
    }
}

function queueTutorialPrompts() {
    clearPrompts();
    const steps = [
        { text: 'WASD to move', delay: 600 },
        { text: 'Move mouse to aim', delay: 2000 },
        { text: 'Left click to shoot', delay: 3400 },
        { text: 'Press R to reload', delay: 5200 }
    ];

    steps.forEach((step) => {
        const timeout = setTimeout(() => {
            showPrompt(step.text, 1600);
        }, step.delay);
        promptTimeouts.push(timeout);
    });
}

function resetRunStats() {
    damageMultiplier = 1;
    reloadSpeedMultiplier = 1;
    moveSpeedMultiplier = 1;
    magSizeMultiplier = 1;
    timeSlowIntensity = Config.timeSlowIntensity;
    timeSlowDuration = Config.timeSlowDuration;
    maxHealth = Config.maxHealth;
    resetWeaponState();
    health = maxHealth;
    timeScale = 1;
    timeSlowTimer = 0;
    document.body.classList.remove('time-slow');
}

function resetWeaponState() {
    initWeaponInventory();
    const defaultWeapon = WeaponCatalog.find((item) => item.type === 'rifle') || WeaponCatalog[0];
    currentWeaponId = defaultWeapon ? defaultWeapon.id : currentWeaponId;
    if (weapon) {
        equipWeapon(currentWeaponId, true);
    } else if (defaultWeapon) {
        maxAmmo = defaultWeapon.magSize;
        ammo = defaultWeapon.magSize;
        reserveAmmo = defaultWeapon.reserveMax;
    }
}

// Game State Functions
function startGame() {
    startScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    
    // Initialize audio context on user interaction
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Reset game state
    score = 0;
    wave = 1;
    resetRunStats();
    lowAmmoPromptCooldown = 0;
    weapon.isReloading = false;
    weapon.canShoot = true;
    if (reloadIndicator) {
        reloadIndicator.classList.add('hidden');
    }
    if (reloadFill) {
        reloadFill.style.width = '0%';
        reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
    
    // Clear existing enemies
    enemies.forEach(e => scene.remove(e.mesh));
    enemies = [];
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    
    if (upgradeScreen) {
        upgradeScreen.classList.add('hidden');
    }
    updateHUD();
    gameState = GameState.PLAYING;
    
    clearPrompts();
    queueTutorialPrompts();
    startWave();
    
    // Lock pointer
    gameCanvas.requestPointerLock();
    gameCanvas.focus();
    showPrompt('Click to lock aim', 1600);
    
    // Start game loop
    clock.start();
    animate();
}

function pauseGame() {
    gameState = GameState.PAUSED;
    pauseScreen.classList.remove('hidden');
    document.exitPointerLock();
    clearPrompts();
    timeScale = 1;
    timeSlowTimer = 0;
    document.body.classList.remove('time-slow');
    if (resumeButton) {
        resumeButton.focus();
    }
}

function resumeGame() {
    gameState = GameState.PLAYING;
    pauseScreen.classList.add('hidden');
    gameCanvas.requestPointerLock();
    gameCanvas.focus();
    showPrompt('Back in action', 1200);
    
    clock.start();
    animate();
}

function restartGame() {
    pauseScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    
    // Reset game state
    score = 0;
    wave = 1;
    resetRunStats();
    weapon.isReloading = false;
    weapon.canShoot = true;
    if (reloadIndicator) {
        reloadIndicator.classList.add('hidden');
    }
    if (reloadFill) {
        reloadFill.style.width = '0%';
    }
    
    // Clear existing enemies
    enemies.forEach(e => scene.remove(e.mesh));
    enemies = [];
    
    // Reset camera
    camera.position.set(0, Config.playerHeight, 0);
    camera.rotation.set(0, 0, 0);
    player.yaw = 0;
    player.pitch = 0;
    
    if (upgradeScreen) {
        upgradeScreen.classList.add('hidden');
    }
    updateHUD();
    gameState = GameState.PLAYING;
    lowAmmoPromptCooldown = 0;
    
    // Lock pointer
    gameCanvas.requestPointerLock();
    gameCanvas.focus();
    
    // Start waves
    startWave();
    clearPrompts();
    queueTutorialPrompts();
    
    clock.start();
    animate();
}

function gameOver() {
    gameState = GameState.GAME_OVER;
    hud.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
    if (upgradeScreen) {
        upgradeScreen.classList.add('hidden');
    }
    document.body.classList.remove('time-slow');
    document.getElementById('final-score').textContent = score;
    document.getElementById('final-wave').textContent = wave;
    document.exitPointerLock();
    clearPrompts();
    if (restartGameButton) {
        restartGameButton.focus();
    }
}

// Window Resize Handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPowerMode ? 1 : 1.5));
}

// Player Movement
function updatePlayer(delta) {
    if (!isPointerLocked || gameState !== GameState.PLAYING) return;
    
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
    if (keys.w) player.direction.sub(forward); // Forward - camera looks forward
    if (keys.s) player.direction.add(forward); // Backward
    if (keys.a) player.direction.sub(right);
    if (keys.d) player.direction.add(right);
    
    // Normalize and apply speed
    if (player.direction.length() > 0) {
        player.direction.normalize();
        const baseSpeed = keys.shift
            ? Config.playerSpeed * Config.playerSprintMultiplier * moveSpeedMultiplier
            : Config.playerSpeed * moveSpeedMultiplier;
        const speed = baseSpeed * (delta * 60);
        player.velocity.copy(player.direction).multiplyScalar(speed);
    }
    
    // Apply movement
    camera.position.add(player.velocity);
    
    // Keep player at constant height
    camera.position.y = Config.playerHeight;
    
    // Boundary check
    const boundary = 90;
    camera.position.x = Math.max(-boundary, Math.min(boundary, camera.position.x));
    camera.position.z = Math.max(-boundary, Math.min(boundary, camera.position.z));
    
    // Weapon sway when moving
    if (player.velocity.length() > 0) {
        const time = clock.getElapsedTime();
        weapon.mesh.position.x = 0.25 + Math.sin(time * 12) * 0.015;
        weapon.mesh.position.y = -0.35 + Math.cos(time * 18) * 0.01;
    } else {
        // Idle sway
        const time = clock.getElapsedTime();
        weapon.mesh.position.x = 0.25 + Math.sin(time * 2) * 0.005;
        weapon.mesh.position.y = -0.35 + Math.cos(time * 3) * 0.003;
    }
    
    // Recoil recovery
    if (weapon.recoil > 0) {
        weapon.recoil *= 0.85;
        player.pitch -= weapon.recoil * 0.5;
        camera.rotation.x = player.pitch;
    }

    if (chipSprint) {
        chipSprint.classList.toggle('active', keys.shift && player.velocity.length() > 0);
    }
}

// Game Loop
function animate() {
    if (gameState !== GameState.PLAYING) return;
    
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    updateTimeScale(delta);
    const scaledDelta = delta * timeScale;
    
    updatePlayer(delta);
    updateEnemies(scaledDelta);
    updateParticles(scaledDelta);
    updateReloadIndicator();

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

// Start the game when the page loads
window.addEventListener('load', init);
