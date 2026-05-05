const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

async function register(req, res) {
  try {
    const { nombre, email, password, role_id } = req.body;
    if (!nombre || !email || !password || !role_id)
      return res.status(400).json({ error: 'nombre, email, password y role_id son requeridos' });

    const existe = await db.query('SELECT id FROM usuarios WHERE email=$1', [email]);
    if (existe.rows.length)
      return res.status(409).json({ error: 'El email ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO usuarios (nombre, email, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, role_id, created_at',
      [nombre, email, hash, role_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email y password son requeridos' });

    const result = await db.query(
      'SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id=u.role_id WHERE u.email=$1 AND u.activo=true',
      [email]
    );
    const usuario = result.rows[0];
    if (!usuario || !(await bcrypt.compare(password, usuario.password_hash)))
      return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: usuario.id, role_id: usuario.role_id, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO sesiones (usuario_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [usuario.id, tokenHash, expiresAt]
    );

    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
}

async function logout(req, res) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.query('DELETE FROM sesiones WHERE token_hash=$1', [tokenHash]);
    res.json({ mensaje: 'Sesión cerrada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
}

module.exports = { register, login, logout };
