/* ===========================================================
   /api/portada
   Guarda y devuelve el estado compartido de la portada de Kubrick
   (secciones, ediciones de noticias, ocultamientos) en un único
   archivo dentro de Vercel Blob, para que lo vea cualquier visitante
   del sitio, no solo quien lo armó.

   El store de Blob es PRIVADO (no público): nadie puede leer el
   archivo entrando directo a su URL, solo esta función, que está
   autenticada automáticamente por Vercel (OIDC) al estar el store
   conectado al proyecto. Por eso se usa access: "private" en vez de
   "public" en todas las operaciones.

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

const { put, get } = require("@vercel/blob");

const NOMBRE_ARCHIVO = "portada.json";
const ESTADO_VACIO = { secciones: [], overrides: {}, ocultos: [], lineasSeccion: "si" };

/* Los blobs privados se leen como un stream (por partes), no como un
   archivo entero de una vez. Esto lo junta todo en un solo texto. */
async function streamATexto(stream) {
  const lector = stream.getReader();
  const partes = [];
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf-8");
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      const resultado = await get(NOMBRE_ARCHIVO, { access: "private", useCache: false });
      if (!resultado || resultado.statusCode !== 200 || !resultado.stream) {
        res.status(200).json(ESTADO_VACIO);
        return;
      }
      const texto = await streamATexto(resultado.stream);
      res.status(200).json(JSON.parse(texto));
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
        access: "private",
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
