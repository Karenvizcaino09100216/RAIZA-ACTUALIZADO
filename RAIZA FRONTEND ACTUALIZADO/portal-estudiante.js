/**
 * Portal del Estudiante - RAIZA (Versión Final Integrada)
 * Sincronizado con los controladores de C# y SQL Server
 */

const API_BASE_URL = "https://localhost:7248/api";
const FOTO_POR_DEFECTO = "https://via.placeholder.com/160?text=Sube+tu+Foto";

let misTareas = [];
let misCertificados = [];
let idTareaSeleccionada = null;
let modoModal = 'crear';

// Estado del kit seleccionado en el modal de checkout
let kitSeleccionadoActual = '';
let kitSeleccionadoActualId = 0;
let catalogoKitsPorId = {};    // idclass_kit -> kit completo (desde la API cuando hay conexión)
// Catálogo REAL de RAIZA (se muestra siempre, sin depender de lo que tenga la base de datos).
// "idclass_kit" es el id con el que el kit existe en la API; si cambia en tu BD, ajústalo aquí.
const KITS_RAIZA = [
    { idclass_kit: 1, idmodulo: 1, icono: 'wrench', precio: 45000,
      name: 'Kit de Alambrismo Inicial',
      description: 'Incluye pinza de punta redonda, pinza plana, alicate de corte, mandril medidor y rollos de alambre calibrado de práctica.' },
    { idclass_kit: 4, idmodulo: 2, icono: 'layers', precio: 35000,
      name: 'Kit de Macramé y Piedras',
      description: 'Hilos encerados brasileños de alta resistencia, piedras naturales perforadas (cabujones), base de apoyo y tijeras de precisión.' },
    { idclass_kit: 3, idmodulo: 3, icono: 'gem', precio: 75000,
      name: 'Kit Master de Mostasilla',
      description: 'Agujas especiales para abalorios, hilos nylon ultraresistentes y un amplio surtido de mostasillas checas y delicas calibradas.' }
];

// Respaldo sin servidor (misma información que KITS_RAIZA)
const catalogoKitsLocales = KITS_RAIZA.map(k => ({ id: k.idclass_kit, nombre: k.name, precio: k.precio, idmodulo: k.idmodulo }));

