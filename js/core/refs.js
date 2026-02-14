export const refs = {
    scene: null,
    camera: null,
    renderer: null,
    clock: null,
    player: null,
    weapon: null,
    shakeOffset: new THREE.Vector3(),
    enemyPrototype: null,
    enemyAnimationClips: {},
    enemyAnimationsLoaded: false,
    enemyLoadFailed: false,
    physics: null,
    pathfinding: null,
    navZoneId: null,
    shieldUniforms: null
};

export const collections = {
    enemies: [],
    bullets: [],
    mapObstacles: [],
    pickups: [],
    particles: [],
    particlePools: {
        hit: [],
        death: [],
        explosion: []
    },
    tracers: [],
    tracerPool: []
};
