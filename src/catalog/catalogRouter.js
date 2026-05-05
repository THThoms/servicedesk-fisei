const router = require('express').Router();
const { listarServicios, obtenerServicio, crearServicio, actualizarRegla } = require('./catalogController');
const { verifyToken, requireRole } = require('../auth/authMiddleware');

router.get('/', verifyToken, listarServicios);
router.get('/:id', verifyToken, obtenerServicio);
router.post('/', verifyToken, requireRole('admin'), crearServicio);
router.put('/:id/regla', verifyToken, requireRole('admin'), actualizarRegla);

module.exports = router;
