const API_BASE_URL = "https://localhost:7248/api";

// ---------------- Utilidades ----------------

// tipo: 'error' (por defecto, rojo), 'exito' (verde) o 'info' (dorado)
function mostrarAlerta(mensaje, tipo = 'error') {
    const box = document.getElementById('alertaBox');
    if (box) {
        box.textContent = mensaje;
        box.classList.remove('exito', 'info');
        if (tipo !== 'error') box.classList.add(tipo);
        box.hidden = false;
        box.style.display = 'block';
    } else {
        alert(mensaje);
    }
}

function ocultarAlerta() {
    const box = document.getElementById('alertaBox');
    if (box) {
        box.textContent = '';
        box.classList.remove('exito', 'info');
        box.style.display = 'none';
        box.hidden = true;
    }
}

async function leerJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function mensajePorEstado(status) {
    switch (status) {
        case 400: return "Los datos enviados no son válidos.";
        case 401: return "No autorizado. Revisa tus credenciales.";
        case 403: return "No tienes permiso para realizar esta acción.";
        case 404: return "Servicio no encontrado.";
        case 429: return "Demasiados intentos. Espera un momento.";
        default:
            return status >= 500 ? `Error del servidor (código ${status}).` : `Error inesperado (código ${status}).`;
    }
}

function textoDeError(data, response, fallback) {
    const base = data.mensaje || fallback || mensajePorEstado(response.status);
    return data.detalle ? `${base} (${data.detalle})` : base;
}

function bloquearBoton(boton, bloquear, textoCargando) {
    if (!boton) return;
    if (bloquear) {
        boton.dataset.textoOriginal = boton.textContent;
        boton.textContent = textoCargando;
        boton.disabled = true;
    } else {
        boton.textContent = boton.dataset.textoOriginal || boton.textContent;
        boton.disabled = false;
    }
}

function reiniciarCaptcha() {
    if (typeof grecaptcha !== 'undefined') {
        grecaptcha.reset();
    }
}

// ---------------- Interfaz: Pestañas y Contraseña ----------------

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = window.RZ ? RZ.icon('eye-off') : '🙈';
    } else {
        input.type = 'password';
        btn.innerHTML = window.RZ ? RZ.icon('eye') : '👁️';
    }
}

// Correo al que se le envió el código (registro o recuperación)
let correoPendiente = '';

const PANELES = ['formLogin', 'formRegistro', 'formVerificar', 'formRecuperar', 'formRestablecer'];

// Muestra un solo panel; las pestañas solo se ven en Ingresar / Registrarse
function mostrarPanel(id) {
    PANELES.forEach(p => {
        const el = document.getElementById(p);
        if (el) el.style.display = (p === id) ? 'block' : 'none';
    });
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.style.display = (id === 'formLogin' || id === 'formRegistro') ? '' : 'none';
}

function cambiarVista(vista) {
    ocultarAlerta();
    mostrarPanel(vista === 'login' ? 'formLogin' : 'formRegistro');
    document.getElementById('tabLogin').classList.toggle('activo', vista === 'login');
    document.getElementById('tabRegistro').classList.toggle('activo', vista !== 'login');
}

function volverALogin(e) {
    if (e) e.preventDefault();
    cambiarVista('login');
}

// ---------------- Paso 1: Login Directo ----------------

