-- =============================================================
-- ServiceDesk FISEI — Esquema de Base de Datos
-- HU-01: BD + estructura del proyecto
-- =============================================================

CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(50)  NOT NULL UNIQUE,
    descripcion TEXT,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE usuarios (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INT          NOT NULL REFERENCES roles(id),
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Sesiones activas para invalidar JWT en logout
CREATE TABLE sesiones (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT          NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMP    NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE servicios (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Tabla configurable: servicio → nivel de entrada sin cambio de código
CREATE TABLE reglas_enrutamiento (
    id            SERIAL PRIMARY KEY,
    servicio_id   INT NOT NULL UNIQUE REFERENCES servicios(id),
    nivel_entrada INT NOT NULL CHECK (nivel_entrada BETWEEN 1 AND 4)
);

CREATE TABLE tickets (
    id                   SERIAL PRIMARY KEY,
    usuario_id           INT          NOT NULL REFERENCES usuarios(id),
    servicio_id          INT          NOT NULL REFERENCES servicios(id),
    titulo               VARCHAR(200) NOT NULL,
    descripcion          TEXT         NOT NULL,
    estado               VARCHAR(20)  NOT NULL DEFAULT 'abierto'
                             CHECK (estado IN ('abierto','en_proceso','escalado','resuelto','cerrado')),
    nivel_actual         INT          NOT NULL CHECK (nivel_actual BETWEEN 1 AND 4),
    tecnico_asignado_id  INT          REFERENCES usuarios(id),
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE adjuntos (
    id             SERIAL PRIMARY KEY,
    ticket_id      INT          NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    nombre_archivo VARCHAR(255) NOT NULL,
    ruta_archivo   VARCHAR(500) NOT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE historial_acciones (
    id          SERIAL PRIMARY KEY,
    ticket_id   INT         NOT NULL REFERENCES tickets(id),
    tecnico_id  INT         NOT NULL REFERENCES usuarios(id),
    accion      VARCHAR(20) NOT NULL
                    CHECK (accion IN ('asignado','resuelto','escalado','comentario')),
    nivel_desde INT         CHECK (nivel_desde BETWEEN 1 AND 4),
    nivel_hasta INT         CHECK (nivel_hasta BETWEEN 1 AND 4),
    notas       TEXT,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE base_conocimiento (
    id         SERIAL PRIMARY KEY,
    ticket_id  INT          REFERENCES tickets(id) ON DELETE SET NULL,
    titulo     VARCHAR(200) NOT NULL,
    problema   TEXT         NOT NULL,
    solucion   TEXT         NOT NULL,
    categoria  VARCHAR(100),
    creado_por INT          NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tickets_usuario  ON tickets(usuario_id);
CREATE INDEX idx_tickets_estado   ON tickets(estado);
CREATE INDEX idx_tickets_nivel    ON tickets(nivel_actual);
CREATE INDEX idx_historial_ticket ON historial_acciones(ticket_id);
CREATE INDEX idx_sesiones_token   ON sesiones(token_hash);
CREATE INDEX idx_sesiones_expiry  ON sesiones(expires_at);
