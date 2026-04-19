import { Config } from '../../core/config.js'

export function createEnvironmentManager({ state, refs, collections, ui, audio, collisionSystem, callbacks }) {
    let currentLayout = null;
    let ammoCrateGeometry = null;
    let ammoCrateMaterial = null;
    let mapSafeZone = null;
    let baseEnvironmentReady = false;
    let sceneryGeneration = 0;
    let mapGeneration = 0;
    let navMeshRefreshTimer = null;
    const NAV_ZONE_ID = 'arena';
    const sceneryRoots = [];
    const environmentAssetCache = new Map();
    const gltfLoader = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
        ? new THREE.GLTFLoader()
        : null;
    const treeAssetNames = ['Trees', 'Pine Trees', 'Birch Trees', 'Dead Trees', 'Maple Trees'];

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function sanitizeAssetName(assetName) {
        if (typeof assetName !== 'string') return null;
        const trimmed = assetName.trim().replace(/\\/g, '/');
        if (!trimmed) return null;
        const withoutFolder = trimmed.replace(/^\.?\/?assets\//i, '');
        const withoutExtension = withoutFolder.replace(/\.glb$/i, '').trim();
        return withoutExtension || null;
    }

    function getAssetPath(assetName) {
        const sanitized = sanitizeAssetName(assetName);
        if (!sanitized) return null;
        return `assets/${sanitized}.glb`;
    }

    function cloneSceneGraph(scene) {
        return THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(scene) : scene.clone(true);
    }

    function markProceduralForCleanup(root) {
        if (!root) return root;
        root.traverse((child) => {
            if (child.isMesh) {
                child.userData.disposeOnRemove = true;
            }
        });
        return root;
    }

    function disposeOwnedResources(root) {
        if (!root) return;
        root.traverse((child) => {
            if (!child.userData?.disposeOnRemove || !child.isMesh) return;
            if (child.geometry?.dispose) {
                child.geometry.dispose();
            }
            if (!child.material) return;
            if (Array.isArray(child.material)) {
                child.material.forEach((material) => material?.dispose?.());
            } else {
                child.material.dispose?.();
            }
        });
    }

    function replaceContainerVisual(container, visual) {
        if (!container || !visual) return;
        const previousChildren = container.children.slice();
        previousChildren.forEach((child) => {
            container.remove(child);
            disposeOwnedResources(child);
        });
        container.add(visual);
    }

    function applyShadowSettings(root, { castShadow = false, receiveShadow = false } = {}) {
        if (!root) return;
        root.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = castShadow;
            child.receiveShadow = receiveShadow;
        });
    }

    function normalizeExternalAsset(root, { targetHeight = 1, centerXZ = true, alignToGround = true } = {}) {
        if (!root) return;
        const box = new THREE.Box3().setFromObject(root);
        if (!Number.isFinite(box.min.x)) return;

        const size = new THREE.Vector3();
        box.getSize(size);
        const scale = targetHeight > 0 && size.y > 0
            ? targetHeight / size.y
            : 1 / (Math.max(size.x, size.y, size.z) || 1);
        root.scale.setScalar(scale);

        const scaledBox = new THREE.Box3().setFromObject(root);
        if (centerXZ) {
            const center = scaledBox.getCenter(new THREE.Vector3());
            root.position.x -= center.x;
            root.position.z -= center.z;
        }

        const groundedBox = new THREE.Box3().setFromObject(root);
        if (alignToGround) {
            root.position.y -= groundedBox.min.y;
        } else {
            const center = groundedBox.getCenter(new THREE.Vector3());
            root.position.y -= center.y;
        }
    }

    function loadAssetTemplate(assetName, onReady, onError) {
        const modelPath = getAssetPath(assetName);
        if (!modelPath || !gltfLoader) {
            onError?.(new Error(`Unable to load environment model: ${assetName}`));
            return;
        }

        const existing = environmentAssetCache.get(modelPath);
        if (existing?.status === 'ready' && existing.scene) {
            onReady?.(existing.scene);
            return;
        }
        if (existing?.status === 'error') {
            onError?.(existing.error);
            return;
        }

        const entry = existing || { status: 'loading', callbacks: [] };
        entry.callbacks.push({ onReady, onError });
        if (existing) return;

        environmentAssetCache.set(modelPath, entry);
        gltfLoader.load(
            modelPath,
            (gltf) => {
                entry.status = 'ready';
                entry.scene = gltf.scene;
                const callbacks = entry.callbacks.slice();
                entry.callbacks.length = 0;
                callbacks.forEach((callback) => callback.onReady?.(gltf.scene));
            },
            undefined,
            (error) => {
                entry.status = 'error';
                entry.error = error;
                const callbacks = entry.callbacks.slice();
                entry.callbacks.length = 0;
                callbacks.forEach((callback) => callback.onError?.(error));
                console.warn(`Environment model not found: ${modelPath}`);
            }
        );
    }

    function addSceneryObject(root) {
        if (!root || !refs.scene) return false;
        sceneryRoots.push(root);
        refs.scene.add(root);
        return true;
    }

    function clearScenery() {
        sceneryGeneration += 1;
        sceneryRoots.forEach((root) => {
            refs.scene?.remove(root);
            disposeOwnedResources(root);
        });
        sceneryRoots.length = 0;
    }

    function scheduleNavMeshRefresh() {
        if (navMeshRefreshTimer) return;
        navMeshRefreshTimer = setTimeout(() => {
            navMeshRefreshTimer = null;
            rebuildNavMesh();
        }, 60);
    }

    function applyExternalAssetToContainer(container, assetName, options = {}) {
        if (!container || !assetName) return;
        const modelPath = getAssetPath(assetName);
        if (!modelPath) return;

        const generation = options.generation ?? 0;
        container.userData.assetModelPath = modelPath;
        container.userData.assetGeneration = generation;

        loadAssetTemplate(
            assetName,
            (scene) => {
                if (!container || container.userData.assetModelPath !== modelPath) return;
                if (container.userData.assetGeneration !== generation) return;
                if (options.requireSceneParent && container.parent !== refs.scene) return;

                const clone = cloneSceneGraph(scene);
                normalizeExternalAsset(clone, {
                    targetHeight: options.targetHeight,
                    centerXZ: options.centerXZ ?? true,
                    alignToGround: options.alignToGround ?? true
                });
                applyShadowSettings(clone, {
                    castShadow: options.castShadow ?? false,
                    receiveShadow: options.receiveShadow ?? false
                });
                replaceContainerVisual(container, clone);

                if (options.isObstacle) {
                    refreshObstacleCollider(container);
                    scheduleNavMeshRefresh();
                }
            },
            () => {
                // Keep the procedural fallback when an asset fails to load.
            }
        );
    }

    // --- Helpers for Physics & Colliders ---

    function getColliderHandle(collider) { return collisionSystem.getColliderHandle(collider); }
    function createObstacleCollider(mesh) { collisionSystem.createObstacleCollider(mesh); }
    function removeObstacleCollider(mesh) { collisionSystem.removeObstacleCollider(mesh); }
    function refreshObstacleCollider(mesh) { collisionSystem.refreshObstacleCollider(mesh); }

    function createFallbackTree(castShadow) {
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5D4037, roughness: 0.95 });
        const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2E7D32, roughness: 0.95 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 3, 8), trunkMaterial);
        const foliage = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.8, 8), foliageMaterial);
        trunk.position.y = 1.5;
        foliage.position.y = 5.1;
        trunk.castShadow = castShadow;
        trunk.receiveShadow = castShadow;
        foliage.castShadow = castShadow;
        foliage.receiveShadow = castShadow;
        const root = new THREE.Group();
        root.add(trunk);
        root.add(foliage);
        return markProceduralForCleanup(root);
    }

    function createFallbackRock(targetHeight, castShadow) {
        const geometry = new THREE.IcosahedronGeometry(Math.max(0.3, targetHeight * 0.32), 0);
        const material = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.9, metalness: 0.08 });
        const rock = new THREE.Mesh(geometry, material);
        rock.position.y = Math.max(0.35, targetHeight * 0.45);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        rock.castShadow = castShadow;
        rock.receiveShadow = castShadow;
        return markProceduralForCleanup(rock);
    }

    function createFallbackBush(targetHeight, castShadow) {
        const root = new THREE.Group();
        const sphereA = new THREE.Mesh(
            new THREE.SphereGeometry(targetHeight * 0.34, 10, 10),
            new THREE.MeshStandardMaterial({ color: 0x3f7f35, roughness: 1.0 })
        );
        const sphereB = new THREE.Mesh(
            new THREE.SphereGeometry(targetHeight * 0.28, 10, 10),
            new THREE.MeshStandardMaterial({ color: 0x3a7430, roughness: 1.0 })
        );
        const sphereC = new THREE.Mesh(
            new THREE.SphereGeometry(targetHeight * 0.24, 10, 10),
            new THREE.MeshStandardMaterial({ color: 0x467f39, roughness: 1.0 })
        );
        sphereA.position.set(0, targetHeight * 0.38, 0);
        sphereB.position.set(-targetHeight * 0.2, targetHeight * 0.28, targetHeight * 0.12);
        sphereC.position.set(targetHeight * 0.22, targetHeight * 0.25, -targetHeight * 0.16);
        [sphereA, sphereB, sphereC].forEach((mesh) => {
            mesh.castShadow = castShadow;
            mesh.receiveShadow = castShadow;
            root.add(mesh);
        });
        return markProceduralForCleanup(root);
    }

    function createFallbackGrass(targetHeight) {
        const grass = new THREE.Mesh(
            new THREE.ConeGeometry(targetHeight * 0.28, targetHeight, 4),
            new THREE.MeshStandardMaterial({ color: 0x4f8c3f, roughness: 1.0 })
        );
        grass.position.y = targetHeight * 0.5;
        grass.rotation.y = Math.random() * Math.PI;
        grass.receiveShadow = !state.lowPowerMode;
        return markProceduralForCleanup(grass);
    }

    function scatterDecorAsset({ assetName, targetHeight, minRadius, maxRadius, fallbackFactory, castShadow = false, receiveShadow = false, tilt = 0 }) {
        const container = new THREE.Group();
        const angle = Math.random() * Math.PI * 2;
        const radius = randomBetween(minRadius, maxRadius);
        container.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        container.rotation.y = Math.random() * Math.PI * 2;
        if (tilt > 0) {
            container.rotation.x = randomBetween(-tilt, tilt);
            container.rotation.z = randomBetween(-tilt, tilt);
        }

        const fallback = fallbackFactory?.();
        if (fallback) {
            container.add(fallback);
        }
        if (!addSceneryObject(container)) {
            disposeOwnedResources(container);
            return null;
        }

        applyExternalAssetToContainer(container, assetName, {
            targetHeight,
            castShadow,
            receiveShadow,
            generation: sceneryGeneration,
            requireSceneParent: true
        });
        return container;
    }

    function getTreeTargetHeight(assetName) {
        switch (assetName) {
            case 'Pine Trees':
                return randomBetween(9, 14);
            case 'Dead Trees':
                return randomBetween(7, 11.5);
            case 'Maple Trees':
                return randomBetween(8, 12.5);
            case 'Birch Trees':
                return randomBetween(7.5, 11.5);
            case 'Trees':
            default:
                return randomBetween(8, 12);
        }
    }

    function createRockObstacle(targetHeight, castShadow, generation) {
        const obstacle = new THREE.Group();
        const fallback = createFallbackRock(targetHeight, castShadow);
        obstacle.add(fallback);
        obstacle.rotation.y = Math.random() * Math.PI * 2;
        obstacle.rotation.x = randomBetween(-0.08, 0.08);
        obstacle.rotation.z = randomBetween(-0.08, 0.08);
        obstacle.userData.rockTargetHeight = targetHeight;
        obstacle.userData.rockGeneration = generation;
        return obstacle;
    }

    // --- Map Objects Management ---

    function updateMapSafeZone() {
        const playerPos = refs.camera?.position;
        if (!playerPos) {
            mapSafeZone = null;
            return;
        }
        mapSafeZone = {
            x: playerPos.x,
            z: playerPos.z,
            radius: 6
        };
    }

    function intersectsMapSafeZone(bounds) {
        if (!mapSafeZone || !bounds) return false;
        const closestX = Math.max(bounds.min.x, Math.min(mapSafeZone.x, bounds.max.x));
        const closestZ = Math.max(bounds.min.z, Math.min(mapSafeZone.z, bounds.max.z));
        const dx = closestX - mapSafeZone.x;
        const dz = closestZ - mapSafeZone.z;
        return (dx * dx + dz * dz) < (mapSafeZone.radius * mapSafeZone.radius);
    }

    function addMapObject(mesh) {
        if (!mesh) return false;
        if (mesh.isMesh) {
            markProceduralForCleanup(mesh);
        }
        mesh.userData.isObstacle = true;
        mesh.updateMatrixWorld(true);
        mesh.userData.boundingBox = new THREE.Box3().setFromObject(mesh);
        if (intersectsMapSafeZone(mesh.userData.boundingBox)) {
            disposeOwnedResources(mesh);
            return false;
        }
collections.mapObstacles.push(mesh);
        refs.scene.add(mesh);
        createObstacleCollider(mesh);
        if (collisionSystem?.rebuildObstacleSpatialGrid) {
            collisionSystem.rebuildObstacleSpatialGrid();
        }
        return true;
    }

