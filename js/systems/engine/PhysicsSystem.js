import { Config } from '../../core/config.js';

export function createPhysicsSystem({ state, refs, collections, callbacks }) {
    let RAPIER = null;
    const WORLD_BOUNDARY = 90;

    async function initPhysics(RAPIER_LIB) {
        if (!RAPIER_LIB) {
            refs.physics = null;
            return false;
        }
        RAPIER = RAPIER_LIB;
        await RAPIER.init();
        const world = new RAPIER.World({ x: 0, y: 0, z: 0 });

        const radius = Math.max(0.35, Config.playerRadius * 0.5);
        const halfHeight = Math.max(0.2, (Config.playerHeight * 0.5) - radius);
        const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, Config.playerHeight, 0)
            .setLinearDamping(8)
            .setAngularDamping(10);
        if (playerBodyDesc.lockRotations) {
            playerBodyDesc.lockRotations();
        }
        const playerBody = world.createRigidBody(playerBodyDesc);
        const playerColliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
            .setFriction(1.1)
            .setRestitution(0);
        const playerCollider = world.createCollider(playerColliderDesc, playerBody);

        const physics = {
            rapier: RAPIER,
            world,
            playerBody,
            playerCollider
        };
        refs.physics = physics;
        return physics;
    }

    function resetPlayerPhysics() {
        const physics = refs.physics;
        if (!physics?.playerBody) return;
        try {
            physics.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            physics.playerBody.setTranslation({ x: 0, y: Config.playerHeight, z: 0 }, true);
        } catch (error) {
            disablePhysics('Player physics reset failed.', error);
        }
    }

    function disablePhysics(reason, error = null) {
        if (!refs.physics) return;
        if (error) {
            console.warn(reason, error);
        } else {
            console.warn(reason);
        }
        
        refs.physics = null;
        collections.enemies.forEach((enemy) => {
            if (!enemy) return;
            enemy.body = null;
            enemy.collider = null;
        });
        collections.mapObstacles.forEach((obstacle) => {
            if (obstacle?.userData) {
                obstacle.userData.colliderHandle = null;
            }
        });
        collections.pickups.forEach((pickup) => {
            if (pickup?.userData) {
                pickup.userData.colliderHandle = null;
            }
        });
    }

    function stepPhysics(delta) {
        const physics = refs.physics;
        if (!physics?.world) return;

        // Validation: delta must be a positive non-NaN number
        if (isNaN(delta) || delta <= 0) {
            console.warn('Physics skipped: invalid delta', delta);
            return;
        }

        try {
            if (physics.world.integrationParameters) {
                physics.world.integrationParameters.dt = delta;
            } else if (physics.world.timestep !== undefined) {
                physics.world.timestep = delta;
            }
            physics.world.step();
        } catch (error) {
            disablePhysics('Physics step failed. Disabling physics.', error);
        }
    }

    function syncPlayerFromPhysics(camera, player) {
        const physics = refs.physics;
        if (!physics?.playerBody) return;
        try {
            const pos = physics.playerBody.translation();
            
            // NaN Safety: check if physics output is valid
            if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
                console.warn('Player physics returned NaN. Resetting body...');
                physics.playerBody.setTranslation({ x: 0, y: Config.playerHeight, z: 0 }, true);
                physics.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                return;
            }

            const clampedX = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, pos.x));
            const clampedZ = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, pos.z));
            const bodyY = Config.playerHeight;
            if (clampedX !== pos.x || clampedZ !== pos.z || pos.y !== bodyY) {
                physics.playerBody.setTranslation({ x: clampedX, y: bodyY, z: clampedZ }, true);
            }
            camera.position.set(clampedX, bodyY + (player?.viewOffsetY || 0), clampedZ);
        } catch (error) {
            disablePhysics('Sync player from physics failed. Falling back to non-physics movement.', error);
        }
    }


    return {
        initPhysics,
        resetPlayerPhysics,
        disablePhysics,
        stepPhysics,
        syncPlayerFromPhysics
    };
}
