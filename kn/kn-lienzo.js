/* ===========================================================
   KUBRICK NEWS · LIENZO DE PORTADA
   -----------------------------------------------------------
   La portada deja de armarse por secciones y pasa a ser un lienzo
   libre, como una mesa de diseño: tarjetas de noticias, textos,
   líneas, rectángulos e imágenes que se colocan donde uno quiera.

   - Visitantes en escritorio/tablet: ven el lienzo tal cual se
     diseñó (si la pantalla es más angosta que el lienzo, se reduce
     en proporción).
   - Visitantes en celular: los elementos se apilan en una columna,
     de arriba hacia abajo, en el orden en que están en el lienzo.
   - Admin: editor con guías inteligentes (sin cuadrícula), panel
     de propiedades, capas, deshacer/rehacer y atajos de teclado.

   Todo se guarda en estadoRemoto.lienzo (mismo archivo del
   servidor que ya usa /api/portada; no hace falta tocar la API).

   Forma de los datos:
     lienzo = { version: 1, ancho: 1220, elementos: [ ... ] }
     elemento = { id, tipo, x, y, w, h, z, ...propiedades }
       tipo "caso":   casoId, estilo ("foto" | "mini" | "titular"),
                      barra (bool), conteo (bool)
       tipo "texto":  texto, fuente, tam, peso, cursiva, alin,
                      interlineado, espaciado, mayus, color, enlace
       tipo "forma":  relleno, borde, grosorBorde, radio
       tipo "linea":  color, grosor            (horizontal si w >= h)
       tipo "imagen": src, ajuste ("cover" | "contain"), radio, enlace
   =========================================================== */
