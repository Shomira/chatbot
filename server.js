const express = require('express');

const app = express();

app.use(express.json());

/* ======================================================
   CONFIGURACIÓN GENERAL
====================================================== */

// API KEY DE GEMINI (Coloca tu llave real de Google AI Studio aquí)
const GEMINI_API_KEY = 'AIzaSyAvpLx0FrJSORIfW-BIit6r7DQCT8qWCYk';

// MODELO GEMINI
const GEMINI_MODEL = 'gemini-2.5-flash';

// URL API GEMINI
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// PUERTO
const PORT = 3000;


/* ======================================================
   MEMORIA EN CACHÉ DEL SERVIDOR (HISTORIAL)
====================================================== */
const historiales = {};


/* ======================================================
   PROMPT DEL SISTEMA
====================================================== */

const PROMPT_SISTEMA = `
Eres el asistente virtual oficial de la cafetería “Café Central”.

Tu trabajo es atender clientes por WhatsApp y Dialogflow de manera amable, rápida y profesional.

========================
PERSONALIDAD
========================

- Habla siempre en español.
- Usa un tono cálido y amigable.
- Responde de forma natural.
- Máximo 2 o 3 oraciones por respuesta.
- Mantén respuestas cortas.
- Usa emojis moderadamente ☕😊
- Nunca respondas de manera robótica.

========================
MENÚ OFICIAL
========================

BEBIDAS:
- Espresso — $1.50
- Americano — $2.00
- Cappuccino — $2.50
- Latte — $2.70

COMIDA:
- Pastel de chocolate — $3.00
- Croissant — $2.00

OPCIONES DE LECHE:
- Entera
- Deslactosada
- Almendras (+$0.50)

========================
HORARIOS
========================

Lunes a Domingo:
08:00 AM - 09:00 PM

========================
UBICACIÓN
========================

Loja, Ecuador.

========================
REGLAS IMPORTANTES
========================

- NO inventes productos.
- NO inventes precios.
- NO inventes promociones.
- NO hables de temas fuera de la cafetería.
- Si no sabes algo, responde amablemente.

========================
PEDIDOS
========================

Si el cliente quiere ordenar:
- pregunta cantidades
- pregunta tipo de leche si aplica
- confirma el pedido

========================
RESERVAS
========================

Si el cliente quiere reservar:
Solicita:
- Nombre
- Fecha
- Hora
- Número de personas

========================
ESTILO
========================

Ejemplo:
Cliente: Hola
Respuesta:
¡Hola! ☕ Bienvenido a Café Central. ¿Qué deseas ordenar hoy?

Cliente: Quiero un latte
Respuesta:
¡Claro! ☕ El Latte cuesta $2.70. ¿Prefieres leche entera, deslactosada o almendras?
`;


/* ======================================================
   WEBHOOK DIALOGFLOW
====================================================== */

