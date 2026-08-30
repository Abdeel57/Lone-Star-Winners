/**
 * Semilla de DESARROLLO.
 *
 * Las personas y las promociones son ostensiblemente ficticias: los correos
 * usan el TLD reservado `.invalid` (RFC 2606), que no existe y no puede
 * existir, y los nombres lo dicen en voz alta. Nada de eso puede confundirse
 * con datos de produccion.
 *
 * El CATALOGO es la excepcion, y es deliberada: los articulos son los que el
 * cliente entrego (DEC-052, DEC-053), porque un catalogo inventado no sirve
 * para desarrollar la tienda -ni las categorias, ni los colores de la gorra,
 * ni los cuatro paquetes existen en un catalogo de camisetas de muestra-. Lo
 * ficticio ahi son los PRECIOS de la mercancia, y cada descripcion lo dice en
 * los dos idiomas para que se lea tambien fuera del repositorio.
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
  productVariantTranslations,
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

// ---------------------------------------------------------------------------
// Catalogo del cliente (DEC-052, DEC-053)
//
// NINGUN PRODUCTO DICE CUANTAS PARTICIPACIONES DA, ni en columna ni en texto
// libre. Tampoco el nombre del paquete: "$10 entry package" es el IMPORTE, no
// la cantidad. Quien decide cuanto vale cada tipo es
// `purchase_entry_formula.rates` de la version de reglas, y hoy esta en `TBD`
// (docs/LEGAL_PENDING.md). Escribir la cifra aqui seria la columna
// `entries_per_unit` que la migracion `0026` se nego a crear, solo que sin
// declararla.
//
// El copy describe MERCANCIA o un PAQUETE DE PARTICIPACIONES. Ni "boletos" ni
// "oportunidades de ganar", en ninguno de los dos idiomas (CLAUDE.md seccion 1
// y la nota de proceso de docs/LEGAL_PENDING.md).
//
// El texto que ve el participante lleva acentos -es CONTENIDO, no un comentario
// de este archivo-: los dos idiomas son de primera clase (principio 4) y
// "telefono" sin tilde no es espanol correcto.
// ---------------------------------------------------------------------------

/**
 * Variante de catalogo.
 *
 * `name: null` es una variante SIN nombre, que es el caso normal de un producto
 * de un solo modelo: no siembra `product_variant_translations` y la interfaz no
 * pinta selector. Solo las gorras llevan nombre, porque son lo unico que el
 * cliente entrego con colores.
 *
 * `stockQuantity: null` es "existencias no gestionadas", que no es cero.
 */
interface CatalogVariantSpec {
  readonly skuSuffix: string;
  readonly stockQuantity: number | null;
  readonly name: { readonly en: string; readonly es: string } | null;
}

interface CatalogProductSpec {
  readonly sku: string;
  readonly slug: string;
  /** DEC-052: etiqueta de catalogo. No decide nada legal. */
  readonly kind: "MERCHANDISE" | "ENTRY_PACKAGE";
  /** Clave de `product_categories`, sembrada por la migracion `0026`. */
  readonly categoryKey: string;
  readonly priceMinor: bigint;
  readonly en: { readonly name: string; readonly description: string };
  readonly es: { readonly name: string; readonly description: string };
  readonly variants: readonly CatalogVariantSpec[];
}

/**
 * Marca de honestidad del precio, DENTRO de la descripcion y en los dos
 * idiomas.
 *
 * En la descripcion y no en un comentario porque el comentario no viaja: el
 * precio se ve en la tienda, en el carrito y en el panel, y quien lo mire ahi
 * tiene que poder saber que es de desarrollo sin abrir el repositorio.
 *
 * Es la misma frase para los siete articulos a proposito. La semilla no INVENTA
 * copy comercial -"funda de silicona con argolla de acero" seria poner palabras
 * en boca del cliente-; describe lo unico que sabe con certeza sobre estas
 * filas, que es que el precio no esta acordado.
 */
const MERCHANDISE_DESCRIPTION_EN =
  "Client catalog item. The amount shown is a fictitious development price: no price has been agreed for this item.";

const MERCHANDISE_DESCRIPTION_ES =
  "Artículo del catálogo del cliente. El importe mostrado es un precio de desarrollo ficticio: para este artículo no hay ningún precio acordado.";

/** Variante unica y sin nombre: un solo modelo, sin selector que pintar. */
function singleVariant(stockQuantity: number | null): readonly CatalogVariantSpec[] {
  return [{ skuSuffix: "-1", stockQuantity, name: null }];
}

