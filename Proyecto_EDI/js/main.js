/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║         CONTROLADOR PRINCIPAL — SIMULADOR DESFIBRILADOR LIFEPAK        ║
 * ║         Fase 1: Motor RLC + Gráficas de Carga/Descarga                ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Este módulo orquesta toda la lógica del simulador:
 *   - Gestión del estado del sistema (encendido, cargando, descargando...)
 *   - Manejadores de eventos para todos los botones
 *   - Animación del ECG en el canvas (placeholder para Fase 1)
 *   - Dibujo de las curvas de carga y descarga (resultados del RK4)
 *   - Actualización de los displays del monitor
 *
 * @module main
 */

(function () {
    // ── Obtener funciones y constantes del motor RLC (Fase 1) ──
    const {
        C_DEFIB, L_DEFIB, R_CRITICA,
        NIVELES_ENERGIA,
        calcularVoltajeInicial,
        analizarAmortiguamiento,
        simularCarga,
        simularDescarga,
        generarReporteVerificacion
    } = window.RLC;

    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 1: ESTADO GLOBAL DEL SISTEMA
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Estado completo del simulador de desfibrilador.
     * Es la "fuente de verdad" de toda la aplicación.
     */
    const estado = {
        // Sistema
        encendido: false,
        idxEnergia: 10,      // Índice en NIVELES_ENERGIA → 200J por defecto
        resistencia: 75,      // Ω — impedancia transtorácica del paciente

        // Proceso de carga
        cargado: false,
        cargando: false,
        porcentajeCarga: 0,       // 0–100%
        animIdCarga: null,    // ID del requestAnimationFrame de la animación de carga
        velocidadCarga: 1.5,     // Factor de velocidad para la animación (x real)

        // Resultados de simulación (guardados para redibujar al cambiar R)
        resultadoCarga: null,    // {puntos, Vtarget, tiempoTotal}
        resultadoDescarga: null,    // {puntos, Ipico, Vpico, energiaEntregada, ...}
        Vc0: 0,       // Voltaje del capacitor al momento de la descarga
        vistaDescarga: 'ambas', // 'ambas' | 'corriente' | 'voltaje'
        animIdDescarga: null,    // ID de requestAnimationFrame de descarga

        // Controles clínicos
        sincronizado: false,
        marcapasos: false,
        ratePPM: 70,
        currentMA: 80,
        casoClinico: 'fv',   // 'fv' | 'tv' | 'brad' | 'asistolia' | 'normal'

        // ECG
        ecgOffset: 0,
        ecgAnimId: null,
        tiempoEcg: 0,
        tiempoUltimoShock: undefined,

        // ── LÓGICA CLÍNICA AVANZADA ──────────────────────────────────────
        intentosShock: 0,       // Contador de intentos de shock fallidos en el caso actual

        // Timer de deterioro clínico → asistolia

        timerDeterioro: null,    // ID del setInterval del timer de deterioro
        tiempoRestante: 90,      // Segundos restantes antes de asistolia
        deterioroActivo: false,   // true si el timer está corriendo
    };

    // PARÁMETRO AJUSTABLE: tiempo en segundos antes de que el paciente entre en asistolia
    // si no se logra reanimar. 
    const TIEMPO_DETERIORO_SEG = 90;

    // ── Joules actualmente seleccionados ────────────────────────────────
    function joulesToActuales() {
        return NIVELES_ENERGIA[estado.idxEnergia];
    }


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 2: REFERENCIAS AL DOM
    // ══════════════════════════════════════════════════════════════════════

    // Canvases
    const canvasECG = document.getElementById('canvas-ecg');
    const canvasCarga = document.getElementById('canvas-carga');
    const canvasDescarga = document.getElementById('canvas-descarga');

    const ctxECG = canvasECG?.getContext('2d');
    const ctxCarga = canvasCarga?.getContext('2d');
    const ctxDescarga = canvasDescarga?.getContext('2d');

    // Botones del desfibrilador
    const btnOn = document.getElementById('btn-on');
    const btnEnergyUp = document.getElementById('btn-energy-up');
    const btnEnergyDown = document.getElementById('btn-energy-down');
    const btnCharge = document.getElementById('btn-charge');
    const btnShock = document.getElementById('btn-shock');
    const btnSync = document.getElementById('btn-sync');
    const btnPacer = document.getElementById('btn-pacer');
    const btnRateUp = document.getElementById('btn-rate-up');
    const btnRateDown = document.getElementById('btn-rate-down');
    const btnCurrentUp = document.getElementById('btn-current-up');
    const btnCurrentDown = document.getElementById('btn-current-down');
    const btnPause = document.getElementById('btn-pause');
    const btnAlarms = document.getElementById('btn-alarms');

    // Botones de caso clínico
    const btnCasos = document.querySelectorAll('.btn-caso');

    // Slider de resistencia
    const sliderR = document.getElementById('slider-resistencia');

    // Displays del monitor
    const displayHR = document.getElementById('display-hr');
    const displayEnergia = document.getElementById('display-energia');
    const displayHora = document.getElementById('display-hora');
    const monitorMsg = document.getElementById('monitor-status-msg');
    const displayRate = document.getElementById('display-rate');
    const displayMA = document.getElementById('display-current');
    const pacerInfo = document.getElementById('pacer-info');
    const displayPPM = document.getElementById('display-ppm');
    const displayMaP = document.getElementById('display-ma');

    // Barra de carga
    const chargeBar = document.getElementById('charge-bar');
    const chargePct = document.getElementById('charge-percent');
    const chargeBarCont = document.getElementById('charge-bar-container');

    // LEDs
    const ledOn = document.getElementById('led-on');
    const ledSync = document.getElementById('led-sync');
    const ledPacer = document.getElementById('led-pacer');

    // Panel de parámetros educativo
    const paramR = document.getElementById('param-R');
    const paramL = document.getElementById('param-L');
    const paramC = document.getElementById('param-C');
    const paramE = document.getElementById('param-E');
    const paramV0 = document.getElementById('param-V0');
    const amortValor = document.getElementById('amort-valor');
    const amortTipo = document.getElementById('amort-tipo');
    const edoSustituida = document.getElementById('edo-sustituida');
    const valorR = document.getElementById('valor-resistencia');

    // Stats de gráficas
    const statVfinal = document.getElementById('stat-vfinal');
    const statT99 = document.getElementById('stat-t99');
    const statIpico = document.getElementById('stat-ipico');
    const statVpico = document.getElementById('stat-vpico');
    const statEentregada = document.getElementById('stat-eentregada');

    // Tooltip y vista de descarga
    const chartTooltip = document.getElementById('chart-tooltip');
    const tooltipTime = document.getElementById('tooltip-time');
    const tooltipValues = document.getElementById('tooltip-values');
    const radiosView = document.querySelectorAll('input[name="view-descarga"]');

    // Consola de verificación
    const consoleOutput = document.getElementById('console-output');
    const btnConsoleToggle = document.getElementById('btn-console-toggle');
    const consoleBody = document.getElementById('console-body');


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 3: INICIALIZACIÓN
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Punto de entrada principal. Se ejecuta cuando el DOM está listo.
     */
    function init() {
        registrarEventos();
        actualizarDisplays();
        iniciarReloj();
        dibujarEcgApagado(ctxECG, canvasECG);
        dibujarCanvasVacio(ctxCarga, canvasCarga, 'Presiona CHARGE para ver la curva de carga');
        dibujarCanvasVacio(ctxDescarga, canvasDescarga, 'Presiona SHOCK para ver el pulso bifásico');
        actualizarPanelEducativo();
        log('// Simulador de Desfibrilador — Motor RLC + RK4\n// Presiona ON para encender el sistema...\n');
    }


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 4: REGISTRO DE EVENTOS
    // ══════════════════════════════════════════════════════════════════════

    function registrarEventos() {
        // ── Botón ON/OFF ────────────────────────────────────────────────
        btnOn?.addEventListener('click', toggleEncendido);

        // ── Selección de energía ────────────────────────────────────────
        btnEnergyUp?.addEventListener('click', () => cambiarEnergia(+1));
        btnEnergyDown?.addEventListener('click', () => cambiarEnergia(-1));

        // ── Carga y descarga ────────────────────────────────────────────
        btnCharge?.addEventListener('click', iniciarCarga);
        btnShock?.addEventListener('click', ejecutarShock);

        // ── SYNC ────────────────────────────────────────────────────────
        btnSync?.addEventListener('click', toggleSync);

        // ── PACER ───────────────────────────────────────────────────────
        btnPacer?.addEventListener('click', togglePacer);
        btnRateUp?.addEventListener('click', () => cambiarRate(+5));
        btnRateDown?.addEventListener('click', () => cambiarRate(-5));
        btnCurrentUp?.addEventListener('click', () => cambiarCurrent(+5));
        btnCurrentDown?.addEventListener('click', () => cambiarCurrent(-5));

        // ── PAUSE ───────────────────────────────────────────────────────
        btnPause?.addEventListener('click', togglePause);

        // ── ALARMS ──────────────────────────────────────────────────────
        btnAlarms?.addEventListener('click', () => {
            btnAlarms?.classList.toggle('active');
        });

        // ── Slider de resistencia ────────────────────────────────────────
        sliderR?.addEventListener('input', (e) => {
            estado.resistencia = parseInt(e.target.value);
            valorR && (valorR.textContent = `${estado.resistencia} Ω`);
            actualizarPanelEducativo();

            // Si hay resultados de descarga previos, redibujar con nueva R
            if (estado.resultadoDescarga && estado.Vc0 > 0) {
                const nuevo = simularDescarga(estado.Vc0, estado.resistencia);
                estado.resultadoDescarga = nuevo;
                animarCurvaDescarga(nuevo);
                actualizarStatsDescarga(nuevo);
            }
        });

        // ── Selector de caso clínico ─────────────────────────────────────
        btnCasos.forEach(btn => {
            btn.addEventListener('click', () => {
                btnCasos.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const nuevoCaso = btn.dataset.caso;
                estado.casoClinico = nuevoCaso;
                // Resetear contadores y timer al cambiar de caso manualmente
                estado.intentosShock = 0;
                detenerTimerDeterioro();
                ocultarTimerDeterioro();
                if (estado.encendido) {
                    actualizarEcgSegunCaso();
                    // Iniciar timer si el nuevo caso lo requiere
                    if (nuevoCaso === 'fv' || nuevoCaso === 'tv') {
                        iniciarTimerDeterioro();
                    }
                }
            });
        });

        // ── Toggle de consola ────────────────────────────────────────────
        btnConsoleToggle?.addEventListener('click', () => {
            consoleBody?.classList.toggle('collapsed');
            btnConsoleToggle && (btnConsoleToggle.textContent =
                consoleBody?.classList.contains('collapsed') ? '▲' : '▼');
        });

        // ── Controles de Vista de Descarga ───────────────────────────────
        radiosView.forEach(radio => {
            radio.addEventListener('change', (e) => {
                estado.vistaDescarga = e.target.value;
                // Si hay descarga calculada, redibujar sin animar
                if (estado.resultadoDescarga && estado.Vc0 > 0) {
                    animarCurvaDescarga(estado.resultadoDescarga, false);
                }
            });
        });

        // ── Tooltips interactivos en Gráficas ────────────────────────────
        if (canvasCarga) {
            canvasCarga.addEventListener('mousemove', (e) => manejarTooltipCarga(e));
            canvasCarga.addEventListener('mouseleave', ocultarTooltip);
        }
        if (canvasDescarga) {
            canvasDescarga.addEventListener('mousemove', (e) => manejarTooltipDescarga(e));
            canvasDescarga.addEventListener('mouseleave', ocultarTooltip);
        }
    }


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 5: LÓGICA DEL SISTEMA
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Enciende o apaga el sistema del desfibrilador.
     */
    function toggleEncendido() {
        estado.encendido = !estado.encendido;

        if (estado.encendido) {
            // ── ENCENDER ────────────────────────────────────────────────
            ledOn?.classList.add('active');
            btnOn?.classList.add('active');
            document.getElementById('status-dot')?.classList.add('active');
            const statusText = document.getElementById('status-text');
            if (statusText) statusText.textContent = 'SISTEMA ENCENDIDO';
            btnCharge?.removeAttribute('disabled');
            btnCharge?.classList.remove('disabled');
            setMonitorMsg('LISTO — SELECCIONE ENERGÍA Y CARGUE', 'ok');
            iniciarEcgAnimacion();
            // Iniciar timer de deterioro solo si el caso es de emergencia
            if (estado.casoClinico === 'fv' || estado.casoClinico === 'tv') {
                iniciarTimerDeterioro();
            }
            log(`// Sistema encendido.\n// Energía: ${joulesToActuales()}J | Resistencia: ${estado.resistencia}Ω\n`);
        } else {
            // ── APAGAR ──────────────────────────────────────────────────
            ledOn?.classList.remove('active');
            btnOn?.classList.remove('active');
            document.getElementById('status-dot')?.classList.remove('active');
            const statusText2 = document.getElementById('status-text');
            if (statusText2) statusText2.textContent = 'SISTEMA APAGADO';
            btnCharge?.setAttribute('disabled', true);
            btnCharge?.classList.add('disabled');
            btnShock?.setAttribute('disabled', true);
            btnShock?.classList.add('disabled');
            cancelarCarga();
            detenerEcgAnimacion();
            detenerTimerDeterioro();
            if (window.AudioEngine) window.AudioEngine.stopCharge();
            estado.cargado = false;
            estado.cargando = false;
            estado.porcentajeCarga = 0;
            actualizarBarraCarga(0);
            setMonitorMsg('SISTEMA APAGADO', 'off');
            dibujarEcgApagado(ctxECG, canvasECG);
            ocultarTimerDeterioro();
            log('// Sistema apagado.\n');
        }
    }

    /**
     * Cambia el nivel de energía seleccionado.
     * @param {number} dir - +1 para subir, -1 para bajar
     */
    function cambiarEnergia(dir) {
        if (!estado.encendido || estado.cargando) return;

        // Cancelar la carga anterior si ya había
        if (estado.cargado) {
            estado.cargado = false;
            estado.porcentajeCarga = 0;
            actualizarBarraCarga(0);
            btnShock?.setAttribute('disabled', true);
            btnShock?.classList.add('disabled');
            setMonitorMsg('ENERGÍA CAMBIADA — RECARGUE', 'warning');
            if (window.AudioEngine) window.AudioEngine.stopCharge();
        }

        estado.idxEnergia = Math.max(0,
            Math.min(NIVELES_ENERGIA.length - 1, estado.idxEnergia + dir));
        actualizarDisplays();
        actualizarPanelEducativo();
    }

    /**
     * Inicia el proceso de carga del capacitor.
     * El capacitor inicia en 0V y se carga hasta V₀ mediante RK4.
     */
    function iniciarCarga() {
        if (!estado.encendido || estado.cargando || estado.cargado) return;

        estado.cargando = true;
        estado.cargado = false;
        estado.porcentajeCarga = 0;

        const joules = joulesToActuales();
        setMonitorMsg(`CARGANDO... ${joules}J`, 'charging');
        log(`\n// ═══ INICIANDO CARGA DEL CAPACITOR ═══\n`);
        log(`// Energía objetivo: ${joules} J\n`);
        log(`// Voltaje objetivo: V₀ = √(2×${joules}/C) = ${calcularVoltajeInicial(joules).toFixed(1)} V\n`);
        log(`// El capacitor inicia DESCARGADO (Vc = 0V). Ejecutando RK4...\n`);

        // ── Ejecutar RK4 para la carga (instantáneo, se precomputan todos los puntos)
        const resultado = simularCarga(joules, C_DEFIB);
        estado.resultadoCarga = resultado;

        log(`// RK4 completado: ${resultado.puntos.length} pasos calculados.\n`);
        log(`// Vtarget = ${resultado.Vtarget.toFixed(2)} V | τ = ${resultado.tiempoTotal / 5}s\n`);

        // Actualizar stats de la gráfica
        if (statVfinal) statVfinal.textContent = `${resultado.Vtarget.toFixed(0)} V`;
        if (statT99) statT99.textContent = `${(resultado.tiempoTotal * 0.6).toFixed(2)} s`;

        if (window.AudioEngine) window.AudioEngine.startCharge(resultado.tiempoTotal * 0.6);

        // ── Animar la curva de carga y la barra de progreso ─────────────
        animarCurvaCarga(resultado, () => {
            // Callback: carga completada
            estado.cargando = false;
            estado.cargado = true;
            estado.porcentajeCarga = 100;
            estado.Vc0 = resultado.Vtarget;

            actualizarBarraCarga(100);
            btnShock?.removeAttribute('disabled');
            btnShock?.classList.remove('disabled');
            btnShock?.classList.add('ready');
            setMonitorMsg('⚡ LISTO PARA SHOCK — PRESIONE SHOCK', 'ready');
            if (window.AudioEngine) window.AudioEngine.playReadyTone();
            log(`\n// ✅ CARGA COMPLETA: Vc = ${resultado.Vtarget.toFixed(2)} V\n`);
            log(`// Presiona SHOCK para ejecutar la descarga bifásica.\n`);
        });
    }

    /**
     * Ejecuta la descarga del desfibrilador (SHOCK).
     * El capacitor cargado descarga su energía a través del paciente.
     * La curva resultante se calcula con RK4 y se muestra en el gráfico.
     */
    function ejecutarShock() {
        if (!estado.encendido || !estado.cargado || estado.cargando) return;

        const joules = joulesToActuales();
        const R = estado.resistencia;

        setMonitorMsg('⚡⚡⚡ DESCARGANDO ⚡⚡⚡', 'shock');
        log(`\n// ═══ EJECUTANDO SHOCK — DESCARGA BIFÁSICA ═══\n`);
        log(`// Vc₀ = ${estado.Vc0.toFixed(2)} V | R = ${R} Ω\n`);
        log(`// Ejecutando RK4 para EDO de 2° orden: L·q″ + R·q′ + q/C = 0\n`);

        // Efecto visual de flash en el monitor
        canvasECG?.classList.add('shock-flash');
        setTimeout(() => canvasECG?.classList.remove('shock-flash'), 300);
        if (window.AudioEngine) window.AudioEngine.playShock();

        // ── Ejecutar RK4 para la descarga (instantáneo)
        const resultado = simularDescarga(estado.Vc0, R);
        estado.resultadoDescarga = resultado;

        log(`// Amortiguamiento: ${resultado.amortiguamiento.tipo}\n`);
        log(`// α = ${resultado.amortiguamiento.alpha.toFixed(2)} rad/s | ω₀ = ${resultado.amortiguamiento.omega0.toFixed(2)} rad/s\n`);
        log(`// Ipico = ${resultado.Ipico.toFixed(2)} A | Vpico = ${resultado.Vpico.toFixed(2)} V\n`);
        log(`// Energía entregada al paciente = ${resultado.energiaEntregada.toFixed(2)} J\n`);

        // Reporte completo de verificación académica
        setTimeout(() => {
            try {
                log('\n' + generarReporteVerificacion(joules, R));
            } catch (e) {
                console.error("Error en generarReporteVerificacion:", e);
                log('\n// [ERROR] Falla al generar reporte: ' + e.message + '\n');
            }
        }, 500);

        // Animar la curva de descarga
        animarCurvaDescarga(resultado);
        actualizarStatsDescarga(resultado);

        // Registrar tiempo del shock para el artefacto en el ECG
        estado.tiempoUltimoShock = estado.tiempoEcg;

        // ── LÓGICA CLÍNICA DE DESFIBRILACIÓN (con probabilidad y validación) ──
        setTimeout(() => {
            try {
                let mensajeResultado = 'SHOCK ENTREGADO';
                let tipoMensaje = 'ok';
                let shockExitoso = false;

                if (estado.casoClinico === 'asistolia') {
                    // Asistolia: shock no indicado
                    mensajeResultado = 'ASISTOLIA — SHOCK NO INDICADO. USE RCP.';
                    tipoMensaje = 'warning';

                } else if (estado.casoClinico === 'fv') {
                    // ── FV: requiere ≥120J para tener probabilidad de éxito ──
                    if (joules < 120) {
                        mensajeResultado = `ENERGÍA INSUFICIENTE (${joules}J) — MÍNIMO 120J PARA FV`;
                        tipoMensaje = 'warning';
                        // Shock inefectivo acelera deterioro
                        reducirTiempoDeterioro(15);
                    } else {
                        // Probabilidad de éxito según energía
                        // ⚠️ PROBABILIDADES AJUSTABLES: cambia los valores numéricos aquí
                        const prob = joules >= 200 ? 0.85 : 0.60; // 85% con ≥200J, 60% con 120-199J
                        shockExitoso = (Math.random() < prob);

                        if (shockExitoso) {
                            estado.casoClinico = 'normal';
                            estado.intentosShock = 0;
                            mensajeResultado = '✅ RITMO NORMAL RESTAURADO';
                            detenerTimerDeterioro();
                            ocultarTimerDeterioro();
                            document.querySelectorAll('.btn-caso').forEach(b => b.classList.remove('active'));
                            log(`// ✅ CARDIOVERSIÓN EXITOSA tras ${estado.intentosShock + 1} intento(s).\n`);
                        } else {
                            estado.intentosShock++;
                            mensajeResultado = `SIN RESPUESTA (intento ${estado.intentosShock}) — REINTENTE O AUMENTE ENERGÍA`;
                            tipoMensaje = 'warning';
                            reducirTiempoDeterioro(10); // Cada fallo acorta el tiempo restante
                            log(`// ⚠️ Shock sin respuesta. Intento #${estado.intentosShock}. Reintente.\n`);
                        }
                    }

                } else if (estado.casoClinico === 'tv') {
                    if (!estado.sincronizado) {
                        // Shock NO sincronizado en TV → deteriora a FV (comportamiento real)
                        estado.casoClinico = 'fv';
                        estado.intentosShock = 0;
                        mensajeResultado = '⚠️ DETERIORO A FV — ACTIVE SYNC ANTES DEL SHOCK';
                        tipoMensaje = 'warning';
                        document.querySelectorAll('.btn-caso').forEach(b => b.classList.remove('active'));
                        document.getElementById('caso-fv')?.classList.add('active');
                        log('// ⚠️ TV sin SYNC → Fibrilación Ventricular. Active SYNC para cardiovertir TV.\n');
                    } else {
                        // ── TV + SYNC: requiere ≥120J (cardioversión sincronizada) ──
                        if (joules < 120) {
                            mensajeResultado = `ENERGÍA INSUFICIENTE (${joules}J) — MÍNIMO 120J PARA CARDIOVERSIÓN SINCRONIZADA`;
                            tipoMensaje = 'warning';
                            reducirTiempoDeterioro(15);
                            log(`// ⚠️ Cardioversión rechazada: ${joules}J insuficientes. Se requieren ≥120J.\n`);
                        } else {
                            // Probabilidad de éxito para TV+SYNC
                            // ⚠️ PROBABILIDADES AJUSTABLES: cambia los valores numéricos aquí
                            const prob = joules >= 150 ? 0.90 : 0.70; // 90% con ≥150J, 70% con 120-149J
                            shockExitoso = (Math.random() < prob);

                            if (shockExitoso) {
                                estado.casoClinico = 'normal';
                                estado.intentosShock = 0;
                                mensajeResultado = '✅ CARDIOVERSIÓN EXITOSA — RITMO SINUSAL';
                                // Desactivar SYNC después del shock exitoso
                                estado.sincronizado = false;
                                ledSync?.classList.remove('active');
                                btnSync?.classList.remove('active');
                                detenerTimerDeterioro();
                                ocultarTimerDeterioro();
                                document.querySelectorAll('.btn-caso').forEach(b => b.classList.remove('active'));
                                log(`// ✅ Cardioversión sincronizada exitosa tras ${estado.intentosShock + 1} intento(s).\n`);
                            } else {
                                estado.intentosShock++;
                                mensajeResultado = `SIN RESPUESTA (intento ${estado.intentosShock}) — REINTENTE`;
                                tipoMensaje = 'warning';
                                reducirTiempoDeterioro(10);
                                // El SYNC se mantiene activo para el reintento
                                log(`// ⚠️ Shock sin respuesta. Intento #${estado.intentosShock}. SYNC sigue activo.\n`);
                            }
                        }
                    }

                } else if (estado.casoClinico === 'brad' || estado.casoClinico === 'normal') {
                    mensajeResultado = 'SHOCK NO INDICADO EN ESTE RITMO';
                    tipoMensaje = 'warning';
                }

                // Actualizar el generador de señales con el nuevo ritmo si cambió
                actualizarEcgSegunCaso();
                setMonitorMsg(mensajeResultado, tipoMensaje);
                if (tipoMensaje === 'warning' && window.AudioEngine) {
                    window.AudioEngine.playAlarm();
                }
            } catch (e) {
                console.error("Error en logica clinica SHOCK:", e);
                log('\n// [ERROR] Excepción en la evaluación del shock: ' + e.message + '\n');
            }
        }, 800);

        // Actualizar estado del sistema
        estado.cargado = false;
        estado.porcentajeCarga = 0;
        actualizarBarraCarga(0);
        btnShock?.setAttribute('disabled', true);
        btnShock?.classList.remove('ready');
        btnShock?.classList.add('disabled');
    }

    /**
     * Cancela el proceso de carga en curso.
     */
    function cancelarCarga() {
        if (estado.animIdCarga) {
            cancelAnimationFrame(estado.animIdCarga);
            estado.animIdCarga = null;
        }
        estado.cargando = false;
    }

    function toggleSync() {
        if (!estado.encendido) return;
        estado.sincronizado = !estado.sincronizado;
        ledSync?.classList.toggle('active', estado.sincronizado);
        btnSync?.classList.toggle('active', estado.sincronizado);
        if (estado.sincronizado && estado.casoClinico === 'tv') {
            log(`// SYNC ACTIVADO — Listo para cardioversión sincronizada (mínimo 120J).\n`);
        } else {
            log(`// SYNC: ${estado.sincronizado ? 'ACTIVADO' : 'DESACTIVADO'}\n`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  TIMER DE DETERIORO CLÍNICO → ASISTOLIA
    //  Cuando el paciente tiene FV o TV y no se logra reanimar a tiempo,
    //  el corazón entra en asistolia (línea plana).
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Inicia el timer de deterioro clínico.
     * ⚠️ El tiempo total se controla con TIEMPO_DETERIORO_SEG (definido al inicio del archivo).
     */
    function iniciarTimerDeterioro() {
        if (estado.deterioroActivo) return; // Evitar doble inicio
        estado.tiempoRestante = TIEMPO_DETERIORO_SEG;
        estado.deterioroActivo = true;
        actualizarVistaTimer();

        estado.timerDeterioro = setInterval(function () {
            if (!estado.encendido || !estado.deterioroActivo) {
                detenerTimerDeterioro();
                return;
            }
            // Solo cuenta regresiva si el caso es FV o TV
            if (estado.casoClinico !== 'fv' && estado.casoClinico !== 'tv') {
                return;
            }
            estado.tiempoRestante--;
            actualizarVistaTimer();

            if (estado.tiempoRestante <= 0) {
                transicionarAsistolia();
            }
        }, 1000);

        log(`// ⏱️ Timer de deterioro iniciado: ${TIEMPO_DETERIORO_SEG}s antes de asistolia.\n`);
        log(`// (Cada shock fallido reduce 10s, energía insuficiente reduce 15s)\n`);
    }

    /**
     * Detiene el timer de deterioro.
     */
    function detenerTimerDeterioro() {
        if (estado.timerDeterioro) {
            clearInterval(estado.timerDeterioro);
            estado.timerDeterioro = null;
        }
        estado.deterioroActivo = false;
    }

    /**
     * Reduce el tiempo restante antes de asistolia (por shock fallido o energía insuf).
     * @param {number} segundos - Cantidad de segundos a reducir
     */
    function reducirTiempoDeterioro(segundos) {
        if (!estado.deterioroActivo) return;
        estado.tiempoRestante = Math.max(0, estado.tiempoRestante - segundos);
        actualizarVistaTimer();
        log(`// ⏱️ Tiempo de deterioro reducido en ${segundos}s → ${estado.tiempoRestante}s restantes.\n`);
        if (estado.tiempoRestante <= 0) {
            transicionarAsistolia();
        }
    }

    /**
     * Transición definitiva a asistolia: línea plana.
     */
    function transicionarAsistolia() {
        detenerTimerDeterioro();
        estado.casoClinico = 'asistolia';
        estado.intentosShock = 0;

        // Efecto visual severo en el monitor
        canvasECG?.classList.add('shock-flash');
        setTimeout(() => canvasECG?.classList.remove('shock-flash'), 500);

        // Actualizar botones del caso
        document.querySelectorAll('.btn-caso').forEach(b => b.classList.remove('active'));

        setMonitorMsg('🔴 ASISTOLIA — LÍNEA PLANA — USE RCP', 'shock');
        ocultarTimerDeterioro();
        actualizarEcgSegunCaso();

        // Sonido de flatline
        if (window.AudioEngine) {
            window.AudioEngine.playAlarm();
            setTimeout(() => window.AudioEngine.playFlatline(), 700);
        }

        log('\n// ══════════════════════════════════════════════════════════\n');
        log('// ⚠️  ASISTOLIA — El paciente entró en asistolia.\n');
        log('// ⚠️  El shock no está indicado en asistolia.\n');
        log('// ⚠️  Seleccione un nuevo caso clínico para reiniciar.\n');
        log('// ══════════════════════════════════════════════════════════\n');
    }

    /**
     * Actualiza el indicador visual del timer en el monitor.
     */
    function actualizarVistaTimer() {
        const timerEl = document.getElementById('deterioro-timer');
        if (!timerEl) return;
        if (!estado.deterioroActivo || (estado.casoClinico !== 'fv' && estado.casoClinico !== 'tv')) {
            timerEl.style.display = 'none';
            return;
        }
        timerEl.style.display = 'inline-flex';
        const seg = estado.tiempoRestante;
        const color = seg > 30 ? '#FFD700' : seg > 10 ? '#FF6B00' : '#FF0000';
        timerEl.style.color = color;
        timerEl.innerHTML = `⏱️ DETERIORO: <b>${seg}s</b>`;
        if (seg <= 10) {
            timerEl.classList.add('timer-critico');
        } else {
            timerEl.classList.remove('timer-critico');
        }
    }

    /**
     * Oculta el indicador del timer.
     */
    function ocultarTimerDeterioro() {
        const timerEl = document.getElementById('deterioro-timer');
        if (timerEl) {
            timerEl.style.display = 'none';
            timerEl.classList.remove('timer-critico');
        }
    }

    function togglePacer() {
        if (!estado.encendido) return;
        estado.marcapasos = !estado.marcapasos;
        ledPacer?.classList.toggle('active', estado.marcapasos);
        btnPacer?.classList.toggle('active', estado.marcapasos);
        if (pacerInfo) pacerInfo.style.display = estado.marcapasos ? 'flex' : 'none';
        log(`// PACER: ${estado.marcapasos ? 'ACTIVADO' : 'DESACTIVADO'} | ${estado.ratePPM} PPM | ${estado.currentMA} mA\n`);
    }

    function togglePause() {
        if (!estado.encendido) return;
        if (estado.ecgAnimId) {
            detenerEcgAnimacion();
            setMonitorMsg('ECG PAUSADO', 'warning');
        } else {
            iniciarEcgAnimacion();
            setMonitorMsg('LISTO', 'ok');
        }
    }

    function cambiarRate(delta) {
        estado.ratePPM = Math.max(30, Math.min(200, estado.ratePPM + delta));
        if (displayRate) displayRate.textContent = estado.ratePPM;
        if (displayPPM) displayPPM.textContent = estado.ratePPM;
    }

    function cambiarCurrent(delta) {
        estado.currentMA = Math.max(10, Math.min(200, estado.currentMA + delta));
        if (displayMA) displayMA.textContent = estado.currentMA;
        if (displayMaP) displayMaP.textContent = estado.currentMA;
    }


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 6: ANIMACIÓN DEL ECG (Placeholder — Fase 1)
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Inicia la animación del ECG con scroll continuo.
     * En Fase 1: solo muestra un placeholder según el caso seleccionado.
     * En Fase 2: se reemplaza por el simulador ECG completo.
     */
    function iniciarEcgAnimacion() {
        if (estado.ecgAnimId) return;
        actualizarEcgSegunCaso();
    }

    function detenerEcgAnimacion() {
        if (estado.ecgAnimId) {
            cancelAnimationFrame(estado.ecgAnimId);
            estado.ecgAnimId = null;
        }
    }

    function actualizarEcgSegunCaso() {
        detenerEcgAnimacion();
        if (!estado.encendido) return;

        function señalEcg(t) {
            // Calcular tiempo post-shock (si hubo un shock reciente)
            let artefacto = 0;
            if (estado.tiempoUltimoShock !== undefined) {
                const tPostShock = t - estado.tiempoUltimoShock;
                if (tPostShock >= 0 && tPostShock < 1.0) {
                    artefacto = window.ECGSim.artefactoShock(tPostShock);
                }
            }

            let baseSenal = 0;

            switch (estado.casoClinico) {
                case 'fv':
                    baseSenal = window.ECGSim.fv(t);
                    break;
                case 'tv':
                    baseSenal = window.ECGSim.tv(t);
                    break;
                case 'brad':
                    // Si el marcapasos está activo y la corriente > umbral (ej: 50mA), captura el ritmo
                    if (estado.marcapasos && estado.currentMA >= 50) {
                        baseSenal = window.ECGSim.marcapasos(t, estado.ratePPM);
                    } else {
                        baseSenal = window.ECGSim.brad(t);
                    }
                    break;
                case 'asistolia':
                    baseSenal = window.ECGSim.asistolia(t);
                    break;
                case 'normal':
                default:
                    baseSenal = window.ECGSim.normal(t);
                    break;
            }

            return baseSenal + artefacto;
        }

        // ── Calcular HR según el caso ────────────────────────────────────
        const hrSegunCaso = { fv: '---', tv: '180', brad: '30', normal: '72', asistolia: '0' };
        const hrDisplay = hrSegunCaso[estado.casoClinico] || '72';
        if (displayHR) displayHR.textContent = hrDisplay;

        // ── Bucle de animación continua ──────────────────────────────────
        const velocidadEcg = 0.04; // segundos de señal por frame

        function animarEcg() {
            if (!ctxECG || !canvasECG) return;
            const W = canvasECG.width;
            const H = canvasECG.height;
            const cy = H / 2;
            const amp = H * 0.38;

            // Desplazar el buffer (scroll effect)
            const imageData = ctxECG.getImageData(3, 0, W - 3, H);
            ctxECG.putImageData(imageData, 0, 0);

            // Borrar el extremo derecho
            ctxECG.fillStyle = '#000000';
            ctxECG.fillRect(W - 4, 0, 4, H);

            // Dibujar nuevo punto de señal
            const y_actual = señalEcg(estado.tiempoEcg);
            const y_prev = señalEcg(estado.tiempoEcg - velocidadEcg);
            const yPx_act = cy - y_actual * amp;
            const yPx_prev = cy - y_prev * amp;

            ctxECG.beginPath();
            ctxECG.moveTo(W - 4, yPx_prev);
            ctxECG.lineTo(W - 1, yPx_act);
            ctxECG.strokeStyle = '#00FF7F';
            ctxECG.lineWidth = 2;
            ctxECG.shadowColor = '#00FF7F';
            ctxECG.shadowBlur = 6;
            ctxECG.stroke();

            // Detectar QRS para el pitido (cuando cruza cierto umbral hacia arriba)
            if (window.AudioEngine && ['normal', 'brad', 'marcapasos'].includes(estado.casoClinico)) {
                // Evitar pitar por culpa del ruido masivo del shock
                const tPostShock = estado.tiempoUltimoShock !== undefined ? estado.tiempoEcg - estado.tiempoUltimoShock : 999;
                const enShock = (tPostShock >= 0 && tPostShock < 0.2);

                if (y_actual > 0.8 && y_prev <= 0.8 && !enShock) {
                    window.AudioEngine.playQRSBeep();
                }
            }

            estado.tiempoEcg += velocidadEcg;
            estado.ecgAnimId = requestAnimationFrame(animarEcg);
        }

        animarEcg();
    }


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 7: DIBUJO DE CANVAS — CURVAS RLC
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Dibuja los ejes, grilla y etiquetas de un canvas de gráfica.
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement} canvas
     * @param {Object} config - {xLabel, yLabel, xMax, yMax, yMin}
     */
    function dibujarEjes(ctx, canvas, config) {
        const W = canvas.width;
        const H = canvas.height;
        const pad = { top: 15, right: 15, bottom: 35, left: 55 };
        const aW = W - pad.left - pad.right;
        const aH = H - pad.top - pad.bottom;

        // Fondo
        ctx.fillStyle = '#0D1117';
        ctx.fillRect(0, 0, W, H);

        // Grilla
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const x = pad.left + (aW / 5) * i;
            const y = pad.top + (aH / 4) * i;
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + aH); ctx.stroke();
            if (i <= 4) { ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + aW, y); ctx.stroke(); }
        }

        // Ejes
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top);
        ctx.lineTo(pad.left, pad.top + aH);
        ctx.lineTo(pad.left + aW, pad.top + aH);
        ctx.stroke();

        // Etiqueta X
        ctx.fillStyle = '#8888AA';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(config.xLabel, pad.left + aW / 2, H - 2);

        // Etiqueta Y
        ctx.save();
        ctx.translate(12, pad.top + aH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(config.yLabel, 0, 0);
        ctx.restore();

        // Valores en ejes
        ctx.textAlign = 'right';
        ctx.fillStyle = '#6A6A8A';
        ctx.font = '9px Share Tech Mono, monospace';

        // Eje Y: 5 ticks
        for (let i = 0; i <= 4; i++) {
            const val = config.yMin + (config.yMax - config.yMin) * (1 - i / 4);
            const y = pad.top + (aH / 4) * i;
            ctx.fillText(formatVal(val, config.yLabel), pad.left - 4, y + 3);
        }

        // Eje X: 6 ticks
        ctx.textAlign = 'center';
        for (let i = 0; i <= 5; i++) {
            const val = config.xMax * i / 5;
            const x = pad.left + (aW / 5) * i;
            ctx.fillText(formatVal(val, config.xLabel), x, pad.top + aH + 14);
        }

        return { pad, aW, aH };
    }

    function formatVal(val, label) {
        if (label.includes('ms')) return (val * 1000).toFixed(1);
        if (label.includes('s')) return val.toFixed(2);
        if (label.includes('kV')) return (val / 1000).toFixed(1);
        if (label.includes('A')) return val.toFixed(0);
        return val.toFixed(0);
    }

    /**
     * Dibuja un canvas vacío con un mensaje de espera.
     */
    function dibujarCanvasVacio(ctx, canvas, mensaje) {
        if (!ctx || !canvas) return;
        ctx.fillStyle = '#0D1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
        ctx.fillStyle = '#3A3A5A';
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(mensaje, canvas.width / 2, canvas.height / 2);
    }

    /**
     * Dibuja el monitor ECG en estado apagado.
     */
    function dibujarEcgApagado(ctx, canvas) {
        if (!ctx || !canvas) return;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Línea plana de referencia
        ctx.strokeStyle = '#1A3A1A';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        ctx.fillStyle = '#1A3A1A';
        ctx.font = '14px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SISTEMA APAGADO', canvas.width / 2, canvas.height / 2 - 20);
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText('Presiona ON para iniciar', canvas.width / 2, canvas.height / 2 + 15);
    }

    /**
     * Anima la curva de CARGA del capacitor.
     * Dibuja los puntos progresivamente mientras la barra de progreso avanza.
     *
     * @param {{puntos, Vtarget, tiempoTotal}} resultado
     * @param {Function} onComplete - Callback al terminar la animación
     */
    function animarCurvaCarga(resultado, onComplete) {
        if (!ctxCarga || !canvasCarga) return;

        const { puntos, Vtarget, tiempoTotal } = resultado;
        const W = canvasCarga.width;
        const H = canvasCarga.height;

        // Configurar los ejes
        const { pad, aW, aH } = dibujarEjes(ctxCarga, canvasCarga, {
            xLabel: 't [s]', yLabel: 'Vc [V]',
            xMax: tiempoTotal, yMax: Vtarget * 1.05, yMin: 0
        });

        // Dibujar línea de voltaje objetivo (referencia)
        const yTarget = pad.top + aH - (Vtarget / (Vtarget * 1.05)) * aH;
        ctxCarga.setLineDash([4, 4]);
        ctxCarga.strokeStyle = '#FFD700';
        ctxCarga.lineWidth = 1;
        ctxCarga.beginPath();
        ctxCarga.moveTo(pad.left, yTarget);
        ctxCarga.lineTo(pad.left + aW, yTarget);
        ctxCarga.stroke();
        ctxCarga.setLineDash([]);
        ctxCarga.fillStyle = '#FFD700';
        ctxCarga.font = '9px Share Tech Mono, monospace';
        ctxCarga.textAlign = 'left';
        ctxCarga.fillText(`V₀ = ${Vtarget.toFixed(0)}V`, pad.left + aW - 80, yTarget - 3);

        // Duración real de la animación: 3.5 segundos independiente de la energía
        const DURACION_ANIM_MS = 3500;
        const startTime = performance.now();
        let idxActual = 0;

        function frame(now) {
            const progreso = Math.min((now - startTime) / DURACION_ANIM_MS, 1);
            const pctDisplay = Math.round(progreso * 100);

            // Avanzar hasta el índice correspondiente al progreso
            const idxTarget = Math.floor(progreso * (puntos.length - 1));

            // Dibujar segmento de la curva desde idxActual hasta idxTarget
            if (idxTarget > idxActual) {
                ctxCarga.beginPath();
                ctxCarga.strokeStyle = '#00FF7F';
                ctxCarga.lineWidth = 2;
                ctxCarga.shadowColor = '#00FF7F';
                ctxCarga.shadowBlur = 4;

                for (let i = idxActual; i <= idxTarget; i++) {
                    const p = puntos[i];
                    const x = pad.left + (p.t / tiempoTotal) * aW;
                    const y = pad.top + aH - (p.Vc / (Vtarget * 1.05)) * aH;
                    i === idxActual ? ctxCarga.moveTo(x, y) : ctxCarga.lineTo(x, y);
                }
                ctxCarga.stroke();
                idxActual = idxTarget;
            }

            // Actualizar barra de progreso
            actualizarBarraCarga(pctDisplay);

            if (progreso < 1) {
                estado.animIdCarga = requestAnimationFrame(frame);
            } else {
                // Curva completa
                estado.animIdCarga = null;
                actualizarBarraCarga(100);
                onComplete && onComplete();
            }
        }

        estado.animIdCarga = requestAnimationFrame(frame);
    }

    /**
     * Anima la curva de DESCARGA bifásica del desfibrilador.
     * Muestra la corriente I(t) y el voltaje Vc(t) vs tiempo.
     *
     * @param {{puntos, Ipico, Vpico, energiaEntregada}} resultado
     * @param {boolean} animado - Si es true, dibuja progresivamente. Si es false, dibuja de inmediato.
     */
    function animarCurvaDescarga(resultado, animado = true) {
        if (!ctxDescarga || !canvasDescarga) return;

        if (estado.animIdDescarga) {
            cancelAnimationFrame(estado.animIdDescarga);
            estado.animIdDescarga = null;
        }

        const { puntos, Ipico, Vpico } = resultado;
        if (!puntos || puntos.length === 0) return;

        const W = canvasDescarga.width;
        const H = canvasDescarga.height;
        const tMax = puntos[puntos.length - 1].t;

        // Calcular rangos dinámicos según la vista seleccionada
        const vista = estado.vistaDescarga;
        const maxAbs_I = Math.max(Ipico, 1);
        const maxAbs_Vc = Math.max(Vpico, 1);

        let maxAbs_Y, yLabel;
        if (vista === 'voltaje') {
            maxAbs_Y = maxAbs_Vc;
            yLabel = 'Vc [V]';
        } else {
            maxAbs_Y = maxAbs_I;
            yLabel = 'I [A]';
        }

        // Limpiar y dibujar ejes
        const { pad, aW, aH } = dibujarEjes(ctxDescarga, canvasDescarga, {
            xLabel: 't [ms]', yLabel: yLabel,
            xMax: tMax, yMax: maxAbs_Y, yMin: -maxAbs_Y * 0.7
        });

        const cy = pad.top + aH * (maxAbs_Y / (maxAbs_Y + maxAbs_Y * 0.7)); // Eje cero

        // Línea del cero
        ctxDescarga.strokeStyle = 'rgba(255,255,255,0.15)';
        ctxDescarga.lineWidth = 0.5;
        ctxDescarga.setLineDash([3, 3]);
        ctxDescarga.beginPath();
        ctxDescarga.moveTo(pad.left, cy);
        ctxDescarga.lineTo(pad.left + aW, cy);
        ctxDescarga.stroke();
        ctxDescarga.setLineDash([]);

        // Marcar fase bifásica
        const xFase = pad.left + (6e-3 / tMax) * aW;
        ctxDescarga.strokeStyle = 'rgba(255,215,0,0.3)';
        ctxDescarga.lineWidth = 1;
        ctxDescarga.setLineDash([2, 4]);
        ctxDescarga.beginPath();
        ctxDescarga.moveTo(xFase, pad.top);
        ctxDescarga.lineTo(xFase, pad.top + aH);
        ctxDescarga.stroke();
        ctxDescarga.setLineDash([]);
        ctxDescarga.fillStyle = 'rgba(255,215,0,0.6)';
        ctxDescarga.font = '8px Share Tech Mono, monospace';
        ctxDescarga.textAlign = 'center';
        ctxDescarga.fillText('Fase 2', xFase, pad.top + 10);

        // Función de coordenadas
        const toX = (t) => pad.left + (t / tMax) * aW;
        const toY = (val, max) => cy - (val / max) * (aH * maxAbs_Y / (maxAbs_Y + maxAbs_Y * 0.7));

        // Función para dibujar un segmento
        function dibujarSegmentos(idxActual, idxTarget) {
            if (idxTarget <= idxActual) return;

            // Dibujar corriente I(t)
            if (vista === 'ambas' || vista === 'corriente') {
                ctxDescarga.beginPath();
                ctxDescarga.strokeStyle = '#FF6B35';
                ctxDescarga.lineWidth = 2;
                ctxDescarga.shadowColor = '#FF6B35';
                ctxDescarga.shadowBlur = animado ? 3 : 0;
                for (let i = idxActual; i <= idxTarget; i++) {
                    const p = puntos[i];
                    const x = toX(p.t);
                    const y = toY(p.I, maxAbs_Y);
                    i === idxActual ? ctxDescarga.moveTo(x, y) : ctxDescarga.lineTo(x, y);
                }
                ctxDescarga.stroke();
            }

            // Dibujar voltaje Vc(t)
            if (vista === 'ambas' || vista === 'voltaje') {
                ctxDescarga.beginPath();
                ctxDescarga.strokeStyle = '#00BFFF';
                ctxDescarga.lineWidth = 1.5;
                ctxDescarga.shadowColor = '#00BFFF';
                ctxDescarga.shadowBlur = animado ? 3 : 0;
                for (let i = idxActual; i <= idxTarget; i++) {
                    const p = puntos[i];
                    const x = toX(p.t);
                    // Si es ambas, Vc se normaliza sobre I. Si es solo voltaje, usa su propio maxAbs_Y
                    const valY = vista === 'ambas' ? (p.Vc / maxAbs_Vc * maxAbs_I) : p.Vc;
                    const y = toY(valY, maxAbs_Y);
                    i === idxActual ? ctxDescarga.moveTo(x, y) : ctxDescarga.lineTo(x, y);
                }
                ctxDescarga.stroke();
            }
        }

        if (!animado) {
            dibujarSegmentos(0, puntos.length - 1);
            return;
        }

        // Animación de la curva
        const DURACION_MS = 800;
        const startTime = performance.now();
        let idxActual = 0;

        function frame(now) {
            try {
                const progreso = Math.min((now - startTime) / DURACION_MS, 1);
                const idxTarget = Math.floor(progreso * (puntos.length - 1));

                dibujarSegmentos(idxActual, idxTarget);
                idxActual = idxTarget;

                if (progreso < 1) {
                    estado.animIdDescarga = requestAnimationFrame(frame);
                } else {
                    ctxDescarga.shadowBlur = 0;
                    estado.animIdDescarga = null;
                }
            } catch (e) {
                console.error("Error en animarCurvaDescarga frame:", e);
                estado.animIdDescarga = null;
            }
        }

        estado.animIdDescarga = requestAnimationFrame(frame);
    }

    // ── Lógica de Tooltips Interactivos ──────────────────────────────────────────

    function mostrarTooltip(clientX, clientY, t, valores, unidadT = 'ms') {
        if (!chartTooltip || !tooltipTime || !tooltipValues) return;
        chartTooltip.style.display = 'block';

        const tFormatted = unidadT === 's' ? t.toFixed(3) : (t * 1000).toFixed(2);
        tooltipTime.textContent = `t: ${tFormatted} ${unidadT}`;

        tooltipValues.innerHTML = '';
        valores.forEach(v => {
            const div = document.createElement('div');
            div.style.color = v.color;
            div.textContent = `${v.label}: ${v.valor.toFixed(2)} ${v.unidad}`;
            tooltipValues.appendChild(div);
        });

        let left = clientX + 15;
        let top = clientY + 15;

        // Evitar que el tooltip se salga de la pantalla
        if (left + 140 > window.innerWidth) left = clientX - 140;
        if (top + 80 > window.innerHeight) top = clientY - 80;

        chartTooltip.style.left = left + 'px';
        chartTooltip.style.top = top + 'px';
    }

    function ocultarTooltip() {
        if (chartTooltip) chartTooltip.style.display = 'none';
    }

    function manejarTooltipCarga(e) {
        if (!estado.resultadoCarga || !estado.resultadoCarga.puntos.length) return;
        const rect = canvasCarga.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvasCarga.width / rect.width);

        const pad = { top: 15, right: 15, bottom: 35, left: 55 };
        const aW = canvasCarga.width - pad.left - pad.right;

        if (x < pad.left || x > canvasCarga.width - pad.right) {
            ocultarTooltip();
            return;
        }

        const { puntos, tiempoTotal } = estado.resultadoCarga;
        const tRaton = ((x - pad.left) / aW) * tiempoTotal;

        let puntoCercano = puntos[0];
        let minDiff = Infinity;
        for (let i = 0; i < puntos.length; i++) {
            const diff = Math.abs(puntos[i].t - tRaton);
            if (diff < minDiff) {
                minDiff = diff;
                puntoCercano = puntos[i];
            } else if (diff > minDiff) {
                break;
            }
        }

        mostrarTooltip(e.clientX, e.clientY, puntoCercano.t, [
            { label: 'Vc', valor: puntoCercano.Vc, unidad: 'V', color: '#00FF7F' }
        ], 's');
    }

    function manejarTooltipDescarga(e) {
        if (!estado.resultadoDescarga || !estado.resultadoDescarga.puntos.length) return;
        const rect = canvasDescarga.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvasDescarga.width / rect.width);

        const pad = { top: 15, right: 15, bottom: 35, left: 55 };
        const aW = canvasDescarga.width - pad.left - pad.right;

        if (x < pad.left || x > canvasDescarga.width - pad.right) {
            ocultarTooltip();
            return;
        }

        const { puntos } = estado.resultadoDescarga;
        const tMax = puntos[puntos.length - 1].t;
        const tRaton = ((x - pad.left) / aW) * tMax;

        let puntoCercano = puntos[0];
        let minDiff = Infinity;
        for (let i = 0; i < puntos.length; i++) {
            const diff = Math.abs(puntos[i].t - tRaton);
            if (diff < minDiff) {
                minDiff = diff;
                puntoCercano = puntos[i];
            } else if (diff > minDiff) {
                break;
            }
        }

        const valores = [];
        const vista = estado.vistaDescarga;

        if (vista === 'ambas' || vista === 'corriente') {
            valores.push({ label: 'I', valor: puntoCercano.I, unidad: 'A', color: '#FF6B35' });
        }
        if (vista === 'ambas' || vista === 'voltaje') {
            valores.push({ label: 'Vc', valor: puntoCercano.Vc, unidad: 'V', color: '#00BFFF' });
        }

        mostrarTooltip(e.clientX, e.clientY, puntoCercano.t, valores, 'ms');
    }

    function actualizarStatsDescarga(resultado) {
        if (statIpico) statIpico.textContent = `${resultado.Ipico.toFixed(1)} A`;
        if (statVpico) statVpico.textContent = `${resultado.Vpico.toFixed(0)} V`;
        if (statEentregada) statEentregada.textContent = `${resultado.energiaEntregada.toFixed(1)} J`;
    }


    // ══════════════════════════════════════════════════════════════════════
    //  SECCIÓN 8: ACTUALIZACIÓN DE DISPLAYS
    // ══════════════════════════════════════════════════════════════════════

    function actualizarDisplays() {
        const joules = joulesToActuales();
        if (displayEnergia) displayEnergia.textContent = `${joules} J`;
        // Actualizar el display digital de energía en el bloque de botones
        const energyDisplay = document.getElementById('energy-display');
        if (energyDisplay) energyDisplay.textContent = joules;
        if (paramE) paramE.textContent = `${joules} J`;
        const V0 = calcularVoltajeInicial(joules);
        if (paramV0) paramV0.textContent = `${V0.toFixed(0)} V`;
    }

    function actualizarPanelEducativo() {
        const R = estado.resistencia;
        const joules = joulesToActuales();
        const V0 = calcularVoltajeInicial(joules);
        const am = analizarAmortiguamiento(R);

        if (paramR) paramR.textContent = `${R} Ω`;
        if (paramL) paramL.textContent = `${(L_DEFIB * 1000).toFixed(0)} mH`;
        if (paramC) paramC.textContent = `${(C_DEFIB * 1e6).toFixed(0)} µF`;
        if (paramE) paramE.textContent = `${joules} J`;
        if (paramV0) paramV0.textContent = `${V0.toFixed(0)} V`;

        if (amortValor) {
            amortValor.textContent = `Δ = ${am.delta.toFixed(0)} | α=${am.alpha.toFixed(0)} | ω₀=${am.omega0.toFixed(0)} rad/s`;
        }

        const tiposUI = {
            'SUBAMORTIGUADO': { label: '🌀 SUBAMORTIGUADO', color: '#4FC3F7' },
            'CRÍTICAMENTE_AMORTIGUADO': { label: '✅ CRÍTICAMENTE AMORTIGUADO', color: '#81C784' },
            'SOBREAMORTIGUADO': { label: '📉 SOBREAMORTIGUADO', color: '#FFB74D' }
        };
        const info = tiposUI[am.tipo] || { label: am.tipo, color: '#888' };
        if (amortTipo) {
            amortTipo.textContent = info.label;
            amortTipo.style.color = info.color;
        }

        if (edoSustituida) {
            edoSustituida.textContent =
                `${(L_DEFIB * 1000).toFixed(0)}m·q″ + ${R}·q′ + ${(1 / C_DEFIB).toFixed(0)}·q = 0`;
        }
    }

    function actualizarBarraCarga(pct) {
        if (chargeBar) {
            chargeBar.style.width = `${pct}%`;
            // Color gradiente según el nivel
            if (pct < 50) chargeBar.style.background = 'linear-gradient(90deg, #1AAD19, #7DC21C)';
            else if (pct < 85) chargeBar.style.background = 'linear-gradient(90deg, #7DC21C, #FFD700)';
            else chargeBar.style.background = 'linear-gradient(90deg, #FFD700, #FF4500)';
        }
        if (chargePct) chargePct.textContent = `${pct}%`;
    }

    function setMonitorMsg(msg, tipo = 'ok') {
        if (!monitorMsg) return;
        monitorMsg.textContent = msg;
        monitorMsg.className = 'status-msg';
        monitorMsg.classList.add(`msg-${tipo}`);
    }

    /**
     * Actualiza el reloj del monitor en tiempo real.
     */
    function iniciarReloj() {
        function tick() {
            if (displayHora) {
                const ahora = new Date();
                const h = String(ahora.getHours()).padStart(2, '0');
                const m = String(ahora.getMinutes()).padStart(2, '0');
                const s = String(ahora.getSeconds()).padStart(2, '0');
                displayHora.textContent = `${h}:${m}:${s}`;
            }
        }
        tick();
        setInterval(tick, 1000);
    }

    /**
     * Escribe un mensaje en la consola de verificación académica.
     * @param {string} msg
     */
    function log(msg) {
        if (!consoleOutput) return;
        consoleOutput.textContent += msg;
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    // ── Punto de entrada ──────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);

})();
