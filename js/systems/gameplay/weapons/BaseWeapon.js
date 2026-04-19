/**
 * Base weapon class - all weapons inherit from this.
 */
export class BaseWeapon {
  constructor(config, model) {
    this.config = config;
    this.model = model;
    this.cooldown = 0;
  }

  update(delta) {
    this.cooldown -= delta;
  }

  tryShoot(ctx) {
    if (this.cooldown > 0) return false;
    this.cooldown = this.config.fireRate / 1000; // convert ms to seconds
    return this.shoot(ctx);
  }

  shoot(ctx) {
    // Override in subclass
    return false;
  }
}

/**
 * Single-shot weapon (pistol, sniper)
 */
export class SingleShotWeapon extends BaseWeapon {
  shoot(ctx) {
    return true;
  }
}

/**
 * Shotgun - fires multiple pellets with spread
 */
export class ShotgunWeapon extends BaseWeapon {
  shoot(ctx) {
    return true;
  }
}

/**
 * Automatic weapon (rifle, SMG)
 */
export class AutoWeapon extends BaseWeapon {
  shoot(ctx) {
    return true;
  }
}

/**
 * Beam weapon (future-proof - continuous damage)
 */
export class BeamWeapon extends BaseWeapon {
  shoot(ctx) {
    ctx.onBeam?.({
      position: ctx.position,
      direction: ctx.direction,
      duration: this.config.beamDuration || 0.2,
      damagePerSecond: this.config.damage
    });
    return true;
  }
}
