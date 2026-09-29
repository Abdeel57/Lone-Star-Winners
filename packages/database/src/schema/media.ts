/**
 * Imagenes de catalogo subidas desde el panel (DEC-056).
 * Espejo de `drizzle/0029_media_assets.sql`.
 *
 * Las filas son INMUTABLES: el rol `app` solo tiene SELECT e INSERT. Cambiar la
 * foto de un producto es subir otra imagen y apuntar `image_url` a ella, y por
 * eso `/media/<id>.<ext>` puede servirse con `immutable`.
 *
 * Los bytes viven aqui porque el proveedor de almacenamiento sigue sin decidir
 * (`CLAUDE.md` 7) y el disco del contenedor no sobrevive a un despliegue. Ver
 * la cabecera de la migracion para el razonamiento completo.
 */

import { customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";

/** `bytea`. El driver entrega `Buffer`, que es lo que Fastify manda sin tocar. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Lista cerrada, la misma que el CHECK. SVG queda fuera: puede llevar script. */
export const MEDIA_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

/** 5 MiB. Mismo valor que `media_assets_byte_size_range`. */
export const MEDIA_MAX_BYTES = 5_242_880;

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentType: text("content_type").$type<MediaContentType>().notNull(),
  byteSize: integer("byte_size").notNull(),
  /** Hex en minusculas. UNIQUE: la misma foto subida dos veces es una fila. */
  sha256: text("sha256").notNull().unique("media_assets_sha256_unique"),
  content: bytea("content").notNull(),
  uploadedByAdminUserId: uuid("uploaded_by_admin_user_id").references(() => adminUsers.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
