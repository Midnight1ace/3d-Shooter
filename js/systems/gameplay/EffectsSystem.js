export function createEffectsSystem({ state, config, refs, collections, dom, renderer, scene, camera }) {
    let composer = null;
    let bloomPass = null;
    let vignettePass = null;

    function addCameraShake(amount) {
        if (!state.screenShakeEnabled) return;
        state.cameraShake = Math.min(0.25, state.cameraShake + amount);
    }

    function getCameraShakeOffset(delta) {
        if (state.cameraShake <= 0) {
            refs.shakeOffset.set(0, 0, 0);
            return refs.shakeOffset;
        }
        state.cameraShake = Math.max(0, state.cameraShake - delta * 2.5);
        const strength = state.cameraShake * state.cameraShake;
        refs.shakeOffset.set(
            (Math.random() - 0.5) * strength,
            (Math.random() - 0.5) * strength,
            0
        );
        return refs.shakeOffset;
    }

    function updateTimeScale(delta) {
        if (state.timeSlowTimer > 0) {
            state.timeSlowTimer -= delta;
            state.timeScale = state.timeSlowIntensity;
            document.body.classList.add('time-slow');
            return;
        }
        if (state.timeScale < 1) {
            state.timeScale = Math.min(1, state.timeScale + delta / config.timeSlowRecovery);
            if (state.timeScale >= 1) {
                document.body.classList.remove('time-slow');
            }
        }
    }

    function triggerTimeSlow() {
        state.timeSlowTimer = state.timeSlowDuration;
        state.timeScale = state.timeSlowIntensity;
        document.body.classList.add('time-slow');
    }

    function triggerHitStop(multiplier = 1) {
        if (!state.hitStopEnabled) return;
        const duration = config.hitStopDuration * multiplier;
        state.hitStopTimer = Math.max(state.hitStopTimer, duration);
    }

    function toggleScreenShake(ui) {
        state.screenShakeEnabled = !state.screenShakeEnabled;
        state.cameraShake = 0;
        ui?.showPrompt(`Screen shake: ${state.screenShakeEnabled ? 'On' : 'Off'}`, 1200);
    }

    function toggleHitStop(ui) {
        state.hitStopEnabled = !state.hitStopEnabled;
        state.hitStopTimer = 0;
        ui?.showPrompt(`Hit-stop: ${state.hitStopEnabled ? 'On' : 'Off'}`, 1200);
    }

    function setupPostProcessing() {
        if (state.lowPowerMode) return;
        
        try {
            // Init Composer
            composer = new THREE.EffectComposer(renderer);
            
            // Render Pass
            const renderPass = new THREE.RenderPass(scene, camera);
            composer.addPass(renderPass);
            
            // Bloom Pass
            bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                1.0,  // Strength (Reduced)
                0.3,  // Radius
                0.5   // Threshold (Increased significantly to only bloom highlights)
            );
            composer.addPass(bloomPass);
            
            // Vignette Pass
            if (THREE.VignetteShader) {
                vignettePass = new THREE.ShaderPass(THREE.VignetteShader);
                vignettePass.uniforms['offset'].value = 1.0;
                vignettePass.uniforms['darkness'].value = 1.3;
                composer.addPass(vignettePass);
            }
            return composer;
        } catch (error) {
            console.warn('Post-processing setup failed. Falling back to standard rendering.', error);
            composer = null;
            return null;
        }
    }

    function releaseParticle(particle) {
        if (!particle) return;
        const type = particle.userData?.poolType;
        if (!type || !collections.particlePools[type]) return;
        particle.visible = false;
        scene?.remove(particle);
        collections.particlePools[type].push(particle);
    }

    function clearActiveParticles() {
        for (let i = collections.particles.length - 1; i >= 0; i--) {
            const particle = collections.particles[i];
            releaseParticle(particle);
        }
        collections.particles.length = 0;
    }

    function updateParticles(delta) {
        if (!collections.particles.length) return;
        
        for (let i = collections.particles.length - 1; i >= 0; i--) {
            const particle = collections.particles[i];
            
            // Update position
            particle.position.addScaledVector(particle.userData.velocity, delta);
            particle.userData.velocity.y -= 9.8 * delta; // Gravity
            
            // Update lifetime
            particle.userData.lifetime -= delta;
            const lifeRatio = particle.userData.maxLifetime > 0
                ? particle.userData.lifetime / particle.userData.maxLifetime
                : 0;
            particle.material.opacity = Math.max(0, Math.min(1, lifeRatio));
            
            // Remove dead particles
            if (particle.userData.lifetime <= 0 || particle.position.y < 0) {
                collections.particles.splice(i, 1);
                releaseParticle(particle);
            }
        }
    }

    function render(shake) {
        const isPlaying = state.phase === 'playing'; // Simplified or use dynamic phases
        const isStart = state.phase === 'start';
        const isUpgrading = state.phase === 'choosing';
        const isGameOver = state.phase === 'game_over';

        camera.position.add(shake);

        try {
            // Render in all sensible phases
            if (composer && !state.lowPowerMode && (isPlaying || isStart || isUpgrading || isGameOver)) {
                composer.render();
            } else {
                renderer.render(scene, camera);
            }
        } catch (e) {
            if (!state._renderErrorLogged) {
                console.error('Render failure:', e);
                state._renderErrorLogged = true;
            }
            renderer.render(scene, camera);
        }

        camera.position.sub(shake);
    }

    return {
        addCameraShake,
        getCameraShakeOffset,
        updateTimeScale,
        triggerTimeSlow,
        triggerHitStop,
        toggleScreenShake,
        toggleHitStop,
        setupPostProcessing,
        updateParticles,
        releaseParticle,
        clearActiveParticles,
        render,
        getComposer: () => composer
    };
}
