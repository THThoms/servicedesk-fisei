const router = require('express').Router();
const upload = require('./upload');
const { crearTicket, listarTickets, obtenerTicket } = require('./ticketController');
const { verifyToken } = require('../auth/authMiddleware');

router.get('/', verifyToken, listarTickets);
router.get('/:id', verifyToken, obtenerTicket);
router.post('/', verifyToken, upload.array('adjuntos', 5), crearTicket);

module.exports = router;
