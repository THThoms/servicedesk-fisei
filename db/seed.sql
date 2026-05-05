-- =============================================================
-- ServiceDesk FISEI — Datos iniciales
-- HU-01: BD + estructura del proyecto
-- =============================================================

INSERT INTO roles (nombre, descripcion) VALUES
  ('admin',   'Administrador general del sistema'),
  ('user',    'Usuario final que genera tickets'),
  ('tech_n1', 'Técnico Nivel 1 — Internet, Correo electrónico'),
  ('tech_n2', 'Técnico Nivel 2 — Equipos, Software'),
  ('tech_n3', 'Técnico Nivel 3 — MOODLE, Calificaciones'),
  ('tech_n4', 'Técnico Nivel 4 — Infraestructura crítica');

INSERT INTO servicios (nombre, descripcion) VALUES
  ('Internet',                         'Problemas de conectividad a internet'),
  ('Correo electrónico',               'Problemas con el email institucional'),
  ('Equipos',                          'Problemas con equipos de cómputo y hardware'),
  ('Software',                         'Problemas con aplicaciones y software'),
  ('MOODLE',                           'Problemas con la plataforma educativa MOODLE'),
  ('Servicio de calificaciones',       'Problemas con el sistema de calificaciones'),
  ('Fallo crítico de infraestructura', 'Fallos críticos de infraestructura institucional');

INSERT INTO reglas_enrutamiento (servicio_id, nivel_entrada)
SELECT id,
  CASE nombre
    WHEN 'Internet'                         THEN 1
    WHEN 'Correo electrónico'               THEN 1
    WHEN 'Equipos'                          THEN 2
    WHEN 'Software'                         THEN 2
    WHEN 'MOODLE'                           THEN 3
    WHEN 'Servicio de calificaciones'       THEN 3
    WHEN 'Fallo crítico de infraestructura' THEN 4
  END
FROM servicios;
