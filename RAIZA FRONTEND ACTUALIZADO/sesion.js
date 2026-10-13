/* RAIZA — sesion.js
   En el navegador (F12 > Aplicación > Almacenamiento local) queda SOLO el token: raiza_jwt.
   El rol, el nombre y el id del usuario se leen del propio token (JWT) cuando se necesitan.
   Los datos personales (teléfono, dirección, foto, pedidos, entregas) viven solo en memoria. */
(function(){
  // ---------- Memoria (se pierde al recargar; no se ve en F12) ----------
  var mem = {};
  window.RZ_MEM = {
    get: function(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    set: function(k, v){ mem[k] = String(v); },
    remove: function(k){ delete mem[k]; }
  };

  // ---------- Lectura del token ----------
  var CLAIMS = {
    rol:    ['role', 'rol', 'Rol', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'],
    nombre: ['nombre', 'Nombre', 'given_name'],   // 'name'/'unique_name' traen el correo, no el nombre
    id:     ['nameid', 'idUsuario', 'IdUsuario', 'uid', 'sub', 'id', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']
  };
  var LEGADO = { rol: 'raiza_rol', nombre: 'raiza_nombre', id: 'raiza_idUsuario' };
  var override = {};

  function payload(){
    try {
      var t = localStorage.getItem('raiza_jwt');
      if (!t) return null;
      var b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function claim(campo){
    var p = payload();
    if (!p) return null;
    for (var i = 0; i < CLAIMS[campo].length; i++) {
      var v = p[CLAIMS[campo][i]];
      if (Array.isArray(v)) v = v[0];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return null;
  }

  function leer(campo){
    if (override[campo]) return override[campo];
    var v = claim(campo);
    if (v !== null) return v;
    // Respaldo: solo existe si el token no trae ese dato (ver guardarLogin)
    return localStorage.getItem(LEGADO[campo]);
  }

  window.RZ_SESION = {
    rol:    function(){ return leer('rol'); },
    nombre: function(){ return leer('nombre'); },
    id:     function(){ return leer('id'); },
    setNombre: function(n){ override.nombre = String(n || ''); },

    // Guarda el token. Si el token NO trae rol/nombre/id, se guarda ese dato aparte para no romper el portal.
    guardarLogin: function(token, datos){
      localStorage.setItem('raiza_jwt', token);
      Object.keys(LEGADO).forEach(function(c){ localStorage.removeItem(LEGADO[c]); });
      var faltan = [];
      ['rol', 'nombre', 'id'].forEach(function(c){
        if (claim(c) === null && datos && datos[c]) {
          localStorage.setItem(LEGADO[c], datos[c]);
          faltan.push(c);
        }
      });
      if (faltan.length) console.warn('El token no incluye: ' + faltan.join(', ') + '. Agrégalo como claim en el backend para dejar solo el token en el navegador.');
    }
  };

  // Borra lo que versiones anteriores dejaron guardado (si el token ya trae esos datos)
  try {
    Object.keys(localStorage).forEach(function(k){
      if (/^raiza_(correo|telefono|direccion|fotoPerfil|pedidos|entrega_)/.test(k)) localStorage.removeItem(k);
    });
    if (localStorage.getItem('raiza_jwt')) {
      Object.keys(LEGADO).forEach(function(c){ if (claim(c) !== null) localStorage.removeItem(LEGADO[c]); });
    }
  } catch (e) {}
})();