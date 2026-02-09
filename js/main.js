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
    
    // Enemies
    enemySpawnRate: 3000,
    enemySpeed: 0.06,
    enemyDamage: 15,
    
    // Game
    maxHealth: 100,
    maxAmmo: 25,
    totalAmmo: 100
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
let isPointerLocked = false;
let audioContext = null;

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
    renderer = new THREE.WebGLRenderer({
        canvas: gameCanvas,
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
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
    loadingScreen.classList.add('hidden');
    
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
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
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
    ground.receiveShadow = true;
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
    createObstacles();
    
    // Add decorative elements
    createTrees();
}

// Create Trees
function createTrees() {
    for (let i = 0; i < 30; i++) {
        // Tree trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5D4037 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 1.5;
        trunk.castShadow = true;
        
        // Tree foliage
        const foliageGeometry = new THREE.ConeGeometry(2, 5, 8);
        const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2E7D32 });
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.y = 5;
        foliage.castShadow = true;
        
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
function createObstacles() {
    // Crates - wooden boxes
    const crateMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.8,
        metalness: 0.1
    });
    
    for (let i = 0; i < 15; i++) {
        const size = 1.5 + Math.random() * 1.5;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const obstacle = new THREE.Mesh(geometry, crateMaterial);
        
        obstacle.position.x = (Math.random() - 0.5) * 60;
        obstacle.position.z = (Math.random() - 0.5) * 60;
        obstacle.position.y = size / 2;
        
        obstacle.rotation.y = Math.random() * Math.PI;
        obstacle.castShadow = true;
        obstacle.receiveShadow = true;
        
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
    
    for (let i = 0; i < 10; i++) {
        const geometry = new THREE.BoxGeometry(3, 1.2, 1);
        const barrier = new THREE.Mesh(geometry, barrierMaterial);
        
        barrier.position.x = (Math.random() - 0.5) * 70;
        barrier.position.z = (Math.random() - 0.5) * 70;
        barrier.position.y = 0.6;
        
        barrier.rotation.y = Math.random() * Math.PI;
        barrier.castShadow = true;
        barrier.receiveShadow = true;
        
        scene.add(barrier);
    }
    
    // Pillars
    const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0x606060,
        roughness: 0.5,
        metalness: 0.3
    });
    
    for (let i = 0; i < 6; i++) {
        const geometry = new THREE.CylinderGeometry(0.8, 1, 6, 12);
        const pillar = new THREE.Mesh(geometry, pillarMaterial);
        
        const angle = (i / 6) * Math.PI * 2;
        const radius = 25;
        pillar.position.x = Math.cos(angle) * radius;
        pillar.position.z = Math.sin(angle) * radius;
        pillar.position.y = 3;
        
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        
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

// Mouse Down Handler - Fixed
function onMouseDown(event) {
    if (event.button === 0 && gameState === GameState.PLAYING && isPointerLocked) {
        shoot();
    }
}

// Shoot Function - Fixed
function shoot() {
    if (!weapon.canShoot || weapon.isReloading || ammo <= 0) return;
    
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
    if (weapon.isReloading || ammo >= Config.maxAmmo) return;
    
    weapon.isReloading = true;
    
    // Show reload indicator
    const reloadIndicator = document.getElementById('reload-indicator');
    if (!reloadIndicator) {
        const newIndicator = document.createElement('div');
        newIndicator.id = 'reload-indicator';
        newIndicator.textContent = 'RELOADING...';
        document.body.appendChild(newIndicator);
    } else {
        reloadIndicator.style.opacity = '1';
    }
    
    // Animate weapon
    weapon.mesh.rotation.x = 0.8;
    weapon.mesh.position.z = -0.2;
    
    setTimeout(() => {
        ammo = Config.maxAmmo;
        
        weapon.isReloading = false;
        weapon.mesh.rotation.x = 0;
        weapon.mesh.position.z = -0.4;
        
        const indicator = document.getElementById('reload-indicator');
        if (indicator) {
            indicator.style.opacity = '0';
        }
        
        updateHUD();
    }, 1500);
}

// Create Hit Effect
function createHitEffect(position) {
    const particleCount = 15;
    
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
            lifetime: 0.5
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

// Play Shoot Sound - Improved
function playShootSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
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
        // Create a simple red box for testing
        const geometry = new THREE.BoxGeometry(2, 3, 2);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const enemy = new THREE.Mesh(geometry, material);
        
        // Position in front of camera
        enemy.position.x = camera.position.x;
        enemy.position.z = camera.position.z - 15;
        enemy.position.y = 1.5;
        
        scene.add(enemy);
        enemies.push({
            mesh: enemy,
            health: 100,
            speed: 0.05,
            lastAttack: 0
        });
        
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
    for (let i = 0; i < 20; i++) {
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
            lifetime: 1.0
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
            enemy.mesh.position.addScaledVector(direction, enemy.speed);
        }
        
        // Look at player
        enemy.mesh.lookAt(camera.position.x, 1, camera.position.z);
        
        // Attack player if close
        if (distance < 2.5) {
            if (now - enemy.lastAttack > 1000) {
                takeDamage(Config.enemyDamage);
                enemy.lastAttack = now;
                
                // Push enemy back slightly
                enemy.mesh.position.subScaledVector(direction, 1);
            }
        }
    }
}

