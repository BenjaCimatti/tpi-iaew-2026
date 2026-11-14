# Prueba de carga — JMeter

Herramienta exigida por la consigna: **JMeter** (`alpine/jmeter:5.6.3` en Docker,
sin instalar Java). Plan: [`load/pedidos.jmx`](../load/pedidos.jmx). Ejecución:
[`load/run.sh`](../load/run.sh).

## Escenario

Flujo de un mozo, repetido sin pausa por cada usuario virtual:

1. `GET /productos`: consultar el catálogo.
2. `POST /pedidos`: crear un pedido con dos productos del seed (mesa 1).
3. `GET /pedidos/{id}`: consultar el pedido creado.
4. `POST /pedidos/{id}/confirmar`: confirmar. Dispara outbox → RabbitMQ → worker → orden de cocina.

- **Cada iteración crea y confirma su propio pedido.** Ninguna confirmación
  falla por diseño: no se reutiliza un pedido ya confirmado.
- Aserción: toda respuesta debe ser **2xx**. Cualquier otro código cuenta como error.
- **Token:** se obtiene una sola vez con `client_credentials` **antes** de la
  carga y se pasa por propiedad (`-Jtoken`). La prueba mide la API, no Auth0, y
  el `.jmx` no contiene secretos.
- Cada request lleva un `x-correlation-id` nuevo (`${__UUID()}`).
- JMeter corre dentro de la red de Compose y apunta a `api:3000`, sin el
  reenvío de puertos de Docker Desktop.

| Parámetro | Valor |
|---|---|
| Usuarios concurrentes | 20 |
| Ramp-up | 20 s |
| Duración | 120 s (incluye el ramp-up) |
| Pausa entre requests | ninguna (carga máxima sostenible por 20 usuarios) |
| Datos | seed: mesa `b3f1a2e0-…0001`, productos `a1c9f0e0-…0001` y `…0003` |

## Objetivos propios

La consigna **no fija umbrales numéricos**. Estos objetivos los define el
equipo como referencia para un restaurante (decenas de mesas):

| Indicador | Objetivo propio | Resultado | ¿Cumple? |
|---|---|---|---|
| p95 de todas las requests | < 300 ms | **42 ms** | Sí |
| Error rate | < 1 % | **0,00 %** | Sí |
| Throughput con 20 usuarios | ≥ 100 req/s | **721 req/s** | Sí |
| Consistencia asíncrona | 100 % de confirmaciones con orden de cocina | **21 618 / 21 618** | Sí |

## Resultados — corrida `20261114-170056`

Entorno: notebook Intel Core Ultra 9 185H (16 núcleos / 22 hilos), 23,4 GB de
RAM; Docker Desktop 29.7.2 con 22 CPU y 11,4 GB asignados a la VM. Commit
`945e50c` con los cambios de E2-09 sin commitear (solo Postman y archivos de
carga; ningún cambio en `src/`).

| Request | Muestras | Error % | Media (ms) | p90 | p95 | p99 | Máx. | req/s |
|---|---|---|---|---|---|---|---|---|
| `GET /productos` | 21 633 | 0,00 | 16,6 | 24 | 26 | 33 | 70 | 180,4 |
| `POST /pedidos` | 21 628 | 0,00 | 26,1 | 34 | 38 | 47 | 87 | 180,4 |
| `GET /pedidos/:pedidoId` | 21 622 | 0,00 | 30,1 | 39 | 43 | 54 | 106 | 180,4 |
| `POST /pedidos/:pedidoId/confirmar` | 21 618 | 0,00 | 29,0 | 37 | 41 | 51 | 118 | 180,4 |
| **Total** | **86 501** | **0,00** | **25,4** | **37** | **42** | **58** | **118** | **721,2** |

Después de la carga: ningún pedido `confirmado` sin orden de cocina y outbox sin
pendientes. Grafana durante la prueba mostró p95 de 47,9 ms, 741 req/s, 0 % de
5xx y como máximo 5 eventos pendientes en el outbox:
[captura](img/dashboard-jmeter.png). La diferencia con el p95 de JMeter se
explica porque Prometheus interpola entre buckets del histograma (25 y 50 ms).

Archivos de la corrida: [`load/resultados/20261114-170056/`](../load/resultados/20261114-170056/)
(`statistics.json`, `resultados.jtl.gz` con las muestras crudas y
`parametros.txt`). El reporte HTML de JMeter se regenera con:

```bash
gunzip -k load/resultados/20261114-170056/resultados.jtl.gz
MSYS_NO_PATHCONV=1 docker compose --profile carga run --rm jmeter \
  -g /load/resultados/20261114-170056/resultados.jtl -o /load/resultados/20261114-170056/reporte
```

## Interpretación

- Con 20 usuarios sin pausa, la API sostuvo ~720 req/s (~180 confirmaciones por
  segundo) sin errores y con p95 de 42 ms. Las rutas de escritura (`POST`) y la
  consulta del pedido con sus ítems son las más lentas, por las transacciones y
  el `SELECT … FOR UPDATE`.
- El flujo asíncrono acompañó la carga: con el publicador por lote (E2-08), el
  outbox no acumuló más de 5 eventos y el worker creó todas las órdenes.
- El cuello de botella observado antes de E2-08 (publicador de a un evento: 303
  pendientes y hasta 6 s de demora) no reapareció.

## Limitaciones

- **Generador y sistema en la misma máquina.** JMeter compite por CPU con API,
  PostgreSQL y RabbitMQ: los números son una referencia local, no capacidad de
  producción.
- Un solo token para todos los usuarios virtuales (mismo cliente M2M).
- El escenario no incluye `GET /cocina/ordenes`. **Esa ruta no tiene
  paginación:** después de las pruebas devolvía decenas de miles de órdenes
  (~6 MB) y su p95 subió a ~450 ms durante la colección Postman. Mejora futura:
  paginar o filtrar por órdenes activas por defecto.
- Los datos crecen con cada corrida (cada iteración crea un pedido y una orden).
  Para la demo, reinicializar con `docker compose down --volumes` (ver README).

## Repetir

```bash
docker compose up --build -d
docker compose exec api npm run db:seed
bash load/run.sh                                    # 20 usuarios, 20 s de rampa, 120 s
USUARIOS=50 RAMPUP=30 DURACION=180 bash load/run.sh # otro escenario
```

En Windows usar Git Bash. El reporte queda en `load/resultados/<fecha>/reporte/index.html`.
