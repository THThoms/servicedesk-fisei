const router = require('express').Router();
const { register, login, logout } = require('./authController');
const { verifyToken } = require('./authMiddleware');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', verifyToken, logout);

module.exports = router;
