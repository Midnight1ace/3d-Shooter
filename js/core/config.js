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
    pillarCount: 6,
    navMeshSize: 90,
    navMeshCellSize: 4,
    navMeshPadding: 1.2
};

const WeaponNameSets = {
    pistol: [
        'BerettaM9',
        'ColtPython',
        'DesertEagle',
        'FNFiveSeven',
        'Glock17',
        'LugerP08',
        'M1911',
        'MakarovPM',
        'MauserC96',
        'P320'
    ],
    smg: [
        'MAC10',
        'MP40',
        'MP5',
        'P90',
        'PP19Bizon',
        'Skorpion',
        'Thompson',
        'UMP45',
        'UZI',
        'Vector'
    ],
    ar: [
        'AUG',
        'FAMAS',
        'G36C',
        'GalilARM',
        'HK416',
        'L85A2',
        'M4A1',
        'SCAR_H',
        'SIG_MCX_Spear',
        'TavorTAR21'
    ],
    rifle: [
        'AWM',
        'BarrettM82',
        'CheyTacIntervention',
        'DragunovSVD',
        'Kar98k',
        'M14',
        'M1Garand',
        'MosinNagant',
        'Remington700',
        'VSSVintorez'
    ],
    shotgun: [
        'AA12',
        'BenelliM4',
        'DoubleBarrel',
        'KSG',
        'Mossberg500',
        'Remington870',
        'Saiga12',
        'SPAS12',
        'Striker',
        'Winchester1887'
    ]
};

const WeaponTypeOrder = ['pistol', 'smg', 'ar', 'rifle', 'shotgun'];

function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6D2B79F5;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function prettyName(raw) {
    return raw
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([A-Za-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugify(raw) {
    return raw
        .replace(/_/g, '-')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
}

function lerp(min, max, t) {
    return min + (max - min) * t;
}

function pick(rng, min, max, decimals = 0) {
    const value = lerp(min, max, rng());
    if (decimals === 0) return Math.round(value);
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

const WeaponStatRanges = {
    pistol: {
        damage: [18, 26],
        fireRate: [150, 240],
        range: [120, 160],
        magSize: [10, 17],
        reserveMax: [60, 90],
        recoil: [0.035, 0.06],
        spread: [0.009, 0.014],
        pellets: [1, 1]
    },
    smg: {
        damage: [12, 18],
        fireRate: [70, 110],
        range: [100, 135],
        magSize: [22, 34],
        reserveMax: [110, 160],
        recoil: [0.04, 0.07],
        spread: [0.014, 0.022],
        pellets: [1, 1]
    },
    ar: {
        damage: [20, 30],
        fireRate: [90, 150],
        range: [160, 210],
        magSize: [24, 32],
        reserveMax: [120, 180],
        recoil: [0.045, 0.075],
        spread: [0.012, 0.018],
        pellets: [1, 1]
    },
    rifle: {
        damage: [38, 65],
        fireRate: [220, 420],
        range: [210, 280],
        magSize: [5, 15],
        reserveMax: [30, 70],
        recoil: [0.08, 0.14],
        spread: [0.008, 0.014],
        pellets: [1, 1]
    },
    shotgun: {
        damage: [10, 16],
        fireRate: [360, 520],
        range: [70, 95],
        magSize: [5, 10],
        reserveMax: [30, 55],
        recoil: [0.1, 0.16],
        spread: [0.06, 0.1],
        pellets: [6, 9]
    }
};

function buildStatsForType(type, rng) {
    const ranges = WeaponStatRanges[type] || WeaponStatRanges.rifle;
    const magSize = pick(rng, ranges.magSize[0], ranges.magSize[1], 0);
    let reserveMax = pick(rng, ranges.reserveMax[0], ranges.reserveMax[1], 0);
    reserveMax = Math.max(reserveMax, magSize * 3);

    return {
        damage: pick(rng, ranges.damage[0], ranges.damage[1], 0),
        fireRate: pick(rng, ranges.fireRate[0], ranges.fireRate[1], 0),
        range: pick(rng, ranges.range[0], ranges.range[1], 0),
        magSize,
        reserveMax,
        recoil: pick(rng, ranges.recoil[0], ranges.recoil[1], 3),
        spread: pick(rng, ranges.spread[0], ranges.spread[1], 3),
        pellets: pick(rng, ranges.pellets[0], ranges.pellets[1], 0)
    };
}

function buildWeaponCatalog() {
    const catalog = [];
    WeaponTypeOrder.forEach((type) => {
        const names = WeaponNameSets[type] || [];
        names.forEach((modelName) => {
            const seed = hashString(`${type}:${modelName}`);
            const rng = mulberry32(seed);
            const stats = buildStatsForType(type, rng);
            catalog.push({
                id: `${type}-${slugify(modelName)}`,
                name: prettyName(modelName),
                type,
                model: modelName,
                seed,
                ...stats
            });
        });
    });
    return catalog;
}

export const WeaponCatalog = buildWeaponCatalog();
export const DefaultWeaponId = WeaponCatalog.find((weapon) => weapon.type === 'ar')?.id
    || WeaponCatalog.find((weapon) => weapon.type === 'rifle')?.id
    || WeaponCatalog[0]?.id
    || 'ar-m4a1';
