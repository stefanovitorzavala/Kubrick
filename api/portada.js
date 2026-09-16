const { put, list } = require("@vercel/blob");

const NOMBRE_ARCHIVO = "portada.json";
const ESTADO_VACIO = { secciones: [], overrides: {}, ocultos: [], lineasSeccion: "si" };

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      const { blobs } = await list({ prefix: NOMBRE_ARCHIVO });
      if (!blobs || blobs.length === 0) {
        res.status(200).json(ESTADO_VACIO);
        return;
      }

      // Al ser un Blob PRIVADO, enviamos el token de autenticación para leer el archivo
      const respuesta = await fetch(blobs[0].url, {
        headers: {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
        },
        cache: "no-store"
      });

      if (!respuesta.ok) {
        res.status(200).json(ESTADO_VACIO);
        return;
      }

      const datos = await respuesta.json();
      res.status(200).json(datos);
    } catch (e) {
      res.status(500).json({ error: "No se pudo leer la portada: " + e.message });
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
      // Guardamos con access: "private" para coincidir con tu almacén privado de Vercel
      await put(NOMBRE_ARCHIVO, JSON.stringify(req.body || ESTADO_VACIO), {
        access: "private",
        addRandomSuffix: false,
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
