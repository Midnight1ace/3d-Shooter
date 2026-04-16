import { Config, GamePhase } from '../../core/config.js';

export function createPlayerSystem({ state, refs, collections, dom, camera, input, weaponSystem, collisionSystem, callbacks }) {
    const WORLD_BOUNDARY = 90;

    function createPlayer() {
        const player = {
            velocity: new THREE.Vector3(),
            direction: new THREE.Vector3(),
            isMoving: false,
            isSprinting: false,
            canShoot: true,
            yaw: 0,
            pitch: 0,
            viewOffsetY: 0,
            lastPosition: null,
            hackWarnings: 0
        };
        refs.player = player;
        return player;
    }

    function handleMouseMove(event) {
        if (!state.isPointerLocked || state.phase !== GamePhase.PLAYING) return;
        const player = refs.player;
        if (!player) return;

        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;

        const sensitivity = 0.002;

        player.yaw -= movementX * sensitivity;
        player.pitch -= movementY * sensitivity;

        player.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, player.pitch));

        camera.rotation.order = 'YXZ';
        camera.rotation.y = player.yaw;
        camera.rotation.x = player.pitch;
    }

    function updatePlayer(delta, clock) {
        if (state.phase !== GamePhase.PLAYING) return;
        const player = refs.player;
        if (!player) return;
        
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
        if (input.keys.w) player.direction.sub(forward); // Forward - camera looks forward
        if (input.keys.s) player.direction.add(forward); // Backward
        if (input.keys.a) player.direction.sub(right);
        if (input.keys.d) player.direction.add(right);
        
        // Normalize and apply speed
        if (player.direction.length() > 0) {
            player.direction.normalize();
            const baseSpeed = input.keys.shift
                ? Config.playerSpeed * Config.playerSprintMultiplier * state.moveSpeedMultiplier
                : Config.playerSpeed * state.moveSpeedMultiplier;
            const speed = baseSpeed * 60;
            player.velocity.copy(player.direction).multiplyScalar(speed);
        }

        const body = refs.physics?.playerBody;
        if (body) {
            try {
                body.setLinvel({ x: player.velocity.x, y: 0, z: player.velocity.z }, true);
            } catch (error) {
                callbacks?.onPhysicsError?.('Player movement physics failed. Falling back to non-physics movement.', error);
                const desiredPosition = camera.position.clone().addScaledVector(player.velocity, delta);
                desiredPosition.y = Config.playerHeight;
                const resolvedPosition = resolvePlayerCollisions(desiredPosition);
                camera.position.copy(resolvedPosition);
                camera.position.x = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.x));
                camera.position.z = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.z));
            }
        } else {
            const desiredPosition = camera.position.clone().addScaledVector(player.velocity, delta);
            desiredPosition.y = Config.playerHeight;
            const resolvedPosition = resolvePlayerCollisions(desiredPosition);
            camera.position.copy(resolvedPosition);
            camera.position.x = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.x));
            camera.position.z = Math.max(-WORLD_BOUNDARY, Math.min(WORLD_BOUNDARY, camera.position.z));
        }
        
        const activeWeapon = weaponSystem.getWeapon();
        const weaponMesh = activeWeapon?.mesh;
        if (weaponMesh) {
            const time = clock.getElapsedTime();
            if (player.velocity.length() > 0) {
                weaponMesh.position.x = 0.25 + Math.sin(time * 12) * 0.015;
                weaponMesh.position.y = -0.35 + Math.cos(time * 18) * 0.01;
            } else {
                weaponMesh.position.x = 0.25 + Math.sin(time * 2) * 0.005;
                weaponMesh.position.y = -0.35 + Math.cos(time * 3) * 0.003;
            }
        }
        
        // Recoil recovery
        if (activeWeapon && activeWeapon.recoil > 0) {
            activeWeapon.recoil *= 0.85;
            player.pitch -= activeWeapon.recoil * 0.5;
            camera.rotation.x = player.pitch;
        }

        dom.chipSprint?.classList.toggle('active', input.keys.shift && player.velocity.length() > 0);

        // Anti-Cheat: Validate distance moved
        if (!player.lastPosition) {
            player.lastPosition = camera.position.clone();
        } else {
            const dist = camera.position.distanceTo(player.lastPosition);
            const maxExpectedDist = Math.max(5, 45 * delta * 2);
            if (dist > maxExpectedDist) {
                console.warn(`[AntiCheat] Unnatural movement detected: ${dist.toFixed(2)} units (max expected ${maxExpectedDist.toFixed(2)})`);
                player.hackWarnings++;
                if (player.hackWarnings > 2) {
                    camera.position.copy(player.lastPosition);
                    // Generate an error log
                    if (window.console && console.error) {
                        console.error(`[AntiCheat] Speedhack/Teleport prevented. Movement distance: ${dist.toFixed(2)}`);
                    }
                }
            } else {
                if (player.hackWarnings > 0) player.hackWarnings--;
                player.lastPosition.copy(camera.position); // Only update lastPosition if it wasn't a hack snapback
            }
        }
    }

    function resolvePlayerCollisions(position) {
        return collisionSystem.resolvePlayerWorldCollision(position, Config.playerRadius, Config.playerHeight);
    }

    return {
        createPlayer,
        handleMouseMove,
        updatePlayer,
        resolvePlayerCollisions
    };
}
