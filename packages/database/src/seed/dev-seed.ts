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
 *   2. No genera ninguna entry.
 *
 *      El ledger YA existe (migracion `0006`). Lo que falta es a que anclarlas:
 *      toda transaccion apunta a una `PromotionRulesVersion`, y aqui todas
 *      estan en `DRAFT` con las claves legales en `TBD`.
 *
 *      Sembrar entries bajo una version de reglas en borrador produciria datos
 *      de desarrollo que el sistema no generaria jamas en produccion, y el
 *      portal del participante se construiria contra una forma que no existe.
 *      Es el mismo motivo del punto 1, un paso mas abajo.
 *
 *      Lo que si se siembra es la SECUENCIA de numeros de cada promocion: se
 *      asigna siempre, para que un rango sea reconstruible hacia atras, y el
 *      flag `visible_entry_numbers_enabled` solo decide si se muestra.
 */

import { eq, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { STAFF_ASSIGNABLE_ROLE_KEYS, type AdminRoleKey } from "../domain/permissions.js";
import {
  adminUserRoles,
  adminUsers,
  identities,
  participants,
  productTranslations,
  productVariants,
  products,
  promotionEntryNumberSequences,
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

    /**
     * Cuentas administrativas, una por ROL DE PERSONAL del catalogo canonico.
     *
     * `COMPLIANCE_OFFICER` y `DRAW_OFFICER` van a PERSONAS DISTINTAS: el
     * trigger de DEC-017 impide que sean la misma, y esta semilla sirve
     * tambien para comprobarlo a mano.
     *
     * DEC-027: la lista
     * se deriva de `STAFF_ASSIGNABLE_ROLE_KEYS`, no se escribe a mano: si
     * `packages/security` anade un rol, la semilla lo cubre sola.
     *
     * `PARTICIPANT` y `SYSTEM` quedan fuera por construccion, y ademas la
     * clave ajena compuesta de `0004` los rechazaria: un empleado no es un
     * participante (DEC-028) y nadie actua como el sistema.
     *
     * Los pares incompatibles (`ADMIN_ROLE_CONFLICTS`) no son un problema
     * aqui: cada cuenta recibe UN solo rol, que es justo lo que el trigger de
     * separacion de funciones permite.
     */
    const adminSpecs = STAFF_ASSIGNABLE_ROLE_KEYS.map((role) => ({
      email: `admin.${role.toLowerCase()}.ficticio@${FICTITIOUS_EMAIL_DOMAIN}`,
      name: `Fictitious ${role}`,
      role,
    }));

    // Por rol, no por posicion: una lista derivada puede reordenarse, y un
    // indice numerico convertiria eso en "el promotor ahora es el de soporte".
    const adminIdByRole = new Map<AdminRoleKey, string>();

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

      adminIdByRole.set(spec.role, admin.id);

      await tx.insert(adminUserRoles).values({
        adminUserId: admin.id,
        roleKey: spec.role,
        grantReason:
          "Semilla de desarrollo. Ninguna de estas cuentas existe fuera de un entorno local.",
      });
    }

    // Quien crea catalogo y versiones de reglas en desarrollo. DEC-027: el
    // antiguo `OPERATIONS_ADMIN` es hoy `PROMOTION_MANAGER`, que es el rol que
    // el catalogo canonico dota de `promotion.create` y `rules.version.create`.
    const promotionManagerId = adminIdByRole.get("PROMOTION_MANAGER");
    if (promotionManagerId === undefined) {
      throw new Error("No se pudo resolver la cuenta PROMOTION_MANAGER de desarrollo.");
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
        en: {
          name: "Development Sample T-Shirt",
          description: "Fictitious catalog item used for local development only.",
        },
        es: {
          name: "Camiseta de muestra para desarrollo",
          description: "Articulo ficticio de catalogo, solo para desarrollo local.",
        },
      },
      {
        sku: "DEV-CAP-002",
        slug: "dev-gorra-lone-star",
        priceMinor: 1800n,
        en: {
          name: "Development Sample Cap",
          description: "Fictitious catalog item used for local development only.",
        },
        es: {
          name: "Gorra de muestra para desarrollo",
          description: "Articulo ficticio de catalogo, solo para desarrollo local.",
        },
      },
      {
        sku: "DEV-MUG-003",
        slug: "dev-taza-lone-star",
        priceMinor: 1200n,
        en: {
          name: "Development Sample Mug",
          description: "Fictitious catalog item used for local development only.",
        },
        es: {
          name: "Taza de muestra para desarrollo",
          description: "Articulo ficticio de catalogo, solo para desarrollo local.",
        },
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
        {
          productId: product.id,
          locale: "en-US",
          name: spec.en.name,
          description: spec.en.description,
        },
        {
          productId: product.id,
          locale: "es-US",
          name: spec.es.name,
          description: spec.es.description,
        },
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
        en: {
          publicName: "Development Draft Promotion",
          tagline: "Local development only. Not a real promotion.",
        },
        es: {
          publicName: "Promocion de desarrollo en borrador",
          tagline: "Solo desarrollo local. No es una promocion real.",
        },
      },
      {
        slug: "dev-promocion-programada",
        internalName: "DEV - promocion programada (datos ficticios)",
        legalTimezone: "America/Chicago",
        startsAt: new Date("2026-09-01T05:00:00.000Z"),
        endsAt: new Date("2026-10-01T04:59:59.000Z"),
        schedule: true,
        en: {
          publicName: "Development Scheduled Promotion",
          tagline: "Local development only. Not a real promotion.",
        },
        es: {
          publicName: "Promocion de desarrollo programada",
          tagline: "Solo desarrollo local. No es una promocion real.",
        },
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
        {
          promotionId: promotion.id,
          locale: "en-US",
          publicName: spec.en.publicName,
          tagline: spec.en.tagline,
        },
        {
          promotionId: promotion.id,
          locale: "es-US",
          publicName: spec.es.publicName,
          tagline: spec.es.tagline,
        },
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
            amoe: {
              mode: null,
              note: "DEC-032: la modalidad AMOE no tiene valor DISABLED. Si hay via AMOE lo responde el flag amoe_enabled; null es la modalidad todavia sin elegir.",
            },
          },
          createdByAdminUserId: promotionManagerId,
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

      // Secuencia de numeros de entry (DEC-009). Se inicializa aunque no haya
      // ni una entry: el rango se asigna siempre -para que sea reconstruible
      // hacia atras- y el flag `visible_entry_numbers_enabled` solo decide si
      // se MUESTRA.
      await tx.insert(promotionEntryNumberSequences).values({
        promotionId: promotion.id,
        formatPrefix: "DEV26",
        formatDigits: 9,
      });

      if (spec.schedule) {
        await tx
          .update(promotions)
          .set({ status: "SCHEDULED" })
          .where(eq(promotions.id, promotion.id));
      }
    }

    warnings.push(
      "No se ha creado ninguna promocion ACTIVE: DEC-012 lo impide mientras las claves legales requeridas sigan en TBD (docs/LEGAL_PENDING.md).",
    );
    warnings.push(
      "No se ha creado ninguna entry. El ledger YA existe, pero toda transaccion se ancla a una PromotionRulesVersion, y aqui todas estan en DRAFT con las claves legales en TBD. Sembrar entries bajo una version de reglas en borrador crearia datos de desarrollo que el sistema no produciria jamas en produccion, y el portal se construiria contra una forma que no existe.",
    );
    warnings.push(
      "Los 12 feature flags los siembra la migracion 0005, no esta semilla: son catalogo, no datos de desarrollo. Todos arrancan apagados salvo dual_approval_for_sensitive_actions_enabled (DEC-032).",
    );
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
