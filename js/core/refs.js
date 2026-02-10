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
    enemyLoadFailed: false
};

export const collections = {
    enemies: [],
    bullets: [],
    mapObstacles: [],
    pickups: []
};