function quitarAcentos(txt) {
    return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// El kit que desbloquea las clases de Mostasilla
function esKitMostasilla(nombre) {
    const t = quitarAcentos(nombre);
    return t.includes('mostasilla') || t.includes('mostacilla') || t.includes('avanzado');
}

// ---------------- Utilidades ---------------- 

// Escapa texto para evitar inyección HTML al renderizar datos del servidor
function escapar(valor) {
    return String(valor ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Escapa texto para usarlo dentro de strings JS en atributos onclick
function paraOnclick(valor) {
    return String(valor ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', ' ');
}

// Genera un avatar SVG con las iniciales (sin depender de servicios externos)
function avatarIniciales(nombre) {
    const iniciales = (nombre || 'U').trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
        "<rect width='160' height='160' rx='80' fill='#687052'/>" +
        "<text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-family='Poppins, Arial' font-size='52' fill='#F2EBDD' font-weight='600'>" +
        iniciales + "</text></svg>";
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Aplica el avatar de iniciales como respaldo cuando la foto no está disponible
function inicializarAvatar(selectorId, nombre) {
    const img = document.getElementById(selectorId);
    if (!img) return;
    const iniciales = avatarIniciales(nombre);
    img.addEventListener('error', () => { img.src = iniciales; });
    // Si la imagen actual no carga (servicio externo bloqueado), se reemplaza de inmediato
    if (img.complete && img.naturalWidth === 0) img.src = iniciales;
}

// ==========================================
// 1. SEGURIDAD Y CONTROL DE ACCESO
// ==========================================
function verificarSesionEstudiante() {
    const token = localStorage.getItem('raiza_jwt');
    const rol = (RZ_SESION.rol() || "").toLowerCase();

    if (!token) {
        alert("Por favor, inicia sesión para acceder al portal.");
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// ==========================================
// 2. NAVEGACIÓN GENERAL Y DE NIVELES
// ==========================================
function cambiarSeccion(idSeccion, botonPresionado) {
    document.querySelectorAll('.seccion-dashboard').forEach(sec => sec.classList.remove('activa'));
    const seccionActiva = document.getElementById(idSeccion);
    if (seccionActiva) seccionActiva.classList.add('activa');

    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('activo'));
    if (botonPresionado) botonPresionado.classList.add('activo');

    if (idSeccion === 'kits') {
        cargarCatalogoKits();
        cargarPedidosKitsDesdeServidor();
        verificarDesbloqueoModuloAvanzado();
    } else if (idSeccion === 'certificados') {
        cargarCertificadosDesdeServidor();
    }
}

function cambiarNivel(idNivel, boton) {
    document.querySelectorAll('.contenedor-nivel').forEach(niv => niv.classList.remove('activo-contenido'));
    document.querySelectorAll('.btn-nivel').forEach(btn => btn.classList.remove('activo-nivel'));
    
    const nivelActivo = document.getElementById(idNivel);
    if (nivelActivo) nivelActivo.classList.add('activo-contenido');
    if (boton) boton.classList.add('activo-nivel');
}

// ==========================================
// 3. PERFIL DE USUARIO (UsuarioController)
// ==========================================
async function cargarPerfilDesdeServidor() {
    const token = localStorage.getItem('raiza_jwt');
    const usuarioId = RZ_SESION.id();

    if (!usuarioId) {
        cargarPerfilLocal();
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/Usuario/${usuarioId}`, {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'Content-Type': 'application/json' 
            }
        });

        if (response.ok) {
            const usuario = await response.json();
            const nombre = usuario.nombre || usuario.Nombre || 'Estudiante';
            const correo = usuario.correo || usuario.Correo || '';
            const documento = usuario.documento || usuario.Documento || 'No registrado';
            const telefono = usuario.telefono || usuario.Telefono || '';
            const direccion = usuario.direccion || usuario.Direccion || '';
            const fotoUrl = usuario.fotoUrl || usuario.FotoUrl;

            if(document.getElementById('perfilNombre')) document.getElementById('perfilNombre').value = nombre;
            if(document.getElementById('perfilCorreo')) document.getElementById('perfilCorreo').value = correo;
            if(document.getElementById('perfilDocumento')) document.getElementById('perfilDocumento').value = documento;
            if(document.getElementById('perfilTelefono')) document.getElementById('perfilTelefono').value = telefono;
            if(document.getElementById('perfilDireccion')) document.getElementById('perfilDireccion').value = direccion;
            
            const tituloResumen = document.querySelector('#resumen h2');
            if (tituloResumen) tituloResumen.textContent = `Bienvenido, ${nombre}`;
            
            if (fotoUrl) {
                if(document.getElementById('imgPerfil')) document.getElementById('imgPerfil').src = fotoUrl;
                const imgSidebar = document.getElementById('imgPerfilSidebar');
                if (imgSidebar) imgSidebar.src = fotoUrl;
            }
        } else {
            cargarPerfilLocal();
        }
    } catch (error) {
        console.warn('Backend inactivo o sin conexión. Usando perfil local.');
        cargarPerfilLocal();
    }
}

function cargarPerfilLocal() {
    const n = RZ_SESION.nombre() || 'Estudiante';
    const tituloResumen = document.querySelector('#resumen h2');
    if (tituloResumen) tituloResumen.textContent = `Bienvenido, ${n}`;

    if(document.getElementById('perfilNombre')) document.getElementById('perfilNombre').value = n;
    if(document.getElementById('perfilCorreo')) document.getElementById('perfilCorreo').value = RZ_MEM.getItem('raiza_correo') || 'estudiante@raiza.com';
    if(document.getElementById('perfilDocumento')) document.getElementById('perfilDocumento').value = '1098765432';
    if(document.getElementById('perfilTelefono')) document.getElementById('perfilTelefono').value = RZ_MEM.getItem('raiza_telefono') || '';
    if(document.getElementById('perfilDireccion')) document.getElementById('perfilDireccion').value = RZ_MEM.getItem('raiza_direccion') || '';
    
    const foto = RZ_MEM.getItem('raiza_fotoPerfil');
    if (foto) {
        if(document.getElementById('imgPerfil')) document.getElementById('imgPerfil').src = foto;
        const imgSidebar = document.getElementById('imgPerfilSidebar');
        if (imgSidebar) imgSidebar.src = foto;
    }
}

document.getElementById('formPerfil')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const token = localStorage.getItem('raiza_jwt');
    const usuarioId = RZ_SESION.id();

    const nombre = document.getElementById('perfilNombre').value;
    const telefono = document.getElementById('perfilTelefono').value;
    const direccion = document.getElementById('perfilDireccion').value;

    RZ_SESION.setNombre(nombre);
    RZ_MEM.setItem('raiza_telefono', telefono);
    RZ_MEM.setItem('raiza_direccion', direccion);

    if (!usuarioId) {
        alert('Tus datos han sido actualizados localmente con éxito.');
        return;
    }

    try {
        const usuarioActualizado = {
            id: parseInt(usuarioId),
            nombre: nombre,
            telefono: telefono,
            direccion: direccion
        };

        const response = await fetch(`${API_BASE_URL}/Usuario/${usuarioId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(usuarioActualizado)
        });

        if (response.ok) {
            alert('¡Tus datos personales han sido actualizados en la base de datos!');
        } else {
            alert('Datos guardados localmente.');
        }
    } catch (error) {
        console.error('Error al actualizar perfil en red:', error);
        alert('Tus datos se guardaron localmente.');
    }
});

// ==========================================
// 4. GESTIÓN DE TAREAS Y PROGRESO (TareaController y EntregaTareaController)
// ==========================================
async function cargarTareasDesdeServidor() {
    const token = localStorage.getItem('raiza_jwt');
    const encabezados = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
        // El modelo Tarea SOLO trae idtarea/titulo/descripcion/fechaEntrega/idmodulo:
        // el nivel del módulo sale de /Modulo y el estado de TU entrega en /EntregaTarea.
        const [respTareas, respModulos, respEntregas] = await Promise.all([
            fetch(`${API_BASE_URL}/Tarea`, { method: 'GET', headers: encabezados }),
            fetch(`${API_BASE_URL}/Modulo`, { method: 'GET', headers: encabezados }),
            fetch(`${API_BASE_URL}/EntregaTarea`, { method: 'GET', headers: encabezados })
        ]);

        if (respTareas.ok) {
            const tareas = await respTareas.json();

            const modulos = respModulos.ok ? await respModulos.json() : [];
            const nivelPorModulo = {};
            modulos.forEach(m => {
                const id = m.idmodulo ?? m.Idmodulo;
                if (id !== undefined && id !== null) {
                    nivelPorModulo[id] = m.nivel ?? m.Nivel ?? 'Basico';
                }
            });

            const miId = RZ_SESION.id();
            const entregas = respEntregas.ok ? await respEntregas.json() : [];
            const tareasEntregadas = new Set(
                entregas
                    .filter(e => String(e.idestudiante ?? e.Idestudiante) === String(miId))
                    .map(e => e.idtarea ?? e.Idtarea)
            );

            misTareas = tareas.map(t => {
                const idTarea = t.idtarea ?? t.IdTarea;
                const nivel = nivelPorModulo[t.idmodulo ?? t.Idmodulo] || 'Basico';
                const fechaCruda = t.fechaEntrega ?? t.FechaEntrega;
                return {
                    id: idTarea,
                    nivel: nivel,
                    modulo: `Módulo ${nivel}`,
                    titulo: t.titulo || t.Titulo || 'Tarea sin título',
                    fecha: fechaCruda ? formatearFecha(fechaCruda) : 'Próximamente',
                    estado: tareasEntregadas.has(idTarea) ? 'Entregada' : 'Pendiente'
                };
            });
            renderizarTareas();
        } else {
            cargarTareasRespaldo();
        }
    } catch (error) {
        console.warn('Servidor de tareas inactivo. Usando respaldo local.');
        cargarTareasRespaldo();
    }
}

function formatearFecha(valor) {
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);
    return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Devuelve el id REAL de TU entrega para una tarea (null si no existe).
// Se usa cuando localStorage no tiene el respaldo (otro dispositivo / API apagada al entregar).
async function buscarIdEntregaPropia(idTarea, token) {
    try {
        const resp = await fetch(`${API_BASE_URL}/EntregaTarea`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!resp.ok) return null;
        const entregas = await resp.json();
        const miId = RZ_SESION.id();
        const propia = entregas.find(e =>
            String(e.idestudiante ?? e.Idestudiante) === String(miId) &&
            (e.idtarea ?? e.Idtarea) === idTarea
        );
        return propia ? (propia.identregatarea ?? propia.Identregatarea ?? null) : null;
    } catch (err) {
        return null;
    }
}

function cargarTareasRespaldo() {
    misTareas = [
        { id: 1, nivel: 'Basico', modulo: 'Proyecto 1 (Básico)', titulo: 'Anillo Sencillo en Espiral', fecha: 'Muy pronto', estado: 'Pendiente' },
        { id: 2, nivel: 'Basico', modulo: 'Proyecto 2 (Básico)', titulo: 'Pulsera de Nudos Básicos', fecha: 'En 3 días', estado: 'Pendiente' },
        { id: 3, nivel: 'Intermedio', modulo: 'Proyecto 1 (Intermedio)', titulo: 'Engaste de Gota', fecha: 'En 7 días', estado: 'Pendiente' },
        { id: 4, nivel: 'Intermedio', modulo: 'Proyecto 2 (Intermedio)', titulo: 'Dije Entrelazado', fecha: 'En 10 días', estado: 'Pendiente' },
        { id: 5, nivel: 'Avanzado', modulo: 'Proyecto 1 (Avanzado)', titulo: 'Aretes Geométricos', fecha: '15 Oct', estado: 'Pendiente' },
        { id: 6, nivel: 'Avanzado', modulo: 'Proyecto 2 (Avanzado)', titulo: 'Colgante Escultórico', fecha: '20 Oct', estado: 'Pendiente' }
    ];
    renderizarTareas();
}

function actualizarCirculoProgreso() {
    const totalTareas = misTareas.length;
    const fijar = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (totalTareas === 0) { fijar('statTareasPend', 0); fijar('statTareasEnt', 0); fijar('statTareasTotal', 0); return; }
    
    const tareasEntregadas = misTareas.filter(t => t.estado === 'Entregada' || t.estado === 'Completada').length;
    const porcentaje = Math.round((tareasEntregadas / totalTareas) * 100);
    
    const textoElement = document.getElementById('textoProgreso');
    if (textoElement) textoElement.textContent = `${porcentaje}%`;

    const barra = document.getElementById('barraProgreso');
    if (barra) barra.style.width = `${porcentaje}%`;
    fijar('statTareasPend', totalTareas - tareasEntregadas);
    fijar('statTareasEnt', tareasEntregadas);
    fijar('statTareasTotal', totalTareas);

    const grados = porcentaje * 3.6;
    const circuloElement = document.getElementById('circuloProgreso');
    if (circuloElement) {
        circuloElement.style.background = `conic-gradient(var(--terracota-coral) ${grados}deg, var(--beige-claro) 0deg)`;
    }
}

function renderizarTareas() {
    const gridBasico = document.getElementById('gridTareasBasico');
    const gridIntermedio = document.getElementById('gridTareasIntermedio');
    const gridAvanzado = document.getElementById('gridTareasAvanzado');
    const listaResumen = document.getElementById('listaTareasResumen');

    if(gridBasico) gridBasico.innerHTML = '';
    if(gridIntermedio) gridIntermedio.innerHTML = '';
    if(gridAvanzado) gridAvanzado.innerHTML = '';
    if(listaResumen) listaResumen.innerHTML = '';

    let tareasPendientesCuentas = 0;

    misTareas.forEach(tarea => {
        const esPendiente = tarea.estado === 'Pendiente';
        const badgeClass = esPendiente ? 'badge-pendiente' : 'badge-entregada';
        const tituloSeguro = escapar(tarea.titulo);
        const tituloOnclick = paraOnclick(tarea.titulo);
        
        let botonesAccion = '';
        if (esPendiente) {
            botonesAccion = `<button class="btn-secundario" onclick="abrirModalTarea(${tarea.id}, '${tituloOnclick}', 'crear')">Subir Trabajo</button>`;
        } else {
            botonesAccion = `
                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button class="btn-secundario" style="flex: 1; padding: 8px; font-size: 0.8rem;" onclick="abrirModalTarea(${tarea.id}, '${tituloOnclick}', 'editar')">Editar</button>
                    <button class="btn-peligro" style="flex: 1; padding: 8px; font-size: 0.8rem;" onclick="eliminarEntregaTarea(${tarea.id})">Eliminar</button>
                </div>
            `;
        }

        const tarjetaHtml = `
            <div class="tarjeta-modulo-item">
                <div>
                    <span class="${badgeClass}">${tarea.estado}</span>
                    <h4 style="margin: 0 0 5px 0; color: var(--verde-oliva); font-size: 0.9rem;">${escapar(tarea.modulo)}</h4>
                    <h3 class="modulo-item-titulo">${tituloSeguro}</h3>
                    <p class="modulo-item-desc">Fecha Límite: ${escapar(tarea.fecha)}</p>
                </div>
                ${botonesAccion}
            </div>
        `;

        if (tarea.nivel === 'Basico' && gridBasico) gridBasico.innerHTML += tarjetaHtml;
        if (tarea.nivel === 'Intermedio' && gridIntermedio) gridIntermedio.innerHTML += tarjetaHtml;
        if (tarea.nivel === 'Avanzado' && gridAvanzado) gridAvanzado.innerHTML += tarjetaHtml;

        if (esPendiente && listaResumen) {
            tareasPendientesCuentas++;
            listaResumen.innerHTML += `
                <li class="item-tarea-pendiente">
                    <div class="item-titulo">${escapar(tarea.titulo)}</div>
                    <div class="item-alerta">Vence: ${escapar(tarea.fecha)}</div>
                </li>
            `;
        }
    });

    if(tareasPendientesCuentas === 0 && listaResumen) {
        listaResumen.innerHTML = `<li class="item-vacio">¡Felicidades! Has completado todas las entregas.</li>`;
    }

    actualizarCirculoProgreso();
}

function abrirModalTarea(id, titulo, modo = 'crear') {
    idTareaSeleccionada = id;
    modoModal = modo;
    
    const tituloModal = document.getElementById('modalTareaTitulo');
    if (tituloModal) {
        tituloModal.textContent = modo === 'editar' ? `Editar Entrega: ${titulo}` : `Entregar: ${titulo}`;
    }
    
    const modal = document.getElementById('modalTarea');
    if (modal) modal.classList.add('activo');
}

function cerrarModalTarea() {
    const modal = document.getElementById('modalTarea');
    if (modal) modal.classList.remove('activo');
    
    const form = document.getElementById('formSubirTareaDin');
    if (form) form.reset();
}

document.getElementById('formSubirTareaDin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('raiza_jwt');
    const estudianteId = RZ_SESION.id();
    if (!estudianteId) {
        alert('No se identificó tu usuario. Inicia sesión nuevamente.');
        window.location.href = 'login.html';
        return;
    }
    const comentarioInput = document.getElementById('comentarioTareaDin');
    const comentario = comentarioInput ? comentarioInput.value.trim() : '';
    const archivoInput = document.getElementById('archivoTareaDin');
    const archivo = archivoInput && archivoInput.files.length > 0 ? archivoInput.files[0] : null;

    // UrlArchivo es OBLIGATORIO en el backend. Si pegas un enlace (Drive/YouTube) se usa ese;
    // si adjuntas un archivo, se SUBE de verdad al servidor y se usa la URL resultante.
    const enlaceEnComentario = comentario.match(/https?:\/\/[^\s]+/i)?.[0] || '';
    let urlArchivo = enlaceEnComentario;
    let nombreSubido = archivo ? archivo.name : '';

    // Indicador de progreso: bloquea el botón mientras se trabaja con el servidor
    const btnEnviar = document.querySelector('#formSubirTareaDin button[type="submit"]');
    const textoBtn = btnEnviar ? btnEnviar.textContent : '';
    if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.textContent = 'Subiendo…'; }
    const restaurarBoton = () => {
        if (btnEnviar) { btnEnviar.disabled = false; btnEnviar.textContent = textoBtn; }
    };

    if (archivo && !enlaceEnComentario) {
        try {
            const formData = new FormData();
            formData.append('archivo', archivo);
            const respUpload = await fetch(`${API_BASE_URL}/EntregaTarea/subir-archivo`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` } // el Content-Type lo define FormData
            });

            if (respUpload.status === 401) {
                alert('Tu sesión expiró. Inicia sesión nuevamente.');
                window.location.href = 'login.html';
                return;
            }

            if (respUpload.ok) {
                const datos = await respUpload.json();
                urlArchivo = datos.url;
                nombreSubido = datos.nombreOriginal || archivo.name;
            } else {
                console.warn('La API rechazó el archivo (código ' + respUpload.status + '). Se usará el nombre local.');
                mostrarProximamente('La subida de archivos estará disponible próximamente. Por ahora, pega un enlace de Google Drive o YouTube en los comentarios.');
            }
        } catch (err) {
            console.warn('No se pudo subir el archivo (API apagada). Se usará el nombre local.');
            mostrarProximamente('La subida de archivos estará disponible próximamente. Por ahora, pega un enlace de Google Drive o YouTube en los comentarios.');
        }
    }
    if (!urlArchivo && archivo) {
        urlArchivo = `archivo: ${archivo.name}`;
    }

    if (!urlArchivo) {
        restaurarBoton();
        alert('Adjunta un archivo o pega un enlace (Google Drive, YouTube, etc.) en el comentario para poder entregar.');
        return;
    }

    // Registro local: guarda un respaldo de la entrega aunque la API esté apagada.
    const registro = {
        idEntrega: null,
        archivo: nombreSubido,
        url: urlArchivo,
        comentario: comentario,
        fecha: new Date().toISOString()
    };

    // El estudiante ya no puede hacer PUT (esa ruta quedó reservada al instructor para calificar).
    // EDITAR = REENVIAR: se elimina la entrega anterior (si existe) y se crea una nueva.
    const registroPrevio = JSON.parse(RZ_MEM.getItem(`raiza_entrega_${idTareaSeleccionada}`) || 'null');
    let idEntrega = (modoModal === 'editar' && registroPrevio && registroPrevio.idEntrega)
        ? registroPrevio.idEntrega
        : 0;

    // Sin respaldo local (otro dispositivo o API apagada al entregar) se busca el id REAL en el
    // servidor: usar el id de la tarea como id de entrega borraba/reescribía registros equivocados
    // y, si no se borraba la anterior, quedaban DOS entregas para la misma tarea.
    if (modoModal === 'editar' && !idEntrega) {
        idEntrega = await buscarIdEntregaPropia(idTareaSeleccionada, token) || 0;
    }

    if (modoModal === 'editar' && idEntrega > 0) {
        try {
            const respDelete = await fetch(`${API_BASE_URL}/EntregaTarea/${idEntrega}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            // 404 = ya no existía (adelante); cualquier otro rechazo se aborta para no duplicar.
            if (!respDelete.ok && respDelete.status !== 404) {
                restaurarBoton();
                alert('No se pudo reemplazar tu entrega anterior (código ' + respDelete.status + '). Inténtalo de nuevo.');
                return;
            }
        } catch (err) {
            console.warn('No se pudo eliminar la entrega anterior (sin conexión). Se enviará la nueva de todos modos.');
        }
    }

    // Siempre se crea una entrega nueva (POST)
    const endpoint = `${API_BASE_URL}/EntregaTarea`;
    const metodoHttp = 'POST';

    try {
        const response = await fetch(endpoint, {
            method: metodoHttp,
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identregatarea: 0,
                urlArchivo: urlArchivo,
                idtarea: idTareaSeleccionada,
                idestudiante: parseInt(estudianteId, 10), // ya validado arriba; el backend además lo fuerza desde el JWT
                comentario: comentario,
                fechaentrega: new Date().toISOString()
            })
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            window.location.href = 'login.html';
            return;
        }

        // Si el servidor responde, guardamos el ID real de la entrega para futuras ediciones.
        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            registro.idEntrega = data.identregatarea ?? data.Identregatarea ?? null;
        } else {
            console.warn('La API no pudo guardar la entrega (código ' + response.status + '). Se conserva en local.');
        }
    } catch (error) {
        console.warn('Error de red al procesar la tarea en el servidor. Aplicando cambio visual local.');
    }

    try {
        RZ_MEM.setItem(`raiza_entrega_${idTareaSeleccionada}`, JSON.stringify(registro));
    } catch (err) { /* Cuota de almacenamiento llena: el envío visual aún se aplica */ }

    const tarea = misTareas.find(t => t.id === idTareaSeleccionada);
    if (tarea) {
        tarea.estado = 'Entregada';
        tarea.fecha = modoModal === 'editar' ? 'Actualizado Hoy' : 'Entregado Hoy';
    }

    restaurarBoton();
    alert(modoModal === 'editar' ? '¡Tu entrega ha sido actualizada con éxito!' : '¡Trabajo enviado con éxito!');
    cerrarModalTarea();
    renderizarTareas();
});

