/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║                      MOTOR DE AUDIO — FASE 5                           ║
 * ║               Sonidos del Desfibrilador usando Web Audio API           ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * NOTA: Cada método está envuelto en try/catch para evitar que errores del
 * AudioContext (contexto suspendido, cerrado, o bloqueado por el navegador)
 * propaguen hacia window.onerror y aparezcan como "Script error. Line: 0".
 */

(function() {
    'use strict';

    let audioCtx = null;
    let chargeOsc = null;
    let chargeGain = null;
    let isMuted = false;

    /**
     * Inicialización perezosa del AudioContext.
     * Web Audio API requiere que el contexto sea creado tras una interacción
     * del usuario (click, keydown, etc.) por política de autoplay de los navegadores.
     * @returns {boolean} true si el contexto está listo para usar.
     */
    function initAudio() {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(function(e) {
                    console.warn('[AudioEngine] No se pudo reanudar el AudioContext:', e);
                });
            }
            return audioCtx.state !== 'closed';
        } catch(err) {
            console.warn('[AudioEngine] initAudio falló:', err);
            audioCtx = null;
            return false;
        }
    }

    /**
     * Verifica que el contexto esté disponible y en estado correcto antes de usarlo.
     * @returns {boolean}
     */
    function audioDisponible() {
        if (isMuted) return false;
        if (!initAudio()) return false;
        if (!audioCtx || audioCtx.state === 'closed') return false;
        return true;
    }

    const AudioEngine = {

        toggleMute(muted) {
            isMuted = muted;
            if (isMuted && chargeOsc) {
                this.stopCharge();
            }
        },

        // ── Pitido del monitor cardíaco (QRS beep) ────────────────────────
        playQRSBeep() {
            try {
                if (!audioDisponible()) return;
                const t = audioCtx.currentTime;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, t);

                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.1, t + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

                osc.connect(gain);
                gain.connect(audioCtx.destination);

                osc.start(t);
                osc.stop(t + 0.15);
            } catch(e) {
                console.warn('[AudioEngine] playQRSBeep:', e);
            }
        },

        // ── Sonido de carga del capacitor (tono ascendente) ───────────────
        startCharge(durationSec) {
            try {
                if (!audioDisponible()) return;
                this.stopCharge();

                const t = audioCtx.currentTime;
                chargeOsc = audioCtx.createOscillator();
                chargeGain = audioCtx.createGain();

                chargeOsc.type = 'triangle';
                chargeOsc.frequency.setValueAtTime(400, t);
                chargeOsc.frequency.exponentialRampToValueAtTime(2000, t + durationSec);

                chargeGain.gain.setValueAtTime(0, t);
                chargeGain.gain.linearRampToValueAtTime(0.05, t + 0.1);

                chargeOsc.connect(chargeGain);
                chargeGain.connect(audioCtx.destination);

                chargeOsc.start(t);
            } catch(e) {
                console.warn('[AudioEngine] startCharge:', e);
                chargeOsc = null;
                chargeGain = null;
            }
        },

        // ── Detener sonido de carga ────────────────────────────────────────
        stopCharge() {
            try {
                if (chargeOsc && audioCtx && audioCtx.state !== 'closed') {
                    const t = audioCtx.currentTime;
                    if (chargeGain) {
                        chargeGain.gain.cancelScheduledValues(t);
                        chargeGain.gain.setValueAtTime(chargeGain.gain.value, t);
                        chargeGain.gain.linearRampToValueAtTime(0, t + 0.1);
                    }
                    chargeOsc.stop(t + 0.12);
                }
            } catch(e) {
                console.warn('[AudioEngine] stopCharge:', e);
            } finally {
                chargeOsc = null;
                chargeGain = null;
            }
        },

        // ── Sonido agudo continuo cuando está cargado y listo ─────────────
        playReadyTone() {
            try {
                if (!audioDisponible()) return;
                this.stopCharge();

                const t = audioCtx.currentTime;
                chargeOsc = audioCtx.createOscillator();
                chargeGain = audioCtx.createGain();

                chargeOsc.type = 'sine';
                chargeOsc.frequency.setValueAtTime(2000, t);

                chargeGain.gain.setValueAtTime(0, t);
                chargeGain.gain.linearRampToValueAtTime(0.02, t + 0.1);

                chargeOsc.connect(chargeGain);
                chargeGain.connect(audioCtx.destination);

                chargeOsc.start(t);
            } catch(e) {
                console.warn('[AudioEngine] playReadyTone:', e);
                chargeOsc = null;
                chargeGain = null;
            }
        },

        // ── Sonido del Shock (Ruido blanco + impacto) ─────────────────────
        playShock() {
            try {
                if (!audioDisponible()) return;
                this.stopCharge();

                const t = audioCtx.currentTime;
                const dur = 0.5;

                // Generador de ruido blanco usando buffer
                const sampleRate = audioCtx.sampleRate;
                const bufferSize = Math.floor(sampleRate * dur);
                if (bufferSize <= 0) return;

                const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }

                const noise = audioCtx.createBufferSource();
                noise.buffer = buffer;

                // Filtro paso bajo (sonido del relé/descarga: grave y seco)
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1000, t);
                filter.frequency.exponentialRampToValueAtTime(100, t + dur);

                const gain = audioCtx.createGain();
                gain.gain.setValueAtTime(0.5, t);
                gain.gain.exponentialRampToValueAtTime(0.01, t + dur);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(audioCtx.destination);

                noise.start(t);
            } catch(e) {
                console.warn('[AudioEngine] playShock:', e);
            }
        },

        // ── Alarma (warning beep) ──────────────────────────────────────────
        playAlarm() {
            try {
                if (!audioDisponible()) return;
                const t = audioCtx.currentTime;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();

                osc.type = 'square';
                osc.frequency.setValueAtTime(600, t);

                gain.gain.setValueAtTime(0.05, t);
                gain.gain.setValueAtTime(0, t + 0.2);
                gain.gain.setValueAtTime(0.05, t + 0.3);
                gain.gain.setValueAtTime(0, t + 0.5);

                osc.connect(gain);
                gain.connect(audioCtx.destination);

                osc.start(t);
                osc.stop(t + 0.6);
            } catch(e) {
                console.warn('[AudioEngine] playAlarm:', e);
            }
        },

        // ── Tono de asistolia (pitido plano continuo de muerte) ────────────
        playFlatline() {
            try {
                if (!audioDisponible()) return;
                this.stopCharge(); // reutilizamos chargeOsc/chargeGain

                const t = audioCtx.currentTime;
                chargeOsc = audioCtx.createOscillator();
                chargeGain = audioCtx.createGain();

                chargeOsc.type = 'sine';
                chargeOsc.frequency.setValueAtTime(440, t);

                chargeGain.gain.setValueAtTime(0, t);
                chargeGain.gain.linearRampToValueAtTime(0.04, t + 0.05);

                chargeOsc.connect(chargeGain);
                chargeGain.connect(audioCtx.destination);

                chargeOsc.start(t);
            } catch(e) {
                console.warn('[AudioEngine] playFlatline:', e);
                chargeOsc = null;
                chargeGain = null;
            }
        }
    };

    window.AudioEngine = AudioEngine;
})();