/**
 * Los cinco colores de la gorra premium.
 *
 * Es el unico producto con variantes con nombre, y por eso el unico que siembra
 * `product_variant_translations`. Un color a `0`: agotado es un estado normal
 * de tienda, y `0` -sin existencias- no es `null` -sin inventario que llevar-.
 */
const CAP_COLOR_VARIANTS: readonly CatalogVariantSpec[] = [
  { skuSuffix: "-BLACK", stockQuantity: 40, name: { en: "Black", es: "Negro" } },
  { skuSuffix: "-WHITE", stockQuantity: 35, name: { en: "White", es: "Blanco" } },
  { skuSuffix: "-RED", stockQuantity: 28, name: { en: "Red", es: "Rojo" } },
  { skuSuffix: "-NAVY", stockQuantity: 22, name: { en: "Navy", es: "Azul marino" } },
  { skuSuffix: "-KHAKI", stockQuantity: 0, name: { en: "Khaki", es: "Caqui" } },
];

/**
 * Paquete de participaciones.
 *
 * Aqui el importe SI lo fijo el cliente ($10, $20, $50 y $100), asi que la
 * descripcion no puede llamarlo ficticio: seria una falsedad al reves. Dice lo
 * cierto -es el importe del cliente, cargado como precio de desarrollo- y sigue
 * sin comprometer a nadie.
 *
 * Lo que no dice, en ningun idioma, es cuantas participaciones incluye.
 */
function entryPackageSpec(dollars: string, priceMinor: bigint): CatalogProductSpec {
  return {
    sku: `PKG-${dollars}`,
    slug: `entry-package-${dollars}`,
    kind: "ENTRY_PACKAGE",
    categoryKey: "entry-packages",
    priceMinor,
    en: {
      name: `$${dollars} entry package`,
      description: `Entry package from the client's catalog. The $${dollars} amount is the one the client set, loaded here as a development price. How many entries it includes is decided by the promotion's rules version, not by this product.`,
    },
    es: {
      name: `Paquete de participaciones de $${dollars}`,
      description: `Paquete de participaciones del catálogo del cliente. El importe de $${dollars} es el que fijó el cliente y aquí se carga como precio de desarrollo. Cuántas participaciones incluye lo decide la versión de reglas de la promoción, no este producto.`,
    },
    // Sin existencias gestionadas: un paquete no tiene almacen que agotar. Lo
    // que lo limita es el tope por participante de la version de reglas, que no
    // es inventario y no se descuenta aqui.
    variants: singleVariant(null),
  };
}

/**
 * Los once productos: siete de mercancia y los cuatro paquetes.
 *
 * Los `slug` y los `sku` son los mismos que usan los fixtures del escaparate
 * (`apps/web/src/mocks/fixtures/catalog.ts`), y los importes de la mercancia
 * tambien: asi la misma URL de ficha lleva al mismo articulo contra el mock y
 * contra una base sembrada, y una discrepancia entre las dos vistas es un fallo
 * de verdad y no una diferencia de fixtures.
 */
