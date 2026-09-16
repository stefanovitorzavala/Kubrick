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

      // Toma el archivo guardado más reciente
      const blobMasReciente = blobs.sort(
        (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
      )[0];

      // Lectura pública directa sin restricción de permisos
      const respuesta = await fetch(blobMasReciente.url, { cache: "no-store" });

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
      res.status(500).json({ error: "Falta la variable ADMIN_PASSWORD." });
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
        addRandomSuffix: false,
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
