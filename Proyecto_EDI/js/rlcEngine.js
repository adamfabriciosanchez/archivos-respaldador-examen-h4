/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║         MOTOR MATEMÁTICO: CIRCUITO RLC + RUNGE-KUTTA 4° ORDEN         ║
 * ║         Simulador de Desfibrilador — Proyecto Ecuaciones Diferenciales ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * DESCRIPCIÓN DEL MODELO FÍSICO:
 * ================================
 * Un desfibrilador bifásico se modela como un circuito RLC en serie.
 * El proceso tiene DOS fases claramente diferenciadas:
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  FASE 1 — CARGA (botón CHARGE):                                     │
 *  │  El capacitor inicia COMPLETAMENTE DESCARGADO (Vc = 0V).            │
 *  │  Al presionar CHARGE, el convertidor interno lo carga hasta V₀.     │
 *  │  Modelado como circuito RC de 1° orden (usamos R_carga = 1000 Ω):   │
 *  │                                                                     │
 *  │      EDO:  dVc/dt = (Vtarget - Vc) / τ                             │
 *  │                                                                     │
 *  │  Solución analítica: Vc(t) = Vtarget · (1 - e^(-t/τ))             │
 *  ├─────────────────────────────────────────────────────────────────────┤
 *  │  FASE 2 — DESCARGA / SHOCK (botón SHOCK):                           │
 *  │  El capacitor cargado descarga su energía a través del paciente.    │
 *  │  Modelado como circuito RLC serie de 2° orden:                      │
 *  │                                                                     │
 *  │      EDO:  L·d²q/dt² + R·dq/dt + (1/C)·q = 0                     │
 *  │                                                                     │
 *  │  Condiciones iniciales:                                             │
 *  │    q(0) = C·V₀   [capacitor cargado a V₀]                         │
 *  │    I(0) = 0       [corriente inicial cero]                          │
 *  ├─────────────────────────────────────────────────────────────────────┤
 *  │  PULSO BIFÁSICO:                                                    │
 *  │  A los 6ms se activa el puente H (H-bridge): invierte la           │
 *  │  polaridad de la corriente. Esto mejora la eficiencia de            │
 *  │  desfibrilación al reducir la impedancia transtorácica.             │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * PARÁMETROS DEL CIRCUITO (elección pedagógica):
 * ================================================
 *   C = 100µF  — Capacitancia del desfibrilador
 *   L = 50mH  — Inductancia del circuito
 *   R = 50–150 Ω — Impedancia transtorácica del paciente (ajustable)
 *
 *   ► Resistencia crítica: R_c = 2√(L/C) = 2·√(50e-3/100e-6) ≈ 44.7 Ω
 *
 *   Con el slider de 50–150 Ω se pueden observar los TRES regímenes:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  R < 100 Ω  →  SUBAMORTIGUADO   (oscilaciones amortiguadas)  │
 *   │  R = 100 Ω  →  CRÍTICAMENTE AMORTIGUADO     (sin oscilación) │
 *   │  R > 100 Ω  →  SOBREAMORTIGUADO (decaimiento exponencial)    │
 *   └────────────────────────────────────────────────────────────────┘
 *
 *   NOTA ACADÉMICA: Los desfibriladores reales usan C ≈ 100-200µF, con lo
 *   que operan casi siempre en régimen sobreamortiguado. Usamos C=100µF para
 *   aproximarnos más al modelo realista.
 *
 * MÉTODO NUMÉRICO: RUNGE-KUTTA 4° ORDEN (RK4)
 * =============================================
 *   El RK4 estima la solución de la EDO evaluando la pendiente
 *   en 4 puntos del intervalo [tₙ, tₙ+h] y promediando ponderadamente:
 *
 *     k1 = f(tₙ,       yₙ)               → pendiente al inicio
 *     k2 = f(tₙ + h/2, yₙ + h·k1/2)     → pendiente al 1er punto medio
 *     k3 = f(tₙ + h/2, yₙ + h·k2/2)     → pendiente al 2do punto medio
 *     k4 = f(tₙ + h,   yₙ + h·k3)       → pendiente al final
 *
 *     yₙ₊₁ = yₙ + (h/6)·(k1 + 2·k2 + 2·k3 + k4)
 *
 *
 * @module rlcEngine
 * @author Simulador EDO — Proyecto Académico
 */