function clearMapObstacles() {
        collections.mapObstacles.forEach((obj) => {
            removeObstacleCollider(obj);
            refs.scene.remove(obj);
            disposeOwnedResources(obj);
        });
        collections.mapObstacles = [];
        if (collisionSystem?.rebuildObstacleSpatialGrid) {
            collisionSystem.rebuildObstacleSpatialGrid();
        }
    }

    function createEnvironment() {
        clearScenery();

        if (!baseEnvironmentReady) {
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

            const skyGeometry = new THREE.SphereGeometry(450, 32, 32);
            const skyMaterial = new THREE.MeshBasicMaterial({
                color: 0x708090,
                side: THREE.BackSide
            });
            const sky = new THREE.Mesh(skyGeometry, skyMaterial);
            refs.scene.add(sky);

            setupLighting();
            baseEnvironmentReady = true;
        }

        createGroundDetail();

        const density = state.lowPowerMode ? 0.5 : 1;
        regenerateMap();
        createTrees(density);
    }

    function createGroundDetail() {
        const rockCount = state.lowPowerMode ? 14 : 22;
        const bushCount = state.lowPowerMode ? 18 : 28;
        const grassCount = state.lowPowerMode ? 28 : 42;
        const castShadow = !state.lowPowerMode;

        for (let i = 0; i < rockCount; i++) {
            const targetHeight = randomBetween(0.45, 1.35);
            scatterDecorAsset({
                assetName: 'Rocks',
                targetHeight,
                minRadius: 10,
                maxRadius: 95,
                fallbackFactory: () => createFallbackRock(targetHeight, castShadow),
                castShadow,
                receiveShadow: castShadow,
                tilt: 0.12
            });
        }

        for (let i = 0; i < bushCount; i++) {
            const targetHeight = randomBetween(0.8, 1.9);
            scatterDecorAsset({
                assetName: 'Bushes',
                targetHeight,
                minRadius: 8,
                maxRadius: 92,
                fallbackFactory: () => createFallbackBush(targetHeight, castShadow),
                castShadow,
                receiveShadow: castShadow
            });
        }

        for (let i = 0; i < grassCount; i++) {
            const targetHeight = randomBetween(0.35, 0.95);
            scatterDecorAsset({
                assetName: 'Grass',
                targetHeight,
                minRadius: 6,
                maxRadius: 98,
                fallbackFactory: () => createFallbackGrass(targetHeight),
                receiveShadow: castShadow
            });
        }
    }

    function setupLighting() {
        // Ambient Light - lower intensity
        const ambientLight = new THREE.AmbientLight(0xffeedd, 0.3);
        refs.scene.add(ambientLight);

        // Directional Light - lower intensity
        const directionalLight = new THREE.DirectionalLight(0xffffee, 0.65);
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
        mapGeneration += 1;
        if (navMeshRefreshTimer) {
            clearTimeout(navMeshRefreshTimer);
            navMeshRefreshTimer = null;
        }
        clearPickups();
        clearMapObstacles();
        updateMapSafeZone();
        
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
            case 'scatter': createLayoutScatter(castShadow, density, mapGeneration); break;
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

    function createLayoutScatter(castShadow, density, generation) {
        const crateCount = Math.max(8, Math.round(Config.crateCount * density));
        const pillarCount = Math.max(5, Math.round(Config.pillarCount * density));

        for (let i = 0; i < crateCount; i++) {
            const targetHeight = randomBetween(1.4, 3.1);
            const obstacle = createRockObstacle(targetHeight, castShadow, generation);
            if (!obstacle) continue;
            obstacle.position.set((Math.random() - 0.5) * 90, 0, (Math.random() - 0.5) * 90);
            if (!addMapObject(obstacle)) {
                disposeOwnedResources(obstacle);
                continue;
            }
            applyExternalAssetToContainer(obstacle, 'Rocks', {
                targetHeight,
                castShadow,
                receiveShadow: castShadow,
                generation,
                isObstacle: true,
                requireSceneParent: true
            });
        }

        for (let i = 0; i < pillarCount; i++) {
            const targetHeight = randomBetween(4.8, 8.5);
            const pillar = createRockObstacle(targetHeight, castShadow, generation);
            if (!pillar) continue;
            const angle = (i / pillarCount) * Math.PI * 2 + Math.random();
            const radius = 20 + Math.random() * 30;
            pillar.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
            if (!addMapObject(pillar)) {
                disposeOwnedResources(pillar);
                continue;
            }
            applyExternalAssetToContainer(pillar, 'Rocks', {
                targetHeight,
                castShadow,
                receiveShadow: castShadow,
                generation,
                isObstacle: true,
                requireSceneParent: true
            });
        }
    }

    function createTrees(density = 1) {
        const count = Math.max(6, Math.round(Config.treeCount * density * 0.65));
        const castShadow = !state.lowPowerMode;

        for (let i = 0; i < count; i++) {
            const assetName = treeAssetNames[Math.floor(Math.random() * treeAssetNames.length)];
            const tree = new THREE.Group();
            const angle = Math.random() * Math.PI * 2;
            const radius = 40 + Math.random() * 60;
            tree.position.x = Math.cos(angle) * radius;
            tree.position.z = Math.sin(angle) * radius;
            tree.rotation.y = Math.random() * Math.PI * 2;
            if (assetName === 'Dead Trees') {
                tree.rotation.z = randomBetween(-0.06, 0.06);
                tree.rotation.x = randomBetween(-0.04, 0.04);
            }

            tree.add(createFallbackTree(castShadow));
            if (!addSceneryObject(tree)) {
                disposeOwnedResources(tree);
                continue;
            }

            applyExternalAssetToContainer(tree, assetName, {
                targetHeight: getTreeTargetHeight(assetName),
                castShadow,
                receiveShadow: castShadow,
                generation: sceneryGeneration,
                requireSceneParent: true
            });
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
        if (!pickup?.userData) return;
        // Pickups use distance checks in update(); avoid mutating Rapier world here
        // because enemy-drop callbacks may run during physics-sensitive code paths.
        pickup.userData.colliderHandle = null;
    }

    function removePickupCollider(pickup) {
        if (!pickup?.userData) return;
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