async function eliminarEntregaTarea(idTarea) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta entrega? Tu tarea volverá a quedar como pendiente.')) {
        return;
    }

    const token = localStorage.getItem('raiza_jwt');
    const registro = JSON.parse(RZ_MEM.getItem(`raiza_entrega_${idTarea}`) || 'null');
    // El id de la tarea NUNCA es el id de la entrega: sin respaldo local se busca el real.
    let idEntrega = registro && registro.idEntrega ? registro.idEntrega : null;
    if (!idEntrega) {
        idEntrega = await buscarIdEntregaPropia(idTarea, token);
    }

    const marcarPendiente = () => {
        const tarea = misTareas.find(t => t.id === idTarea);
        if (tarea) {
            tarea.estado = 'Pendiente';
            tarea.fecha = 'Pendiente de entrega';
        }
        RZ_MEM.removeItem(`raiza_entrega_${idTarea}`);
        renderizarTareas();
    };

    if (!idEntrega) {
        // No hay entrega en el servidor: solo se corrige el estado local (sin avisar "eliminada").
        marcarPendiente();
        alert('No se encontró una entrega registrada en el servidor para esta tarea; se marcó como pendiente.');
        return;
    }

    try {
        const resp = await fetch(`${API_BASE_URL}/EntregaTarea/${idEntrega}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        if (resp.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            window.location.href = 'login.html';
            return;
        }

        if (!resp.ok && resp.status !== 404) {
            // 403/500: el servidor NO borró nada → no se cambia el estado local.
            alert('El servidor rechazó eliminar la entrega (código ' + resp.status + '). Nada cambió.');
            return;
        }

        marcarPendiente();
        alert(resp.status === 404
            ? 'La entrega ya no existía en el servidor; se marcó como pendiente.'
            : 'La entrega ha sido eliminada correctamente.');
    } catch (error) {
        console.warn('No se pudo conectar con el servidor para eliminar la entrega.');
        alert('Sin conexión con el servidor: no se pudo eliminar la entrega. Reinténtalo más tarde.');
    }
}

// ==========================================
// 5. VERIFICACIÓN DE DESBLOQUEO DE MÓDULO AVANZADO (PedidoKitController)
// Solo tus propios pedidos (mis-pedidos) deciden el desbloqueo.
// ==========================================
function esEstadoDesbloqueante(estado) {
    const e = (estado || '').toLowerCase();
    // Estados que la BD permite en pedido_kit: Pendiente, Enviado, Entregado, Cancelado.
    // El módulo avanzado se desbloquea cuando la administración confirma el pago y despacha
    // el kit (Enviado) o lo entrega (Entregado). Se conservan Pagado/En camino/Preparación
    // por compatibilidad si la BD se amplía en el futuro.
    return ['enviado', 'entregado', 'pagado', 'en camino', 'preparacion', 'preparación'].some(x => e.includes(x));
}

async function verificarDesbloqueoModuloAvanzado() {
    const token = localStorage.getItem('raiza_jwt');
    const divBloqueado = document.getElementById('avisoKitBloqueado');
    const divContenido = document.getElementById('contenidoAvanzadoReal');

    const marcarDesbloqueado = () => {
        if (divBloqueado) divBloqueado.classList.add('campo-oculto');
        if (divContenido) divContenido.classList.remove('campo-oculto');
    };
    const marcarBloqueado = () => {
        if (divBloqueado) divBloqueado.classList.remove('campo-oculto');
        if (divContenido) divContenido.classList.add('campo-oculto');
    };

    await cargarCatalogoKits();

    // Respaldo local (pedidos registrados sin conexión)
    const locales = JSON.parse(RZ_MEM.getItem('raiza_pedidos') || '[]');
    if (locales.some(p => esKitMostasilla(p.kit) && esEstadoDesbloqueante(p.estado))) {
        marcarDesbloqueado();
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/PedidoKit/mis-pedidos`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            window.location.href = 'login.html';
            return;
        }

        if (response.ok) {
            const pedidos = await response.json();
            const kitAvanzadoPagado = pedidos.some(p => {
                const nombre = nombreKitPorId(p.idclasskit) || '';
                const estado = (p.estado || '').toLowerCase();
                return esKitMostasilla(nombre) && esEstadoDesbloqueante(estado);
            });

            if (kitAvanzadoPagado) marcarDesbloqueado();
            else marcarBloqueado();
            return;
        }
    } catch (error) {
        console.warn('No se pudo verificar el kit avanzado con el servidor. Manteniendo estado seguro.');
    }

    marcarBloqueado();
}

