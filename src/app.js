require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

app.use('/api/auth', require('./auth/authRouter'));
app.use('/api/servicios', require('./catalog/catalogRouter'));
app.use('/api/tickets', require('./tickets/ticketRouter'));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ServiceDesk corriendo en puerto ${PORT}`));

module.exports = app;
