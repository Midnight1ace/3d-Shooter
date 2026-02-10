export function createAudioManager() {
    let audioContext = null;

    function ensureAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }

    function playShootSound() {
        try {
            ensureAudioContext();

            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.type = 'sawtooth';
            oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.15);

            const bufferSize = audioContext.sampleRate * 0.1;
            const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
            const data = buffer.getChannelData(0);

            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.5;
            }

            const noiseSource = audioContext.createBufferSource();
            const noiseGain = audioContext.createGain();
            noiseSource.buffer = buffer;
            noiseGain.gain.setValueAtTime(0.3, audioContext.currentTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
            noiseSource.connect(noiseGain);
            noiseGain.connect(audioContext.destination);
            noiseSource.start();
        } catch (e) {
            console.log('Audio not supported');
        }
    }

    function playUiSound(type) {
        try {
            ensureAudioContext();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            const now = audioContext.currentTime;
            let frequency = 360;
            let duration = 0.08;
            let volume = 0.08;

            switch (type) {
                case 'hover':
                    frequency = 520;
                    duration = 0.05;
                    volume = 0.05;
                    break;
                case 'click':
                    frequency = 240;
                    duration = 0.09;
                    volume = 0.08;
                    break;
                case 'reload':
                    frequency = 180;
                    duration = 0.12;
                    volume = 0.07;
                    break;
                case 'perfect':
                    frequency = 620;
                    duration = 0.12;
                    volume = 0.1;
                    break;
                case 'damage':
                    frequency = 120;
                    duration = 0.16;
                    volume = 0.12;
                    break;
                case 'hit':
                    frequency = 420;
                    duration = 0.06;
                    volume = 0.06;
                    break;
                case 'kill':
                    frequency = 320;
                    duration = 0.14;
                    volume = 0.09;
                    break;
            }

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, now);
            gainNode.gain.setValueAtTime(volume, now);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
            oscillator.start(now);
            oscillator.stop(now + duration);
        } catch (e) {
            console.log('Audio not supported');
        }
    }

    return {
        ensureAudioContext,
        playShootSound,
        playUiSound
    };
}