// ==========================================
// 6. KITS Y PEDIDOS (PedidoKitController)
// ==========================================
// Carga el catálogo real de kits (ClassKit) para resolver nombre e ID correctos.
// Si la API está apagada se conserva el respaldo local (catalogoKitsLocales).
let catalogoRenderizado = false;
async function cargarCatalogoKits() {
    try {
        const token = localStorage.getItem('raiza_jwt');
        const response = await fetch(`${API_BASE_URL}/ClassKit`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            const kitsApi = await response.json();
            // Los datos de la BD pueden estar desactualizados: nombre, descripción y precio salen de KITS_RAIZA
            const kits = kitsApi.map(k => {
                const real = KITS_RAIZA.find(r => r.idclass_kit == k.idclass_kit);
                return real ? { ...k, name: real.name, description: real.description, precio: real.precio } : k;
            });
            catalogoKitsPorId = {};
            kits.forEach(k => { catalogoKitsPorId[k.idclass_kit] = k; });
            renderizarCatalogoKits();
            return kits;
        }
    } catch (error) {
        console.warn('Sin conexión con el servidor: se usan los nombres locales de kits.');
    }
    return [];
}

// Formatea un precio en pesos colombianos: 45000 -> "$45.000"
function formatearPrecio(valor) {
    const numero = Number(valor);
    if (isNaN(numero) || numero <= 0) return '$ —';
    return '$' + new Intl.NumberFormat('es-CO').format(numero);
}

