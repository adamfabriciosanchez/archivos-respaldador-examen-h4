/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║                  SIMULADOR DE ECG — ESTADOS CLÍNICOS                   ║
 * ║                Fase 2: Generador Matemático de Señales                 ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Este módulo contiene las funciones matemáticas para generar las ondas
 * de los distintos ritmos cardíacos.
 */

window.ECGSim = {
    // Ruido de línea base para que parezca más real
    ruido(t) {
        return 0.05 * Math.sin(t * 50) + 0.02 * (Math.random() - 0.5);
    },

    // ── ONDA PQRST MATEMÁTICA (Complejo normal) ──
    // Se modela usando sumas de senos modificados sobre un ciclo [0, 1)
    complejoPQRST(fase) {
        if (fase < 0.06) {
            // Onda P
            return 0.12 * Math.sin((fase / 0.06) * Math.PI);
        } else if (fase < 0.12) {
            // Segmento PR
            return 0;
        } else if (fase < 0.14) {
            // Onda Q
            return -0.1 * Math.sin(((fase - 0.12) / 0.02) * Math.PI);
        } else if (fase < 0.16) {
            // Onda R (pico alto)
            return 1.0 * Math.sin(((fase - 0.14) / 0.02) * Math.PI);
        } else if (fase < 0.18) {
            // Onda S
            return -0.2 * Math.sin(((fase - 0.16) / 0.02) * Math.PI);
        } else if (fase < 0.28) {
            // Onda T
            return 0.15 * Math.sin(((fase - 0.18) / 0.10) * Math.PI);
        }
        // Segmento TP (línea base)
        return 0;
    },

    // ── 1. RITMO SINUSAL NORMAL ──
    normal(t) {
        // ~72 BPM = 1.2 Hz
        const fase = (t * 1.2) % 1.0;
        return this.complejoPQRST(fase) + this.ruido(t);
    },

    // ── 2. FIBRILACIÓN VENTRICULAR (FV) ──
    // Ondas caóticas de alta frecuencia, sin complejos definidos
    fv(t) {
        return 0.4 * Math.sin(t * 28 + Math.sin(t * 13.7))
             + 0.2 * Math.sin(t * 41.3 + 0.7)
             + 0.15 * (Math.random() - 0.5)
             + 0.1 * Math.sin(t * 67.2);
    },

    // ── 3. TAQUICARDIA VENTRICULAR (TV) ──
    // Señal senoidal ancha y rápida (~180 BPM = 3 Hz -> ω = 18.85)
    tv(t) {
        return 0.6 * Math.sin(t * 18.85) + 0.1 * Math.sin(t * 37.7) + this.ruido(t);
    },

    // ── 4. BRADICARDIA EXTREMA ──
    // ~30 BPM = 0.5 Hz
    brad(t) {
        const fase = (t * 0.5) % 1.0;
        return this.complejoPQRST(fase) + this.ruido(t);
    },

    // ── 5. ASISTOLIA ──
    // Línea plana con ruido
    asistolia(t) {
        return 0.02 * Math.sin(t * 10) + 0.03 * (Math.random() - 0.5);
    },

    // ── 6. MARCAPASOS ACTIVO (PACER) ──
    // ~70 PPM (configurable en main.js) con espícula antes del QRS
    marcapasos(t, ratePPM = 70) {
        const hz = ratePPM / 60.0;
        const fase = (t * hz) % 1.0;
        
        // Espícula del marcapasos (Spike)
        if (fase > 0.04 && fase < 0.05) {
            return 0.8; // Pico positivo muy fino
        } else if (fase > 0.05 && fase < 0.06) {
            return -0.4; // Rebote
        }
        
        // QRS ancho (típico de captura ventricular)
        if (fase > 0.06 && fase < 0.20) {
             // QRS ensanchado y aberrante
             const faseQRS = (fase - 0.06) / 0.14;
             if (faseQRS < 0.3) {
                 return 0.6 * Math.sin((faseQRS / 0.3) * Math.PI); // R ancha
             } else {
                 return -0.3 * Math.sin(((faseQRS - 0.3) / 0.7) * Math.PI); // S profunda y onda T invertida
             }
        }

        return this.ruido(t);
    },

    // ── DESCARGA BIFÁSICA SOBREPUESTA (Artefacto de Shock) ──
    // Se suma a la señal durante los primeros ms después de un shock
    artefactoShock(tPostShock) {
        if (tPostShock < 0) return 0;
        if (tPostShock < 0.1) {
            // Artefacto masivo que satura la pantalla
            return 2.0 * Math.sin(tPostShock * 100) * Math.exp(-tPostShock * 30);
        }
        // Recuperación de la línea base
        return 0;
    }
};
