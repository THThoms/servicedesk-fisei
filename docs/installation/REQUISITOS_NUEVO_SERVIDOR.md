# Requisitos del servidor nuevo

Escrito para: quien va a contratar o preparar el servidor de ServiceDesk UTA, primero de pruebas y después de producción.

Cada cifra indica su origen:
- **[MEDIDO]** — medido en el laboratorio o el VPS.
- **[CONFIG]** — sale de la configuración del repositorio.
- **[ESTIMADO]** — cálculo razonado, no medido.

**No se ha hecho ninguna prueba de carga**: la concurrencia soportada no está medida.

## 1. Consumo medido

Laboratorio local (`docker stats`, 2026-11-05, aplicación en reposo, 11 usuarios, 9 tickets) y servidor anterior (medición de 2026-11-04):

| Componente | RAM en reposo [MEDIDO] | Límite del contenedor [CONFIG] | CPU límite [CONFIG] |
|---|---:|---:|---:|
| SQL Server 2022 | 1,42 GiB (lab) · 0,98–1,23 GiB (Fases H/P) | 3 GiB (`MSSQL_CONTAINER_MEMORY`); motor `MSSQL_MEMORY_LIMIT_MB=2048` | 2 (`MSSQL_CPUS`) |
| auth-service | 43 MiB | 512 MiB | 1 |
| catalog-service | 34 MiB | 512 MiB | 1 |
| ticket-service | 42 MiB | 512 MiB | 1 |
| api-gateway | 22 MiB | 256 MiB | 0,5 |
| frontend (nginx) | 13 MiB | 128 MiB | 0,5 |
| **Total** | **≈ 1,6 GiB** | **≈ 4,9 GiB de techo** | — |
| Servidor anterior completo | 1,4 GB ocupados de 7,9 GB | — | — |

| Almacenamiento | Tamaño |
|---|---|
| Imagen SQL Server 2022 CU27-GDR1 | 2,35 GB [MEDIDO] |
| Imágenes de la aplicación (5) | ≈ 2,4 GB [MEDIDO, con Node 20]. Con Node 22 se medirá en la Fase V |
| Caché de build de Docker | 2–5 GB [MEDIDO]; se purga con `docker builder prune` |
| Bases (3) | 16 MB asignados cada una; datos usados < 5 MB [MEDIDO] |
| Imágenes adjuntas | 10 archivos de prueba, < 1 MB [MEDIDO]; no representativo |
| Logs de contenedores | ≤ 20 MB × 5 archivos × 7 contenedores ≈ 0,7 GB máximo [CONFIG] |
| SQL Server efímero del restore drill | ≈ 2 GB de RAM durante unos minutos [ESTIMADO, por el mínimo del motor] |

## 2. Escenarios

| | **A. Mínimo para pruebas** | **B. Recomendado para pruebas integrales** | **C. Preparado para producción** |
|---|---|---|---|
| Uso | Instalar, validar y demostrar | Pruebas completas, restore drill aislado, APK, usuarios piloto | Uso real FISEI |
| CPU | 2 vCPU x86_64 | 4 vCPU x86_64 | 4 vCPU x86_64 (SQL Express usa como máximo 4 núcleos) |
| RAM | 4 GB | 8 GB | 8 GB (16 GB con Standard o más carga) |
| Disco sistema + Docker | 40 GB SSD | 80 GB SSD | 100 GB SSD |
| Disco de backups locales | En el mismo disco | En el mismo disco | Volumen separado de 20–40 GB recomendado |
| SQL Server | **Developer** (`SERVER_PURPOSE=pruebas`) | **Developer** (`SERVER_PURPOSE=pruebas`) | **Express** (bases < 10 GB) o la edición con licencia de la UTA |
| Restore drill | `DRILL_MODE=instance` (no hay RAM para un segundo SQL Server) | `ephemeral` | `ephemeral` |
| Margen | Justo: el techo de límites (4,9 GB) supera la RAM; en reposo se usa ≈ 1,6 GB | Holgado | Holgado |

Justificación:
- **4 GB es el mínimo absoluto.** SQL Server en Linux exige 2 GB para el motor, el instalador rechaza menos de 4 GB, y en reposo el sistema usa ≈ 1,6 GB más el SO.
- **8 GB permite el drill `ephemeral`** (≈ 2 GB extra) y reconstruir imágenes sin presión de memoria.
- **Express**: el *buffer pool* se limita a ≈ 1,4 GB y las bases a 10 GB cada una. Con el volumen actual, del orden de MB, hay margen de años [ESTIMADO]. Si una base se acerca a 10 GB, `server-health.sh` muestra el tamaño de cada una y habría que pasar a Standard.

## 3. Crecimiento [ESTIMADO]

| Elemento | Hipótesis | Crecimiento |
|---|---|---|
| Bases | Texto de tickets y eventos | Del orden de decenas de MB al año |
| Imágenes adjuntas | 200 tickets/mes × 2 imágenes × 1 MB. Desde la Fase R el cliente comprime a ≤ 1920 px, y una foto de 4 MB queda en ≈ 0,15–0,5 MB [MEDIDO en la Fase R] | 0,1–0,4 GB/mes |
| Backups locales | 3 conjuntos de `.bak`; las imágenes no se copian al disco | ≈ 3 × tamaño de las bases |
| Bucket B2 | Imágenes una vez + ≈ 29 snapshots deduplicados; cada día sube ≈ 0,4 MB con las bases actuales [MEDIDO, Fase S] | Dominado por las imágenes |

**Conexiones concurrentes: NO MEDIDAS.** La arquitectura (Node + Prisma con pool por servicio, SQL Server con 2 vCPU) es muy holgada para el uso de una facultad, pero no hay cifra. Se recomienda una prueba de carga en la Fase V antes de producción.

## 4. Requisitos de plataforma

- **Arquitectura x86_64/amd64 obligatoria.** No hay imagen de SQL Server 2022 para ARM.
- **SO:** Ubuntu Server 24.04 LTS. El instalador avisa con otro SO y se detiene sin root, en ARM, con menos de 4 GB de RAM, menos de 2 vCPU o menos de 20 GB libres.
- **Red:** IPv4 pública y puertos 22, 80 y 443. Un dominio con DNS apuntando al servidor (para TLS).
- **Software:**

  | Software | Versión | Origen |
  |---|---|---|
  | Docker Engine | **≥ 28** (probado con 29.5); ver CONFIGURACION_RED.md §4 | Repositorio oficial de Docker |
  | Docker Compose | Plugin v2 ≥ 2.20 | Repositorio oficial de Docker |
  | nginx | 1.24 (Ubuntu 24.04) o superior | `apt` |
  | certbot | — | `apt` |
  | ufw | — | `apt` |
  | curl, openssl | — | `apt` |
  | Node.js | Solo para la E2E opcional | — |

## 5. Puertos

Ver [CONFIGURACION_RED.md](CONFIGURACION_RED.md).

| Puerto | Exposición |
|---|---|
| 22, 80, 443 | Públicos |
| 8080 y 3000 | Solo `127.0.0.1` |
| 1433 | **No se publica** |