// Dibuja el catálogo con el mismo estilo de tarjetas de la página principal
function renderizarCatalogoKits() {
    const contenedor = document.getElementById('catalogoKitsDinamico');
    if (!contenedor) return;

    contenedor.innerHTML = KITS_RAIZA.map(k => `
        <div class="tarjeta-curso">
            <div class="tarjeta-icono">${window.RZ ? RZ.icon(k.icono) : ''}</div>
            <h3>${escapar(k.name)}</h3>
            <p>${escapar(k.description)}</p>
            <span class="nivel-badge">Envío seguro</span>
            <div class="kit-footer-card">
                <span class="kit-precio">${formatearPrecio(k.precio)}</span>
                <button class="btn-comprar-kit" onclick="abrirModalKitPorId(${k.idclass_kit})">Solicitar Kit</button>
            </div>
        </div>
    `).join('');
}

function detalleKitPorId(id) {
    const servidor = catalogoKitsPorId[id];
    if (servidor) return servidor;
    const local = catalogoKitsLocales.find(k => k.id == id);
    return local || null;
}

function nombreKitPorId(id) {
    const kit = detalleKitPorId(id);
    if (kit) return kit.name || kit.nombre || 'Kit especializado';
    return 'Kit especializado';
}

async function cargarPedidosKitsDesdeServidor() {
    const token = localStorage.getItem('raiza_jwt');
    const tbodyKits = document.getElementById('tablaMisKits');
    if (!tbodyKits) return;

    await cargarCatalogoKits();

    // Pedidos reales del estudiante (mis-pedidos) + respaldo local (solo lo que aún no está en el servidor)
    const locales = JSON.parse(RZ_MEM.getItem('raiza_pedidos') || '[]');
    const filas = [];

    let idsServidor = new Set();
    try {
        const response = await fetch(`${API_BASE_URL}/PedidoKit/mis-pedidos`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            window.location.href = 'login.html';
            return;
        }

        if (response.ok) {
            const pedidos = await response.json();
            idsServidor = new Set(pedidos.map(p => p.idPedidoKit ?? p.IdPedidoKit));
            pedidos.forEach(p => {
                filas.push({
                    id: p.idPedidoKit ?? p.IdPedidoKit,
                    kit: nombreKitPorId(p.idclasskit),
                    fecha: p.fechapedido,
                    estado: p.estado || 'Pendiente'
                });
            });
        }
    } catch (error) {
        console.warn('Error al consultar los pedidos de kits. Mostrando el respaldo local.');
    }

    // Respaldo local: solo los pedidos registrados sin conexión que el servidor aún no tiene.
    locales.forEach(p => {
        if (p.id && idsServidor.has(p.id)) return;
        filas.push({
            id: p.id,
            kit: p.kit || 'Kit especializado',
            fecha: p.fecha,
            estado: p.estado || 'Pendiente'
        });
    });

    const badges = {
        'Pendiente': 'pill pill-gold',
        'Enviado': 'pill pill-blue',
        'Entregado': 'pill pill-green',
        'Cancelado': 'pill pill-red'
    };

    tbodyKits.innerHTML = '';
    if (filas.length === 0) {
        tbodyKits.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#64748B; padding:22px;">Aún no has solicitado kits. Cuando registres uno aparecerá aquí.</td></tr>';
        return;
    }

    filas.slice(0, 10).forEach(p => {
        const estado = p.estado || 'Pendiente';
        const badge = badges[estado] || 'pill pill-blue';
        tbodyKits.innerHTML += `
            <tr>
                <td>${p.id ? '#' + escapar(p.id) : '—'}</td>
                <td>${escapar(p.kit)}</td>
                <td>${p.fecha ? new Date(p.fecha).toLocaleDateString('es-CO') : 'Reciente'}</td>
                <td><span class="${badge}">${escapar(estado)}</span></td>
            </tr>
        `;
    });
}

