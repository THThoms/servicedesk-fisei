const db = require('../db');
const { resolverNivel } = require('../routing/routingService');

async function crearTicket(req, res) {
  try {
    const { servicio_id, titulo, descripcion } = req.body;
    if (!servicio_id || !titulo || !descripcion)
      return res.status(400).json({ error: 'servicio_id, titulo y descripcion son requeridos' });

    let nivel;
    try {
      nivel = await resolverNivel(servicio_id);
    } catch {
      return res.status(400).json({ error: 'El servicio seleccionado no tiene regla de enrutamiento' });
    }
    const ticket = await db.query(
      'INSERT INTO tickets (usuario_id, servicio_id, titulo, descripcion, nivel_actual) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.usuario.id, servicio_id, titulo, descripcion, nivel]
    );

    if (req.files?.length) {
      for (const file of req.files) {
        await db.query(
          'INSERT INTO adjuntos (ticket_id, nombre_archivo, ruta_archivo) VALUES ($1,$2,$3)',
          [ticket.rows[0].id, file.originalname, file.path]
        );
      }
    }

    res.status(201).json({ ...ticket.rows[0], adjuntos: req.files?.length ?? 0 });
  } catch {
    res.status(500).json({ error: 'Error al crear el ticket' });
  }
}

async function listarTickets(req, res) {
  try {
    const result = await db.query(
      `SELECT t.id, t.titulo, t.estado, t.nivel_actual, t.created_at,
              s.nombre AS servicio, u.nombre AS usuario
       FROM tickets t
       JOIN servicios s ON s.id = t.servicio_id
       JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.usuario_id = $1
       ORDER BY t.created_at DESC`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error al listar tickets' });
  }
}

async function obtenerTicket(req, res) {
  try {
    const ticket = await db.query(
      `SELECT t.*, s.nombre AS servicio, u.nombre AS usuario
       FROM tickets t
       JOIN servicios s ON s.id = t.servicio_id
       JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.id = $1 AND t.usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );
    if (!ticket.rows.length)
      return res.status(404).json({ error: 'Ticket no encontrado' });

    const adjuntos = await db.query(
      'SELECT id, nombre_archivo, ruta_archivo, created_at FROM adjuntos WHERE ticket_id=$1',
      [req.params.id]
    );
    res.json({ ...ticket.rows[0], adjuntos: adjuntos.rows });
  } catch {
    res.status(500).json({ error: 'Error al obtener el ticket' });
  }
}

module.exports = { crearTicket, listarTickets, obtenerTicket };
