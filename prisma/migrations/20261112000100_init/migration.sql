BEGIN;

-- SQL generado con Prisma Migrate; las restricciones CHECK se agregan al final.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "estado_mesa" AS ENUM ('libre', 'ocupada');
CREATE TYPE "estado_pedido" AS ENUM ('pendiente', 'confirmado', 'en_preparacion', 'listo', 'entregado', 'cancelado');
CREATE TYPE "estado_orden_cocina" AS ENUM ('recibida', 'en_preparacion', 'lista');

CREATE TABLE "producto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(12,2) NOT NULL,
    "categoria" TEXT,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "producto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mesa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "numero" INTEGER NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "estado" "estado_mesa" NOT NULL DEFAULT 'libre',
    CONSTRAINT "mesa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mesa_id" UUID NOT NULL,
    "estado" "estado_pedido" NOT NULL DEFAULT 'pendiente',
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_en" TIMESTAMPTZ(3),
    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "item_pedido_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orden_cocina" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "estado" "estado_orden_cocina" NOT NULL DEFAULT 'recibida',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orden_cocina_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "publicado_en" TIMESTAMPTZ(3),
    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mesa_numero_key" ON "mesa"("numero");
CREATE INDEX "pedido_mesa_id_idx" ON "pedido"("mesa_id");
CREATE INDEX "item_pedido_pedido_id_idx" ON "item_pedido"("pedido_id");
CREATE INDEX "item_pedido_producto_id_idx" ON "item_pedido"("producto_id");
CREATE UNIQUE INDEX "orden_cocina_pedido_id_key" ON "orden_cocina"("pedido_id");
CREATE INDEX "outbox_pedido_id_idx" ON "outbox"("pedido_id");
CREATE INDEX "outbox_publicado_en_occurred_at_idx" ON "outbox"("publicado_en", "occurred_at");

ALTER TABLE "pedido" ADD CONSTRAINT "pedido_mesa_id_fkey" FOREIGN KEY ("mesa_id") REFERENCES "mesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orden_cocina" ADD CONSTRAINT "orden_cocina_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NaN es válido para NUMERIC en PostgreSQL: se rechaza explícitamente en importes.
ALTER TABLE "producto"
    ADD CONSTRAINT "producto_precio_valido" CHECK ("precio" >= 0 AND "precio" <> 'NaN'::numeric),
    ADD CONSTRAINT "producto_nombre_no_vacio" CHECK (btrim("nombre") <> '');
ALTER TABLE "mesa"
    ADD CONSTRAINT "mesa_numero_positivo" CHECK ("numero" > 0),
    ADD CONSTRAINT "mesa_capacidad_positiva" CHECK ("capacidad" > 0);
ALTER TABLE "pedido"
    ADD CONSTRAINT "pedido_total_valido" CHECK ("total" >= 0 AND "total" <> 'NaN'::numeric);
ALTER TABLE "item_pedido"
    ADD CONSTRAINT "item_pedido_cantidad_positiva" CHECK ("cantidad" > 0),
    ADD CONSTRAINT "item_pedido_precio_valido" CHECK ("precio_unitario" >= 0 AND "precio_unitario" <> 'NaN'::numeric);
ALTER TABLE "outbox"
    ADD CONSTRAINT "outbox_version_positiva" CHECK ("version" > 0),
    ADD CONSTRAINT "outbox_tipo_no_vacio" CHECK (btrim("event_type") <> ''),
    ADD CONSTRAINT "outbox_payload_objeto" CHECK (jsonb_typeof("payload") = 'object');

COMMIT;