function abrirModalKit(nombreKit, precio, idKit) {
    kitSeleccionadoActual = nombreKit;
    kitSeleccionadoActualId = idKit || 0;
    const tituloModal = document.getElementById('modalKitTitulo');
    if (tituloModal) tituloModal.textContent = `Solicitar: ${nombreKit} (${precio})`;

    if (document.getElementById('nombreEnvio')) document.getElementById('nombreEnvio').value = RZ_SESION.nombre() || '';
    if (document.getElementById('direccionEnvio')) document.getElementById('direccionEnvio').value = RZ_MEM.getItem('raiza_direccion') || '';

    const modal = document.getElementById('modalKit');
    if (modal) modal.classList.add('activo');
}

function cerrarModalKit() {
    const modal = document.getElementById('modalKit');
    if (modal) modal.classList.remove('activo');

    const form = document.getElementById('formCheckoutKit');
    if (form) form.reset();
}

// Abre el checkout con los datos REALES del kit (desde ClassKit o el respaldo local).
function abrirModalKitPorId(idKit) {
    const kit = detalleKitPorId(idKit);
    if (!kit) {
        alert('No encontramos ese kit en el catálogo. Actualiza la página e inténtalo de nuevo.');
        return;
    }
    const nombre = kit.name || kit.nombre || 'Kit RAIZA';
    abrirModalKit(nombre, formatearPrecio(kit.precio), Number(kit.idclass_kit) || idKit);
}

