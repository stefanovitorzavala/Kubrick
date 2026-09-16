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

      const blobMasReciente = blobs.sort(
        (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
      )[0];

      const respuesta = await fetch(blobMasReciente.url, { cache: "no-store" });

      if (!respuesta.ok) {
        res.status(500).json({ error: "No se pudo leer la portada guardada." });
        return;
      }

      const datos = await respuesta.json();
      res.status(200).json(datos);
    } catch (e) {
      res.status(500).json({ error: "Error al leer portada: " + e.message });
    }
    return;
  }

  if (req.method === "POST") {
    if (!process.env.ADMIN_PASSWORD) {
      res.status(500).json({ error: "Falta ADMIN_PASSWORD." });
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
      let cuerpo = req.body;
      if (typeof cuerpo === "string") {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) {}
      }

      if (!cuerpo || (typeof cuerpo === "object" && Object.keys(cuerpo).length === 0)) {
        res.status(400).json({ error: "El contenido a guardar está vacío." });
        return;
      }

      await put(NOMBRE_ARCHIVO, JSON.stringify(cuerpo), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json"
      });

      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Error al guardar: " + e.message });
    }
    return;
  }

  res.status(405).json({ error: "Método no permitido." });
};