async function enviarLogin(e) {
    e.preventDefault();
    ocultarAlerta();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (typeof grecaptcha === 'undefined') {
        mostrarAlerta("No se pudo cargar reCAPTCHA. Revisa tu conexión y recarga la página.");
        return;
    }

    const recaptchaToken = grecaptcha.getResponse();
    if (!recaptchaToken) {
        mostrarAlerta("Por favor, completa la verificación 'No soy un robot'.");
        return;
    }

    const boton = e.target.querySelector('button[type="submit"]');
    bloquearBoton(boton, true, 'Iniciando sesión...');

    try {
        const response = await fetch(`${API_BASE_URL}/Auth/Login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Email: email,
                Password: password,
                RecaptchaToken: recaptchaToken
            })
        });

        const data = await leerJson(response);

        if (!response.ok) {
            // Contraseña correcta pero el correo no está verificado: el backend ya envió un código
            if (response.status === 403 && data.codigo === 'CORREO_NO_VERIFICADO') {
                mostrarPasoCodigo(email);
                mostrarAlerta("Debes verificar tu correo. Te enviamos un código.", 'info');
                reiniciarCaptcha();
                return;
            }
            mostrarAlerta(textoDeError(data, response, "Correo o contraseña incorrectos."));
            reiniciarCaptcha();
            return;
        }

        const token = data.token ?? data.Token;
        const rolCrudo = data.rol ?? data.Rol ?? "";

        if (!token) {
            mostrarAlerta("Respuesta inesperada del servidor. Inténtalo de nuevo.");
            reiniciarCaptcha();
            return;
        }

        localStorage.setItem('raiza_jwt', token);
        localStorage.setItem('raiza_rol', rolCrudo);
        localStorage.setItem('raiza_nombre', data.nombre ?? data.Nombre ?? "");
        localStorage.setItem('raiza_idUsuario', data.idUsuario ?? data.IdUsuario ?? "");

        // Un solo portal: portal.html muestra el panel que corresponde al rol guardado
        window.location.href = 'portal.html';
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrarAlerta("No se pudo conectar con el servidor. Verifica que la API esté en ejecución.");
        reiniciarCaptcha();
    } finally {
        bloquearBoton(boton, false);
    }
}

// ---------------- Paso 2: Registro ----------------

async function enviarRegistro(e) {
    e.preventDefault();
    ocultarAlerta();

    const nombre = document.getElementById('regNombre').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;

    const cumpleRequisitos = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);

    if (!cumpleRequisitos) {
        mostrarAlerta('La contraseña debe tener al menos 8 caracteres e incluir al menos una letra y un número.');
        return;
    }

    // Autorización obligatoria de tratamiento de datos personales
    const consentimiento = document.getElementById('regConsentimiento');
    if (!consentimiento || !consentimiento.checked) {
        mostrarAlerta('Debes autorizar el tratamiento de tus datos personales para crear la cuenta.');
        return;
    }

    const boton = e.target.querySelector('button[type="submit"]');
    bloquearBoton(boton, true, 'Creando cuenta...');

    try {
        const response = await fetch(`${API_BASE_URL}/Auth/Registro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                Nombre: nombre, 
                Correo: email, 
                ContrasenaHash: password 
            })
        });

        const data = await leerJson(response);

        if (response.ok) {
            e.target.reset();
            mostrarPasoCodigo(email);
            mostrarAlerta(data.mensaje || "Te enviamos un código de verificación a tu correo.", 'exito');
        } else {
            mostrarAlerta(textoDeError(data, response, "Error al registrar la cuenta."));
        }
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrarAlerta("No se pudo conectar con el servidor.");
    } finally {
        bloquearBoton(boton, false);
    }
}

// ---------------- Verificación de correo (código) ----------------

function mostrarPasoCodigo(correo) {
    correoPendiente = correo;
    document.getElementById('correoDestino').textContent = correo;
    document.getElementById('codigoVerificacion').value = '';
    mostrarPanel('formVerificar');
    document.getElementById('codigoVerificacion').focus();
}

async function enviarVerificacion(e) {
    e.preventDefault();
    ocultarAlerta();

    const codigo = document.getElementById('codigoVerificacion').value.trim();
    const boton = e.target.querySelector('button[type="submit"]');
    bloquearBoton(boton, true, 'Verificando...');

    try {
        const response = await fetch(`${API_BASE_URL}/Auth/Verificar-Correo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Correo: correoPendiente, Codigo: codigo })
        });

        const data = await leerJson(response);

        if (response.ok) {
            cambiarVista('login');
            document.getElementById('email').value = correoPendiente;
            mostrarAlerta("¡Correo verificado! Ya puedes iniciar sesión.", 'exito');
        } else {
            mostrarAlerta(textoDeError(data, response, "El código no es válido o ya venció."));
        }
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrarAlerta("No se pudo conectar con el servidor.");
    } finally {
        bloquearBoton(boton, false);
    }
}

async function reenviarCodigo(e) {
    e.preventDefault();
    ocultarAlerta();

    try {
        const response = await fetch(`${API_BASE_URL}/Auth/Reenviar-Codigo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Correo: correoPendiente })
        });
        const data = await leerJson(response);
        mostrarAlerta(data.mensaje || "Si el correo corresponde a una cuenta pendiente, enviamos un nuevo código.", 'exito');
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrarAlerta("No se pudo conectar con el servidor.");
    }
}