function cambiarMetodoPago() {
    const metodoSelect = document.getElementById('metodoPago');
    const seccionPse = document.getElementById('seccionPse');
    if (!metodoSelect || !seccionPse) return;

    const esPse = metodoSelect.value === 'PSE';
    seccionPse.classList.toggle('campo-oculto', !esPse);

    if (metodoSelect.value === 'PSE' || metodoSelect.value === 'Tarjeta') {
        mostrarProximamente('El pago en línea estará disponible próximamente. Tu pedido quedará registrado.');
    }
}

// Guía el pedido hacia el kit real (por nombre desde ClassKit; respalda con el id del catálogo)
async function resolverIdKit() {
    const kitsServidor = await cargarCatalogoKits();
    const nombreElegido = (kitSeleccionadoActual || '').trim().toLowerCase();
    const matchPorNombre = kitsServidor.find(k =>
        (k.name || '').trim().toLowerCase() === nombreElegido
    );
    if (matchPorNombre) return matchPorNombre.idclass_kit;
    const matchPorId = kitsServidor.find(k => k.idclass_kit === kitSeleccionadoActualId);
    if (matchPorId) return matchPorId.idclass_kit;
    return kitSeleccionadoActualId || 0;
}

function guardarRespaldoPedidoLocal(id, kit, estado) {
    try {
        const pedidos = JSON.parse(RZ_MEM.getItem('raiza_pedidos') || '[]');
        pedidos.unshift({ id: id, kit: kit, estado: estado, fecha: new Date().toISOString() });
        RZ_MEM.setItem('raiza_pedidos', JSON.stringify(pedidos.slice(0, 10)));
    } catch (err) { /* Cuota de almacenamiento llena */ }
}

