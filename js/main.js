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
    
    // Enemies
    enemySpawnRate: 3000,
    enemySpeed: 0.06,
    enemyDamage: 15,
    lowAmmoThreshold: 5,
    
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

// Global Variables
let scene, camera, renderer;
let player, weapon;
let enemies = [];
let bullets = [];
let clock;
let gameState = GameState.LOADING;
let score = 0;
let wave = 1;
let health = Config.maxHealth;
let ammo = Config.maxAmmo;
let reserveAmmo = Config.totalAmmo;
let isPointerLocked = false;
let audioContext = null;
let uiScale = 1;
let lowPowerMode = false;
let loadingTimer = null;
let loadingProgress = 0;
let reloadStartTime = 0;
let damageDirectionTimeout = null;
let lowAmmoPromptCooldown = 0;
let promptTimeouts = [];
let promptHideTimeout = null;
let debugMode = false;

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
    
    // Create some obstacles/cover - Improved colors
    const density = lowPowerMode ? 0.5 : 1;
    createObstacles(density);
    
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

// Create Obstacles - Enhanced
function createObstacles(density = 1) {
    // Crates - wooden boxes
    const crateMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.8,
        metalness: 0.1
    });
    const castShadow = !lowPowerMode;
    
    const crateCount = Math.max(6, Math.round(Config.crateCount * density));
    for (let i = 0; i < crateCount; i++) {
        const size = 1.5 + Math.random() * 1.5;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const obstacle = new THREE.Mesh(geometry, crateMaterial);
        
        obstacle.position.x = (Math.random() - 0.5) * 60;
        obstacle.position.z = (Math.random() - 0.5) * 60;
        obstacle.position.y = size / 2;
        
        obstacle.rotation.y = Math.random() * Math.PI;
        obstacle.castShadow = castShadow;
        obstacle.receiveShadow = castShadow;
        
        obstacle.userData = {
            isObstacle: true,
            isCrate: true
        };
        
        scene.add(obstacle);
    }
    
    // Concrete barriers
    const barrierMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 0.9,
        metalness: 0.2
    });
    
    const barrierCount = Math.max(4, Math.round(Config.barrierCount * density));
    for (let i = 0; i < barrierCount; i++) {
        const geometry = new THREE.BoxGeometry(3, 1.2, 1);
        const barrier = new THREE.Mesh(geometry, barrierMaterial);
        
        barrier.position.x = (Math.random() - 0.5) * 70;
        barrier.position.z = (Math.random() - 0.5) * 70;
        barrier.position.y = 0.6;
        
        barrier.rotation.y = Math.random() * Math.PI;
        barrier.castShadow = castShadow;
        barrier.receiveShadow = castShadow;
        
        scene.add(barrier);
    }
    
    // Pillars
    const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0x606060,
        roughness: 0.5,
        metalness: 0.3
    });
    
    const pillarCount = Math.max(3, Math.round(Config.pillarCount * density));
    for (let i = 0; i < pillarCount; i++) {
        const geometry = new THREE.CylinderGeometry(0.8, 1, 6, 12);
        const pillar = new THREE.Mesh(geometry, pillarMaterial);
        
        const angle = (i / pillarCount) * Math.PI * 2;
        const radius = 25;
        pillar.position.x = Math.cos(angle) * radius;
        pillar.position.z = Math.sin(angle) * radius;
        pillar.position.y = 3;
        
        pillar.castShadow = castShadow;
        pillar.receiveShadow = castShadow;
        
        scene.add(pillar);
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
    const gunGroup = new THREE.Group();
    
    // Main body - assault rifle style
    const bodyGeometry = new THREE.BoxGeometry(0.12, 0.18, 0.7);
    const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.3,
        metalness: 0.8
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.z = -0.35;
    gunGroup.add(body);
    
    // Barrel
    const barrelGeometry = new THREE.CylinderGeometry(0.025, 0.035, 0.6, 8);
    const barrelMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.2,
        metalness: 0.9
    });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.8;
    barrel.position.y = 0.03;
    gunGroup.add(barrel);
    
    // Handle
    const handleGeometry = new THREE.BoxGeometry(0.1, 0.25, 0.12);
    const handle = new THREE.Mesh(handleGeometry, bodyMaterial);
    handle.position.set(0, -0.22, -0.15);
    handle.rotation.x = 0.3;
    gunGroup.add(handle);
    
    // Magazine
    const magGeometry = new THREE.BoxGeometry(0.08, 0.2, 0.1);
    const mag = new THREE.Mesh(magGeometry, bodyMaterial);
    mag.position.set(0, -0.25, 0);
    mag.rotation.x = -0.1;
    gunGroup.add(mag);
    
    // Scope
    const scopeGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8);
    const scopeMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.1,
        metalness: 0.9
    });
    const scope = new THREE.Mesh(scopeGeometry, scopeMaterial);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.12, -0.3);
    gunGroup.add(scope);
    
    // Position the weapon
    gunGroup.position.set(0.25, -0.35, -0.4);
    
    camera.add(gunGroup);
    scene.add(camera);
    
    weapon = {
        mesh: gunGroup,
        fireRate: Config.weaponFireRate,
        damage: Config.weaponDamage,
        range: Config.weaponRange,
        recoil: 0,
        isReloading: false,
        canShoot: true
    };
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
    updateHUD();
    
    // Play sound
    playShootSound();
    
    // Muzzle flash
    showMuzzleFlash();
    
    // Apply recoil
    weapon.recoil = 0.08;
    player.pitch += weapon.recoil;
    
    // Create bullet tracer
    createBulletTracer();
    
    // Raycast for hits - improved
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    // Check all enemies
    let hitEnemy = false;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        const intersects = raycaster.intersectObject(enemy.mesh, true);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            if (hit.distance <= weapon.range) {
                enemy.health -= weapon.damage;
                showHitMarker();
                
                // Flash enemy red
                flashEnemy(enemy.mesh);
                
                // Create hit effect
                createHitEffect(hit.point);
                
                if (enemy.health <= 0) {
                    killEnemy(i);
                }
                hitEnemy = true;
                break;
            }
        }
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
            child.material.emissive = new THREE.Color(0xff0000);
            child.material.emissiveIntensity = 0.5;
        }
    });
    
    setTimeout(() => {
        enemyMesh.traverse((child) => {
            if (child.isMesh) {
                child.material.emissive = new THREE.Color(0x000000);
                child.material.emissiveIntensity = 0;
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
    if (weapon.isReloading || ammo >= Config.maxAmmo || reserveAmmo <= 0) return;
    
    weapon.isReloading = true;
    reloadStartTime = performance.now();
    playUiSound('reload');
    
    // Show reload indicator
    if (reloadIndicator) {
        reloadIndicator.classList.remove('hidden');
    }
    if (reloadFill) {
        reloadFill.style.width = '0%';
    }
    if (chipReload) {
        chipReload.classList.add('active');
    }
    
    // Animate weapon
    weapon.mesh.rotation.x = 0.8;
    weapon.mesh.position.z = -0.2;
    
    setTimeout(() => {
        const needed = Config.maxAmmo - ammo;
        const loaded = Math.min(needed, reserveAmmo);
        ammo += loaded;
        reserveAmmo -= loaded;
        
        weapon.isReloading = false;
        weapon.mesh.rotation.x = 0;
        weapon.mesh.position.z = -0.4;
        
        if (reloadIndicator) {
            reloadIndicator.classList.add('hidden');
        }
        if (chipReload) {
            chipReload.classList.remove('active');
        }
        
        updateHUD();
    }, Config.reloadDuration);
}

function updateReloadIndicator() {
    if (!weapon || !weapon.isReloading || !reloadFill) return;
    const progress = (performance.now() - reloadStartTime) / Config.reloadDuration;
    reloadFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
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
    const barrel = weapon.mesh.children[1];
    if (barrel) {
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
            case 'damage':
                frequency = 120;
                duration = 0.16;
                volume = 0.12;
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
        // Create a simple enemy with light variety
        const enemyTypes = [
            { color: 0xff5d4d, speed: 0.055, health: 90 },
            { color: 0xffb84d, speed: 0.07, health: 70 },
            { color: 0x7cff7a, speed: 0.045, health: 120 }
        ];
        const baseType = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
        const healthBoost = Math.min(60, wave * 6);
        const speedBoost = Math.min(0.03, wave * 0.002);

        const geometry = new THREE.BoxGeometry(2, 3, 2);
        const material = new THREE.MeshStandardMaterial({ color: baseType.color });
        const enemy = new THREE.Mesh(geometry, material);
        
        // Position around the player
        const angle = Math.random() * Math.PI * 2;
        const radius = 25 + Math.random() * 30;
        enemy.position.x = camera.position.x + Math.cos(angle) * radius;
        enemy.position.z = camera.position.z + Math.sin(angle) * radius;
        enemy.position.y = 1.5;
        
        scene.add(enemy);
        enemies.push({
            mesh: enemy,
            health: baseType.health + healthBoost,
            speed: baseType.speed + speedBoost,
            lastAttack: 0
        });
        updateHUD();
        
        console.log('SUCCESS: Enemy created and added! Total:', enemies.length);
        
    } catch (error) {
        console.error('ERROR creating enemy:', error);
    }
}

function killEnemy(index) {
    if (index < 0 || index >= enemies.length) return;
    
    const enemy = enemies[index];
    
    // Death effect
    createDeathEffect(enemy.mesh.position);
    
    scene.remove(enemy.mesh);
    enemies.splice(index, 1);
    
    score += 100;
    updateHUD();
    
    // Check wave completion
    if (enemies.length === 0) {
        wave++;
        updateHUD();
        setTimeout(() => {
            if (gameState === GameState.PLAYING) {
                startWave();
            }
        }, 2000);
    }
}

// Create Death Effect
function createDeathEffect(position) {
    const particleCount = lowPowerMode ? 10 : 20;
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
            lifetime: 1.0,
            maxLifetime: 1.0
        };
        
        scene.add(particle);
        
        if (!window.hitParticles) window.hitParticles = [];
        window.hitParticles.push(particle);
    }
}

function startWave() {
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
    
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        
        // Calculate direction to player
        const direction = new THREE.Vector3();
        direction.subVectors(camera.position, enemy.mesh.position);
        direction.y = 0;
        const distance = direction.length();
        direction.normalize();
        
        // Move towards player if far enough
        if (distance > 2) {
            const step = enemy.speed * (delta * 60);
            enemy.mesh.position.addScaledVector(direction, step);
        }
        
        // Look at player
        enemy.mesh.lookAt(camera.position.x, 1, camera.position.z);
        
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

// Take Damage - Fixed
function takeDamage(amount, sourcePosition) {
    health -= amount;
    updateHUD();
    playUiSound('damage');
    showDamageDirection(sourcePosition);
    
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
    camera.position.y += 0.05;
    setTimeout(() => {
        camera.position.y = Config.playerHeight;
    }, 50);
    
    if (health <= 0) {
        health = 0;
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
    
    if (healthBar) {
        healthBar.style.width = `${Math.max(0, health)}%`;
        // Change color based on health
        if (health > 60) {
            healthBar.style.background = 'linear-gradient(90deg, #4ecdc4, #44a08d)';
        } else if (health > 30) {
            healthBar.style.background = 'linear-gradient(90deg, #ffd93d, #ff9500)';
        } else {
            healthBar.style.background = 'linear-gradient(90deg, #ff4444, #cc0000)';
        }
    }
    if (healthContainer) {
        healthContainer.setAttribute('aria-valuenow', Math.max(0, Math.round(health)));
    }
    
    if (healthText) healthText.textContent = Math.max(0, Math.round(health));
    if (currentAmmoEl) {
        currentAmmoEl.textContent = ammo;
        currentAmmoEl.style.color = ammo <= Config.lowAmmoThreshold ? '#ff4d5a' : '#2bd4c9';
    }
    if (totalAmmoEl) totalAmmoEl.textContent = reserveAmmo;
    if (scoreEl) scoreEl.textContent = score;
    if (waveEl) waveEl.textContent = wave;
    if (enemyCountEl) enemyCountEl.textContent = enemies.length;
    if (ammoFill) {
        const ammoPercent = (ammo / Config.maxAmmo) * 100;
        ammoFill.style.width = `${Math.max(0, Math.min(100, ammoPercent))}%`;
    }
    if (ammoBar) {
        ammoBar.setAttribute('aria-valuenow', Math.max(0, Math.round((ammo / Config.maxAmmo) * 100)));
    }

    if (gameState === GameState.PLAYING && !weapon.isReloading && ammo <= Config.lowAmmoThreshold) {
        const now = Date.now();
        if (now > lowAmmoPromptCooldown) {
            const message = reserveAmmo > 0 ? 'Low ammo - press R to reload' : 'Out of ammo - keep moving';
            showPrompt(message, 2000);
            lowAmmoPromptCooldown = now + 5000;
        }
    }
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
    health = Config.maxHealth;
    ammo = Config.maxAmmo;
    reserveAmmo = Config.totalAmmo;
    lowAmmoPromptCooldown = 0;
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
    health = Config.maxHealth;
    ammo = Config.maxAmmo;
    reserveAmmo = Config.totalAmmo;
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
        const baseSpeed = keys.shift ? Config.playerSpeed * Config.playerSprintMultiplier : Config.playerSpeed;
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
    
    updatePlayer(delta);
    updateEnemies(delta);
    updateParticles(delta);
    updateReloadIndicator();
    
    renderer.render(scene, camera);
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
