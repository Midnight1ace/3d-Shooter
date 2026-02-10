export const GamePhase = Object.freeze({
    LOADING: 'loading',
    START: 'start',
    PLAYING: 'playing',
    PAUSED: 'paused',
    CHOOSING: 'choosing',
    GAME_OVER: 'game_over'
});

export const Config = {
    // Scene
    fov: 80,
    near: 0.1,
    far: 1000,

    // Player
    playerHeight: 1.7,
    playerRadius: 0.8,
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
    hitStopDuration: 0.035,
    hitStopKillMultiplier: 1.4,
    hitStopHitMultiplier: 1.0,
    cameraShakeShoot: 0.02,
    cameraShakeHit: 0.01,
    cameraShakeDamage: 0.08,
    ammoDropChance: 0.35,
    ammoDropAmountMags: 1,
    
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

export const WeaponCatalog = [
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
