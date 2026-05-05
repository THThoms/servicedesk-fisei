const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sesion = await db.query(
      'SELECT id FROM sesiones WHERE token_hash=$1 AND expires_at > NOW()',
      [tokenHash]
    );
    if (!sesion.rows.length)
      return res.status(401).json({ error: 'Sesión inválida o expirada' });

    req.usuario = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol))
      return res.status(403).json({ error: `Acceso denegado. Roles permitidos: ${roles.join(', ')}` });
    next();
  };
}

module.exports = { verifyToken, requireRole };
