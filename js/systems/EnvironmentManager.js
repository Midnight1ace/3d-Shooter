import { Config } from '../core/config.js';

export function createEnvironmentManager({ state, refs, collections, ui, audio, callbacks }) {
    let currentLayout = null;
    let ammoCrateGeometry = null;
    let ammoCrateMaterial = null;
    const NAV_ZONE_ID = 'arena';

    // --- Helpers for Physics & Colliders ---

    function getColliderHandle(collider) {
        if (!collider) return null;
        return typeof collider === 'number' ? collider : collider.handle;
    }

    function createObstacleCollider(mesh) {
        if (!mesh || !refs.physics?.world) return;
        const physics = refs.physics;
        
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.userData.boundingBox = box;
        const size = new THREE.Vector3();
        box.getSize(size);
        const half = size.multiplyScalar(0.5);
        
        const colliderDesc = physics.rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
            .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
            .setFriction(1.3)
            .setRestitution(0);
            
        if (colliderDesc.setRotation) {
            colliderDesc.setRotation({
                x: mesh.quaternion.x,
                y: mesh.quaternion.y,
                z: mesh.quaternion.z,
                w: mesh.quaternion.w
            });
        }
        
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

    // --- Map Objects Management ---

    function addMapObject(mesh) {
        mesh.userData.isObstacle = true;
        if (!mesh.userData.boundingBox) {
            mesh.userData.boundingBox = new THREE.Box3().setFromObject(mesh);
        }
        collections.mapObstacles.push(mesh);
        refs.scene.add(mesh);
        createObstacleCollider(mesh);
    }

    function clearMapObstacles() {
        collections.mapObstacles.forEach((obj) => {
            removeObstacleCollider(obj);
            refs.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((mat) => mat.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        collections.mapObstacles = [];
    }

    function createEnvironment() {
        // Ground - grass texture color
        const groundGeometry = new THREE.PlaneGeometry(250, 250);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a7c3f,
            roughness: 0.9,
            metalness: 0.05
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = !state.lowPowerMode;
        refs.scene.add(ground);
        
        // Add ground detail (rocks, grass patches)
        createGroundDetail();
        
        // Skybox - darker for better contrast with bloom
        const skyGeometry = new THREE.SphereGeometry(450, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            color: 0x708090, // Slate Gray
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        refs.scene.add(sky);
        
        // Lighting
        setupLighting();

        const density = state.lowPowerMode ? 0.5 : 1;
        regenerateMap();
        createTrees(density);
    }

    function createGroundDetail() {
        const detailCount = state.lowPowerMode ? 40 : 120;
        const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 });
        const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x3d6e36, roughness: 1.0 });
        
        for (let i = 0; i < detailCount; i++) {
            const isRock = Math.random() > 0.4;
            let mesh;
            
            if (isRock) {
                const size = 0.2 + Math.random() * 0.4;
                const geometry = new THREE.IcosahedronGeometry(size, 0);
                mesh = new THREE.Mesh(geometry, rockMaterial);
                mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            } else {
                const w = 0.1 + Math.random() * 0.2;
                const h = 0.2 + Math.random() * 0.3;
                const geometry = new THREE.ConeGeometry(w, h, 3);
                mesh = new THREE.Mesh(geometry, grassMaterial);
                mesh.rotation.y = Math.random() * Math.PI;
            }
            
            const radius = 10 + Math.random() * 80;
            const angle = Math.random() * Math.PI * 2;
            mesh.position.set(Math.cos(angle) * radius, mesh.geometry.type === 'ConeGeometry' ? 0.1 : 0, Math.sin(angle) * radius);
            mesh.receiveShadow = !state.lowPowerMode;
            refs.scene.add(mesh);
        }
    }

    function setupLighting() {
        // Ambient Light - lower intensity
        const ambientLight = new THREE.AmbientLight(0xffeedd, 0.4);
        refs.scene.add(ambientLight);

        // Directional Light - lower intensity
        const directionalLight = new THREE.DirectionalLight(0xffffee, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = !state.lowPowerMode;
        
        if (!state.lowPowerMode) {
             directionalLight.shadow.mapSize.width = 2048;
             directionalLight.shadow.mapSize.height = 2048;
             directionalLight.shadow.camera.near = 0.5;
             directionalLight.shadow.camera.far = 500;
             directionalLight.shadow.camera.left = -100;
             directionalLight.shadow.camera.right = 100;
             directionalLight.shadow.camera.top = 100;
             directionalLight.shadow.camera.bottom = -100;
        } else {
             directionalLight.shadow.mapSize.width = 1024;
             directionalLight.shadow.mapSize.height = 1024;
        }
        refs.scene.add(directionalLight);

        // Hemisphere Light
        const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x4a6741, 0.5);
        refs.scene.add(hemisphereLight);

        // Point lights
        const pointLight1 = new THREE.PointLight(0xff6600, 0.5, 30);
        pointLight1.position.set(20, 5, 20);
        refs.scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0x0066ff, 0.5, 30);
        pointLight2.position.set(-20, 5, -20);
        refs.scene.add(pointLight2);
    }

    // --- Layout Generation ---

    function regenerateMap() {
        clearPickups();
        clearMapObstacles();
        
        const layouts = ['lanes', 'ring', 'cross', 'scatter'];
        let nextLayout = layouts[Math.floor(Math.random() * layouts.length)];
        if (nextLayout === currentLayout && layouts.length > 1) {
            const idx = (layouts.indexOf(nextLayout) + 1) % layouts.length;
            nextLayout = layouts[idx];
        }
        currentLayout = nextLayout;

        const density = state.lowPowerMode ? 0.6 : 1;
        const castShadow = !state.lowPowerMode;

        switch (nextLayout) {
            case 'ring': createLayoutRing(castShadow, density); break;
            case 'cross': createLayoutCross(castShadow, density); break;
            case 'scatter': createLayoutScatter(castShadow, density); break;
            case 'lanes': default: createLayoutLanes(castShadow, density); break;
        }
        
        rebuildNavMesh();
    }

    function createLayoutLanes(castShadow, density) {
        const barrierMaterial = new THREE.MeshStandardMaterial({
            color: 0x5a6069,
            roughness: 0.6,
            metalness: 0.6,
            emissive: 0x111111,
            emissiveIntensity: 0.1
        });
        const count = Math.max(6, Math.round(15 * density));
        for (let i = 0; i < count; i++) {
            const width = 2 + Math.random() * 3;
            const length = 8 + Math.random() * 10;
            const h = 2.0 + Math.random() * 1.5;
            const geometry = new THREE.BoxGeometry(width, h, length);
            const barrier = new THREE.Mesh(geometry, barrierMaterial);
            barrier.position.set((Math.random() - 0.5) * 80, h/2, (Math.random() - 0.5) * 80);
            barrier.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;
            barrier.castShadow = castShadow;
            barrier.receiveShadow = castShadow;
            addMapObject(barrier);
        }
    }

    function createLayoutRing(castShadow, density) {
        const barrierMaterial = new THREE.MeshStandardMaterial({
            color: 0x808080,
            roughness: 0.7,
            metalness: 0.5,
            emissive: 0x222222,
            emissiveIntensity: 0.2
        });
        const ringCount = Math.max(10, Math.round(18 * density));
        for (let i = 0; i < ringCount; i++) {
            const sizeW = 3.5 + Math.random();
            const sizeH = 1.2 + Math.random() * 0.4;
            const geometry = new THREE.BoxGeometry(sizeW, sizeH, 1.2);
            const barrier = new THREE.Mesh(geometry, barrierMaterial);
            const angle = (i / ringCount) * Math.PI * 2;
            const radius = 26 + Math.random() * 4;
            barrier.position.set(Math.cos(angle) * radius, 0.7, Math.sin(angle) * radius);
            barrier.rotation.y = angle + Math.PI / 2;
            barrier.castShadow = castShadow;
            barrier.receiveShadow = castShadow;
            addMapObject(barrier);
        }
    }

    function createLayoutCross(castShadow, density) {
        const barrierMaterial = new THREE.MeshStandardMaterial({
            color: 0x6f7680,
            roughness: 0.8,
            metalness: 0.4,
            emissive: 0x222222,
            emissiveIntensity: 0.1
        });
        const segments = Math.max(3, Math.round(6 * density));
        for (let i = -segments; i <= segments; i++) {
            const h = 1.4 + Math.random() * 0.4;
            const geometry = new THREE.BoxGeometry(6, h, 1.6);
            const wall = new THREE.Mesh(geometry, barrierMaterial);
            wall.position.set(i * 6.2, h/2, 0);
            wall.castShadow = castShadow;
            wall.receiveShadow = castShadow;
            addMapObject(wall);

            const wall2 = wall.clone();
            wall2.rotation.y = Math.PI / 2;
            const h2 = 1.4 + Math.random() * 0.4;
            wall2.geometry = new THREE.BoxGeometry(6, h2, 1.6);
            wall2.position.set(0, h2/2, i * 6.2);
            addMapObject(wall2);
        }
    }

    function createLayoutScatter(castShadow, density) {
        const crateMaterial = new THREE.MeshStandardMaterial({
            color: 0x7c5b3b,
            roughness: 0.8,
            metalness: 0.3,
            emissive: 0x332211,
            emissiveIntensity: 0.1
        });
        const pillarMaterial = new THREE.MeshStandardMaterial({
            color: 0x606060,
            roughness: 0.4,
            metalness: 0.7,
            emissive: 0x111111,
            emissiveIntensity: 0.1
        });
        const crateCount = Math.max(8, Math.round(Config.crateCount * density));
        const pillarCount = Math.max(5, Math.round(Config.pillarCount * density));

        for (let i = 0; i < crateCount; i++) {
            const size = 1.2 + Math.random() * 1.8;
            const geometry = new THREE.BoxGeometry(size, size, size);
            const obstacle = new THREE.Mesh(geometry, crateMaterial);
            obstacle.position.set((Math.random() - 0.5) * 90, size / 2, (Math.random() - 0.5) * 90);
            obstacle.rotation.y = Math.random() * Math.PI;
            obstacle.castShadow = castShadow;
            obstacle.receiveShadow = castShadow;
            addMapObject(obstacle);
        }

        for (let i = 0; i < pillarCount; i++) {
            const h = 5 + Math.random() * 4;
            const r = 0.8 + Math.random() * 0.5;
            const geometry = new THREE.CylinderGeometry(r * 0.9, r, h, 8);
            const pillar = new THREE.Mesh(geometry, pillarMaterial);
            const angle = (i / pillarCount) * Math.PI * 2 + Math.random();
            const radius = 20 + Math.random() * 30;
            pillar.position.set(Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius);
            pillar.castShadow = castShadow;
            pillar.receiveShadow = castShadow;
            addMapObject(pillar);
        }
    }

    function createTrees(density = 1) {
        const count = Math.max(8, Math.round(Config.treeCount * density));
        const castShadow = !state.lowPowerMode;
        
        for (let i = 0; i < count; i++) {
            const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
            const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5D4037 });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.y = 1.5;
            trunk.castShadow = castShadow;
            
            const foliageGeometry = new THREE.ConeGeometry(2, 5, 8);
            const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2E7D32 });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.y = 5;
            foliage.castShadow = castShadow;
            
            const tree = new THREE.Group();
            tree.add(trunk);
            tree.add(foliage);
            
            const angle = Math.random() * Math.PI * 2;
            const radius = 40 + Math.random() * 60;
            tree.position.x = Math.cos(angle) * radius;
            tree.position.z = Math.sin(angle) * radius;
            
            refs.scene.add(tree);
        }
    }

    // --- NavMesh ---

    function buildNavMeshGeometry() {
        const halfSize = 45; 
        const cellSize = 1.5;
        const padding = 0.8;
        const positions = [];
        const obstacleBoxes = collections.mapObstacles.map((mesh) => {
            const bounds = mesh.userData.boundingBox || new THREE.Box3().setFromObject(mesh);
            return {
                minX: bounds.min.x - padding,
                maxX: bounds.max.x + padding,
                minZ: bounds.min.z - padding,
                maxZ: bounds.max.z + padding
            };
        });

        for (let x = -halfSize; x < halfSize; x += cellSize) {
            for (let z = -halfSize; z < halfSize; z += cellSize) {
                const cx = x + cellSize * 0.5;
                const cz = z + cellSize * 0.5;
                let blocked = false;
                for (let i = 0; i < obstacleBoxes.length; i++) {
                    const box = obstacleBoxes[i];
                    if (cx >= box.minX && cx <= box.maxX && cz >= box.minZ && cz <= box.maxZ) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) continue;
                
                const x1 = x + cellSize;
                const z1 = z + cellSize;
                positions.push(
                    x, 0, z,
                    x1, 0, z,
                    x1, 0, z1,
                    x, 0, z,
                    x1, 0, z1,
                    x, 0, z1
                );
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        return geometry;
    }

    function rebuildNavMesh() {
        if (!refs.pathfinding) return;
        
        // We assume main.js has assigned a Pathfinding instance to refs.pathfinding
        // We also need the Zone builder, which might not be on the instance.
        // For now, let's look for it in the global or passed references.
        // If it fails, we just don't have a navmesh, which is a graceful degradation.
        
        try {
            const geometry = buildNavMeshGeometry();
            
            // Try to find the createZone function. 
            // In many three-pathfinding builds, it's a static method on Pathfinding or a separate export.
            // If main.js passed the constructor, we might find it there.
            let zone = null;
            if (THREE.Pathfinding && THREE.Pathfinding.createZone) {
                zone = THREE.Pathfinding.createZone(geometry);
            } else if (refs.pathfinding.createZone) {
                zone = refs.pathfinding.createZone(geometry);
            } else if (window.Pathfinding && window.Pathfinding.createZone) {
                zone = window.Pathfinding.createZone(geometry);
            }

            if (zone) {
                refs.pathfinding.setZoneData(NAV_ZONE_ID, zone);
                refs.navZoneId = NAV_ZONE_ID;
            }
        } catch (e) {
            console.warn('NavMesh generation failed:', e);
        }
    }
    
    // --- Pickups ---

    function createPickupCollider(pickup) {
        if (!pickup || !refs.physics?.world) return;
        const physics = refs.physics;
        const size = 0.45;
        const colliderDesc = physics.rapier.ColliderDesc.cuboid(size, size, size)
            .setTranslation(pickup.position.x, pickup.position.y, pickup.position.z);
        
        if (colliderDesc.setSensor) colliderDesc.setSensor(true);
        
        const collider = physics.world.createCollider(colliderDesc);
        pickup.userData.colliderHandle = getColliderHandle(collider);
    }

    function removePickupCollider(pickup) {
        if (!pickup || !refs.physics?.world) return;
        const handle = getColliderHandle(pickup.userData.colliderHandle);
        if (handle != null) {
            refs.physics.world.removeCollider(handle, true);
        }
        pickup.userData.colliderHandle = null;
    }

    function spawnAmmoCrate(position) {
        if (!refs.scene) return;
        
        if (!ammoCrateGeometry) ammoCrateGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        if (!ammoCrateMaterial) {
             ammoCrateMaterial = new THREE.MeshStandardMaterial({
                color: 0x00ff88,
                emissive: 0x00ff88,
                emissiveIntensity: 1.2,
                roughness: 0.2,
                metalness: 0.8
            });
        }

        const crate = new THREE.Mesh(ammoCrateGeometry, ammoCrateMaterial);
        crate.position.copy(position);
        crate.position.y = 0.45;
        crate.castShadow = !state.lowPowerMode;
        crate.receiveShadow = !state.lowPowerMode;
        crate.userData = {
            type: 'ammo',
            amountMags: Config.ammoDropAmountMags
        };
        
        refs.scene.add(crate);
        collections.pickups.push(crate);
        createPickupCollider(crate);
    }

    function clearPickups() {
        collections.pickups.forEach((pickup) => {
            if (pickup) {
                removePickupCollider(pickup);
                refs.scene?.remove(pickup);
            }
        });
        collections.pickups = [];
    }
    
    function update(delta) {
        if (!collections.pickups.length) return;
        
        const playerPos = refs.camera.position;
        
        for (let i = collections.pickups.length - 1; i >= 0; i--) {
            const pickup = collections.pickups[i];
            if (!pickup) {
                collections.pickups.splice(i, 1);
                continue;
            }
            
            pickup.rotation.y += delta * 1.5;
            
            const distance = pickup.position.distanceTo(playerPos);
            if (distance <= 2.2) {
                // Call the callback to handle the logic (adding ammo, interacting with UI)
                const consumed = callbacks?.onPickupCollected?.(pickup);
                
                if (consumed) {
                    refs.scene.remove(pickup);
                    removePickupCollider(pickup);
                    collections.pickups.splice(i, 1);
                }
            }
        }
    }

    return {
        createEnvironment,
        regenerateMap,
        spawnAmmoCrate,
        clearPickups,
        update
    };
}