'use strict';

(function() {
// ═════════════════════════════════════════════════════════════════════
//  SECCIÓN 1: CONSTANTES DEL CIRCUITO DESFIBRILADOR
// ═════════════════════════════════════════════════════════════════════

/** Capacitancia del desfibrilador [Faradios] — C = 100 µF */
const C_DEFIB = 100e-6;

/** Inductancia del circuito de descarga [Henrios] — L = 50 mH */
const L_DEFIB = 50e-3;

/**
 * Resistencia de amortiguamiento crítico [Ohmios]
 * Calculada como: R_c = 2·√(L/C) = 2·√(50e-3 / 100e-6) ≈ 44.7 Ω
 * Es el punto donde el sistema cambia de sub a sobreamortiguado.
 */
const R_CRITICA = 2 * Math.sqrt(L_DEFIB / C_DEFIB); // ≈ 100 Ω

/** Resistencia del circuito de carga interno [Ohmios] — R_carga = 1000 Ω */
const R_CARGA = 1000;

/** Constante de tiempo del circuito de carga interno [s] — τ = R_carga * C */
const TAU_CARGA = R_CARGA * C_DEFIB;

/** Tiempo de inversión bifásica [s] — T₁ = 6 ms */
const T_BIFASICO = 6e-3;

/** Duración total de la descarga [s] — T_total = 12 ms */
const T_DESCARGA_TOTAL = 12e-3;

/** Niveles de energía seleccionables en el desfibrilador [Joules] */
const NIVELES_ENERGIA = [2, 5, 10, 20, 30, 50, 70, 100, 120, 150, 200, 300, 360];


// ═════════════════════════════════════════════════════════════════════
//  SECCIÓN 2: CÁLCULOS BÁSICOS
// ═════════════════════════════════════════════════════════════════════

/**
 * Calcula el voltaje inicial requerido en el capacitor para almacenar
 * la energía deseada.
 *
 * DERIVACIÓN MATEMÁTICA:
 *   Energía almacenada en capacitor: E = ½·C·V₀²
 *   Despejando V₀: V₀ = √(2·E / C)
 *
 * @param {number} joules - Energía de la descarga [J]
 * @param {number} [C=C_DEFIB] - Capacitancia del capacitor [F]
 * @returns {number} Voltaje inicial V₀ [V]
 *
 * @example
 *   calcularVoltajeInicial(200, 100e-6) → √(2·200/100e-6) = 2000 V
 */
function calcularVoltajeInicial(joules, C = C_DEFIB) {
    // Fórmula: E = ½·C·V₀²  →  V₀ = √(2E/C)
    return Math.sqrt((2 * joules) / C);
}

/**
 * Analiza el tipo de amortiguamiento del circuito RLC dada una resistencia.
 *
 * TEORÍA DE CIRCUITOS RLC:
 *   La ecuación característica de L·q″ + R·q′ + q/C = 0 es:
 *     L·s² + R·s + 1/C = 0
 *     s² + (R/L)·s + 1/(LC) = 0
 *
 *   Definiciones:
 *     α  = R / (2L)     [coeficiente de atenuación]
 *     ω₀ = 1 / √(LC)   [frecuencia natural no amortiguada]
 *
 *   Discriminante: Δ = α² - ω₀²
 *     Δ > 0 → Sobreamortiguado  (2 raíces reales distintas)
 *     Δ = 0 → Críticamente amortiguado (raíz real doble)
 *     Δ < 0 → Subamortiguado    (2 raíces complejas conjugadas)
 *
 * @param {number} R - Resistencia del paciente [Ω]
 * @param {number} [L=L_DEFIB] - Inductancia [H]
 * @param {number} [C=C_DEFIB] - Capacitancia [F]
 * @returns {{tipo: string, alpha: number, omega0: number, delta: number, wd: number}}
 */
function analizarAmortiguamiento(R, L = L_DEFIB, C = C_DEFIB) {
    const alpha  = R / (2 * L);             // Coeficiente de atenuación []
    const omega0 = 1 / Math.sqrt(L * C);   // Frecuencia natural []
    const delta  = alpha * alpha - omega0 * omega0; // Discriminante Δ

    let tipo;
    let wd = 0; // Frecuencia amortiguada (solo aplica en subamortiguado)

    const TOLERANCIA = 1e-3; // Tolerancia numérica para detectar caso crítico
    if (Math.abs(delta) < TOLERANCIA * omega0 * omega0) {
        tipo = 'CRÍTICAMENTE_AMORTIGUADO';
    } else if (delta < 0) {
        tipo = 'SUBAMORTIGUADO';
        wd = Math.sqrt(-delta); // ωd = √(ω₀² - α²) [frecuencia de oscilación]
    } else {
        tipo = 'SOBREAMORTIGUADO';
    }

    return { tipo, alpha, omega0, delta, wd };
}


// ═════════════════════════════════════════════════════════════════════
//  SECCIÓN 3: ALGORITMO RUNGE-KUTTA 4° ORDEN (RK4)
// ═════════════════════════════════════════════════════════════════════

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          PASO RK4 — NÚCLEO DEL MOTOR MATEMÁTICO                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Calcula el estado y(t+h) a partir de y(t) usando el método de
 * Runge-Kutta de 4° orden. Funciona para EDOs escalares y vectoriales.
 *
 * ALGORITMO RK4:
 *   ① k1 = f(t,       y)            [pendiente inicial]
 *   ② k2 = f(t+h/2,  y + h·k1/2)   [pendiente en punto medio (con k1)]
 *   ③ k3 = f(t+h/2,  y + h·k2/2)   [pendiente en punto medio (con k2)]
 *   ④ k4 = f(t+h,    y + h·k3)      [pendiente final]
 *
 *   ⑤ y(t+h) = y(t) + (h/6)·(k1 + 2·k2 + 2·k3 + k4)
 *
 * La ponderación (1, 2, 2, 1) da más importancia a los puntos medios,
 * lo que da al método su alta precisión (error ≈ O(h⁵)).
 *
 * @param {Function} f       - Función f(t, y, params) que devuelve dy/dt
 * @param {number}   t       - Tiempo actual [s]
 * @param {number|number[]} y - Estado actual (escalar o vector)
 * @param {number}   h       - Paso de tiempo Δt [s]
 * @param {Object}   params  - Parámetros del circuito {R, L, C, ...}
 * @returns {number|number[]} Nuevo estado y(t+h)
 */
function rk4Step(f, t, y, h, params) {
    // ── ① k1: Pendiente evaluada al inicio del intervalo ──────────
    const k1 = f(t, y, params);

    // ── ② k2: Pendiente en el punto medio usando k1 ───────────────
    //    Estimación intermedia: y₂ = y + (h/2)·k1
    const y2 = _sumar(y, _escalar(k1, h / 2));
    const k2 = f(t + h / 2, y2, params);

    // ── ③ k3: Pendiente en el punto medio usando k2 ───────────────
    //    Estimación mejorada: y₃ = y + (h/2)·k2
    const y3 = _sumar(y, _escalar(k2, h / 2));
    const k3 = f(t + h / 2, y3, params);

    // ── ④ k4: Pendiente evaluada al final del intervalo ───────────
    //    Usando k3 como predictor: y₄ = y + h·k3
    const y4 = _sumar(y, _escalar(k3, h));
    const k4 = f(t + h, y4, params);

    // ── ⑤ Combinación ponderada de las 4 pendientes ───────────────
    //    Promedio ponderado: (k1 + 2k2 + 2k3 + k4) / 6
    //    yₙ₊₁ = yₙ + h · promedio_ponderado
    const promedio = _sumar(
        _sumar(_escalar(k1, 1), _escalar(k2, 2)),
        _sumar(_escalar(k3, 2), _escalar(k4, 1))
    );
    return _sumar(y, _escalar(promedio, h / 6));
}

/**
 * Helper interno: multiplica un escalar/vector por un factor numérico.
 * @private
 */
function _escalar(v, factor) {
    if (Array.isArray(v)) return v.map(vi => vi * factor);
    return v * factor;
}

/**
 * Helper interno: suma dos escalares o dos vectores elemento a elemento.
 * @private
 */
function _sumar(a, b) {
    if (Array.isArray(a)) return a.map((ai, i) => ai + b[i]);
    return a + b;
}


// ═════════════════════════════════════════════════════════════════════
//  SECCIÓN 4: EDO DE CARGA DEL CAPACITOR (1° Orden)
// ═════════════════════════════════════════════════════════════════════

/**
 * Función derivada para la EDO de CARGA del capacitor.
 *
 * MODELO FÍSICO: El convertidor DC-DC interno actúa como una fuente
 * de voltaje Vtarget en serie con una resistencia de carga R_carga.
 * El capacitor (Vc inicial = 0) se carga siguiendo:
 *
 *   C·dVc/dt = (Vtarget - Vc) / R_carga
 *   → dVc/dt = (Vtarget - Vc) / (R_carga · C) = (Vtarget - Vc) / τ
 *
 * Solución analítica exacta: Vc(t) = Vtarget·(1 - e^(-t/τ))
 * Esta función es la que RK4 aproxima numéricamente.
 *
 * @param {number} t - Tiempo actual [s] (EDO autónoma, no depende de t)
 * @param {number} Vc - Voltaje actual del capacitor [V]
 * @param {{Vtarget: number, tau: number}} params
 * @returns {number} Derivada dVc/dt [V/s]
 */
function derivadaCarga(t, Vc, params) {
    // Cuando Vc → Vtarget, la derivada → 0 (capacitor completamente cargado)
    return (params.Vtarget - Vc) / params.tau;
}

/**
 * Simula la fase de CARGA del capacitor usando RK4.
 *
 * EL CAPACITOR INICIA COMPLETAMENTE DESCARGADO (Vc = 0V).
 * El usuario activa el proceso presionando el botón CHARGE.
 * La simulación calcula todos los puntos instantáneamente;
 * la animación los presenta progresivamente en el gráfico.
 *
 * @param {number} joules - Energía objetivo [J]
 * @param {number} [C=C_DEFIB] - Capacitancia [F]
 * @param {number} [tau=TAU_CARGA] - Constante de tiempo τ [s]
 * @returns {{puntos: Array, Vtarget: number, tiempoTotal: number}}
 *          puntos: Array de {t, Vc, porcentaje}
 */
function simularCarga(joules, C = C_DEFIB, tau = TAU_CARGA) {
    // Calcular voltaje objetivo a partir de la energía: V₀ = √(2E/C)
    const Vtarget = calcularVoltajeInicial(joules, C);

    // Simular 5 constantes de tiempo: a t = 5τ, Vc ≈ 99.3% de Vtarget
    const tiempoTotal = 5 * tau;

    // Paso de tiempo h = τ/150 → ~750 puntos para 5τ (buena resolución)
    const h = tau / 150;

    // ─── CONDICIÓN INICIAL ─────────────────────────────────────────
    // ► El capacitor INICIA DESCARGADO: Vc(0) = 0 V ◄
    // Esto es esencial: el usuario DEBE presionar CHARGE para cargarlo.
    let Vc = 0.0;
    let t  = 0.0;

    const params = { Vtarget, tau };
    const puntos = [];

    // ─── BUCLE DE INTEGRACIÓN RK4 PARA LA CARGA ───────────────────
    // Cada iteración avanza el estado Vc un paso h hacia adelante en el tiempo
    while (t <= tiempoTotal + h * 0.5) {
        puntos.push({
            t:          t,
            Vc:         Math.min(Vc, Vtarget),  // Nunca supera el objetivo
            porcentaje: Math.min((Vc / Vtarget) * 100, 100)
        });

        // ► APLICAR PASO DE RUNGE-KUTTA 4° ORDEN ◄
        // Esta es la llamada central al algoritmo RK4 para la EDO de carga
        Vc = rk4Step(derivadaCarga, t, Vc, h, params);

        // Limitar al voltaje objetivo (el capacitor no puede sobre-cargarse)
        if (Vc > Vtarget) Vc = Vtarget;
        t += h;
    }

    return { puntos, Vtarget, tiempoTotal };
}


// ═════════════════════════════════════════════════════════════════════
//  SECCIÓN 5: EDO DE DESCARGA — CIRCUITO RLC (2° Orden)
// ═════════════════════════════════════════════════════════════════════

/**
 * Función derivada para la EDO de DESCARGA del circuito RLC en serie.
 *
 * ECUACIÓN DIFERENCIAL DE 2° ORDEN (Ley de Kirchhoff de voltajes):
 *   L·d²q/dt² + R·dq/dt + (1/C)·q = 0
 *
 * REDUCCIÓN A SISTEMA DE 1° ORDEN (técnica estándar para usar RK4):
 * Definimos el vector de estado y = [y₁, y₂] donde:
 *   y₁ = q       (carga eléctrica en el capacitor [C])
 *   y₂ = dq/dt = I (corriente en el circuito [A])
 *
 * El sistema de EDOs de 1° orden equivalente es:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  dy₁/dt = y₂                        [dq/dt = I]        │
 *   │  dy₂/dt = -(R/L)·y₂ - (1/LC)·y₁   [dI/dt = f(q,I)]  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Variables observables:
 *   Voltaje en el capacitor: V_C(t) = y₁ / C = q / C
 *   Corriente en el circuito: I(t) = y₂
 *
 * @param {number}   t  - Tiempo actual [s] (EDO autónoma)
 * @param {number[]} y  - Vector de estado [q [C], I [A]]
 * @param {{R: number, L: number, C: number}} params
 * @returns {number[]} Vector de derivadas [dq/dt, dI/dt]
 */
function derivadaDescarga(t, y, params) {
    const { R, L, C } = params;
    const q = y[0]; // Carga en el capacitor [Coulombs]
    const I = y[1]; // Corriente en el circuito [Amperes]

    // ─── SISTEMA DE EDOs DE 1° ORDEN (equivalente a EDO de 2° orden) ──
    // Primera ecuación: dq/dt = I
    const dq_dt = I;

    // Segunda ecuación: dI/dt = -(R/L)·I - (1/LC)·q
    // Proviene de: L·dI/dt = -R·I - q/C  (dividiendo entre L)
    const dI_dt = -(R / L) * I - (1 / (L * C)) * q;

    return [dq_dt, dI_dt];
}

/**
 * Simula la fase de DESCARGA BIFÁSICA del desfibrilador usando RK4.
 *
 * PROCESO:
 *   Fase 1 (0ms → 6ms): El capacitor descarga, corriente positiva
 *   Fase 2 (6ms → 12ms): El puente H invierte la polaridad
 *                         → corriente negativa (bifásica)
 *
 * La forma bifásica es más eficiente médicamente porque:
 *   1. Reduce la energía necesaria en ~50%
 *   2. Disminuye daño miocárdico
 *   3. Es más efectiva para fibrilación ventricular
 *
 * @param {number} Vc0 - Voltaje del capacitor cargado [V]
 * @param {number} R   - Resistencia del paciente [Ω]
 * @param {number} [L=L_DEFIB] - Inductancia [H]
 * @param {number} [C=C_DEFIB] - Capacitancia [F]
 * @returns {{puntos, Ipico, Vpico, energiaEntregada, amortiguamiento}}
 */
function simularDescarga(Vc0, R, L = L_DEFIB, C = C_DEFIB) {
    // ─── CONDICIONES INICIALES ─────────────────────────────────────
    // El capacitor viene CARGADO con voltaje Vc0 (resultado de CHARGE)
    // Carga inicial: q₀ = C·V₀ [Coulombs]
    const q0 = C * Vc0;
    const I0 = 0.0;    // Corriente inicial = 0 (circuito estaba abierto)

    // Vector de estado inicial: y = [q₀, I₀]
    let y = [q0, I0];
    let t = 0.0;

    // Paso de tiempo: 5µs → suficiente para señal de 12ms (2400 pasos)
    const h = 5e-6;
    const params = { R, L, C };

    const puntos = [];
    let faseInvertida    = false;
    let energiaEntregada = 0.0; // Integral de P = I²·R [Joules]

    // ─── BUCLE DE INTEGRACIÓN RK4 PARA LA DESCARGA ────────────────
    while (t <= T_DESCARGA_TOTAL + h * 0.5) {
        const q  = y[0];
        const I  = y[1];
        const Vc = q / C; // Voltaje en el capacitor [V]

        puntos.push({ t, Vc, I, q });

        // Acumular energía disipada en la resistencia del paciente: P = I²·R
        energiaEntregada += I * I * R * h;

        // ► APLICAR PASO DE RUNGE-KUTTA 4° ORDEN ◄
        // Esta es la llamada central al RK4 para la EDO de descarga RLC
        y = rk4Step(derivadaDescarga, t, y, h, params);
        t += h;

        // ─── INVERSIÓN BIFÁSICA (t ≥ T_BIFASICO = 6ms) ────────────
        // El puente H (H-Bridge) invierte la polaridad de la corriente.
        // Se modela cambiando el signo de I (y[1]):
        //   y[1] = -y[1]  →  corriente ahora fluye en sentido inverso
        if (!faseInvertida && t >= T_BIFASICO) {
            y[1] = -y[1];     // ← Inversión bifásica
            faseInvertida = true;
        }
    }

    // ─── ESTADÍSTICAS DE LA DESCARGA ──────────────────────────────
    const Ipico = Math.max(...puntos.map(p => Math.abs(p.I)));
    const Vpico = puntos[0] ? Math.abs(puntos[0].Vc) : Vc0;

    return {
        puntos,
        Ipico,
        Vpico,
        energiaEntregada: Math.abs(energiaEntregada),
        amortiguamiento: analizarAmortiguamiento(R, L, C)
    };
}


// ═════════════════════════════════════════════════════════════════════
//  SECCIÓN 6: REPORTE ACADÉMICO DE VERIFICACIÓN
// ═════════════════════════════════════════════════════════════════════

/**
 * Genera un reporte detallado de la simulación para verificación
 * académica. Incluye primeros pasos del RK4 y comparación con
 * la solución analítica cuando aplica.
 *
 * @param {number} joules - Energía seleccionada [J]
 * @param {number} R      - Resistencia del paciente [Ω]
 * @returns {string} Texto del reporte (para mostrar en consola)
 */
function generarReporteVerificacion(joules, R) {
    const C   = C_DEFIB;
    const L   = L_DEFIB;
    const Vc0 = calcularVoltajeInicial(joules, C);
    const am  = analizarAmortiguamiento(R, L, C);

    let rep = '';
    rep += `╔══════════════════════════════════════════════════════════════╗\n`;
    rep += `║         REPORTE DE SIMULACIÓN RK4 — CIRCUITO RLC             ║\n`;
    rep += `╚══════════════════════════════════════════════════════════════╝\n\n`;

    // ── Parámetros del circuito ────────────────────────────────────
    rep += `📊 PARÁMETROS DEL CIRCUITO:\n`;
    rep += `   Energía seleccionada   E = ${joules} J\n`;
    rep += `   Capacitancia           C = ${(C * 1e6).toFixed(0)} µF\n`;
    rep += `   Inductancia            L = ${(L * 1e3).toFixed(0)} mH\n`;
    rep += `   Resistencia paciente   R = ${R} Ω\n\n`;

    rep += `📐 CÁLCULO DEL VOLTAJE INICIAL:\n`;
    rep += `   Fórmula: V₀ = √(2·E / C)\n`;
    rep += `          = √(2 × ${joules} / ${(C*1e6).toFixed(0)}e-6)\n`;
    rep += `          = √(${(2*joules/C).toExponential(3)})\n`;
    rep += `          = ${Vc0.toFixed(2)} V\n\n`;

    // ── Análisis de amortiguamiento ────────────────────────────────
    rep += `📊 ANÁLISIS DE AMORTIGUAMIENTO:\n`;
    rep += `   α  = R/(2L) = ${R}/(2×${(L*1e3).toFixed(0)}e-3) = ${am.alpha.toFixed(2)} rad/s\n`;
    rep += `   ω₀ = 1/√(LC) = 1/√(${(L*1e3).toFixed(0)}e-3 × ${(C*1e6).toFixed(0)}e-6) = ${am.omega0.toFixed(2)} rad/s\n`;
    rep += `   Δ  = α² - ω₀² = ${(am.alpha**2).toFixed(0)} - ${(am.omega0**2).toFixed(0)} = ${am.delta.toFixed(2)}\n`;
    rep += `   ► Tipo: ${am.tipo.replace('_', ' ')}\n`;
    if (am.tipo === 'SUBAMORTIGUADO') {
        rep += `   ωd = √(-Δ) = ${am.wd.toFixed(2)} rad/s (frecuencia de oscilación)\n`;
    }
    rep += '\n';

    // ── Primeros 10 pasos RK4 ─────────────────────────────────────
    rep += `🔢 PRIMEROS 10 PASOS RK4 (descarga, h = 5µs):\n`;
    rep += `   Paso │  t [µs]  │  Vc [V]    │  I [A]\n`;
    rep += `   ─────┼──────────┼────────────┼──────────────\n`;

    let yDemo = [C * Vc0, 0.0];
    const hDemo = 5e-6;
    const pDemo = { R, L, C };
    for (let i = 0; i <= 10; i++) {
        const Vc_i = yDemo[0] / C;
        const I_i  = yDemo[1];
        rep += `   ${String(i).padStart(4)} │ ${(i * hDemo * 1e6).toFixed(1).padStart(8)} │ ${Vc_i.toFixed(4).padStart(10)} │ ${I_i.toFixed(6)}\n`;
        yDemo = rk4Step(derivadaDescarga, i * hDemo, yDemo, hDemo, pDemo);
    }
    rep += `   ...  (continúa hasta t = 12ms)\n\n`;

    // ── Solución analítica (solo para sobreamortiguado) ────────────
    if (am.tipo === 'SOBREAMORTIGUADO') {
        const { alpha, delta } = am;
        const raiz = Math.sqrt(delta);
        const s1   = -alpha + raiz;
        const s2   = -alpha - raiz;
        const q0   = C * Vc0;
        // Condiciones iniciales: q(0) = q0, I(0) = 0
        // q(t) = A·e^(s1·t) + B·e^(s2·t)
        // q(0) = A + B = q0
        // q'(0) = A·s1 + B·s2 = 0  → A = -q0·s2/(s1-s2)
        const A = (-q0 * s2) / (s1 - s2);
        const B = q0 - A;

        rep += `🧮 SOLUCIÓN ANALÍTICA (caso sobreamortiguado — para verificar RK4):\n`;
        rep += `   Raíces características:\n`;
        rep += `   s₁ = -α + √Δ = ${s1.toFixed(2)} rad/s\n`;
        rep += `   s₂ = -α - √Δ = ${s2.toFixed(2)} rad/s\n`;
        rep += `   Solución: q(t) = A·e^(s₁t) + B·e^(s₂t)\n`;
        rep += `   Constantes: A = ${A.toExponential(4)}, B = ${B.toExponential(4)}\n`;
        rep += `   → V_C(t) = q(t)/C\n\n`;

        rep += `   VERIFICACIÓN en t = 25µs:\n`;
        const t_v = 25e-6;
        const q_an = A * Math.exp(s1 * t_v) + B * Math.exp(s2 * t_v);
        const V_an = q_an / C;

        let y_v = [C * Vc0, 0.0];
        for (let i = 0; i < 5; i++) {
            y_v = rk4Step(derivadaDescarga, i * hDemo, y_v, hDemo, pDemo);
        }
        const V_rk4 = y_v[0] / C;
        const error  = Math.abs((V_rk4 - V_an) / V_an) * 100;

        rep += `   V_analítica(25µs) = ${V_an.toFixed(6)} V\n`;
        rep += `   V_RK4(25µs)       = ${V_rk4.toFixed(6)} V\n`;
        rep += `   Error relativo    = ${error.toFixed(8)}%   ← altísima precisión del RK4\n\n`;
    }

    rep += `✅ Simulación RK4 completada exitosamente.\n`;
    rep += `   Use los gráficos superiores para el análisis visual.\n`;
    return rep;
}


// ═════════════════════════════════════════════════════════════════════
//  EXPORTACIONES AL ENTORNO GLOBAL (Soporte file:// sin módulos)
// ═════════════════════════════════════════════════════════════════════
window.RLC = {
    // ── Constantes del circuito ──────────────────────────────────
    C_DEFIB,
    L_DEFIB,
    R_CRITICA,
    TAU_CARGA,
    T_BIFASICO,
    T_DESCARGA_TOTAL,
    NIVELES_ENERGIA,

    // ── Funciones de análisis ────────────────────────────────────
    calcularVoltajeInicial,
    analizarAmortiguamiento,

    // ── Simulaciones (usan RK4 internamente) ─────────────────────
    simularCarga,
    simularDescarga,

    // ── Reporte académico ─────────────────────────────────────────
    generarReporteVerificacion,

    // ── Funciones RK4 de bajo nivel (exportadas para propósito educativo)
    rk4Step,
    derivadaCarga,
    derivadaDescarga
};

})();
