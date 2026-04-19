/**
 * Collision System
 * Centralizes raycasting, intersection, and collision resolution logic.
 * Optimized with spatial partitioning for O(1) average-case lookups.
 */
export function createCollisionSystem({ state, config, refs, collections }) {
    const raycaster = new THREE.Raycaster();

    // Spatial grid for enemy collision optimization
    const GRID_CELL_SIZE = 8;
    const enemySpatialGrid = new Map();
    const obstacleSpatialGrid = new Map();

    function getCellKey(x, z) {
        const cx = Math.floor(x / GRID_CELL_SIZE);
        const cz = Math.floor(z / GRID_CELL_SIZE);
        return `${cx},${cz}`;
    }

    function rebuildEnemySpatialGrid() {
        enemySpatialGrid.clear();
        for (let i = 0; i < collections.enemies.length; i++) {
            const enemy = collections.enemies[i];
            if (!enemy.position) continue;
            const pos = enemy.position;
            const key = getCellKey(pos.x, pos.z);
            if (!enemySpatialGrid.has(key)) {
                enemySpatialGrid.set(key, []);
            }
            enemySpatialGrid.get(key).push(i);
            
            // Also add to adjacent cells for edge cases
            const adjacentKeys = [
                `${Math.floor(pos.x / GRID_CELL_SIZE) - 1},${Math.floor(pos.z / GRID_CELL_SIZE)}`,
                `${Math.floor(pos.x / GRID_CELL_SIZE) + 1},${Math.floor(pos.z / GRID_CELL_SIZE)}`,
                `${Math.floor(pos.x / GRID_CELL_SIZE)},${Math.floor(pos.z / GRID_CELL_SIZE) - 1}`,
                `${Math.floor(pos.x / GRID_CELL_SIZE)},${Math.floor(pos.z / GRID_CELL_SIZE) + 1}`
            ];
            for (const adjKey of adjacentKeys) {
                if (!enemySpatialGrid.has(adjKey)) {
                    enemySpatialGrid.set(adjKey, []);
                }
            }
        }
    }

    function getNearbyEnemyIndices(origin, direction, maxDistance) {
        const candidateIndices = new Set();
        
        if (!origin || !direction) return [];
        
        // Limit steps to prevent infinite loop with Infinity maxDistance
        const effectiveMaxDistance = (maxDistance === Infinity || !maxDistance) ? 100 : maxDistance;
        const steps = Math.min(20, Math.ceil(effectiveMaxDistance / GRID_CELL_SIZE) + 2);
        const dx = direction.x;
        const dz = direction.z;
        
        const startX = origin.x;
        const startZ = origin.z;
        
        for (let step = 0; step <= steps; step++) {
            const checkX = startX + dx * (step * GRID_CELL_SIZE * 0.5);
            const checkZ = startZ + dz * (step * GRID_CELL_SIZE * 0.5);
            const key = getCellKey(checkX, checkZ);
            
            const cellEnemies = enemySpatialGrid.get(key);
            if (cellEnemies) {
                for (const idx of cellEnemies) {
                    candidateIndices.add(idx);
                }
            }
        }
        
        return Array.from(candidateIndices);
    }

    function rebuildObstacleSpatialGrid() {
        obstacleSpatialGrid.clear();
        for (let i = 0; i < collections.mapObstacles.length; i++) {
            const obstacle = collections.mapObstacles[i];
            if (!obstacle || !obstacle.userData.boundingBox) continue;
            
            const box = obstacle.userData.boundingBox;
            const minX = Math.floor(box.min.x / GRID_CELL_SIZE);
            const maxX = Math.floor(box.max.x / GRID_CELL_SIZE);
            const minZ = Math.floor(box.min.z / GRID_CELL_SIZE);
            const maxZ = Math.floor(box.max.z / GRID_CELL_SIZE);
            
            for (let cx = minX; cx <= maxX; cx++) {
                for (let cz = minZ; cz <= maxZ; cz++) {
                    const key = `${cx},${cz}`;
                    if (!obstacleSpatialGrid.has(key)) {
                        obstacleSpatialGrid.set(key, []);
                    }
                    obstacleSpatialGrid.get(key).push(i);
                }
            }
        }
    }

    function getNearbyObstacles(position, radius) {
        const candidateIndices = new Set();
        const minX = Math.floor((position.x - radius) / GRID_CELL_SIZE);
        const maxX = Math.floor((position.x + radius) / GRID_CELL_SIZE);
        const minZ = Math.floor((position.z - radius) / GRID_CELL_SIZE);
        const maxZ = Math.floor((position.z + radius) / GRID_CELL_SIZE);
        
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const key = `${cx},${cz}`;
                const cellObstacles = obstacleSpatialGrid.get(key);
                if (cellObstacles) {
                    for (const idx of cellObstacles) {
                        candidateIndices.add(idx);
                    }
                }
            }
        }
        
        return Array.from(candidateIndices);
    }

    /**
     * Unified raycast against map obstacles
     */
    function raycast(origin, direction, maxDistance = Infinity) {
        try {
            if (!origin || !direction) return null;
            raycaster.set(origin, direction);
            const hits = collections.mapObstacles.length
                ? raycaster.intersectObjects(collections.mapObstacles, true)
                : [];
            
            if (hits.length > 0 && hits[0].distance <= maxDistance) {
                return hits[0];
            }
            return null;
        } catch (error) {
            console.error('raycast error:', error);
            return null;
        }
    }

    /**
     * Unified raycast against enemies - OPTIMIZED with spatial grid
     */
    function raycastEnemies(raycasterObj, maxRange, obstacleDistance) {
        try {
            if (!collections.enemies.length) {
                return { hit: null, index: -1 };
            }

            // Rebuild grid if needed (do this less frequently in production)
            if (enemySpatialGrid.size === 0) {
                rebuildEnemySpatialGrid();
            }

            if (!raycasterObj?.ray?.origin || !raycasterObj?.ray?.direction) {
                return { hit: null, index: -1 };
            }

            const origin = raycasterObj.ray.origin;
            const direction = raycasterObj.ray.direction;
            
            // Get only nearby enemies using spatial grid - O(1) instead of O(n)
            let candidateIndices = getNearbyEnemyIndices(origin, direction, maxRange);
            
            // Fallback: if grid returns nothing or grid might be stale, use all enemies
            if (!candidateIndices || candidateIndices.length === 0) {
                candidateIndices = [];
                for (let i = 0; i < collections.enemies.length; i++) {
                    candidateIndices.push(i);
                }
            }
            
            if (!candidateIndices.length) {
                return { hit: null, index: -1 };
            }

            let closestHit = null;
            let closestEnemyIndex = -1;

            for (const i of candidateIndices) {
                if (i < 0 || i >= collections.enemies.length) continue;
                const enemy = collections.enemies[i];
                if (!enemy || !enemy.position) continue;
                
                const enemyPos = enemy.position;
                const enemyScale = enemy.archetype?.scale || 1;
                const enemyRadius = 0.9 * enemyScale;
                const enemyBodyY = 1.5 * enemyScale;
                const enemyCenter = new THREE.Vector3(enemyPos.x, enemyPos.y + enemyBodyY, enemyPos.z);
                const toEnemy = enemyCenter.clone().sub(origin);
                const distAlongRay = toEnemy.dot(direction);
                if (distAlongRay < 0 || distAlongRay > maxRange || distAlongRay > obstacleDistance) continue;
                const closestApproach = toEnemy.clone().sub(direction.clone().multiplyScalar(distAlongRay));
                const perpDist = closestApproach.length();
                if (perpDist < enemyRadius) {
                    const hitDist = distAlongRay;
                    const hitPoint = origin.clone().add(direction.clone().multiplyScalar(hitDist));
                    if (!closestHit || hitDist < closestHit.distance) {
                        closestHit = { distance: hitDist, point: hitPoint };
                        closestEnemyIndex = i;
                    }
                }
            }

            return { hit: closestHit, index: closestEnemyIndex };
        } catch (error) {
            console.error('raycastEnemies error:', error);
            return { hit: null, index: -1 };
        }
    }

    /**
     * Resolve sphere-box collision (manual resolution)
     */
    function resolveSphereBoxCollision(position, radius, box, playerY) {
        const expanded = box.clone();
        expanded.min.x -= radius;
        expanded.max.x += radius;
        expanded.min.z -= radius;
        expanded.max.z += radius;

        if (position.x < expanded.min.x || position.x > expanded.max.x || 
            position.z < expanded.min.z || position.z > expanded.max.z) {
            return null;
        }

        if (playerY < expanded.min.y - 1 || playerY > expanded.max.y + 1) {
            return null;
        }

        const resolved = position.clone();
        const overlapX = Math.min(expanded.max.x - position.x, position.x - expanded.min.x);
        const overlapZ = Math.min(expanded.max.z - position.z, position.z - expanded.min.z);
        
        if (overlapX < overlapZ) {
            const centerX = (expanded.min.x + expanded.max.x) * 0.5;
            resolved.x = position.x < centerX ? expanded.min.x : expanded.max.x;
        } else {
            const centerZ = (expanded.min.z + expanded.max.z) * 0.5;
            resolved.z = position.z < centerZ ? expanded.min.z : expanded.max.z;
        }
        
        return resolved;
    }

    /**
     * Check if two Rapier colliders are overlapping
     */
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
        return false;
    }

    /**
     * Utility to get handle from Rapier collider
     */
    function getColliderHandle(collider) {
        if (!collider) return null;
        return typeof collider === 'number' ? collider : collider.handle;
    }

    /**
     * Resolve player position against all map obstacles - OPTIMIZED with spatial grid
     */
    function resolvePlayerWorldCollision(position, radius, playerY) {
        if (!collections.mapObstacles.length) return position;
        
        // Rebuild obstacle grid if needed
        if (obstacleSpatialGrid.size === 0) {
            rebuildObstacleSpatialGrid();
        }
        
        // Get only nearby obstacles using spatial grid
        const nearbyIndices = getNearbyObstacles(position, radius);
        
        if (!nearbyIndices.length) return position;

        let resolved = position.clone();

        for (const i of nearbyIndices) {
            const obstacle = collections.mapObstacles[i];
            if (!obstacle) continue;
            
            const box = obstacle.userData.boundingBox;
            if (!box) continue;
            
            const result = resolveSphereBoxCollision(resolved, radius, box, playerY);
            if (result) {
                resolved.copy(result);
            }
        }
        return resolved;
    }

    function createObstacleCollider(mesh) {
        if (!mesh || !refs.physics?.world) return;
        const physics = refs.physics;

        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.userData.boundingBox = box;
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const half = size.multiplyScalar(0.5);

        const colliderDesc = physics.rapier.ColliderDesc.cuboid(half.x, 20, half.z)
            .setTranslation(center.x, 0, center.z)
            .setFriction(1.3)
            .setRestitution(0);

        const collider = physics.world.createCollider(colliderDesc);
        mesh.userData.colliderHandle = getColliderHandle(collider);
        
        // Rebuild obstacle grid
        rebuildObstacleSpatialGrid();
    }

    function removeObstacleCollider(mesh) {
        if (!mesh || !refs.physics?.world) return;
        const handle = getColliderHandle(mesh.userData.colliderHandle);
        if (handle != null) {
            refs.physics.world.removeCollider(handle, true);
        }
        mesh.userData.colliderHandle = null;
        
        // Rebuild obstacle grid
        rebuildObstacleSpatialGrid();
    }

    function refreshObstacleCollider(mesh) {
        if (!mesh) return;
        mesh.updateMatrixWorld(true);
        mesh.userData.boundingBox = new THREE.Box3().setFromObject(mesh);
        if (!collections.mapObstacles.includes(mesh) || mesh.parent !== refs.scene) return;
        removeObstacleCollider(mesh);
        createObstacleCollider(mesh);
    }

    function rebuildAllSpatialGrids() {
        rebuildEnemySpatialGrid();
        rebuildObstacleSpatialGrid();
    }

    return {
        raycast,
        raycastEnemies,
        resolveSphereBoxCollision,
        resolvePlayerWorldCollision,
        areCollidersOverlapping,
        getColliderHandle,
        createObstacleCollider,
        removeObstacleCollider,
        refreshObstacleCollider,
        rebuildAllSpatialGrids,
        rebuildEnemySpatialGrid,
        rebuildObstacleSpatialGrid
    };
}
