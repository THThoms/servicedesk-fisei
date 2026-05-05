const router = require('express').Router();
const { listarReglas } = require('./routingService');
const { verifyToken } = require('../auth/authMiddleware');

router.get('/', verifyToken, listarReglas);

module.exports = router;
