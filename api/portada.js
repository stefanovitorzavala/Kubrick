/* ===========================================================
   /api/portada
   Guarda y devuelve el estado compartido de Kubrick: las secciones
   de la portada, las noticias completas que se suben como .json
   (título, coberturas, marcas, todo), los medios nuevos que traen
   esas noticias, las ediciones y los ocultamientos. Todo en un único
   archivo dentro de Vercel Blob, para que lo vea cualquier visitante
   del sitio sin que nadie más que el admin tenga que subir nada.

   El store de Blob es PÚBLICO: cualquiera con el link exacto del
   archivo podría leerlo (no hay nada sensible ahí, son noticias
   públicas y su organización), pero solo esta función, con la clave
   correcta, puede escribirlo.

   GET  -> devuelve el estado actual (o uno vacío si todavía no existe).
   POST -> guarda un estado nuevo. Requiere la cabecera x-clave-admin
           con un valor igual a la variable de entorno ADMIN_PASSWORD
           configurada en Vercel (Project Settings -> Environment
           Variables). Sin esa variable configurada, el guardado
           siempre se rechaza, a propósito: mejor que falle a que
           quede sin clave.
           Si además llega la cabecera x-solo-verificar: 1, no guarda
           nada: solo confirma si la clave es correcta (lo usa el
           botón "Admin" del sitio antes de activar el modo admin).
   =========================================================== */

const { put, head } = require("@vercel/blob");

const NOMBRE_ARCHIVO = "portada.json";
const ESTADO_VACIO = { secciones: [], overrides: {}, ocultos: [], lineasSeccion: "si", noticias: [], medios: {} };

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      const info = await head(NOMBRE_ARCHIVO).catch(function () { return null; });
      if (!info) {
        res.status(200).json(ESTADO_VACIO);
        return;
      }
      const respuesta = await fetch(info.url, { cache: "no-store" });
      const datos = await respuesta.json();
      res.status(200).json(Object.assign({}, ESTADO_VACIO, datos));
    } catch (e) {
      res.status(200).json(ESTADO_VACIO);
    }
    return;
  }

  if (req.method === "POST") {
    if (!process.env.ADMIN_PASSWORD) {
      res.status(500).json({ error: "El servidor no tiene configurada la variable de entorno ADMIN_PASSWORD." });
      return;
    }

    const clave = req.headers["x-clave-admin"];
    if (clave !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: "Clave incorrecta." });
      return;
    }

    if (req.headers["x-solo-verificar"] === "1") {
      res.status(200).json({ ok: true, verificado: true });
      return;
    }

    try {
      await put(NOMBRE_ARCHIVO, JSON.stringify(req.body || ESTADO_VACIO), {
        access: "public",
        allowOverwrite: true,
        contentType: "application/json"
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "No se pudo guardar la portada: " + e.message });
    }
    return;
  }

  res.status(405).json({ error: "Método no permitido." });
};
