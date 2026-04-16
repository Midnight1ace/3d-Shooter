/**
 * Collision System
 * Centralizes raycasting, intersection, and collision resolution logic.
 */
export function createCollisionSystem({ state, config, refs, collections }) {
    const raycaster = new THREE.Raycaster();

    /**
     * Unified raycast against map obstacles
     */
    function raycast(origin, direction, maxDistance = Infinity) {
        raycaster.set(origin, direction);
        const hits = collections.mapObstacles.length
            ? raycaster.intersectObjects(collections.mapObstacles, true)
            : [];
        
        if (hits.length > 0 && hits[0].distance <= maxDistance) {
            return hits[0];
        }
        return null;
    }

    /**
     * Unified raycast against enemies
     */
    function raycastEnemies(raycasterObj, maxRange, obstacleDistance) {
        let closestHit = null;
        let closestEnemyIndex = -1;

        for (let i = collections.enemies.length - 1; i >= 0; i--) {
            const enemy = collections.enemies[i];
            if (!enemy.mesh) continue;
            
            const intersects = raycasterObj.intersectObject(enemy.mesh, true);
            if (intersects.length > 0) {
                const hit = intersects[0];
                if (hit.distance <= maxRange &&
                    hit.distance < obstacleDistance &&
                    (!closestHit || hit.distance < closestHit.distance)) {
                    closestHit = hit;
                    closestEnemyIndex = i;
                }
            }
        }

        return { hit: closestHit, index: closestEnemyIndex };
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
     * Resolve player position against all map obstacles
     */
    function resolvePlayerWorldCollision(position, radius, playerY) {
        if (!collections.mapObstacles.length) return position;
        let resolved = position.clone();

        for (let i = 0; i < collections.mapObstacles.length; i++) {
            const obstacle = collections.mapObstacles[i];
            if (!obstacle) continue;
            
            const box = obstacle.userData.boundingBox || new THREE.Box3().setFromObject(obstacle);
            obstacle.userData.boundingBox = box;
            
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
    }

    function removeObstacleCollider(mesh) {
        if (!mesh || !refs.physics?.world) return;
        const handle = getColliderHandle(mesh.userData.colliderHandle);
        if (handle != null) {
            refs.physics.world.removeCollider(handle, true);
        }
        mesh.userData.colliderHandle = null;
    }

    function refreshObstacleCollider(mesh) {
        if (!mesh) return;
        mesh.updateMatrixWorld(true);
        mesh.userData.boundingBox = new THREE.Box3().setFromObject(mesh);
        if (!collections.mapObstacles.includes(mesh) || mesh.parent !== refs.scene) return;
        removeObstacleCollider(mesh);
        createObstacleCollider(mesh);
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
        refreshObstacleCollider
    };
}