// Take Damage - Fixed
function takeDamage(amount) {
    health -= amount;
    updateHUD();
    
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

// Setup UI
function setupUI() {
    startButton.addEventListener('click', startGame);
    resumeButton.addEventListener('click', resumeGame);
    restartButton.addEventListener('click', restartGame);
    restartGameButton.addEventListener('click', restartGame);
    
    // Debug spawn button - works anytime!
    const spawnBtn = document.getElementById('spawn-btn');
    if (spawnBtn) {
        spawnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('=== MANUAL SPAWN BUTTON CLICKED ===');
            spawnEnemy();
        });
    }
    
    updateHUD();
}

// Update HUD
function updateHUD() {
    const healthBar = document.getElementById('health-bar');
    const healthText = document.getElementById('health-text');
    const currentAmmoEl = document.getElementById('current-ammo');
    const totalAmmoEl = document.getElementById('total-ammo');
    const scoreEl = document.getElementById('score');
    const waveEl = document.getElementById('wave');
    
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
    
    if (healthText) healthText.textContent = Math.max(0, Math.round(health));
    if (currentAmmoEl) {
        currentAmmoEl.textContent = ammo;
        currentAmmoEl.style.color = ammo < 10 ? '#ff4444' : '#4ecdc4';
    }
    if (totalAmmoEl) totalAmmoEl.textContent = Config.totalAmmo;
    if (scoreEl) scoreEl.textContent = score;
    if (waveEl) waveEl.textContent = wave;
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
    
    // Start waves - spawn enemies immediately!
    for (let i = 0; i < 5; i++) {
        setTimeout(() => spawnEnemy(), i * 300);
    }
    
    // Lock pointer
    gameCanvas.requestPointerLock();
    
    // Start game loop
    clock.start();
    animate();
}

function pauseGame() {
    gameState = GameState.PAUSED;
    pauseScreen.classList.remove('hidden');
    document.exitPointerLock();
}

function resumeGame() {
    gameState = GameState.PLAYING;
    pauseScreen.classList.add('hidden');
    gameCanvas.requestPointerLock();
    
    clock.start();
    animate();
}

function restartGame() {
    pauseScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    
    // Reset game state
    score = 0;
    wave = 1;
    health = Config.maxHealth;
    ammo = Config.maxAmmo;
    
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
    
    // Lock pointer
    gameCanvas.requestPointerLock();
    
    // Start waves
    startWave();
    
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
}

// Window Resize Handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
        const speed = keys.shift ? Config.playerSpeed * Config.playerSprintMultiplier : Config.playerSpeed;
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
}

// Game Loop
function animate() {
    if (gameState !== GameState.PLAYING) return;
    
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    updatePlayer(delta);
    updateEnemies(delta);
    updateParticles(delta);
    
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
        particle.material.opacity = particle.userData.lifetime / 0.5;
        
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
