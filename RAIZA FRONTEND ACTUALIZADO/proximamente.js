/* RAIZA — proximamente.js
   Aviso emergente para funciones que aún no están disponibles.
   Uso: mostrarProximamente('Texto del aviso'); */
(function(){
  var css = '.rz-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);max-width:min(92vw,440px);background:#3c4229;color:#fff;'
    + 'padding:14px 20px;border-radius:12px;font:500 .9rem/1.45 Inter,sans-serif;box-shadow:0 14px 34px -14px rgba(44,49,30,.6);'
    + 'border-left:4px solid #d8dd85;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:9999;}'
    + '.rz-toast.on{opacity:1;transform:translate(-50%,0);}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var t, el;
  window.mostrarProximamente = function(msg){
    if(!el){ el = document.createElement('div'); el.className = 'rz-toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
    el.textContent = msg || 'Esta función estará disponible próximamente.';
    el.classList.add('on'); clearTimeout(t);
    t = setTimeout(function(){ el.classList.remove('on'); }, 4200);
  };
})();
