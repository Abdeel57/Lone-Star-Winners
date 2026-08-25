/**
 * Semilla de DESARROLLO.
 *
 * Todos los datos son ostensiblemente ficticios: los correos usan el TLD
 * reservado `.invalid` (RFC 2606), que no existe y no puede existir, y los
 * nombres lo dicen en voz alta. Nada de esto puede confundirse con datos de
 * produccion.
 *
 * DOS COSAS QUE ESTA SEMILLA NO PUEDE HACER, Y ES CORRECTO QUE NO PUEDA
 *
 *   1. No crea ninguna promocion `ACTIVE`.
 *
 *      No es una omision: es el sistema funcionando. DEC-012 impide activar
 *      una promocion mientras exista una clave legal requerida sin resolver, y
 *      hoy `docs/LEGAL_PENDING.md` las tiene TODAS en `TBD`. Para que exista
 *      una promocion activa en desarrollo hace falta cargar una configuracion
 *      legal completa; inventarla aqui seria inventar requisitos legales
 *      (principio 2), asi que la semilla se detiene donde debe.
 *
 *      Consecuencia practica para `frontend`: hasta que llegue la respuesta
 *      del abogado, el storefront se desarrolla contra promociones `DRAFT` y
 *      `SCHEDULED`. Ver la nota en `docs/AGENT_HANDOFF.md`.
 *
 *   2. No genera ninguna entry. El ledger no existe todavia (`HO-006`).
 */

import { eq, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  adminUserRoles,
  adminUsers,
  identities,
  participants,
  productTranslations,
  productVariants,
  products,
  promotionRulesDocuments,
  promotionRulesVersions,
  promotionTranslations,
  promotions,
} from "../schema/index.js";

export interface SeedResult {
  readonly identities: number;
  readonly participants: number;
  readonly adminUsers: number;
  readonly promotions: number;
  readonly products: number;
  readonly warnings: readonly string[];
}

const FICTITIOUS_EMAIL_DOMAIN = "example.invalid";

/**
 * Ejecuta la semilla dentro de una unica transaccion: o queda un entorno de
 * desarrollo coherente, o no queda nada. Una semilla a medias es peor que
 * ninguna, porque parece que funciona.
 */