// ---------------- Recuperar contraseña (código por correo) ----------------

function mostrarVistaRecuperar(e) {
    e.preventDefault();
    ocultarAlerta();
    mostrarPanel('formRecuperar');
}

// Paso 1: pedir el código
async function enviarSolicitudRecuperacion(e) {
    e.preventDefault();
    ocultarAlerta();

    const email = document.getElementById('emailRecuperar').value.trim();
    const boton = e.target.querySelector('button[type="submit"]');
    bloquearBoton(boton, true, 'Enviando...');

    try {
        const response = await fetch(`${API_BASE_URL}/Auth/Recuperar/Solicitar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Email: email })
        });
        const data = await leerJson(response);

        if (response.ok) {
            correoPendiente = email;
            document.getElementById('correoRecuperacion').textContent = email;
            document.getElementById('codigoRecuperacion').value = '';
            document.getElementById('nuevaPassword').value = '';
            mostrarPanel('formRestablecer');
            mostrarAlerta(data.mensaje || "Si el correo está registrado, enviamos un código.", 'exito');
        } else {
            mostrarAlerta(textoDeError(data, response, "No se pudo enviar el código."));
        }
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrarAlerta("No se pudo conectar con el servidor.");
    } finally {
        bloquearBoton(boton, false);
    }
}

// Paso 2: código + nueva contraseña
async function enviarRestablecer(e) {
    e.preventDefault();
    ocultarAlerta();

    const codigo = document.getElementById('codigoRecuperacion').value.trim();
    const nuevaContrasena = document.getElementById('nuevaPassword').value;

    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(nuevaContrasena)) {
        mostrarAlerta('La contraseña debe tener al menos 8 caracteres e incluir al menos una letra y un número.');
        return;
    }

    const boton = e.target.querySelector('button[type="submit"]');
    bloquearBoton(boton, true, 'Actualizando...');

    try {
        const response = await fetch(`${API_BASE_URL}/Auth/Recuperar/Restablecer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Email: correoPendiente, Codigo: codigo, NuevaContrasena: nuevaContrasena })
        });
        const data = await leerJson(response);

        if (response.ok) {
            cambiarVista('login');
            document.getElementById('email').value = correoPendiente;
            mostrarAlerta("¡Contraseña actualizada! Ya puedes iniciar sesión.", 'exito');
        } else {
            mostrarAlerta(textoDeError(data, response, "El código no es válido o ya venció."));
        }
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrarAlerta("No se pudo conectar con el servidor.");
    } finally {
        bloquearBoton(boton, false);
    }
}

// ---------------- Política de tratamiento de datos ----------------

function abrirPoliticaDatos(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('modalPoliticaDatos');
    if (modal) modal.classList.add('activo');
}

function cerrarPoliticaDatos() {
    const modal = document.getElementById('modalPoliticaDatos');
    if (modal) modal.classList.remove('activo');
}

// "Entendido y acepto": cierra el modal y marca la casilla
function aceptarPoliticaDatos() {
    const check = document.getElementById('regConsentimiento');
    if (check) check.checked = true;
    cerrarPoliticaDatos();
}

// ---------------- Banner de cookies e inicialización ----------------

document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem('raiza_jwt') && localStorage.getItem('raiza_rol')) { window.location.replace('portal.html'); return; }
    const accion = new URLSearchParams(window.location.search).get('action');
    if (accion === 'register' || accion === 'registro') {
        cambiarVista('registro');
    }

    const modalPolitica = document.getElementById('modalPoliticaDatos');
    if (modalPolitica) {
        modalPolitica.addEventListener('click', (ev) => {
            if (ev.target === modalPolitica) cerrarPoliticaDatos();
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') cerrarPoliticaDatos();
        });
    }

    const cookieBanner = document.getElementById('cookieBanner');
    const btnAceptar = document.getElementById('btnAceptarCookies');

    if (cookieBanner && btnAceptar) {
        if (!localStorage.getItem('raiza_cookies_aceptadas')) {
            setTimeout(() => {
                cookieBanner.classList.add('mostrar');
            }, 500);
        }

        btnAceptar.addEventListener('click', () => {
            localStorage.setItem('raiza_cookies_aceptadas', 'true');
            cookieBanner.classList.remove('mostrar');
        });
    }
});