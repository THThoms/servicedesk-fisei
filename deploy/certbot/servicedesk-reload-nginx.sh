#!/bin/sh
# ServiceDesk UTA — hook de despliegue de certbot
# (/etc/letsencrypt/renewal-hooks/deploy/servicedesk-reload-nginx.sh).
# Se ejecuta SOLO cuando un certificado se renueva: valida la configuración y
# recarga nginx para que use el certificado nuevo sin cortar conexiones.
set -e
nginx -t -q
systemctl reload nginx
logger -t servicedesk-certbot "certificado renovado: nginx recargado (${RENEWED_DOMAINS:-?})"
