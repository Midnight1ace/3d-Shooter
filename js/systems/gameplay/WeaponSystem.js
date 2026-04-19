import { GamePhase, WeaponCatalog, Config } from '../../core/config.js';
import { dom } from '../../core/dom.js';
import { WeaponManager } from './WeaponManager.js';

export function createWeaponSystem({ state, config, refs, collections, ui, audio, input, entityManager, collisionSystem, callbacks }) {
  const weaponInventory = {};
  let weaponManager = null;

  // Tracer pool
  function acquireTracer() {
    const pool = collections.tracerPool;
    let tracer = pool.pop();
    if (!tracer) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        color: 0xffffaa,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      tracer = new THREE.Line(geometry, material);
    }
    tracer.visible = true;
    refs.scene.add(tracer);
    return tracer;
  }

  function releaseTracer(tracer) {
    if (!tracer) return;
    tracer.visible = false;
    refs.scene.remove(tracer);
    collections.tracerPool.push(tracer);
  }

  function createBulletTracer() {
    if (state.lowPowerMode) return;
    const startPoint = new THREE.Vector3(0.25, -0.3, -1);
    startPoint.applyMatrix4(refs.camera.matrixWorld);

    const direction = new THREE.Vector3();
    refs.camera.getWorldDirection(direction);
    const hit = collisionSystem.raycast(startPoint, direction, 50);
    const maxDistance = hit ? Math.min(50, hit.distance) : 50;
    const endPoint = startPoint.clone().add(direction.multiplyScalar(maxDistance));

    const line = acquireTracer();
    const positions = line.geometry.attributes.position.array;
    positions[0] = startPoint.x; positions[1] = startPoint.y; positions[2] = startPoint.z;
    positions[3] = endPoint.x; positions[4] = endPoint.y; positions[5] = endPoint.z;
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.computeBoundingSphere();

    setTimeout(() => releaseTracer(line), 50);
  }

  // Process hit detection and damage
  function processHits(ctx) {
    const raycaster = new THREE.Raycaster();
    const weaponConfig = weaponManager.getWeaponConfig();
    if (!weaponConfig) return;

    const pellets = weaponConfig.pellets || 1;
    let hitEnemy = false;
    let killedEnemy = false;

    for (let p = 0; p < pellets; p++) {
      let direction = ctx.direction.clone();

      // Apply spread (radius in radians)
      const spreadRad = weaponConfig.spread || 0;
      direction.x += (Math.random() - 0.5) * spreadRad;
      direction.y += (Math.random() - 0.5) * spreadRad;
      direction.normalize();

      raycaster.setFromCamera(new THREE.Vector2(0, 0), refs.camera);
      raycaster.ray.origin.copy(ctx.position);
      raycaster.ray.direction.copy(direction);

      const hit = collisionSystem.raycast(ctx.position, direction, weaponConfig.range);
      const obstacleDistance = hit ? hit.distance : Infinity;
      const { hit: closestHit, index: closestEnemyIndex } = collisionSystem.raycastEnemies(raycaster, weaponConfig.range, obstacleDistance);

      if (closestHit && closestEnemyIndex >= 0) {
        const enemy = collections.enemies[closestEnemyIndex];
        const damage = weaponConfig.damage * state.damageMultiplier;
        entityManager.flashEnemy(enemy);
        const killed = entityManager.applyDamage(closestEnemyIndex, damage, closestHit.point);
        if (killed) killedEnemy = true;
        hitEnemy = true;
      }
    }

    if (hitEnemy) {
      callbacks?.onAddCameraShake?.(config.cameraShakeHit);
      callbacks?.onHitStop?.(killedEnemy ? config.hitStopKillMultiplier : config.hitStopHitMultiplier);
    }
  }

  function initWeaponManager() {
    weaponManager = new WeaponManager(refs.player, refs.camera, {
      onShoot: (ctx) => {
        if (refs.weapon.isReloading) return;

        state.ammo--;
        syncWeaponInventory();
        ui.updateHUD();

        audio?.playShootSound?.();
        callbacks?.onAddCameraShake?.(config.cameraShakeShoot);
        ui.showMuzzleFlash(refs.weapon.mesh);

        refs.weapon.recoil = refs.weapon.recoilBase;
        refs.player.pitch += refs.weapon.recoil;

        createBulletTracer();
        processHits(ctx);
      },
      onHit: () => {
        ui.showHitMarker();
        audio?.playUiSound?.('hit');
      }
    });
  }

  function initWeaponInventory() {
    WeaponCatalog.forEach((weaponDef) => {
      weaponInventory[weaponDef.id] = {
        ammo: weaponDef.magSize,
        reserve: weaponDef.reserveMax
      };
    });
  }

  function createWeapon() {
    refs.weapon = {
      mesh: null,
      damage: Config.weaponDamage,
      fireRate: Config.weaponFireRate,
      range: Config.weaponRange,
      recoilBase: 0.05,
      spread: 0.01,
      pellets: 1,
      name: 'Rifle',
      reserveMax: Config.totalAmmo,
      isReloading: false,
      recoil: 0
    };

    initWeaponInventory();
    equipWeapon(state.currentWeaponId, true);
  }

  function equipWeapon(weaponId, isInitial = false) {
    const weaponDef = WeaponCatalog.find((item) => item.id === weaponId);
    if (!weaponDef) return;

    state.currentWeaponId = weaponId;

    if (refs.weapon.mesh) {
      refs.camera.remove(refs.weapon.mesh);
    }

    const adjustedMag = Math.max(1, Math.round(weaponDef.magSize * state.magSizeMultiplier));
    const adjustedReserve = Math.max(1, Math.round(weaponDef.reserveMax * state.magSizeMultiplier));

    refs.weapon = {
      mesh: null,
      damage: weaponDef.damage,
      fireRate: weaponDef.fireRate,
      range: weaponDef.range,
      recoilBase: weaponDef.recoil,
      spread: weaponDef.spread,
      pellets: weaponDef.pellets,
      name: weaponDef.name,
      reserveMax: adjustedReserve,
      isReloading: false,
      recoil: 0
    };

    weaponManager.switchWeapon(weaponId, weaponDef).then(() => {
      refs.weapon.mesh = weaponManager.currentWeapon?.model;
      if (refs.weapon.mesh) {
        refs.camera.add(refs.weapon.mesh);
      }
    });

    if (!weaponInventory[state.currentWeaponId]) {
      weaponInventory[state.currentWeaponId] = {
        ammo: weaponDef.magSize,
        reserve: weaponDef.reserveMax
      };
    }

    state.maxAmmo = adjustedMag;
    const storedAmmo = weaponInventory[state.currentWeaponId].ammo;
    const storedReserve = weaponInventory[state.currentWeaponId].reserve;
    state.ammo = Math.min(storedAmmo, adjustedMag);
    state.reserveAmmo = Math.min(storedReserve, adjustedReserve);
    syncWeaponInventory();

    if (dom.reloadIndicator) dom.reloadIndicator.classList.add('hidden');
    if (dom.reloadFill) {
      dom.reloadFill.style.width = '0%';
      dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }

    if (!isInitial) {
      ui.showPrompt(`Equipped ${weaponDef.name}`, 1400);
    }
    ui.updateHUD();
  }

  function syncWeaponInventory() {
    if (!state.currentWeaponId || !weaponInventory[state.currentWeaponId]) return;
    weaponInventory[state.currentWeaponId].ammo = state.ammo;
    weaponInventory[state.currentWeaponId].reserve = state.reserveAmmo;
  }

  function refreshWeaponStats() {
    if (!refs.weapon || !state.currentWeaponId) return;
    equipWeapon(state.currentWeaponId, true);
  }

  function reload() {
    if (state.phase !== GamePhase.PLAYING) return;
    if (refs.weapon.isReloading) {
      attemptPerfectReload();
      return;
    }
    if (state.ammo >= state.maxAmmo || state.reserveAmmo <= 0) return;

    refs.weapon.isReloading = true;
    state.reloadStartTime = performance.now();
    state.reloadDurationCurrent = config.reloadDuration * state.reloadSpeedMultiplier;
    const isSprinting = input.keys.shift && refs.player.velocity.length() > 0;
    if (isSprinting) state.reloadDurationCurrent *= config.reloadSprintMultiplier;

    state.ammo = 0;
    syncWeaponInventory();
    ui.updateHUD();

    if (dom.reloadIndicator) dom.reloadIndicator.classList.remove('hidden');
    if (dom.reloadFill) {
      dom.reloadFill.style.width = '0%';
      dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
    if (dom.chipReload) dom.chipReload.classList.add('active');
    audio?.playUiSound?.('reload');

    if (refs.weapon.mesh) {
      refs.weapon.mesh.rotation.x = 0.8;
      refs.weapon.mesh.position.z = -0.2;
    }

    setTimeout(() => finishReload(false), state.reloadDurationCurrent);
  }

  function finishReload(isPerfect) {
    if (!refs.weapon.isReloading) return;

    refs.weapon.isReloading = false;
    const reloadAmount = state.maxAmmo - state.ammo;
    const actualReload = Math.min(reloadAmount, state.reserveAmmo);
    state.ammo += actualReload;
    state.reserveAmmo -= actualReload;

    if (isPerfect) {
      const bonusAmmo = Math.min(state.maxAmmo - state.ammo, config.perfectReloadBonus);
      state.ammo += bonusAmmo;
    }

    syncWeaponInventory();
    ui.updateHUD();

    if (dom.reloadIndicator) dom.reloadIndicator.classList.add('hidden');
    if (dom.chipReload) dom.chipReload.classList.remove('active');
    if (dom.reloadFill) {
      dom.reloadFill.style.width = '0%';
      dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
    if (refs.weapon.mesh) {
      refs.weapon.mesh.rotation.x = 0;
      refs.weapon.mesh.position.z = -0.4;
    }
  }

  function attemptPerfectReload() {
    const elapsed = (performance.now() - state.reloadStartTime) / state.reloadDurationCurrent;
    if (Math.abs(elapsed - 0.5) <= config.perfectReloadWindow) {
      finishReload(true);
      audio?.playUiSound?.('perfect');
      ui.showPrompt('Perfect Reload!', 1000);
    }
  }

  function cancelReload() {
    if (!refs.weapon.isReloading) return;
    refs.weapon.isReloading = false;
    if (dom.reloadIndicator) dom.reloadIndicator.classList.add('hidden');
    if (dom.reloadFill) {
      dom.reloadFill.style.width = '0%';
      dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
    if (dom.chipReload) dom.chipReload.classList.remove('active');
    if (refs.weapon.mesh) {
      refs.weapon.mesh.rotation.x = 0;
      refs.weapon.mesh.position.z = -0.4;
    }
    ui.showPrompt('Reload canceled', 1000);
  }

  function updateReloadIndicator() {
    if (!refs.weapon.isReloading || !dom.reloadFill) return;
    const elapsed = performance.now() - state.reloadStartTime;
    const progress = Math.min(1, elapsed / state.reloadDurationCurrent);
    dom.reloadFill.style.width = `${Math.round(progress * 100)}%`;

    if (Math.abs(progress - 0.5) <= config.perfectReloadWindow) {
      dom.reloadFill.style.background = 'linear-gradient(90deg, #6bff9c, #43d96a)';
    } else {
      dom.reloadFill.style.background = 'linear-gradient(90deg, #f6c64f, #ff9248)';
    }
  }

  function resetWeaponState() {
    Object.keys(weaponInventory).forEach((key) => delete weaponInventory[key]);
    initWeaponInventory();
    const defaultWeapon = WeaponCatalog.find((item) => item.id === state.currentWeaponId)
      || WeaponCatalog.find((item) => item.type === 'ar')
      || WeaponCatalog.find((item) => item.type === 'rifle')
      || WeaponCatalog[0];
    if (defaultWeapon) {
      state.currentWeaponId = defaultWeapon.id;
      if (refs.weapon?.mesh) {
        refs.camera.remove(refs.weapon.mesh);
      }
      equipWeapon(state.currentWeaponId, true);
    }
  }

  function update(delta) {
    weaponManager?.update(delta);
  }

  function shoot() {
    if (refs.weapon.isReloading) return;
    if (state.ammo <= 0) {
      ui.showPrompt(state.reserveAmmo > 0 ? 'Reload needed' : 'Out of ammo', 1200);
      audio?.playUiSound?.('click');
      return;
    }

    const ctx = {
      position: refs.camera.position.clone(),
      direction: new THREE.Vector3()
    };
    refs.camera.getWorldDirection(ctx.direction);

    weaponManager.shoot(ctx);
  }

  function switchWeapon(name) {
    const weaponDef = WeaponCatalog.find((w) => w.id === name);
    if (weaponDef) {
      weaponManager.switchWeapon(name, weaponDef);
    }
  }

  // Initialize
  initWeaponManager();
  initWeaponInventory();

  return {
    createWeapon,
    equipWeapon,
    refreshWeaponStats,
    syncWeaponInventory,
    shoot,
    reload,
    cancelReload,
    updateReloadIndicator,
    resetWeaponState,
    update,
    switchWeapon,
    getWeapon: () => refs.weapon,
    getWeaponInventory: () => weaponInventory
  };
}
