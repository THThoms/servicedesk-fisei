const db = require('../db');

async function listarServicios(req, res) {
  try {
    const result = await db.query(
      `SELECT s.id, s.nombre, s.descripcion, r.nivel_entrada
       FROM servicios s
       LEFT JOIN reglas_enrutamiento r ON r.servicio_id = s.id
       WHERE s.activo = true
       ORDER BY r.nivel_entrada, s.nombre`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener servicios' });
  }
}

async function obtenerServicio(req, res) {
  try {
    const result = await db.query(
      `SELECT s.*, r.nivel_entrada
       FROM servicios s
       LEFT JOIN reglas_enrutamiento r ON r.servicio_id = s.id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error al obtener servicio' });
  }
}

async function crearServicio(req, res) {
  try {
    const { nombre, descripcion, nivel_entrada } = req.body;
    if (!nombre || !nivel_entrada)
      return res.status(400).json({ error: 'nombre y nivel_entrada son requeridos' });

    const servicio = await db.query(
      'INSERT INTO servicios (nombre, descripcion) VALUES ($1,$2) RETURNING *',
      [nombre, descripcion]
    );
    await db.query(
      'INSERT INTO reglas_enrutamiento (servicio_id, nivel_entrada) VALUES ($1,$2)',
      [servicio.rows[0].id, nivel_entrada]
    );
    res.status(201).json({ ...servicio.rows[0], nivel_entrada });
  } catch {
    res.status(500).json({ error: 'Error al crear servicio' });
  }
}

async function actualizarRegla(req, res) {
  try {
    const { nivel_entrada } = req.body;
    if (!nivel_entrada)
      return res.status(400).json({ error: 'nivel_entrada es requerido' });

    const result = await db.query(
      'UPDATE reglas_enrutamiento SET nivel_entrada=$1 WHERE servicio_id=$2 RETURNING *',
      [nivel_entrada, req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Regla no encontrada para ese servicio' });
    res.json({ mensaje: 'Regla actualizada', ...result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Error al actualizar regla' });
  }
}

module.exports = { listarServicios, obtenerServicio, crearServicio, actualizarRegla };