const CATALOG_SPECS: readonly CatalogProductSpec[] = [
  {
    sku: "ATH-1",
    slug: "airtag-keychain-holder",
    kind: "MERCHANDISE",
    categoryKey: "airtag-holders",
    priceMinor: 1600n,
    en: { name: "AirTag holder keychain", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Llavero holder para AirTag", description: MERCHANDISE_DESCRIPTION_ES },
    variants: singleVariant(100),
  },
  {
    sku: "PSK-1",
    slug: "phone-stand-keychain",
    kind: "MERCHANDISE",
    categoryKey: "phone-holders",
    priceMinor: 2200n,
    en: { name: "Phone holder keychain", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Llavero con soporte para teléfono", description: MERCHANDISE_DESCRIPTION_ES },
    variants: singleVariant(100),
  },
  {
    sku: "PWB-1",
    slug: "portable-power-bank",
    kind: "MERCHANDISE",
    categoryKey: "power-banks",
    priceMinor: 4800n,
    en: { name: "Portable power bank", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Power bank portátil", description: MERCHANDISE_DESCRIPTION_ES },
    variants: singleVariant(60),
  },
  {
    sku: "NBK-1",
    slug: "notebook-and-pen",
    kind: "MERCHANDISE",
    categoryKey: "notebooks",
    priceMinor: 2600n,
    en: { name: "Notebook with pen", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Libreta con pluma", description: MERCHANDISE_DESCRIPTION_ES },
    variants: singleVariant(100),
  },
  {
    sku: "NKL-1",
    slug: "hands-free-neck-light",
    kind: "MERCHANDISE",
    categoryKey: "neck-lights",
    priceMinor: 2900n,
    en: { name: "Hands-free LED neck light", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Luz LED de cuello manos libres", description: MERCHANDISE_DESCRIPTION_ES },
    variants: singleVariant(80),
  },
  {
    sku: "TMB-1",
    slug: "insulated-tumbler",
    kind: "MERCHANDISE",
    categoryKey: "tumblers",
    priceMinor: 3200n,
    en: { name: "Insulated tumbler", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Termo aislante", description: MERCHANDISE_DESCRIPTION_ES },
    variants: singleVariant(75),
  },
  {
    sku: "CAP-TX",
    slug: "premium-cap",
    kind: "MERCHANDISE",
    categoryKey: "caps",
    priceMinor: 3500n,
    en: { name: "Premium cap", description: MERCHANDISE_DESCRIPTION_EN },
    es: { name: "Gorra premium", description: MERCHANDISE_DESCRIPTION_ES },
    variants: CAP_COLOR_VARIANTS,
  },
  entryPackageSpec("10", 1000n),
  entryPackageSpec("20", 2000n),
  entryPackageSpec("50", 5000n),
  entryPackageSpec("100", 10000n),
];

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
    // Las CATEGORIAS no se tocan aqui: las siembra la migracion `0026` porque
    // son catalogo del negocio y no datos de desarrollo (mismo criterio que los
    // feature flags de `0005`). Esta semilla solo referencia sus claves, y si
    // alguna faltara la clave ajena lo diria en voz alta en vez de crear una
    // segunda fuente de verdad.
    // -----------------------------------------------------------------------
    for (const spec of CATALOG_SPECS) {
      const [product] = await tx
        .insert(products)
        .values({
          sku: spec.sku,
          slug: spec.slug,
          status: "ACTIVE",
          kind: spec.kind,
          categoryKey: spec.categoryKey,
          // Las imagenes las entrega el USUARIO y todavia no existen: no hay
          // almacen de medios (CLAUDE.md seccion 7). DEC-053 fija la FORMA del
          // enlace -`https://...` o ruta raiz `/...`, comprobada por el CHECK
          // de `0026`-, no el contenido, asi que sembrar `/products/x.jpg`
          // seria sembrar enlaces rotos con aspecto de dato bueno.
          imageUrl: null,
          currency: "USD",
        })
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

      // La posicion sale del orden de la lista: es el orden en que el cliente
      // enumero los colores, y un `position` a cero para todas seria un empate
      // que resolveria la base de datos como quisiera.
      for (const [position, variantSpec] of spec.variants.entries()) {
        const [variant] = await tx
          .insert(productVariants)
          .values({
            productId: product.id,
            sku: `${spec.sku}${variantSpec.skuSuffix}`,
            status: "ACTIVE",
            priceAmountMinor: spec.priceMinor,
            currency: "USD",
            stockQuantity: variantSpec.stockQuantity,
            imageUrl: null,
            position,
          })
          .returning({ id: productVariants.id });

        if (variant === undefined) {
          throw new Error(`No se pudo crear la variante ${spec.sku}${variantSpec.skuSuffix}.`);
        }

        if (variantSpec.name !== null) {
          await tx.insert(productVariantTranslations).values([
            { variantId: variant.id, locale: "en-US", name: variantSpec.name.en },
            { variantId: variant.id, locale: "es-US", name: variantSpec.name.es },
          ]);
        }
      }
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
    warnings.push(
      "Los precios de los 7 articulos de mercancia son de DESARROLLO: el cliente no ha fijado ninguno, y cada descripcion lo dice en los dos idiomas. Los 4 paquetes llevan el importe que el cliente si fijo ($10, $20, $50 y $100).",
    );
    warnings.push(
      "Ningun producto declara cuantas participaciones da, ni siquiera los paquetes: esa cifra sale de purchase_entry_formula de la version de reglas (DEC-052), y hoy esta en TBD.",
    );
    warnings.push(
      "Ningun producto ni variante tiene imagen: no hay almacen de medios (CLAUDE.md seccion 7) y los ficheros los entrega el usuario. DEC-053 fija la forma del enlace (https:// o ruta raiz /...), no su contenido.",
    );

    return {
      identities: 2 + adminSpecs.length,
      participants: 2,
      adminUsers: adminSpecs.length,
      promotions: promotionSpecs.length,
      products: CATALOG_SPECS.length,
      warnings,
    };
  });
}
