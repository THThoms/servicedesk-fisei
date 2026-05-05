const db = require('../db');

async function resolverNivel(servicio_id) {
  const result = await db.query(
    'SELECT r.nivel_entrada, s.nombre AS servicio FROM reglas_enrutamiento r JOIN servicios s ON s.id=r.servicio_id WHERE r.servicio_id=$1',
    [servicio_id]
  );
  if (!result.rows.length)
    throw new Error(`Sin regla de enrutamiento para servicio ${servicio_id}`);
  return result.rows[0].nivel_entrada;
}

async function listarReglas(req, res) {
  try {
    const result = await db.query(
      `SELECT s.id, s.nombre AS servicio, r.nivel_entrada,
              CASE r.nivel_entrada
                WHEN 1 THEN 'Técnicos nuevos (N1)'
                WHEN 2 THEN 'Técnico profesional (N2)'
                WHEN 3 THEN 'Servidor DITIC (N3)'
                WHEN 4 THEN 'Proveedor externo (N4)'
              END AS descripcion_nivel
       FROM servicios s
       JOIN reglas_enrutamiento r ON r.servicio_id = s.id
       ORDER BY r.nivel_entrada, s.nombre`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener reglas de enrutamiento' });
  }
}

module.exports = { resolverNivel, listarReglas };
