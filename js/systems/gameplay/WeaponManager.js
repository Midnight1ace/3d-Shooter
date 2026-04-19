/**
 * WeaponManager - Clean, scalable weapon system.
 * Handles weapon model loading, switching, and delegates shooting to weapon instances.
 */
import { state } from '../../core/state.js';
import { SingleShotWeapon, ShotgunWeapon, AutoWeapon, BeamWeapon } from './weapons/BaseWeapon.js';

export class WeaponManager {
  constructor(player, camera, options = {}) {
    this.player = player;
    this.camera = camera;

    this.weapons = {};
    this.currentWeapon = null;
    this.currentName = null;
    this.modelCache = new Map();

    this.onShoot = options.onShoot || (() => {});
    this.onHit = options.onHit || (() => {});
    this.onBeam = options.onBeam || (() => {});
  }

  static hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  static mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async switchWeapon(name, weaponDef) {
    if (this.currentName === name) return Promise.resolve();

    // Remove old model from scene (caller manages adding/removing)
    if (this.currentWeapon && this.currentWeapon.model) {
      this.camera.remove(this.currentWeapon.model);
    }

    const config = this.buildConfig(weaponDef);
    const model = await this.loadModel(weaponDef);
    const weapon = this.createWeapon(config, model);

    this.currentWeapon = weapon;
    this.currentName = name;
  }

  buildConfig(weaponDef) {
    const rawType = weaponDef.type;
    let type = 'single';
    if (rawType === 'shotgun') type = 'spread';
    else if (rawType === 'smg' || rawType === 'ar') type = 'auto';
    else if (rawType === 'rifle' || rawType === 'pistol') type = 'single';

    const spreadRad = weaponDef.spread || 0.01;
    const spreadDeg = THREE.MathUtils.radToDeg(spreadRad);

    return {
      type,
      damage: weaponDef.damage,
      fireRate: weaponDef.fireRate,
      range: weaponDef.range,
      spread: spreadRad,
      spreadDegrees: spreadDeg,
      pellets: weaponDef.pellets,
      recoil: weaponDef.recoil,
      ...weaponDef
    };
  }

async loadModel(weaponDef) {
    const modelName = weaponDef.model || weaponDef.id;
    if (this.modelCache.has(modelName)) {
      const cached = this.modelCache.get(modelName);
      return THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(cached) : cached.clone(true);
    }

    const tryPaths = [
      `assets/weapons/${modelName}.glb`,
      `assets/${modelName}.glb`
    ];

    for (const path of tryPaths) {
      try {
        const model = await this.loadModelFromPath(path, weaponDef);
        if (model) {
          this.modelCache.set(modelName, model);
          return model.clone();
        }
      } catch (e) {
        continue;
      }
    }

    const procedural = this.buildWeaponMesh(weaponDef);
    this.modelCache.set(modelName, procedural);
    return procedural.clone();
  }