(function () {
  "use strict";

  const ANCHO = 1220;
  const UMBRAL_IMAN = 6;          // px en pantalla para que una guía "imante"
  const MAX_HISTORIAL = 120;
  const CORTE_CELULAR = 720;      // por debajo, la portada se apila

  /* comillas simples: estos valores van dentro de un atributo style="" */
  const FUENTES = {
    titular: "'Cormorant Garamond', Garamond, 'Times New Roman', serif",
    texto:   "'EB Garamond', Garamond, Georgia, serif",
    versal:  "'Cormorant SC', 'Cormorant Garamond', serif",
    sistema: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Arial, sans-serif"
  };
  const NOMBRE_FUENTE = { titular: "Cormorant · titulares", texto: "EB Garamond · texto", versal: "Versalitas", sistema: "Sistema · sans" };
  const COLORES = [
    ["#1D1D1F", "Negro"], ["#424245", "Gris oscuro"], ["#86868B", "Gris"], ["#D2D2D7", "Gris claro"],
    ["#F5F5F7", "Gris fondo"], ["#FFFFFF", "Blanco"], ["#24477F", "Azul"], ["#C2403A", "Rojo"]
  ];
  const ESTILOS_CASO = { foto: "Foto con titular encima", mini: "Miniatura + titular", titular: "Solo titular" };

  /* ---------------- estado del editor ---------------- */
  let seleccion = [];            // ids seleccionados (el primero es el "principal")
  let historial = [], futuro = [];
  let editandoTexto = null;      // id del texto en edición
  let escala = 1;
  let instantaneaCampo = null;   // para deshacer cambios hechos desde el panel
  let tecladoConectado = false;
  let portapapeles = null;
  let ultimosCasos = [];

  /* ---------------- utilidades ---------------- */
  function L() {
    if (!estadoRemoto.lienzo || !Array.isArray(estadoRemoto.lienzo.elementos)) {
      estadoRemoto.lienzo = { version: 1, ancho: ANCHO, elementos: [] };
    }
    return estadoRemoto.lienzo;
  }
  function hayLienzo() {
    return !!(estadoRemoto.lienzo && Array.isArray(estadoRemoto.lienzo.elementos) && estadoRemoto.lienzo.elementos.length);
  }
  function uid() { return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function porIdEl(id) { return L().elementos.find(function (e) { return e.id === id; }); }
  function zMax() { return L().elementos.reduce(function (m, e) { return Math.max(m, e.z || 0); }, 0); }
  function redondo(n) { return Math.round(n); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function altoLienzo(margen) {
    const fondo = L().elementos.reduce(function (m, e) { return Math.max(m, e.y + (e.h || 0)); }, 0);
    return Math.max(400, fondo + margen);
  }
  function mapaCasos(casos) {
    const m = {};
    (casos || []).forEach(function (c) { m[c.id] = c; });
    return m;
  }
  function escAttr(t) { return esc(t == null ? "" : String(t)); }

  /* ---------------- contenido de cada elemento ---------------- */
  function contenidoCaso(e, caso, editor) {
    if (!caso) {
      return '<div class="lz-caso-faltante">Noticia no disponible' + (editor ? "<small>" + escAttr(e.casoId) + "</small>" : "") + "</div>";
    }
    const imagenes = imagenesDeNoticia(caso);
    const vel = velocidadDeNoticia(caso);
    const href = editor ? "" : ' href="#/caso/' + escAttr(caso.id) + '"';
    const conteo = e.conteo === false ? "" : "<p>" + esc(caso.coberturas.length) + " medios comparados</p>";
    const barra = e.barra === false ? "" : barraLCD(caso);
    const estilo = e.estilo || "foto";

    if (estilo === "foto") {
      return '<a class="tarjeta-grande lz-tarjeta"' + href + ">" +
        (imagenes.length ? '<div class="fondo-grande' + claseCarrusel(imagenes) + '"' + atributosCarrusel(imagenes, vel) + estiloFondo(imagenes) + "></div>" : "") +
        '<div class="velo-grande"></div>' +
        '<div class="texto-grande"><h2>' + esc(caso.titulo) + "</h2>" + conteo + barra + "</div></a>";
    }
    if (estilo === "mini") {
      return '<a class="tarjeta-mediana lz-tarjeta"' + href + ">" +
        (imagenes.length
          ? '<div class="miniatura-mediana' + claseCarrusel(imagenes) + '"' + atributosCarrusel(imagenes, vel) + estiloFondo(imagenes) + "></div>"
          : '<div class="miniatura-mediana miniatura-vacia"></div>') +
        '<div class="texto-mediana"><h3>' + esc(caso.titulo) + "</h3>" + conteo + barra + "</div></a>";
    }
    return '<a class="tarjeta-pequena lz-tarjeta lz-solo-titular"' + href + ">" +
      '<div class="texto-pequeno"><span class="titulo-pequeno">' + esc(caso.titulo) + "</span>" + conteo + barra + "</div></a>";
  }

  function estiloTexto(e) {
    return "font-family:" + (FUENTES[e.fuente] || FUENTES.titular) + ";" +
      "font-size:" + (e.tam || 32) + "px;" +
      "font-weight:" + (e.peso || 500) + ";" +
      "font-style:" + (e.cursiva ? "italic" : "normal") + ";" +
      "text-align:" + (e.alin || "left") + ";" +
      "line-height:" + (e.interlineado || 1.15) + ";" +
      "letter-spacing:" + (e.espaciado || 0) + "em;" +
      "text-transform:" + (e.mayus ? "uppercase" : "none") + ";" +
      "color:" + (e.color || "#1D1D1F") + ";" +
      "--tam:" + (e.tam || 32) + "px;";
  }

  function contenidoElemento(e, porId, editor) {
    if (e.tipo === "caso") return contenidoCaso(e, porId[e.casoId], editor);
    if (e.tipo === "texto") {
      const interior = '<div class="lz-texto" style="' + estiloTexto(e) + '">' + esc(e.texto || "") + "</div>";
      return (!editor && e.enlace) ? '<a class="lz-enlace" href="' + escAttr(e.enlace) + '">' + interior + "</a>" : interior;
    }
    if (e.tipo === "forma") {
      return '<div class="lz-forma" style="background:' + (e.relleno || "transparent") + ";" +
        "border:" + (e.grosorBorde || 0) + "px solid " + (e.borde || "transparent") + ";" +
        "border-radius:" + (e.radio != null ? e.radio : 12) + 'px"></div>';
    }
    if (e.tipo === "linea") {
      const horizontal = e.w >= e.h;
      return '<div class="lz-linea ' + (horizontal ? "h" : "v") + '" style="--grosor:' + (e.grosor || 1) + "px;--color:" + (e.color || "#1D1D1F") + '"></div>';
    }
    if (e.tipo === "imagen") {
      const img = e.src
        ? '<img src="' + escAttr(e.src) + '" alt="" style="object-fit:' + (e.ajuste || "cover") + ";border-radius:" + (e.radio != null ? e.radio : 12) + 'px" draggable="false">'
        : '<div class="lz-imagen-vacia">Imagen<br><small>pega un enlace en el panel</small></div>';
      return (!editor && e.enlace) ? '<a class="lz-enlace" href="' + escAttr(e.enlace) + '">' + img + "</a>" : img;
    }
    return "";
  }

  function htmlElemento(e, porId, editor) {
    const alto = e.tipo === "texto" ? "" : "height:" + e.h + "px;";
    return '<div class="lz-el lz-' + e.tipo + (e.tipo === "caso" ? " lz-estilo-" + (e.estilo || "foto") : "") + '" data-id="' + escAttr(e.id) + '" ' +
      'style="left:' + e.x + "px;top:" + e.y + "px;width:" + e.w + "px;" + alto + "z-index:" + (e.z || 1) + '">' +
      contenidoElemento(e, porId, editor) + "</div>";
  }

  /* ---------------- vista pública ---------------- */
  function ordenLectura(a, b) { return (a.y - b.y) || (a.x - b.x); }

  function htmlPila(porId) {
    const lista = L().elementos.slice().sort(ordenLectura);
    return '<div class="lz-pila">' + lista.map(function (e) {
      if (e.tipo === "forma") return "";
      if (e.tipo === "linea") return e.w >= e.h ? '<hr class="lz-pila-linea" style="border-top:' + (e.grosor || 1) + "px solid " + (e.color || "#1D1D1F") + '">' : "";
      if (e.tipo === "imagen" && !e.src) return "";
      const extra = e.tipo === "imagen" ? ' style="aspect-ratio:' + e.w + "/" + e.h + '"' : "";
      return '<div class="lz-pila-el lz-' + e.tipo + (e.tipo === "caso" ? " lz-estilo-" + (e.estilo || "foto") : "") + '"' + extra + ">" +
        contenidoElemento(e, porId, false) + "</div>";
    }).join("") + "</div>";
  }

  function htmlFiltrado(casos) {
    const visibles = casos.filter(function (c) { return (c.temas || []).indexOf(filtroTema) !== -1; });
    if (!visibles.length) return '<div class="vacio"><p>No hay noticias de este tema todavía.</p></div>';
    return '<div class="lz-filtro">' + visibles.map(function (c) {
      return '<div class="lz-filtro-el">' + contenidoCaso({ estilo: "foto" }, c, false) + "</div>";
    }).join("") + "</div>";
  }

  function htmlPublico(casos) {
    if (filtroTema) return htmlFiltrado(casos);
    const porId = mapaCasos(casos);
    const elementos = L().elementos.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    const alto = altoLienzo(24);
    return '<div class="lz-marco" data-alto="' + alto + '">' +
      '<div class="lz-lienzo" style="width:' + ANCHO + "px;height:" + alto + 'px">' +
        elementos.map(function (e) { return htmlElemento(e, porId, false); }).join("") +
      "</div></div>" + htmlPila(porId);
  }

  /* ---------------- vista del editor ---------------- */
  function boton(accion, texto, titulo, extra) {
    return '<button type="button" class="lz-bt' + (extra || "") + '" data-lz="' + accion + '" title="' + escAttr(titulo || texto) + '">' + texto + "</button>";
  }

  function htmlEditor(casos) {
    const alto = altoLienzo(320);
    return '<div class="lz-editor-raiz">' +
      '<div class="lz-marco lz-modo-editor" data-alto="' + alto + '">' +
        '<div class="lz-lienzo lz-editor" id="lz-lienzo" style="width:' + ANCHO + "px;height:" + alto + 'px"></div>' +
      "</div>" +
      '<div class="lz-barra-herr" id="lz-herr">' +
        '<div class="lz-grupo">' +
          boton("nuevo-texto", "Texto", "Agregar un texto (T)") +
          boton("nuevo-caso", "Noticia", "Agregar una tarjeta de noticia (N)") +
          boton("nueva-linea", "Línea", "Agregar una línea (L)") +
          boton("nueva-forma", "Rectángulo", "Agregar un rectángulo (R)") +
          boton("nueva-imagen", "Imagen", "Agregar una imagen (I)") +
        "</div>" +
        '<div class="lz-grupo">' +
          boton("deshacer", "↶", "Deshacer (Ctrl+Z)") +
          boton("rehacer", "↷", "Rehacer (Ctrl+Y)") +
        "</div>" +
        '<div class="lz-grupo">' +
          boton("duplicar", "Duplicar", "Duplicar (Ctrl+D)") +
          boton("frente", "Al frente", "Traer al frente (Ctrl+])") +
          boton("atras", "Atrás", "Enviar atrás (Ctrl+[)") +
          boton("eliminar", "Eliminar", "Eliminar (Supr)", " peligro") +
        "</div>" +
        '<span class="lz-estado" id="lz-estado"></span>' +
      "</div>" +
      '<div class="lz-menu-casos oculto" id="lz-menu-casos"></div>' +
      '<aside class="lz-panel" id="lz-panel"></aside>' +
    "</div>";
  }

  /* ---------------- dibujo del lienzo en el editor ---------------- */
  function pintar() {
    const lienzo = document.getElementById("lz-lienzo");
    if (!lienzo) return;
    const porId = mapaCasos(ultimosCasos);
    const elementos = L().elementos.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    lienzo.innerHTML = elementos.map(function (e) { return htmlElemento(e, porId, true); }).join("") +
      '<div class="lz-guias" id="lz-guias"></div><div class="lz-sel-capa" id="lz-sel-capa"></div>';
    medirTextos();
    ajustarAlto();
    pintarSeleccion();
    pintarPanel();
  }

  /* los textos tienen alto automático: se mide después de dibujar */
  function medirTextos() {
    document.querySelectorAll("#lz-lienzo .lz-el.lz-texto").forEach(function (nodo) {
      const e = porIdEl(nodo.dataset.id);
      if (e) e.h = nodo.offsetHeight;
    });
  }

  function ajustarAlto() {
    const lienzo = document.getElementById("lz-lienzo");
    if (!lienzo) return;
    const editor = lienzo.classList.contains("lz-editor");
    const alto = altoLienzo(editor ? 320 : 24);
    lienzo.style.height = alto + "px";
    const marco = lienzo.parentElement;
    marco.dataset.alto = alto;
    reescalar();
  }

  function reescalar() {
    document.querySelectorAll(".lz-marco").forEach(function (marco) {
      const lienzo = marco.querySelector(".lz-lienzo");
      if (!lienzo) return;
      const disponible = marco.clientWidth || ANCHO;
      const s = Math.min(1, disponible / ANCHO);
      lienzo.style.transform = "scale(" + s + ")";
      marco.style.height = (parseFloat(marco.dataset.alto || lienzo.offsetHeight) * s) + "px";
      if (lienzo.classList.contains("lz-editor")) escala = s;
    });
  }

  function cajaDe(ids) {
    const els = ids.map(porIdEl).filter(Boolean);
    if (!els.length) return null;
    const x = Math.min.apply(null, els.map(function (e) { return e.x; }));
    const y = Math.min.apply(null, els.map(function (e) { return e.y; }));
    const r = Math.max.apply(null, els.map(function (e) { return e.x + e.w; }));
    const b = Math.max.apply(null, els.map(function (e) { return e.y + e.h; }));
    return { x: x, y: y, w: r - x, h: b - y };
  }

  function pintarSeleccion() {
    const capa = document.getElementById("lz-sel-capa");
    if (!capa) return;
    seleccion = seleccion.filter(porIdEl);
    document.querySelectorAll("#lz-lienzo .lz-el").forEach(function (n) {
      n.classList.toggle("seleccionado", seleccion.indexOf(n.dataset.id) > -1);
    });
    if (!seleccion.length) { capa.innerHTML = ""; return; }
    const c = cajaDe(seleccion);
    const unico = seleccion.length === 1 ? porIdEl(seleccion[0]) : null;
    let manijas = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    if (unico && unico.tipo === "texto") manijas = ["e", "w"];
    if (unico && unico.tipo === "linea") manijas = unico.w >= unico.h ? ["e", "w"] : ["n", "s"];
    if (!unico) manijas = [];
    const inv = 1 / escala;
    capa.innerHTML = '<div class="lz-sel" style="left:' + c.x + "px;top:" + c.y + "px;width:" + c.w + "px;height:" + c.h + "px;--inv:" + inv + '">' +
      manijas.map(function (m) { return '<span class="lz-manija m-' + m + '" data-manija="' + m + '"></span>'; }).join("") +
      '<span class="lz-medidas">' + redondo(c.w) + " × " + redondo(c.h) + "</span>" +
    "</div>";
  }

  function repintarElemento(id) {
    const e = porIdEl(id);
    const nodo = document.querySelector('#lz-lienzo .lz-el[data-id="' + id + '"]');
    if (!e || !nodo) { pintar(); return; }
    const tmp = document.createElement("div");
    tmp.innerHTML = htmlElemento(e, mapaCasos(ultimosCasos), true);
    const nuevo = tmp.firstChild;
    nodo.replaceWith(nuevo);
    if (e.tipo === "texto") e.h = nuevo.offsetHeight;
    pintarSeleccion();
  }

  function moverNodos(ids) {
    ids.forEach(function (id) {
      const e = porIdEl(id);
      const n = document.querySelector('#lz-lienzo .lz-el[data-id="' + id + '"]');
      if (!e || !n) return;
      n.style.left = e.x + "px"; n.style.top = e.y + "px"; n.style.width = e.w + "px";
      if (e.tipo !== "texto") n.style.height = e.h + "px";
      else e.h = n.offsetHeight;
      if (e.tipo === "linea") {
        const l = n.querySelector(".lz-linea");
        if (l) l.className = "lz-linea " + (e.w >= e.h ? "h" : "v");
      }
    });
    pintarSeleccion();
  }

  /* ---------------- historial y guardado ---------------- */
  function foto() { return JSON.stringify(L().elementos); }
  function recordar(instantanea) {
    historial.push(instantanea || foto());
    if (historial.length > MAX_HISTORIAL) historial.shift();
    futuro = [];
  }
  let temporizadorEstado = null;
  function guardar() {
    estadoRemoto.lienzo.version = 1;
    estadoRemoto.lienzo.ancho = ANCHO;
    guardarEstadoRemoto();
    const est = document.getElementById("lz-estado");
    if (est) {
      est.textContent = "Guardando…";
      clearTimeout(temporizadorEstado);
      temporizadorEstado = setTimeout(function () { est.textContent = "Guardado"; }, 1100);
    }
  }
  function deshacer() {
    if (!historial.length) return;
    futuro.push(foto());
    L().elementos = JSON.parse(historial.pop());
    pintar(); guardar();
  }
  function rehacer() {
    if (!futuro.length) return;
    historial.push(foto());
    L().elementos = JSON.parse(futuro.pop());
    pintar(); guardar();
  }

  /* ---------------- crear elementos ---------------- */
  function centroVisible(w, h) {
    const lienzo = document.getElementById("lz-lienzo");
    const r = lienzo.getBoundingClientRect();
    const yVista = (window.innerHeight / 2 - r.top) / escala;
    return { x: redondo((ANCHO - w) / 2), y: redondo(clamp(yVista - h / 2, 0, altoLienzo(0) + 200)) };
  }
  function agregar(e) {
    recordar();
    const p = centroVisible(e.w, e.h);
    e.id = uid(); e.x = e.x != null ? e.x : p.x; e.y = e.y != null ? e.y : p.y; e.z = zMax() + 1;
    L().elementos.push(e);
    seleccion = [e.id];
    pintar(); guardar();
    return e;
  }
  function nuevoTexto() {
    const e = agregar({ tipo: "texto", w: 520, h: 50, texto: "Escribe aquí", fuente: "titular", tam: 40, peso: 500, cursiva: false, alin: "left", interlineado: 1.1, espaciado: 0, mayus: false, color: "#1D1D1F" });
    empezarEdicionTexto(e.id);
  }
  function nuevaLinea() { agregar({ tipo: "linea", w: 600, h: 9, color: "#1D1D1F", grosor: 1 }); }
  function nuevaForma() { agregar({ tipo: "forma", w: 360, h: 220, relleno: "#F5F5F7", borde: "#D2D2D7", grosorBorde: 0, radio: 12 }); }
  function nuevaImagen() { agregar({ tipo: "imagen", w: 480, h: 300, src: "", ajuste: "cover", radio: 12, enlace: "" }); }
  function nuevoCaso(casoId) {
    agregar({ tipo: "caso", casoId: casoId, estilo: "foto", w: 600, h: 340, barra: true, conteo: true });
  }

  function abrirMenuCasos(anclaBoton) {
    const menu = document.getElementById("lz-menu-casos");
    const usados = {};
    L().elementos.forEach(function (e) { if (e.tipo === "caso") usados[e.casoId] = true; });
    const lista = ultimosCasos.slice().sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    menu.innerHTML = '<input type="search" class="lz-buscar" placeholder="Buscar noticia…">' +
      '<div class="lz-lista-casos">' + lista.map(function (c) {
        return '<button type="button" data-caso="' + escAttr(c.id) + '" class="' + (usados[c.id] ? "usado" : "") + '">' +
          '<span>' + esc(c.titulo) + "</span>" + (usados[c.id] ? "<em>ya está en la portada</em>" : "") + "</button>";
      }).join("") + "</div>";
    menu.classList.remove("oculto");
    const r = anclaBoton.getBoundingClientRect();
    menu.style.left = Math.max(12, r.left) + "px";
    menu.style.bottom = (window.innerHeight - r.top + 10) + "px";
    const buscar = menu.querySelector(".lz-buscar");
    buscar.focus();
    buscar.addEventListener("input", function () {
      const q = buscar.value.toLowerCase();
      menu.querySelectorAll("[data-caso]").forEach(function (b) { b.style.display = b.textContent.toLowerCase().indexOf(q) > -1 ? "" : "none"; });
    });
    menu.querySelectorAll("[data-caso]").forEach(function (b) {
      b.addEventListener("click", function () { cerrarMenuCasos(); nuevoCaso(b.dataset.caso); });
    });
  }
  function cerrarMenuCasos() {
    const menu = document.getElementById("lz-menu-casos");
    if (menu) menu.classList.add("oculto");
  }

  /* ---------------- acciones sobre la selección ---------------- */
  function duplicar() {
    if (!seleccion.length) return;
    recordar();
    const nuevos = [];
    let z = zMax();
    seleccion.map(porIdEl).filter(Boolean).forEach(function (e) {
      const c = JSON.parse(JSON.stringify(e));
      c.id = uid(); c.x += 20; c.y += 20; c.z = ++z;
      L().elementos.push(c); nuevos.push(c.id);
    });
    seleccion = nuevos; pintar(); guardar();
  }
  function eliminar() {
    if (!seleccion.length) return;
    recordar();
    L().elementos = L().elementos.filter(function (e) { return seleccion.indexOf(e.id) === -1; });
    seleccion = []; pintar(); guardar();
  }
  function capas(direccion) {
    if (!seleccion.length) return;
    recordar();
    const orden = L().elementos.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    const elegidos = orden.filter(function (e) { return seleccion.indexOf(e.id) > -1; });
    const resto = orden.filter(function (e) { return seleccion.indexOf(e.id) === -1; });
    const nuevo = direccion === "frente" ? resto.concat(elegidos) : elegidos.concat(resto);
    nuevo.forEach(function (e, i) { e.z = i + 1; });
    pintar(); guardar();
  }
  function copiar() {
    if (!seleccion.length) return;
    portapapeles = JSON.stringify(seleccion.map(porIdEl).filter(Boolean));
  }
  function pegar() {
    if (!portapapeles) return;
    recordar();
    let z = zMax();
    const nuevos = JSON.parse(portapapeles).map(function (e) { e.id = uid(); e.x += 24; e.y += 24; e.z = ++z; return e; });
    nuevos.forEach(function (e) { L().elementos.push(e); });
    portapapeles = JSON.stringify(nuevos);
    seleccion = nuevos.map(function (e) { return e.id; });
    pintar(); guardar();
  }
  function alinear(modo) {
    if (seleccion.length < 2) return;
    recordar();
    const c = cajaDe(seleccion);
    seleccion.map(porIdEl).forEach(function (e) {
      if (modo === "izq") e.x = c.x;
      if (modo === "cen") e.x = redondo(c.x + (c.w - e.w) / 2);
      if (modo === "der") e.x = c.x + c.w - e.w;
      if (modo === "arr") e.y = c.y;
      if (modo === "med") e.y = redondo(c.y + (c.h - e.h) / 2);
      if (modo === "aba") e.y = c.y + c.h - e.h;
    });
    moverNodos(seleccion); guardar();
  }
  function distribuir(eje) {
    if (seleccion.length < 3) return;
    recordar();
    const els = seleccion.map(porIdEl).sort(function (a, b) { return eje === "h" ? a.x - b.x : a.y - b.y; });
    const c = cajaDe(seleccion);
    const total = els.reduce(function (s, e) { return s + (eje === "h" ? e.w : e.h); }, 0);
    const hueco = ((eje === "h" ? c.w : c.h) - total) / (els.length - 1);
    let pos = eje === "h" ? c.x : c.y;
    els.forEach(function (e) {
      if (eje === "h") { e.x = redondo(pos); pos += e.w + hueco; } else { e.y = redondo(pos); pos += e.h + hueco; }
    });
    moverNodos(seleccion); guardar();
  }
  function centrarEnPagina() {
    if (!seleccion.length) return;
    recordar();
    const c = cajaDe(seleccion);
    const dx = redondo((ANCHO - c.w) / 2) - c.x;
    seleccion.map(porIdEl).forEach(function (e) { e.x += dx; });
    moverNodos(seleccion); guardar();
  }

  /* ---------------- guías inteligentes ---------------- */
  /* Compara los bordes y centros de la caja que se mueve con los de
     todos los demás elementos y con los bordes y el centro del lienzo.
     Si alguno queda a menos de UMBRAL_IMAN px (en pantalla), la caja
     se imanta y se dibuja la guía. También detecta distancias iguales
     entre vecinos de la misma fila o columna. */
  function referencias(excluir) {
    const otros = L().elementos.filter(function (e) { return excluir.indexOf(e.id) === -1; });
    return otros;
  }

  function imantar(caja, excluir, bordes) {
    const umbral = UMBRAL_IMAN / escala;
    const otros = referencias(excluir);
    const guias = [];
    const bx = bordes.x, by = bordes.y;   // qué puntos de la caja se pueden imantar: ["i","c","d"] / ["a","m","b"]

    function puntosX(c) { return { i: c.x, c: c.x + c.w / 2, d: c.x + c.w }; }
    function puntosY(c) { return { a: c.y, m: c.y + c.h / 2, b: c.y + c.h }; }

    let mejorX = null, mejorY = null;
    const px = puntosX(caja), py = puntosY(caja);

    const objetivosX = [{ v: 0, o: null }, { v: ANCHO / 2, o: null, centro: true }, { v: ANCHO, o: null }];
    const objetivosY = [];
    otros.forEach(function (o) {
      const ox = puntosX(o), oy = puntosY(o);
      objetivosX.push({ v: ox.i, o: o }, { v: ox.c, o: o }, { v: ox.d, o: o });
      objetivosY.push({ v: oy.a, o: o }, { v: oy.m, o: o }, { v: oy.b, o: o });
    });

    bx.forEach(function (k) {
      objetivosX.forEach(function (t) {
        const d = t.v - px[k];
        if (Math.abs(d) <= umbral && (!mejorX || Math.abs(d) < Math.abs(mejorX.d))) mejorX = { d: d, v: t.v };
      });
    });
    by.forEach(function (k) {
      objetivosY.forEach(function (t) {
        const d = t.v - py[k];
        if (Math.abs(d) <= umbral && (!mejorY || Math.abs(d) < Math.abs(mejorY.d))) mejorY = { d: d, v: t.v };
      });
    });

    /* distancias iguales (solo al mover, cuando se imantan las tres referencias) */
    let espacios = [];
    if (bx.length === 3 && !mejorX) {
      const r = espaciadoIgual(caja, otros, "x", umbral);
      if (r) { mejorX = { d: r.d, v: null }; espacios = espacios.concat(r.marcas); }
    }
    if (by.length === 3 && !mejorY) {
      const r = espaciadoIgual(caja, otros, "y", umbral);
      if (r) { mejorY = { d: r.d, v: null }; espacios = espacios.concat(r.marcas); }
    }

    const dx = mejorX ? mejorX.d : 0, dy = mejorY ? mejorY.d : 0;
    const final = { x: caja.x + dx, y: caja.y + dy, w: caja.w, h: caja.h };

    /* dibujar todas las coincidencias exactas tras imantar */
    const fx = puntosX(final), fy = puntosY(final);
    const vistas = {};
    function guiaV(x, extra) {
      const key = "v" + redondo(x);
      if (vistas[key]) return; vistas[key] = 1;
      let y1 = final.y, y2 = final.y + final.h;
      extra.forEach(function (o) { if (o) { y1 = Math.min(y1, o.y); y2 = Math.max(y2, o.y + o.h); } });
      guias.push({ t: "v", x: x, y1: y1, y2: y2 });
    }
    function guiaH(y, extra) {
      const key = "h" + redondo(y);
      if (vistas[key]) return; vistas[key] = 1;
      let x1 = final.x, x2 = final.x + final.w;
      extra.forEach(function (o) { if (o) { x1 = Math.min(x1, o.x); x2 = Math.max(x2, o.x + o.w); } });
      guias.push({ t: "h", y: y, x1: x1, x2: x2 });
    }
    bx.forEach(function (k) {
      const v = fx[k];
      if (Math.abs(v - ANCHO / 2) < 0.5) guias.push({ t: "v", x: ANCHO / 2, y1: 0, y2: altoLienzo(0) + 200, centro: true });
      const coinc = otros.filter(function (o) { const p = puntosX(o); return Math.abs(p.i - v) < 0.5 || Math.abs(p.c - v) < 0.5 || Math.abs(p.d - v) < 0.5; });
      if (coinc.length) guiaV(v, coinc);
    });
    by.forEach(function (k) {
      const v = fy[k];
      const coinc = otros.filter(function (o) { const p = puntosY(o); return Math.abs(p.a - v) < 0.5 || Math.abs(p.m - v) < 0.5 || Math.abs(p.b - v) < 0.5; });
      if (coinc.length) guiaH(v, coinc);
    });

    return { dx: dx, dy: dy, guias: guias, espacios: espacios };
  }

  /* Si la caja queda a la misma distancia de su vecino que la que hay
     entre otros dos elementos de la misma fila, o justo al medio entre
     dos vecinos, se imanta a esa posición y se marcan los huecos. */
  function espaciadoIgual(caja, otros, eje, umbral) {
    const X = eje === "x";
    const ini = function (c) { return X ? c.x : c.y; };
    const fin = function (c) { return X ? c.x + c.w : c.y + c.h; };
    const tam = function (c) { return X ? c.w : c.h; };
    const solapa = function (o) {
      return X ? (o.y < caja.y + caja.h && o.y + o.h > caja.y) : (o.x < caja.x + caja.w && o.x + o.w > caja.x);
    };
    const banda = otros.filter(solapa).sort(function (a, b) { return ini(a) - ini(b); });
    if (!banda.length) return null;

    const antes = banda.filter(function (o) { return fin(o) <= ini(caja) + umbral; }).pop();
    const despues = banda.filter(function (o) { return ini(o) >= fin(caja) - umbral; })[0];

    const marca = function (a, b) {
      return X ? { t: "eh", x1: fin(a), x2: ini(b), y: Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0 ? (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2 : a.y + a.h / 2 }
               : { t: "ev", y1: fin(a), y2: ini(b), x: (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2 };
    };

    /* justo al medio entre dos vecinos */
    if (antes && despues) {
      const objetivo = (fin(antes) + ini(despues) - tam(caja)) / 2;
      const d = objetivo - ini(caja);
      if (Math.abs(d) <= umbral) {
        const c2 = Object.assign({}, caja); if (X) c2.x += d; else c2.y += d;
        return { d: d, marcas: [marca(antes, c2), marca(c2, despues)] };
      }
    }
    /* igual a un hueco que ya existe en la fila */
    const huecos = [];
    for (let i = 0; i < banda.length - 1; i++) {
      const g = ini(banda[i + 1]) - fin(banda[i]);
      if (g > 0) huecos.push({ g: g, a: banda[i], b: banda[i + 1] });
    }
    let mejor = null;
    huecos.forEach(function (h) {
      if (antes) {
        const d = (fin(antes) + h.g) - ini(caja);
        if (Math.abs(d) <= umbral && (!mejor || Math.abs(d) < Math.abs(mejor.d))) mejor = { d: d, h: h, lado: "antes" };
      }
      if (despues) {
        const d = (ini(despues) - h.g - tam(caja)) - ini(caja);
        if (Math.abs(d) <= umbral && (!mejor || Math.abs(d) < Math.abs(mejor.d))) mejor = { d: d, h: h, lado: "despues" };
      }
    });
    if (!mejor) return null;
    const c3 = Object.assign({}, caja); if (X) c3.x += mejor.d; else c3.y += mejor.d;
    return { d: mejor.d, marcas: [marca(mejor.h.a, mejor.h.b), mejor.lado === "antes" ? marca(antes, c3) : marca(c3, despues)] };
  }

  function dibujarGuias(r) {
    const capa = document.getElementById("lz-guias");
    if (!capa) return;
    if (!r) { capa.innerHTML = ""; return; }
    const inv = 1 / escala;
    let html = "";
    r.guias.forEach(function (g) {
      if (g.t === "v") html += '<div class="lz-guia v' + (g.centro ? " centro" : "") + '" style="left:' + g.x + "px;top:" + g.y1 + "px;height:" + (g.y2 - g.y1) + "px;--inv:" + inv + '"></div>';
      else html += '<div class="lz-guia h" style="top:' + g.y + "px;left:" + g.x1 + "px;width:" + (g.x2 - g.x1) + "px;--inv:" + inv + '"></div>';
    });
    (r.espacios || []).forEach(function (m) {
      if (m.t === "eh") html += '<div class="lz-hueco h" style="left:' + m.x1 + "px;top:" + m.y + "px;width:" + (m.x2 - m.x1) + "px;--inv:" + inv + '"><b>' + redondo(m.x2 - m.x1) + "</b></div>";
      else html += '<div class="lz-hueco v" style="top:' + m.y1 + "px;left:" + m.x + "px;height:" + (m.y2 - m.y1) + "px;--inv:" + inv + '"><b>' + redondo(m.y2 - m.y1) + "</b></div>";
    });
    capa.innerHTML = html;
  }

  /* ---------------- interacción con el puntero ---------------- */
  function puntoLienzo(ev) {
    const r = document.getElementById("lz-lienzo").getBoundingClientRect();
    return { x: (ev.clientX - r.left) / escala, y: (ev.clientY - r.top) / escala };
  }

  function alPresionar(ev) {
    if (ev.button !== 0) return;
    const lienzo = document.getElementById("lz-lienzo");
    const manija = ev.target.closest("[data-manija]");
    const nodo = ev.target.closest(".lz-el");

    if (editandoTexto) {
      if (nodo && nodo.dataset.id === editandoTexto) return;   // clic dentro del texto en edición
      terminarEdicionTexto();
    }
    cerrarMenuCasos();

    if (manija && seleccion.length === 1) { ev.preventDefault(); empezarRedimension(ev, manija.dataset.manija); return; }

    if (nodo) {
      ev.preventDefault();
      const id = nodo.dataset.id;
      if (ev.shiftKey) {
        const i = seleccion.indexOf(id);
        if (i > -1) seleccion.splice(i, 1); else seleccion.push(id);
        pintarSeleccion(); pintarPanel();
        return;
      }
      if (seleccion.indexOf(id) === -1) { seleccion = [id]; pintarSeleccion(); pintarPanel(); }
      empezarMovimiento(ev);
      return;
    }

    if (ev.target === lienzo || ev.target.closest(".lz-guias") || ev.target.classList.contains("lz-sel-capa")) {
      ev.preventDefault();
      if (!ev.shiftKey) seleccion = [];
      empezarMarquesina(ev);
    }
  }

  function empezarMovimiento(ev) {
    const inicio = puntoLienzo(ev);
    const instantanea = foto();
    const origen = {};
    seleccion.forEach(function (id) { const e = porIdEl(id); origen[id] = { x: e.x, y: e.y }; });
    const caja0 = cajaDe(seleccion);
    let movido = false;
    const duplicarAlArrastrar = ev.altKey;

    function mover(e2) {
      const p = puntoLienzo(e2);
      let dx = p.x - inicio.x, dy = p.y - inicio.y;
      if (!movido && Math.abs(dx) * escala < 3 && Math.abs(dy) * escala < 3) return;
      if (!movido && duplicarAlArrastrar) {
        /* Alt + arrastrar: deja una copia en el lugar original */
        let z = zMax();
        seleccion.forEach(function (id) {
          const c = JSON.parse(JSON.stringify(porIdEl(id))); c.id = uid(); c.z = ++z; L().elementos.push(c);
        });
        pintar();
      }
      movido = true;
      if (e2.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }   // Shift: solo horizontal o vertical
      const caja = { x: caja0.x + dx, y: caja0.y + dy, w: caja0.w, h: caja0.h };
      const r = e2.ctrlKey || e2.metaKey ? { dx: 0, dy: 0, guias: [], espacios: [] } : imantar(caja, seleccion, { x: ["i", "c", "d"], y: ["a", "m", "b"] });
      dx += r.dx; dy += r.dy;
      seleccion.forEach(function (id) {
        const e = porIdEl(id);
        e.x = redondo(origen[id].x + dx);
        e.y = redondo(Math.max(0, origen[id].y + dy));
      });
      moverNodos(seleccion);
      dibujarGuias(r);
    }
    function soltar() {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      dibujarGuias(null);
      if (movido) { recordar(instantanea); ajustarAlto(); guardar(); pintarPanel(); }
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function empezarRedimension(ev, m) {
    const e = porIdEl(seleccion[0]);
    const inicio = puntoLienzo(ev);
    const o = { x: e.x, y: e.y, w: e.w, h: e.h };
    const proporcion = o.w / Math.max(1, o.h);
    const instantanea = foto();
    let cambio = false;
    const minimo = e.tipo === "linea" ? 1 : 16;

    function mover(e2) {
      const p = puntoLienzo(e2);
      const dx = p.x - inicio.x, dy = p.y - inicio.y;
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (m.indexOf("e") > -1) w = o.w + dx;
      if (m.indexOf("w") > -1) { w = o.w - dx; x = o.x + dx; }
      if (m.indexOf("s") > -1) h = o.h + dy;
      if (m.indexOf("n") > -1) { h = o.h - dy; y = o.y + dy; }

      /* Shift en una esquina: mantiene la proporción */
      if (e2.shiftKey && m.length === 2) {
        if (Math.abs(dx) > Math.abs(dy)) { const nh = w / proporcion; if (m.indexOf("n") > -1) y = o.y + o.h - nh; h = nh; }
        else { const nw = h * proporcion; if (m.indexOf("w") > -1) x = o.x + o.w - nw; w = nw; }
      }

      /* imantar solo los bordes que se están moviendo */
      if (!(e2.ctrlKey || e2.metaKey)) {
        const bx = [], by = [];
        if (m.indexOf("e") > -1) bx.push("d");
        if (m.indexOf("w") > -1) bx.push("i");
        if (m.indexOf("s") > -1) by.push("b");
        if (m.indexOf("n") > -1) by.push("a");
        const r = imantar({ x: x, y: y, w: w, h: h }, [e.id], { x: bx, y: by });
        if (m.indexOf("e") > -1) w += r.dx;
        if (m.indexOf("w") > -1) { x += r.dx; w -= r.dx; }
        if (m.indexOf("s") > -1) h += r.dy;
        if (m.indexOf("n") > -1) { y += r.dy; h -= r.dy; }
        dibujarGuias(r);
      }

      if (w < minimo) { if (m.indexOf("w") > -1) x -= (minimo - w); w = minimo; }
      if (h < minimo) { if (m.indexOf("n") > -1) y -= (minimo - h); h = minimo; }
      e.x = redondo(x); e.y = redondo(Math.max(0, y)); e.w = redondo(w); e.h = redondo(h);
      cambio = true;
      moverNodos([e.id]);
    }
    function soltar() {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      dibujarGuias(null);
      if (cambio) { recordar(instantanea); ajustarAlto(); guardar(); pintarPanel(); }
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function empezarMarquesina(ev) {
    const capa = document.getElementById("lz-guias");
    const inicio = puntoLienzo(ev);
    const previa = seleccion.slice();
    const caja = document.createElement("div");
    caja.className = "lz-marquesina";
    capa.appendChild(caja);
    function mover(e2) {
      const p = puntoLienzo(e2);
      const x = Math.min(p.x, inicio.x), y = Math.min(p.y, inicio.y);
      const w = Math.abs(p.x - inicio.x), h = Math.abs(p.y - inicio.y);
      caja.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px";
      const dentro = L().elementos.filter(function (e) {
        return e.x < x + w && e.x + e.w > x && e.y < y + h && e.y + e.h > y;
      }).map(function (e) { return e.id; });
      seleccion = previa.concat(dentro.filter(function (id) { return previa.indexOf(id) === -1; }));
      pintarSeleccion();
    }
    function soltar() {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      caja.remove();
      pintarSeleccion(); pintarPanel();
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  /* ---------------- edición de textos en el lugar ---------------- */
  function empezarEdicionTexto(id) {
    const e = porIdEl(id);
    if (!e || e.tipo !== "texto") return;
    editandoTexto = id;
    seleccion = [id];
    pintarSeleccion();
    const nodo = document.querySelector('#lz-lienzo .lz-el[data-id="' + id + '"]');
    const t = nodo.querySelector(".lz-texto");
    nodo.classList.add("editando");
    t.contentEditable = "true";
    t.spellcheck = true;
    t.focus();
    const rango = document.createRange();
    rango.selectNodeContents(t);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(rango);
    instantaneaCampo = foto();
    t.addEventListener("input", function () {
      e.h = nodo.offsetHeight;
      pintarSeleccion();
    });
    t.addEventListener("paste", function (pe) {   // pegar siempre como texto plano
      pe.preventDefault();
      const txt = (pe.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, txt);
    });
  }
  function terminarEdicionTexto() {
    const id = editandoTexto;
    if (!id) return;
    editandoTexto = null;
    const e = porIdEl(id);
    const nodo = document.querySelector('#lz-lienzo .lz-el[data-id="' + id + '"]');
    if (!e || !nodo) return;
    const t = nodo.querySelector(".lz-texto");
    const nuevo = t.innerText.replace(/\n$/, "");
    t.contentEditable = "false";
    nodo.classList.remove("editando");
    if (nuevo !== e.texto) {
      recordar(instantaneaCampo);
      e.texto = nuevo;
      repintarElemento(id);
      guardar();
    }
    pintarPanel();
  }

  /* ---------------- panel de propiedades ---------------- */
  function campoNum(prop, etiqueta, valor, paso, min, max) {
    return '<label class="lz-campo"><span>' + etiqueta + '</span><input type="number" data-prop="' + prop + '" value="' + valor + '"' +
      (paso ? ' step="' + paso + '"' : "") + (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + "></label>";
  }
  function campoSel(prop, etiqueta, valor, opciones) {
    return '<label class="lz-campo ancho"><span>' + etiqueta + '</span><select data-prop="' + prop + '">' +
      Object.keys(opciones).map(function (k) { return '<option value="' + escAttr(k) + '"' + (String(valor) === k ? " selected" : "") + ">" + esc(opciones[k]) + "</option>"; }).join("") +
      "</select></label>";
  }
  function campoTexto(prop, etiqueta, valor, ph) {
    return '<label class="lz-campo ancho"><span>' + etiqueta + '</span><input type="text" data-prop="' + prop + '" value="' + escAttr(valor || "") + '" placeholder="' + escAttr(ph || "") + '"></label>';
  }
  function campoCheck(prop, etiqueta, valor) {
    return '<label class="lz-check"><input type="checkbox" data-prop="' + prop + '"' + (valor ? " checked" : "") + "> " + etiqueta + "</label>";
  }
  function muestras(prop, etiqueta, valor, conTransparente) {
    const lista = conTransparente ? [["transparent", "Sin color"]].concat(COLORES) : COLORES;
    return '<div class="lz-campo ancho"><span>' + etiqueta + '</span><div class="lz-muestras">' +
      lista.map(function (c) {
        return '<button type="button" class="lz-muestra' + (String(valor).toLowerCase() === c[0].toLowerCase() ? " activa" : "") + (c[0] === "transparent" ? " transparente" : "") +
          '" data-color-prop="' + prop + '" data-color="' + c[0] + '" title="' + c[1] + '" style="background:' + c[0] + '"></button>';
      }).join("") + "</div></div>";
  }
  function grupoBotones(prop, valor, opciones) {
    return '<div class="lz-segmentado">' + opciones.map(function (o) {
      return '<button type="button" data-set-prop="' + prop + '" data-valor="' + o[0] + '" class="' + (String(valor) === o[0] ? "activo" : "") + '" title="' + o[2] + '">' + o[1] + "</button>";
    }).join("") + "</div>";
  }

  function pintarPanel() {
    const panel = document.getElementById("lz-panel");
    if (!panel) return;
    if (!seleccion.length) {
      panel.innerHTML = '<h4>Portada</h4>' +
        '<p class="lz-ayuda">Haz clic en un elemento para seleccionarlo. Arrastra para moverlo: aparecen guías cuando se alinea con otro o con el centro de la página.</p>' +
        '<ul class="lz-atajos">' +
          "<li><kbd>Doble clic</kbd> editar un texto</li>" +
          "<li><kbd>Shift</kbd> + clic: seleccionar varios</li>" +
          "<li><kbd>Shift</kbd> al arrastrar: solo en línea recta</li>" +
          "<li><kbd>Alt</kbd> al arrastrar: duplicar</li>" +
          "<li><kbd>Ctrl</kbd> al arrastrar: sin guías</li>" +
          "<li><kbd>Flechas</kbd> mover 1 px · con <kbd>Shift</kbd> 10 px</li>" +
          "<li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> deshacer / rehacer</li>" +
          "<li><kbd>Ctrl+D</kbd> duplicar · <kbd>Supr</kbd> eliminar</li>" +
          "<li><kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> copiar / pegar</li>" +
        "</ul>" +
        '<button type="button" class="boton secundario lz-ancho" data-lz="reconstruir">Rehacer desde las secciones antiguas</button>';
      return;
    }

    if (seleccion.length > 1) {
      panel.innerHTML = "<h4>" + seleccion.length + " elementos</h4>" +
        '<div class="lz-sub">Alinear</div>' +
        '<div class="lz-segmentado seis">' +
          boton("al-izq", "⇤", "Alinear a la izquierda") + boton("al-cen", "↔", "Centrar horizontalmente") + boton("al-der", "⇥", "Alinear a la derecha") +
          boton("al-arr", "⤒", "Alinear arriba") + boton("al-med", "↕", "Centrar verticalmente") + boton("al-aba", "⤓", "Alinear abajo") +
        "</div>" +
        '<div class="lz-sub">Distribuir</div>' +
        '<div class="lz-segmentado">' + boton("dist-h", "Horizontal", "Mismo espacio horizontal (3 o más)") + boton("dist-v", "Vertical", "Mismo espacio vertical (3 o más)") + "</div>" +
        '<button type="button" class="boton secundario lz-ancho" data-lz="centrar-pagina">Centrar en la página</button>';
      conectarPanel(panel);
      return;
    }

    const e = porIdEl(seleccion[0]);
    if (!e) { panel.innerHTML = ""; return; }
    const nombres = { caso: "Noticia", texto: "Texto", forma: "Rectángulo", linea: "Línea", imagen: "Imagen" };
    let html = "<h4>" + nombres[e.tipo] + "</h4>" +
      '<div class="lz-fila">' + campoNum("x", "X", e.x) + campoNum("y", "Y", e.y) + campoNum("w", "Ancho", e.w, 1, 1) +
      (e.tipo === "texto" ? "" : campoNum("h", "Alto", e.h, 1, 1)) + "</div>";

    if (e.tipo === "texto") {
      html += '<label class="lz-campo ancho"><span>Texto</span><textarea data-prop="texto" rows="3">' + esc(e.texto || "") + "</textarea></label>" +
        campoSel("fuente", "Tipografía", e.fuente || "titular", NOMBRE_FUENTE) +
        '<div class="lz-fila">' + campoNum("tam", "Tamaño", e.tam || 32, 1, 6, 400) +
          campoSel("peso", "Peso", String(e.peso || 500), { "400": "Normal", "500": "Medio", "600": "Seminegrita", "700": "Negrita" }) + "</div>" +
        '<div class="lz-fila">' + campoNum("interlineado", "Interlineado", e.interlineado || 1.15, 0.05, 0.6, 3) +
          campoNum("espaciado", "Espaciado", e.espaciado || 0, 0.01, -0.1, 1) + "</div>" +
        '<div class="lz-sub">Alineación</div>' +
        grupoBotones("alin", e.alin || "left", [["left", "Izq.", "Izquierda"], ["center", "Centro", "Centro"], ["right", "Der.", "Derecha"], ["justify", "Just.", "Justificado"]]) +
        '<div class="lz-fila checks">' + campoCheck("cursiva", "Cursiva", e.cursiva) + campoCheck("mayus", "Mayúsculas", e.mayus) + "</div>" +
        muestras("color", "Color", e.color || "#1D1D1F") +
        campoTexto("enlace", "Enlace (opcional)", e.enlace, "#/caso/… o https://…");
    }
    if (e.tipo === "caso") {
      const opciones = {};
      ultimosCasos.forEach(function (c) { opciones[c.id] = c.titulo.length > 70 ? c.titulo.slice(0, 70) + "…" : c.titulo; });
      if (!opciones[e.casoId]) opciones[e.casoId] = "(no disponible) " + e.casoId;
      html += campoSel("casoId", "Noticia", e.casoId, opciones) +
        campoSel("estilo", "Estilo", e.estilo || "foto", ESTILOS_CASO) +
        '<div class="lz-fila checks">' + campoCheck("barra", "Barra izq./der.", e.barra !== false) + campoCheck("conteo", "Nº de medios", e.conteo !== false) + "</div>" +
        '<button type="button" class="boton secundario lz-ancho" data-lz="editar-caso">Editar la noticia</button>';
    }
    if (e.tipo === "forma") {
      html += muestras("relleno", "Relleno", e.relleno || "transparent", true) +
        muestras("borde", "Borde", e.borde || "transparent", true) +
        '<div class="lz-fila">' + campoNum("grosorBorde", "Grosor borde", e.grosorBorde || 0, 1, 0, 40) + campoNum("radio", "Esquinas", e.radio != null ? e.radio : 12, 1, 0, 400) + "</div>";
    }
    if (e.tipo === "linea") {
      html += muestras("color", "Color", e.color || "#1D1D1F") +
        '<div class="lz-fila">' + campoNum("grosor", "Grosor", e.grosor || 1, 1, 1, 40) + "</div>" +
        '<div class="lz-segmentado">' + boton("linea-h", "Horizontal", "Volver horizontal") + boton("linea-v", "Vertical", "Volver vertical") + "</div>";
    }
    if (e.tipo === "imagen") {
      html += campoTexto("src", "Enlace de la imagen", e.src, "https://…/foto.jpg") +
        campoSel("ajuste", "Ajuste", e.ajuste || "cover", { cover: "Llenar (recorta)", contain: "Encajar (completa)" }) +
        '<div class="lz-fila">' + campoNum("radio", "Esquinas", e.radio != null ? e.radio : 12, 1, 0, 400) + "</div>" +
        campoTexto("enlace", "Enlace al hacer clic (opcional)", e.enlace, "#/caso/… o https://…");
    }

    html += '<div class="lz-sub">Capa</div><div class="lz-segmentado">' +
      boton("frente", "Al frente", "Traer al frente") + boton("atras", "Atrás", "Enviar atrás") + boton("centrar-pagina", "Centrar", "Centrar en la página") + "</div>";
    panel.innerHTML = html;
    conectarPanel(panel);
  }

  function aplicarCampo(e, prop, valor) {
    const numericos = ["x", "y", "w", "h", "tam", "interlineado", "espaciado", "grosor", "grosorBorde", "radio"];
    if (numericos.indexOf(prop) > -1) { valor = parseFloat(valor); if (isNaN(valor)) return false; }
    if (prop === "peso") valor = parseInt(valor, 10);
    e[prop] = valor;
    return true;
  }

  function conectarPanel(panel) {
    panel.querySelectorAll("[data-prop]").forEach(function (campo) {
      campo.addEventListener("focus", function () { instantaneaCampo = foto(); });
      const evento = campo.type === "checkbox" || campo.tagName === "SELECT" ? "change" : "input";
      campo.addEventListener(evento, function () {
        const e = porIdEl(seleccion[0]);
        if (!e) return;
        if (campo.type === "checkbox" || campo.tagName === "SELECT") { instantaneaCampo = instantaneaCampo || foto(); }
        const valor = campo.type === "checkbox" ? campo.checked : campo.value;
        if (!aplicarCampo(e, campo.dataset.prop, valor)) return;
        if (["x", "y", "w", "h"].indexOf(campo.dataset.prop) > -1) moverNodos([e.id]);
        else repintarElemento(e.id);
        if (campo.type === "checkbox" || campo.tagName === "SELECT") { recordar(instantaneaCampo); instantaneaCampo = null; guardar(); if (campo.dataset.prop === "estilo") pintarPanel(); }
      });
      campo.addEventListener("change", function () {
        if (campo.type === "checkbox" || campo.tagName === "SELECT") return;
        if (instantaneaCampo) { recordar(instantaneaCampo); instantaneaCampo = null; }
        ajustarAlto(); guardar();
      });
    });
    panel.querySelectorAll("[data-color-prop]").forEach(function (b) {
      b.addEventListener("click", function () {
        const e = porIdEl(seleccion[0]);
        if (!e) return;
        recordar();
        e[b.dataset.colorProp] = b.dataset.color;
        if (b.dataset.colorProp === "borde" && b.dataset.color !== "transparent" && !e.grosorBorde) e.grosorBorde = 1;
        repintarElemento(e.id); guardar(); pintarPanel();
      });
    });
    panel.querySelectorAll("[data-set-prop]").forEach(function (b) {
      b.addEventListener("click", function () {
        const e = porIdEl(seleccion[0]);
        if (!e) return;
        recordar();
        e[b.dataset.setProp] = b.dataset.valor;
        repintarElemento(e.id); guardar(); pintarPanel();
      });
    });
    panel.querySelectorAll("[data-lz]").forEach(function (b) { b.addEventListener("click", function () { accion(b.dataset.lz, b); }); });
  }

  /* ---------------- acciones de botones ---------------- */
  function accion(a, el) {
    if (a === "nuevo-texto") nuevoTexto();
    else if (a === "nuevo-caso") abrirMenuCasos(el);
    else if (a === "nueva-linea") nuevaLinea();
    else if (a === "nueva-forma") nuevaForma();
    else if (a === "nueva-imagen") nuevaImagen();
    else if (a === "deshacer") deshacer();
    else if (a === "rehacer") rehacer();
    else if (a === "duplicar") duplicar();
    else if (a === "eliminar") eliminar();
    else if (a === "frente") capas("frente");
    else if (a === "atras") capas("atras");
    else if (a === "centrar-pagina") centrarEnPagina();
    else if (a.indexOf("al-") === 0) alinear(a.slice(3));
    else if (a === "dist-h") distribuir("h");
    else if (a === "dist-v") distribuir("v");
    else if (a === "editar-caso") { const e = porIdEl(seleccion[0]); if (e) panelEditarCaso(e.casoId); }
    else if (a === "linea-h" || a === "linea-v") {
      const e = porIdEl(seleccion[0]); if (!e) return;
      recordar();
      const largo = Math.max(e.w, e.h);
      if (a === "linea-h") { e.w = largo; e.h = 9; } else { e.h = largo; e.w = 9; }
      pintar(); guardar();
    }
    else if (a === "reconstruir") {
      if (!confirm("Esto reemplaza el lienzo actual por una copia de la portada armada por secciones. ¿Continuar? (Se puede deshacer con Ctrl+Z)")) return;
      recordar();
      L().elementos = convertirDesdeSecciones(ultimosCasos);
      seleccion = []; pintar(); guardar();
    }
  }

  /* ---------------- teclado ---------------- */
  function alTeclado(ev) {
    if (!document.getElementById("lz-lienzo")) return;
    const objetivo = ev.target;
    const escribiendo = objetivo && (objetivo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(objetivo.tagName));
    const ctrl = ev.ctrlKey || ev.metaKey;

    if (editandoTexto) {
      if (ev.key === "Escape") { ev.preventDefault(); terminarEdicionTexto(); }
      return;
    }
    if (escribiendo) return;

    const k = ev.key.toLowerCase();
    if (ctrl && k === "z" && !ev.shiftKey) { ev.preventDefault(); deshacer(); return; }
    if (ctrl && (k === "y" || (k === "z" && ev.shiftKey))) { ev.preventDefault(); rehacer(); return; }
    if (ctrl && k === "d") { ev.preventDefault(); duplicar(); return; }
    if (ctrl && k === "c") { copiar(); return; }
    if (ctrl && k === "v") { ev.preventDefault(); pegar(); return; }
    if (ctrl && k === "a") { ev.preventDefault(); seleccion = L().elementos.map(function (e) { return e.id; }); pintarSeleccion(); pintarPanel(); return; }
    if (ctrl && ev.key === "]") { ev.preventDefault(); capas("frente"); return; }
    if (ctrl && ev.key === "[") { ev.preventDefault(); capas("atras"); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") { if (seleccion.length) { ev.preventDefault(); eliminar(); } return; }
    if (ev.key === "Escape") { seleccion = []; cerrarMenuCasos(); pintarSeleccion(); pintarPanel(); return; }
    if (ev.key === "Enter" && seleccion.length === 1 && porIdEl(seleccion[0]).tipo === "texto") { ev.preventDefault(); empezarEdicionTexto(seleccion[0]); return; }

    const flechas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (flechas[ev.key] && seleccion.length) {
      ev.preventDefault();
      const paso = ev.shiftKey ? 10 : 1;
      if (!ev.repeat || !alTeclado.flechaActiva) { recordar(); alTeclado.flechaActiva = true; }
      seleccion.map(porIdEl).forEach(function (e) {
        e.x += flechas[ev.key][0] * paso;
        e.y = Math.max(0, e.y + flechas[ev.key][1] * paso);
      });
      moverNodos(seleccion);
      clearTimeout(alTeclado.t);
      alTeclado.t = setTimeout(function () { alTeclado.flechaActiva = false; ajustarAlto(); guardar(); pintarPanel(); }, 350);
      return;
    }
    if (!ctrl && !ev.altKey) {
      if (k === "t") { ev.preventDefault(); nuevoTexto(); }
      else if (k === "l") { ev.preventDefault(); nuevaLinea(); }
      else if (k === "r") { ev.preventDefault(); nuevaForma(); }
      else if (k === "i") { ev.preventDefault(); nuevaImagen(); }
      else if (k === "n") { ev.preventDefault(); abrirMenuCasos(document.querySelector('[data-lz="nuevo-caso"]')); }
    }
  }

  /* ---------------- conversión desde la portada por secciones ---------------- */
  /* Dibuja la portada antigua fuera de pantalla, a 1220 px, mide dónde
     quedó cada tarjeta y cada título de sección, y crea un elemento
     del lienzo por cada uno, en la misma posición. Así el lienzo arranca
     igual a lo que ya estaba armado. */
  function convertirDesdeSecciones(casos) {
    const prevAdmin = modoAdmin, prevFiltro = filtroTema;
    let html = "";
    try { modoAdmin = false; filtroTema = null; html = renderPortadaSecciones(casos); }
    finally { modoAdmin = prevAdmin; filtroTema = prevFiltro; }

    const medidor = document.createElement("div");
    medidor.style.cssText = "position:absolute;left:-30000px;top:0;width:" + ANCHO + "px;visibility:hidden;";
    medidor.innerHTML = html;
    document.body.appendChild(medidor);
    const base = medidor.getBoundingClientRect();
    const elementos = [];
    let z = 0;

    medidor.querySelectorAll(".cabecera-seccion-noticias").forEach(function (cab) {
      const h2 = cab.querySelector("h2");
      const r = cab.getBoundingClientRect();
      const rh = h2.getBoundingClientRect();
      const tam = parseFloat(getComputedStyle(h2).fontSize) || 32;
      elementos.push({ id: uid(), tipo: "texto", x: redondo(rh.left - base.left), y: redondo(rh.top - base.top), w: redondo(Math.max(rh.width + 40, 300)), h: redondo(rh.height),
        z: ++z, texto: h2.textContent, fuente: "titular", tam: redondo(tam), peso: 500, cursiva: false, alin: "left", interlineado: 1, espaciado: 0, mayus: false, color: "#1D1D1F" });
      elementos.push({ id: uid(), tipo: "linea", x: redondo(r.left - base.left), y: redondo(r.bottom - base.top - 5), w: redondo(r.width), h: 9, z: ++z, color: "#1D1D1F", grosor: 1 });
    });
    medidor.querySelectorAll("a[data-caso-id]").forEach(function (a) {
      const r = a.getBoundingClientRect();
      const estilo = a.classList.contains("tarjeta-grande") ? "foto" : a.classList.contains("tarjeta-mediana") ? "mini" : "titular";
      elementos.push({ id: uid(), tipo: "caso", casoId: a.dataset.casoId, estilo: estilo,
        x: redondo(r.left - base.left), y: redondo(r.top - base.top), w: redondo(r.width), h: redondo(r.height), z: ++z, barra: true, conteo: true });
    });
    medidor.remove();

    /* que nada quede pegado al borde superior */
    const minY = elementos.reduce(function (m, e) { return Math.min(m, e.y); }, Infinity);
    if (isFinite(minY)) elementos.forEach(function (e) { e.y = e.y - minY + 8; });
    return elementos;
  }

  /* ---------------- montaje ---------------- */
  function montar() {
    reescalar();
    const lienzo = document.getElementById("lz-lienzo");
    if (!lienzo) return;
    pintar();
    lienzo.addEventListener("pointerdown", alPresionar);
    lienzo.addEventListener("dblclick", function (ev) {
      const nodo = ev.target.closest(".lz-el");
      if (!nodo) return;
      const e = porIdEl(nodo.dataset.id);
      if (e && e.tipo === "texto") empezarEdicionTexto(e.id);
    });
    lienzo.addEventListener("click", function (ev) { ev.preventDefault(); }, true);   // ningún enlace navega mientras se edita
    document.querySelectorAll("#lz-herr [data-lz]").forEach(function (b) {
      b.addEventListener("click", function () { accion(b.dataset.lz, b); });
    });
    if (!tecladoConectado) {
      document.addEventListener("keydown", alTeclado);
      document.addEventListener("pointerdown", function (ev) {
        const menu = document.getElementById("lz-menu-casos");
        if (menu && !menu.contains(ev.target) && !ev.target.closest('[data-lz="nuevo-caso"]')) cerrarMenuCasos();
      });
      tecladoConectado = true;
    }
  }

  window.addEventListener("resize", function () { reescalar(); if (document.getElementById("lz-lienzo")) pintarSeleccion(); });

  /* ---------------- integración con el sitio ---------------- */
  const renderPortadaSecciones = renderPortada;   // la versión por secciones queda para la conversión

  renderPortada = function (casos) {
    ultimosCasos = casos;
    if (modoAdmin) {
      if (!hayLienzo()) {
        /* primera vez: convertir la portada por secciones al lienzo */
        L().elementos = convertirDesdeSecciones(casos);
        if (L().elementos.length) guardarEstadoRemoto();
      }
      return htmlEditor(casos);
    }
    if (hayLienzo()) return htmlPublico(casos);
    return renderPortadaSecciones(casos);
  };

  const vistaCasosOriginal = vistaCasos;
  vistaCasos = function () {
    if (editandoTexto) editandoTexto = null;
    vistaCasosOriginal();
    document.body.classList.toggle("lz-editando", !!document.getElementById("lz-lienzo"));
    if (document.getElementById("lz-lienzo")) {
      const nota = document.querySelector(".nota-al-pie");
      if (nota) nota.textContent = "Modo admin: la portada es un lienzo libre. Agrega elementos con la barra de abajo, arrástralos y ajústalos en el panel de la derecha.";
    }
    montar();
  };

  /* Al salir de la portada, quitar la clase del editor */
  window.addEventListener("hashchange", function () {
    setTimeout(function () { document.body.classList.toggle("lz-editando", !!document.getElementById("lz-lienzo")); }, 0);
  });
})();