export async function seedDevelopmentData(db: Database): Promise<SeedResult> {
  const warnings: string[] = [];

  return db.transaction(async (tx) => {
    const alreadySeeded = await tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM promotions WHERE slug LIKE 'dev-%'`,
    );
    if (alreadySeeded.rows[0] !== undefined && alreadySeeded.rows[0].count !== "0") {
      throw new Error(
        "La base de datos ya contiene datos de semilla (`dev-%`). Recrea la base de datos antes de volver a sembrar.",
      );
    }

    // -----------------------------------------------------------------------
    // Identidades y perfiles
    // -----------------------------------------------------------------------
    const [participantIdentityEn] = await tx
      .insert(identities)
      .values({
        email: `participante.ficticio.en@${FICTITIOUS_EMAIL_DOMAIN}`,
        status: "ACTIVE",
        emailVerifiedAt: new Date("2026-01-15T12:00:00.000Z"),
      })
      .returning({ id: identities.id });

    const [participantIdentityEs] = await tx
      .insert(identities)
      .values({
        email: `participante.ficticio.es@${FICTITIOUS_EMAIL_DOMAIN}`,
        status: "PENDING_VERIFICATION",
      })
      .returning({ id: identities.id });

    if (participantIdentityEn === undefined || participantIdentityEs === undefined) {
      throw new Error("No se pudieron crear las identidades de participante de desarrollo.");
    }

    await tx.insert(participants).values([
      {
        identityId: participantIdentityEn.id,
        displayName: "Fictitious Participant (EN)",
        preferredLocale: "en-US",
        status: "ACTIVE",
      },
      {
        identityId: participantIdentityEs.id,
        displayName: "Participante Ficticio (ES)",
        preferredLocale: "es-US",
        status: "ACTIVE",
      },
    ]);

    // Cuentas administrativas. `COMPLIANCE_OFFICER` y `DRAW_OFFICER` van a
    // PERSONAS DISTINTAS: el trigger de DEC-017 impide que sean la misma, y
    // esta semilla sirve tambien para comprobarlo a mano.
    const adminSpecs = [
      { email: `admin.super.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`, name: "Fictitious Super Admin", role: "SUPER_ADMIN" },
      { email: `admin.ops.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`, name: "Fictitious Operations Admin", role: "OPERATIONS_ADMIN" },
      { email: `admin.soporte.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`, name: "Fictitious Support Agent", role: "CUSTOMER_SUPPORT" },
      { email: `admin.compliance.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`, name: "Fictitious Compliance Officer", role: "COMPLIANCE_OFFICER" },
      { email: `admin.sorteo.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`, name: "Fictitious Draw Officer", role: "DRAW_OFFICER" },
      { email: `admin.auditor.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`, name: "Fictitious Read-Only Auditor", role: "READ_ONLY_AUDITOR" },
    ] as const;

    const adminIds: string[] = [];

    for (const spec of adminSpecs) {
      const [identity] = await tx
        .insert(identities)
        .values({
          email: spec.email,
          status: "ACTIVE",
          emailVerifiedAt: new Date("2026-01-10T12:00:00.000Z"),
        })
        .returning({ id: identities.id });

      if (identity === undefined) {
        throw new Error(`No se pudo crear la identidad administrativa ${spec.email}.`);
      }

      const [admin] = await tx
        .insert(adminUsers)
        .values({
          identityId: identity.id,
          fullName: spec.name,
          status: "ACTIVE",
          // DEC-006: sin MFA inscrito la constraint impide el estado ACTIVE.
          // La inscripcion real de TOTP la implementa `packages/security`.
          mfaEnrolledAt: new Date("2026-01-10T12:05:00.000Z"),
        })
        .returning({ id: adminUsers.id });

      if (admin === undefined) {
        throw new Error(`No se pudo crear la cuenta administrativa ${spec.email}.`);
      }

      adminIds.push(admin.id);

      await tx.insert(adminUserRoles).values({
        adminUserId: admin.id,
        roleKey: spec.role,
        grantReason: "Semilla de desarrollo. Ninguna de estas cuentas existe fuera de un entorno local.",
      });
    }

    const operationsAdminId = adminIds[1];
    if (operationsAdminId === undefined) {
      throw new Error("No se pudo resolver la cuenta de operaciones de desarrollo.");
    }

    // -----------------------------------------------------------------------
    // Catalogo
    //
    // El copy describe MERCANCIA. Ni "boletos" ni "oportunidades de ganar", en
    // ninguno de los dos idiomas (CLAUDE.md seccion 1 y la nota de proceso de
    // docs/LEGAL_PENDING.md).
    // -----------------------------------------------------------------------
    const catalogSpecs = [
      {
        sku: "DEV-TEE-001",
        slug: "dev-camiseta-lone-star",
        priceMinor: 2500n,
        en: { name: "Development Sample T-Shirt", description: "Fictitious catalog item used for local development only." },
        es: { name: "Camiseta de muestra para desarrollo", description: "Articulo ficticio de catalogo, solo para desarrollo local." },
      },
      {
        sku: "DEV-CAP-002",
        slug: "dev-gorra-lone-star",
        priceMinor: 1800n,
        en: { name: "Development Sample Cap", description: "Fictitious catalog item used for local development only." },
        es: { name: "Gorra de muestra para desarrollo", description: "Articulo ficticio de catalogo, solo para desarrollo local." },
      },
      {
        sku: "DEV-MUG-003",
        slug: "dev-taza-lone-star",
        priceMinor: 1200n,
        en: { name: "Development Sample Mug", description: "Fictitious catalog item used for local development only." },
        es: { name: "Taza de muestra para desarrollo", description: "Articulo ficticio de catalogo, solo para desarrollo local." },
      },
    ] as const;

    for (const spec of catalogSpecs) {
      const [product] = await tx
        .insert(products)
        .values({ sku: spec.sku, slug: spec.slug, status: "ACTIVE", currency: "USD" })
        .returning({ id: products.id });

      if (product === undefined) {
        throw new Error(`No se pudo crear el producto ${spec.sku}.`);
      }

      await tx.insert(productTranslations).values([
        { productId: product.id, locale: "en-US", name: spec.en.name, description: spec.en.description },
        { productId: product.id, locale: "es-US", name: spec.es.name, description: spec.es.description },
      ]);

      await tx.insert(productVariants).values({
        productId: product.id,
        sku: `${spec.sku}-STD`,
        status: "ACTIVE",
        priceAmountMinor: spec.priceMinor,
        currency: "USD",
        stockQuantity: 100,
        position: 0,
      });
    }

    // -----------------------------------------------------------------------
    // Promociones
    // -----------------------------------------------------------------------
    const promotionSpecs = [
      {
        slug: "dev-promocion-borrador",
        internalName: "DEV - promocion en borrador (datos ficticios)",
        legalTimezone: "America/Chicago",
        startsAt: null,
        endsAt: null,
        schedule: false,
        en: { publicName: "Development Draft Promotion", tagline: "Local development only. Not a real promotion." },
        es: { publicName: "Promocion de desarrollo en borrador", tagline: "Solo desarrollo local. No es una promocion real." },
      },
      {
        slug: "dev-promocion-programada",
        internalName: "DEV - promocion programada (datos ficticios)",
        legalTimezone: "America/Chicago",
        startsAt: new Date("2026-09-01T05:00:00.000Z"),
        endsAt: new Date("2026-10-01T04:59:59.000Z"),
        schedule: true,
        en: { publicName: "Development Scheduled Promotion", tagline: "Local development only. Not a real promotion." },
        es: { publicName: "Promocion de desarrollo programada", tagline: "Solo desarrollo local. No es una promocion real." },
      },
    ] as const;

    for (const spec of promotionSpecs) {
      const [promotion] = await tx
        .insert(promotions)
        .values({
          slug: spec.slug,
          internalName: spec.internalName,
          legalTimezone: spec.legalTimezone,
          startsAt: spec.startsAt,
          endsAt: spec.endsAt,
        })
        .returning({ id: promotions.id });

      if (promotion === undefined) {
        throw new Error(`No se pudo crear la promocion ${spec.slug}.`);
      }

      await tx.insert(promotionTranslations).values([
        { promotionId: promotion.id, locale: "en-US", publicName: spec.en.publicName, tagline: spec.en.tagline },
        { promotionId: promotion.id, locale: "es-US", publicName: spec.es.publicName, tagline: spec.es.tagline },
      ]);

      // Version de reglas en DRAFT con TODAS las claves requeridas en `TBD`.
      // Es el reflejo exacto de `docs/LEGAL_PENDING.md` de hoy. La columna
      // generada `unresolved_required_keys` las listara, y el trigger de
      // DEC-012 impedira activar la promocion mientras sigan asi.
      const [rulesVersion] = await tx
        .insert(promotionRulesVersions)
        .values({
          promotionId: promotion.id,
          version: 1,
          status: "DRAFT",
          config: {
            _note:
              "Configuracion de desarrollo. Ningun valor legal esta decidido: ver docs/LEGAL_PENDING.md. No inventar valores aqui.",
            eligibility: "TBD",
            allowed_jurisdictions: "TBD",
            minimum_age: "TBD",
            promotion_start_end_rules: "TBD",
            entry_limits: "TBD",
            product_eligibility: "TBD",
            purchase_entry_formula: "TBD",
            official_rules_document: "TBD",
            controlling_language: "TBD",
            winner_drawing_method: "TBD",
            partial_refund_rounding_policy: "TBD",
            entry_expiration: "TBD",
            amoe: { mode: "DISABLED", note: "DEC-013: apagado por defecto. La modalidad la decide el abogado." },
          },
          createdByAdminUserId: operationsAdminId,
        })
        .returning({ id: promotionRulesVersions.id });

      if (rulesVersion === undefined) {
        throw new Error(`No se pudo crear la version de reglas de ${spec.slug}.`);
      }

      // Marcadores de posicion del texto legal. NINGUNO esta marcado como
      // controlante: cual de los dos idiomas lo es sigue en `TBD`.
      await tx.insert(promotionRulesDocuments).values([
        {
          rulesVersionId: rulesVersion.id,
          locale: "en-US",
          title: "Official Rules (placeholder)",
          body: "PLACEHOLDER. The Official Rules are drafted by the client's attorney. This repository consumes them; it does not produce them.",
          isLegallyControlling: false,
          isInformationalTranslation: false,
        },
        {
          rulesVersionId: rulesVersion.id,
          locale: "es-US",
          title: "Official Rules (marcador de posicion)",
          body: "MARCADOR DE POSICION. Las Official Rules las redacta el abogado del cliente. Este repositorio las consume; no las produce.",
          isLegallyControlling: false,
          isInformationalTranslation: false,
        },
      ]);

      if (spec.schedule) {
        await tx.update(promotions).set({ status: "SCHEDULED" }).where(eq(promotions.id, promotion.id));
      }
    }

    warnings.push(
      "No se ha creado ninguna promocion ACTIVE: DEC-012 lo impide mientras las claves legales requeridas sigan en TBD (docs/LEGAL_PENDING.md).",
    );
    warnings.push("No se ha creado ninguna entry: el ledger todavia no existe (HO-006, expiracion de entries).");
    warnings.push(
      "Ninguna cuenta administrativa tiene credencial: el hash Argon2id y el TOTP los implementa packages/security (DEC-006).",
    );

    return {
      identities: 2 + adminSpecs.length,
      participants: 2,
      adminUsers: adminSpecs.length,
      promotions: promotionSpecs.length,
      products: catalogSpecs.length,
      warnings,
    };
  });
}