  loadModelFromPath(path, weaponDef) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        path,
        (gltf) => {
          let model = gltf.scene;
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = !state.lowPowerMode;
              child.receiveShadow = !state.lowPowerMode;
              if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((m) => {
                  if (m.emissive) m.emissive.setHex(0x000000);
                  m.emissiveIntensity = 0;
                });
              }
            }
          });
          model.rotation.y = Math.PI * 0.5;
          this.normalizeWeaponModel(model, weaponDef);
          model.position.x += 0.25;
          model.position.y += -0.25;
          model.position.z += -0.4;
          model.scale.multiplyScalar(1.05);
          resolve(model);
        },
        undefined,
        () => reject(new Error('Model not found'))
      );
    });
  }

  createWeapon(config, model) {
    switch (config.type) {
      case 'single': return new SingleShotWeapon(config, model);
      case 'spread': return new ShotgunWeapon(config, model);
      case 'auto': return new AutoWeapon(config, model);
      case 'beam': return new BeamWeapon(config, model);
      default: return new SingleShotWeapon(config, model);
    }
  }

  update(delta) {
    if (this.currentWeapon) {
      this.currentWeapon.update(delta);
    }
  }

  shoot(ctx) {
    if (!this.currentWeapon) return false;
    const fired = this.currentWeapon.tryShoot(ctx);
    if (fired) {
      if (this.currentWeapon.config.type === 'beam') {
        this.onBeam(ctx);
      } else {
        this.onShoot(ctx);
      }
    }
    return fired;
  }

  getCurrentWeapon() {
    return this.currentWeapon;
  }

  getWeaponConfig() {
    return this.currentWeapon?.config;
  }

  /**
   * Procedural weapon mesh generation
   */
  buildWeaponMesh(weaponDef) {
    const weaponGroup = new THREE.Group();
    const seed = weaponDef.seed ?? WeaponManager.hashString(weaponDef.model || weaponDef.id || weaponDef.name || 'weapon');
    const rng = WeaponManager.mulberry32(seed);
    const pick = (min, max) => min + (max - min) * rng();

    const baseHue = (0.05 + rng() * 0.12) % 1;
    const accentHue = (baseHue + 0.45 + rng() * 0.2) % 1;
    const bodyColor = new THREE.Color().setHSL(baseHue, 0.12, 0.18 + rng() * 0.05);
    const accentColor = new THREE.Color().setHSL(accentHue, 0.65, 0.55);
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e1e1e, metalness: 0.3, roughness: 0.6
    });
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor, metalness: 0.65, roughness: 0.35
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: accentColor, emissive: accentColor, emissiveIntensity: 1.5,
      metalness: 0.5, roughness: 0.2
    });

    const addBox = (name, w, h, d, x, y, z, material, rotation) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      if (rotation) mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
      if (name) mesh.name = name;
      weaponGroup.add(mesh);
      return mesh;
    };

    const addCylinderZ = (name, radius, length, x, y, z, material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      if (name) mesh.name = name;
      weaponGroup.add(mesh);
      return mesh;
    };

    const type = weaponDef.type || 'rifle';

    if (type === 'pistol') {
      const bodyLength = pick(0.52, 0.68), bodyHeight = pick(0.18, 0.24), bodyWidth = pick(0.22, 0.3);
      addBox('body', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);
      const barrelLength = pick(0.28, 0.42), barrelRadius = pick(0.02, 0.03);
      addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, -bodyLength/2 - barrelLength/2 + 0.05, accentMaterial);
      const gripHeight = pick(0.22, 0.3), gripWidth = pick(0.12, 0.16), gripLength = pick(0.12, 0.18);
      addBox('grip', gripWidth, gripHeight, gripLength, 0, -bodyHeight/2 - gripHeight/2 + 0.02, bodyLength * 0.18, bodyMaterial);
      addBox(null, gripWidth*0.9, 0.06, gripLength*0.6, 0, -bodyHeight/2 + 0.01, bodyLength*0.08, darkMaterial);
      if (rng() > 0.4) addBox(null, bodyWidth*0.7, 0.03, bodyLength*0.35, 0, bodyHeight/2 + 0.02, -bodyLength*0.05, accentMaterial);
      if (rng() > 0.5) {
        addBox(null, bodyWidth*0.18, 0.05, 0.06, 0, bodyHeight/2 + 0.03, -bodyLength/2 + 0.08, accentMaterial);
        addBox(null, bodyWidth*0.2, 0.06, 0.08, 0, bodyHeight/2 + 0.03, bodyLength/2 - 0.1, accentMaterial);
      }
    } else if (type === 'smg') {
      const bodyLength = pick(0.62, 0.82), bodyHeight = pick(0.22, 0.3), bodyWidth = pick(0.28, 0.38);
      addBox('receiver', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);
      const handguardLength = pick(0.2, 0.3);
      addBox('handguard', bodyWidth*0.9, bodyHeight*0.8, handguardLength, 0, -0.02, -bodyLength/2 + handguardLength/2, darkMaterial);
      const barrelLength = pick(0.35, 0.55), barrelRadius = pick(0.022, 0.03);
      addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, -bodyLength/2 - barrelLength/2 + 0.04, accentMaterial);
      const gripHeight = pick(0.2, 0.28), gripWidth = pick(0.12, 0.16), gripLength = pick(0.12, 0.18);
      addBox('grip', gripWidth, gripHeight, gripLength, 0, -bodyHeight/2 - gripHeight/2 + 0.01, bodyLength*0.15, bodyMaterial);
      const magHeight = pick(0.26, 0.38), magWidth = pick(0.14, 0.2), magLength = pick(0.14, 0.22);
      addBox('mag', magWidth, magHeight, magLength, 0, -bodyHeight/2 - magHeight/2 + 0.01, bodyLength*0.05, darkMaterial);
      const stockLength = pick(0.18, 0.3), stockHeight = pick(0.16, 0.22), stockWidth = pick(0.16, 0.22);
      addBox('stock', stockWidth, stockHeight, stockLength, 0, -0.02, bodyLength/2 + stockLength/2 - 0.05, bodyMaterial);
      if (rng() > 0.45) addBox(null, bodyWidth*0.65, 0.04, bodyLength*0.25, 0, bodyHeight/2 + 0.02, -bodyLength*0.05, accentMaterial);
    } else if (type === 'shotgun') {
      const bodyLength = pick(0.72, 0.9), bodyHeight = pick(0.22, 0.3), bodyWidth = pick(0.32, 0.42);
      addBox('receiver', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);
      const barrelLength = pick(0.85, 1.1), barrelRadius = pick(0.03, 0.045);
      addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, -bodyLength/2 - barrelLength/2 + 0.08, accentMaterial);
      const pumpLength = pick(0.28, 0.42);
      addBox('pump', bodyWidth*0.85, bodyHeight*0.75, pumpLength, 0, -0.04, -bodyLength/2 + pumpLength/2 + 0.08, darkMaterial);
      const tubeLength = barrelLength * pick(0.6, 0.8);
      addCylinderZ('tube', barrelRadius*0.7, tubeLength, 0, -bodyHeight/2 + 0.05, -bodyLength/2 - tubeLength/2 + 0.12, darkMaterial);
      const stockLength = pick(0.35, 0.5), stockHeight = pick(0.22, 0.28), stockWidth = pick(0.22, 0.28);
      addBox('stock', stockWidth, stockHeight, stockLength, 0, -0.02, bodyLength/2 + stockLength/2 - 0.05, bodyMaterial);
      if (rng() > 0.5) addBox(null, bodyWidth*0.15, 0.05, 0.06, 0, bodyHeight/2 + 0.03, -bodyLength/2 + 0.1, accentMaterial);
    } else {
      const isAr = type === 'ar';
      const bodyLength = isAr ? pick(0.75, 0.95) : pick(0.85, 1.05);
      const bodyHeight = isAr ? pick(0.24, 0.32) : pick(0.24, 0.34);
      const bodyWidth = isAr ? pick(0.3, 0.4) : pick(0.32, 0.42);
      addBox('receiver', bodyWidth, bodyHeight, bodyLength, 0, 0, 0, bodyMaterial);
      const handguardLength = isAr ? pick(0.35, 0.55) : pick(0.4, 0.6);
      addBox('handguard', bodyWidth*0.85, bodyHeight*0.75, handguardLength, 0, -0.02, -bodyLength/2 + handguardLength/2, darkMaterial);
      const barrelLength = isAr ? pick(0.55, 0.8) : pick(0.8, 1.2);
      const barrelRadius = isAr ? pick(0.026, 0.036) : pick(0.03, 0.04);
      addCylinderZ('barrel', barrelRadius, barrelLength, 0, 0, -bodyLength/2 - barrelLength/2 + 0.05, accentMaterial);
      const gripHeight = pick(0.22, 0.3), gripWidth = pick(0.12, 0.17), gripLength = pick(0.12, 0.2);
      addBox('grip', gripWidth, gripHeight, gripLength, 0, -bodyHeight/2 - gripHeight/2 + 0.02, bodyLength*0.2, bodyMaterial);
      const magHeight = pick(0.26, 0.4), magWidth = pick(0.16, 0.22), magLength = pick(0.16, 0.26);
      addBox('mag', magWidth, magHeight, magLength, 0, -bodyHeight/2 - magHeight/2 + 0.02, bodyLength*0.05, darkMaterial);
      const stockLength = isAr ? pick(0.28, 0.42) : pick(0.35, 0.5);
      const stockHeight = pick(0.22, 0.3), stockWidth = pick(0.22, 0.3);
      addBox('stock', stockWidth, stockHeight, stockLength, 0, -0.02, bodyLength/2 + stockLength/2 - 0.05, bodyMaterial);
      if (isAr && rng() > 0.4) addBox(null, bodyWidth*0.5, 0.05, 0.18, 0, bodyHeight/2 + 0.03, -bodyLength*0.1, accentMaterial);
      const scopeChance = isAr ? 0.55 : 0.8;
      if (rng() < scopeChance) {
        const scopeLength = pick(0.22, 0.32), scopeRadius = pick(0.045, 0.06);
        addCylinderZ(null, scopeRadius, scopeLength, 0, bodyHeight/2 + 0.05, -bodyLength*0.05, accentMaterial);
        addBox(null, bodyWidth*0.2, 0.04, scopeLength*0.8, 0, bodyHeight/2, -bodyLength*0.05, darkMaterial);
      } else {
        addBox(null, bodyWidth*0.15, 0.05, 0.06, 0, bodyHeight/2 + 0.03, -bodyLength/2 + 0.08, accentMaterial);
        addBox(null, bodyWidth*0.2, 0.06, 0.08, 0, bodyHeight/2 + 0.03, bodyLength/2 - 0.1, accentMaterial);
      }
      if (rng() > 0.5) addCylinderZ(null, barrelRadius*1.2, 0.12, 0, 0, -bodyLength/2 - barrelLength/2 + 0.05 - barrelLength/2 - 0.04, accentMaterial);
      if (!isAr && rng() > 0.55) {
        const legHeight = pick(0.12, 0.18), legWidth = 0.04, legLength = 0.14;
        const legZ = -bodyLength/2 - barrelLength/2 + 0.05 - barrelLength*0.35;
        addBox(null, legWidth, legHeight, legLength, -0.08, -bodyHeight/2 - legHeight/2, legZ, darkMaterial, { x: 0.25 });
        addBox(null, legWidth, legHeight, legLength, 0.08, -bodyHeight/2 - legHeight/2, legZ, darkMaterial, { x: 0.25 });
      }
    }

    weaponGroup.scale.setScalar(1.05);
    weaponGroup.position.set(0.3, -0.3, -0.5);
    return weaponGroup;
  }

  normalizeWeaponModel(model, weaponDef) {
    const box = new THREE.Box3().setFromObject(model);
    if (!Number.isFinite(box.min.x)) return;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const modelName = weaponDef.model || weaponDef.id;
    const targetMap = {
      'Pistol': 0.78, 'Revolver': 0.88,
      'Submachine Gun': 0.95,
      'Assault Rifle': 1.02, 'Bullpup': 1.0,
      'Sniper Rifle': 1.22,
      'Shotgun': 1.02, 'Shotgun Sawed Off': 0.86, 'Shotgun Short Stock': 0.92
    };
    const typeTargets = { pistol: 0.8, smg: 0.95, ar: 1.05, rifle: 1.15, shotgun: 1.0 };
    const target = targetMap[modelName] || typeTargets[weaponDef.type] || 0.95;

    const scale = target / maxDim;
    model.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);
    model.position.sub(center);
    model.position.y -= scaledBox.min.y * 0.4;
  }
}