app.post('/webhook', async (req, res) => {

    try {

        // 1. EXTRAER EL MENSAJE Y EL ID ÚNICO DE SESIÓN DEL CLIENTE
        const mensajeUsuario = req.body.queryResult?.queryText || '';
        const sessionId = req.body.session || 'default_session';

        console.log('========================================');
        console.log(`SESIÓN ACTIVA: ${sessionId}`);
        console.log(`MENSAJE DEL CLIENTE: "${mensajeUsuario}"`);
        console.log('========================================');

        if (!mensajeUsuario || mensajeUsuario.trim() === '') {
            return res.json({ 
                fulfillmentText: '¡Hola! ☕ Bienvenido a Café Central, ¿en qué te puedo ayudar hoy?' 
            });
        }

        // 2. INICIALIZAR EL HISTORIAL DE LA SESIÓN SI NO EXISTE
        if (!historiales[sessionId]) {
            historiales[sessionId] = [];
        }

        // 3. AAÑADIR EL MENSAJE ACTUAL DEL USUARIO
        historiales[sessionId].push({
            role: 'user',
            parts: [{ text: mensajeUsuario }]
        });

        // 4. LIMPIADOR DE HISTORIAL (Garantiza alternancia estricta user -> model -> user)
        let historialLimpio = [];
        let ultimoRol = null;

        for (const mensaje of historiales[sessionId]) {
            if (mensaje.role !== ultimoRol) {
                historialLimpio.push(mensaje);
                ultimoRol = mensaje.role;
            }
        }

        // Validación de cierre: Asegura que el paquete enviado termine con el mensaje actual del usuario
        if (historialLimpio.length === 0 || historialLimpio[historialLimpio.length - 1].role !== 'user') {
            historialLimpio.push({
                role: 'user',
                parts: [{ text: mensajeUsuario }]
            });
        }

        // Limitamos el historial a los últimos 6 mensajes para mantener la estabilidad de los tokens
        if (historialLimpio.length > 6) {
            historialLimpio = historialLimpio.slice(-6);
        }

        // Sincronizamos la memoria local con el arreglo limpio
        historiales[sessionId] = historialLimpio;


        /* ==========================================
           PAYLOAD REESTRUCTURADO Y SEGURO
        ========================================== */

        const payload = {
            systemInstruction: {
                parts: [{ text: PROMPT_SISTEMA }]
            },
            contents: historialLimpio,
            generationConfig: {
                temperature: 0.4,
                topK: 32,
                topP: 0.9,
                maxOutputTokens: 120 
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };


        /* ==========================================
           PETICIÓN HTTP POST A GEMINI
        ========================================== */

        const response = await fetch(
            GEMINI_API_URL,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );


        /* ==========================================
           VALIDAR RESPUESTA HTTP
        ========================================== */

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ ERROR RESPUESTA API GEMINI (Estructura rechazada):');
            console.error(errorText);

            // En caso de error de sincronización, reseteamos el historial de esta sesión
            historiales[sessionId] = [];

            return res.json({
                fulfillmentText: 'Lo siento mucho ☕ Hubo un pequeño salto en la línea. ¿Me podrías repetir lo último?'
            });
        }


        /* ==========================================
           CONVERTIR JSON Y EXTRAER TEXTO GENERADO
        ========================================== */

        const data = await response.json();
        let textoRespuesta = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textoRespuesta) {
            console.warn('⚠️ Advertencia: Estructura vacía recibida en candidates.');
            textoRespuesta = '¡Claro que sí! ☕ ¿Qué te gustaría ordenar de nuestro menú hoy o deseas gestionar una reserva?';
        }


        /* ==========================================
           GUARDAR LA RESPUESTA DE LA IA EN EL HISTORIAL
        ========================================== */
        historiales[sessionId].push({
            role: 'model',
            parts: [{ text: textoRespuesta }]
        });


        /* ==========================================
           LOGS DE CONSOLA DE SALIDA
        ========================================== */

        console.log('========================================');
        console.log('RESPUESTA ENVIADA A DIALOGFLOW:');
        console.log(textoRespuesta);
        console.log('========================================');


        /* ==========================================
           RESPUESTA INTEGRADA A DIALOGFLOW ES
        ========================================== */

        return res.json({
            fulfillmentText: textoRespuesta
        });

    } catch (error) {

        console.error('❌ ERROR CRÍTICO GENERAL EN WEBHOOK:');
        console.error(error);

        return res.json({
            fulfillmentText: 'Lo siento ☕ Tuvimos un inconveniente en la barra de atención. ¿Podrías intentar nuevamente?'
        });

    }

});


/* ======================================================
   SERVIDOR PERMANENTE EXPRESS
====================================================== */

app.listen(PORT, '0.0.0.0', () => {

    console.log('==================================================');
    console.log('    CAFÉ CENTRAL BOT MULTI-TURNO ONLINE ☕');
    console.log(`    Puerto Local: http://localhost:${PORT}`);
    console.log(`    Modelo de IA: ${GEMINI_MODEL}`);
    console.log('    Servidor activo y recordando el historial...');
    console.log('==================================================');

});