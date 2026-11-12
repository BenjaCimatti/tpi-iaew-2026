# Verificación del esqueleto — Entrega 1

Ejecución realizada el **12/11/2026, entre las 17:31 y las 17:33 (Argentina,
UTC−03:00)**, sobre el commit base
`248f766637debdc1e33d0ce190580817dd40be3a`, con los cambios documentales locales
del README y del plan. No se modificó `docker-compose.yml`.

Entorno: macOS (`Darwin arm64`), Docker Desktop, motor Docker `29.8.2` y Docker
Compose `v5.6.0`. Se utilizó el `.env` local existente, sin sobrescribirlo ni
registrar sus valores. Al inicio no había contenedores del proyecto; fue necesario
iniciar Docker Desktop porque el motor estaba detenido.

## Comandos y resultados

Todos los comandos de comprobación y detención de la tabla terminaron con código
de salida `0`.

| Comando | Resultado observado |
|---|---|
| `docker compose config --quiet` | Configuración válida. Advertencia: el atributo `version` es obsoleto y se ignora. |
| `docker compose up -d` | Descargó las imágenes y creó la red, el volumen de PostgreSQL y los cuatro contenedores. Esperó los healthchecks de DB/broker antes de iniciar API/worker. |
| `docker compose ps` | `api` y `worker` en ejecución; `db` y `broker` en ejecución y `healthy`. Detalle debajo. |
| `curl --fail --silent --show-error --max-time 10 --include http://localhost:3000` | HTTP `200 OK`, cabecera `X-App-Name: http-echo` y cuerpo `API placeholder - reemplazar en Entrega 2`. |
| `curl --fail --silent --show-error --max-time 10 --output /dev/null --write-out 'RabbitMQ Management: HTTP %{http_code}\n' http://localhost:15672` | `RabbitMQ Management: HTTP 200`. Se verificó acceso HTTP al panel, sin probar el login en un navegador. |
| `docker compose logs --no-color --tail=10 api worker` | API escuchando en `:3000` y worker en `:3001`; la API registró el `GET /` con estado `200`. |
| `docker compose exec -T broker rabbitmqctl list_connections name user state` | `Listing connections ...`, sin conexiones AMQP listadas. |
| `docker compose down` | Detuvo y eliminó los cuatro contenedores y la red del proyecto. |
| `docker compose ps -a` | Solo encabezados, sin contenedores del proyecto después de `down`. |
| `docker volume ls --filter name=tpi-iaew-2026_db_data` | El volumen `tpi-iaew-2026_db_data` permaneció disponible. |

Estado observado antes de detener:

| Servicio | Imagen | Estado |
|---|---|---|
| `api` | `hashicorp/http-echo` | Up |
| `worker` | `hashicorp/http-echo` | Up |
| `db` | `postgres:16-alpine` | Up (healthy) |
| `broker` | `rabbitmq:3.13-management-alpine` | Up (healthy) |

Extracto de los logs (timestamps UTC emitidos por los contenedores):

```text
worker-1  | 2026/11/12 20:33:03 [INFO] server is listening on :3001
api-1     | 2026/11/12 20:33:03 [INFO] server is listening on :3000
```

## Conclusión y límites

**El esqueleto arrancó y se detuvo correctamente en este entorno.** La API
placeholder y la página de RabbitMQ Management respondieron por HTTP; los
healthchecks de PostgreSQL y RabbitMQ pasaron.

Esto **no demuestra integración de negocio**: ambos servicios de aplicación usan
`http-echo`, que no conecta a PostgreSQL/RabbitMQ ni implementa pedidos. No se
demostraron CRUD, autenticación, publicación/consumo de `pedido.confirmado`,
persistencia de órdenes de cocina ni WebSocket. Tampoco se verificó persistencia
de datos de negocio: conservar el volumen no prueba ese comportamiento.

La advertencia por `version` no impidió la ejecución. Las imágenes y el Compose
se mantuvieron como estaban. Al finalizar, los servicios quedaron detenidos y el
volumen de PostgreSQL se conservó.