document.getElementById('formCheckoutKit')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = (document.getElementById('nombreEnvio') || {}).value || '';
    const direccion = ((document.getElementById('direccionEnvio') || {}).value || '').trim();
    const metodo = ((document.getElementById('metodoPago') || {}).value || '').trim();

    if (!direccion) {
        alert('Ingresa la dirección de envío para poder registrar el pedido.');
        return;
    }
    if (!metodo) {
        alert('Selecciona un método de pago.');
        return;
    }

    const token = localStorage.getItem('raiza_jwt');
    const estudianteId = parseInt(RZ_SESION.id() || '0');

    const btn = e.target.querySelector('button[type="submit"]');
    const textoOriginal = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }

    try {
        const idKit = await resolverIdKit();
        if (!idKit) {
            alert('No pudimos identificar el kit seleccionado. Cierra y abre el catálogo e inténtalo de nuevo.');
            return;
        }

        const response = await fetch(`${API_BASE_URL}/PedidoKit`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idclasskit: idKit,
                cantidad: 1,
                estado: 'Pendiente',
                direccionenvio: direccion,
                fechapedido: new Date().toISOString(),
                idestudiante: estudianteId,
                metodopago: metodo
            })
        });

        if (response.status === 401) {
            alert('Tu sesión expiró. Inicia sesión nuevamente.');
            window.location.href = 'login.html';
            return;
        }

        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            const idPedido = data.idPedidoKit ?? data.IdPedidoKit ?? null;
            const pedidoCreado = data.pedidoKit || data;

            guardarRespaldoPedidoLocal(idPedido, kitSeleccionadoActual, 'Pendiente');

            alert('Pedido registrado correctamente' + (idPedido ? ` (Pedido #${idPedido})` : '') + '.\n\n' +
                'Tu kit quedó con estado "Pendiente". Cuando la administración confirme el pago (lo marcará como Enviado o Entregado), tu módulo avanzado se desbloqueará.');
            cerrarModalKit();
            cargarPedidosKitsDesdeServidor();
            verificarDesbloqueoModuloAvanzado();
            return;
        }

        const err = await response.json().catch(() => ({}));
        alert('No se pudo registrar el pedido: ' + (err.mensaje || ('código ' + response.status)));
    } catch (error) {
        console.warn('Servidor no disponible al registrar el pedido. Guardando en local.');
        guardarRespaldoPedidoLocal(null, kitSeleccionadoActual, 'Pendiente');
        alert('No pudimos conectar con el servidor. Guardamos el pedido localmente; se confirmará cuando haya conexión.');
        cerrarModalKit();
        cargarPedidosKitsDesdeServidor();
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
    }
});

// ==========================================
// 7. CERTIFICADOS (CertificadoController)
// ==========================================
async function cargarCertificadosDesdeServidor() {
    const token = localStorage.getItem('raiza_jwt');
    try {
        const response = await fetch(`${API_BASE_URL}/Certificado`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            misCertificados = await response.json();
        }
    } catch (error) {
        console.warn('Error al consultar certificados.');
    }
}

// ==========================================
// 8. UTILIDADES Y SEGURIDAD
// ==========================================
function cerrarSesion() { 
    if(confirm('¿Deseas cerrar sesión?')) { 
        localStorage.clear(); 
        window.location.href = 'login.html'; 
    } 
}

function mostrarAvisoIntegracion(msg) { 
    const texto = `"${msg}" estará disponible próximamente.`;
    if (typeof mostrarProximamente === 'function') { mostrarProximamente(texto); } else { alert(texto); }
}

document.getElementById('inputFotoPerfil')?.addEventListener('change', function(e) {
    const archivo = e.target.files[0];
    if (archivo) {
        const reader = new FileReader();
        reader.onload = function(evento) {
            const f = evento.target.result;
            if(document.getElementById('imgPerfil')) document.getElementById('imgPerfil').src = f;
            const imgSidebar = document.getElementById('imgPerfilSidebar');
            if (imgSidebar) imgSidebar.src = f;
            RZ_MEM.setItem('raiza_fotoPerfil', f);
        };
        reader.readAsDataURL(archivo);
    }
});

function borrarFotoPerfil() {
    if(confirm('¿Eliminar tu foto de perfil?')) {
        RZ_MEM.removeItem('raiza_fotoPerfil');
        const iniciales = avatarIniciales(RZ_SESION.nombre() || 'U');
        if(document.getElementById('imgPerfil')) document.getElementById('imgPerfil').src = iniciales;
        const imgSidebar = document.getElementById('imgPerfilSidebar');
        if (imgSidebar) imgSidebar.src = iniciales;
        const inputFoto = document.getElementById('inputFotoPerfil');
        if (inputFoto) inputFoto.value = "";
    }
}

function guardarPrivacidad() {
    mostrarProximamente('Las preferencias de notificaciones y privacidad estarán disponibles próximamente.');
}

document.addEventListener('DOMContentLoaded', () => {
    if (!verificarSesionEstudiante()) return;

    renderizarCatalogoKits();

    cargarPerfilDesdeServidor();
    cargarTareasDesdeServidor();
    verificarDesbloqueoModuloAvanzado();

    // Si el video de recursos/ no existe, se muestra un aviso amable en su lugar
    document.querySelectorAll('.visor-multimedia video').forEach(video => {
        video.addEventListener('error', () => {
            const contenedor = video.closest('.visor-multimedia');
            if (contenedor && !contenedor.querySelector('.video-no-disponible')) {
                contenedor.innerHTML = `
                    <div class="video-no-disponible">
                        <span>${window.RZ ? RZ.icon('video') : ''}</span>
                        El video aún no está disponible.
                        Está siendo preparado por el equipo RAIZA.
                    </div>
                `;
            }
        });
    });

    // Blindaje de seguridad en el cliente
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', e => { 
        if (e.key === 'F12' || (e.ctrlKey && ['u','s','p','i'].includes(e.key))) e.preventDefault(); 
    });

    const nombre = RZ_SESION.nombre() || 'Estudiante';

    // Avatar de respaldo con iniciales: si la foto externa no carga, nunca se ve rota
    inicializarAvatar('imgPerfil', nombre);
    inicializarAvatar('imgPerfilSidebar', nombre);

    document.querySelectorAll('.contenido-protegido').forEach(panel => {
        const marca = document.createElement('div');
        marca.className = 'marca-agua-seguridad';
        marca.innerHTML = `${nombre} - Uso Exclusivo RAIZA &bull; `.repeat(40);
        panel.appendChild(marca);
    });
});