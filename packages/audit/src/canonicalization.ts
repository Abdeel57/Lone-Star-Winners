/**
 * Registro de versiones de canonicalizacion (DEC-008).
 *
 * ---------------------------------------------------------------------------
 * LO PRIMERO, PORQUE CAMBIA COMO SE LEE TODO LO DEMAS
 * ---------------------------------------------------------------------------
 *
 * EL HASH NO DEPENDE DEL ORDEN DE LAS COLUMNAS DE LA TABLA.
 *
 * La pregunta que bloqueaba este hito era si el orden de columnas de
 * `entry_transactions` ya era definitivo. La respuesta correcta no es "si": es
 * que la pregunta no debe importar, y aqui deja de importar.
 *
 * La forma canonica ordena las claves alfabeticamente (RFC 8785), asi que el
 * orden fisico del DDL es invisible al hash. Lo que si importa -y muchisimo-
 * es el CONJUNTO de campos incluidos. Ese conjunto se declara aqui, campo a
 * campo, en vez de deducirse de la tabla en tiempo de ejecucion.
 *
 * La diferencia entre declararlo y deducirlo es toda la diferencia:
 *
 *   - DEDUCIDO (`SELECT *`): el dia que `backend` anada una columna, todos los
 *     hashes futuros cambian de significado y ningun test falla. La cadena
 *     sigue verificando; simplemente pasa a proteger otra cosa. Un auditor no
 *     tiene forma de saber que campo cubria el hash de marzo.
 *
 *   - DECLARADO: el dia que `backend` anada una columna, el test de paridad de
 *     `tests/security` falla y obliga a decidir explicitamente si el campo
 *     entra en la version 1 -no puede: cambiaria hashes ya escritos- o si hace
 *     falta una version 2. Es un obstaculo a proposito.
 *
 * ---------------------------------------------------------------------------
 * QUE QUEDA FUERA DEL PAYLOAD, Y POR QUE NO ES UN AGUJERO
 * ---------------------------------------------------------------------------
 *
 * `sequence_no` es `GENERATED ALWAYS AS IDENTITY`: la base de datos lo asigna
 * DURANTE el INSERT, y el hash tiene que estar calculado ANTES, porque la
 * tabla es append-only (DEC-007) y no admite un UPDATE posterior para
 * rellenarlo. No es una decision de gusto: incluirlo es imposible.
 *
 * No queda desprotegido. El verificador recorre la cadena EN ORDEN de
 * `sequence_no` y exige que el `chain_prev_hash` de cada fila sea el
 * `chain_hash` de la anterior. Reordenar, insertar o borrar filas rompe ese
 * encadenamiento aunque los payloads sean intactos. `sequence_no` queda
 * protegido por la topologia de la cadena en vez de por su contenido, que para
 * este campo es la unica proteccion posible.
 *
 * `canonicalization_version`, `chain_prev_hash` y `chain_hash` tampoco entran
 * en el payload: son la cadena, no el hecho. La version se ata al hash por
 * otro camino -va en el prefijo del preimage, ver `chain.ts`-, y esa parte si
 * es imprescindible: sin ella, un atacante podria reetiquetar una fila como
 * "version 2" y presentar una canonicalizacion mas debil que produce el mismo
 * hash.
 *
 * ---------------------------------------------------------------------------
 * REQUISITO SOBRE EL CAMINO DE ESCRITURA (handoff a `backend`)
 * ---------------------------------------------------------------------------
 *
 * `recorded_at` SI entra en el payload, y tiene `DEFAULT now()` en la tabla.
 * Quien inserta DEBE pasarlo explicitamente en el INSERT y usar ese mismo
 * valor al calcular el hash. Si deja que actue el DEFAULT, el hash se calcula
 * sobre un instante y la fila guarda otro, y la cadena nace rota.
 */

import type { CanonicalObject } from "./canonical.js";

/** Version de canonicalizacion vigente para escrituras nuevas. */
export const CURRENT_CANONICALIZATION_VERSION = 1;

/**
 * Dominios de cadena. Cada uno tiene su propia cadena por promocion, y el
 * dominio entra en el preimage para que un registro de un dominio no pueda
 * presentarse como registro del otro.
 */
export const CHAIN_DOMAIN_ENTRY_LEDGER = "entry_transactions";
export const CHAIN_DOMAIN_AUDIT_EVENT = "audit_events";
/**
 * Registro de un sorteo interno (DEC-017). Tiene cadena PROPIA, y no comparte
 * la de `audit_events`, por la misma razon por la que el ledger no comparte la
 * suya: si dos clases de registro conviven en una cadena, una fila de una puede
 * presentarse como fila de la otra. Un `AuditEvent` lo escribe cualquier accion
 * administrativa; un `DrawingEvent` solo puede existir tras cinco cerrojos.
 * Mezclarlos abarataria el segundo hasta el precio del primero.
 */
export const CHAIN_DOMAIN_DRAWING_EVENT = "drawing_events";

export type ChainDomain =
  | typeof CHAIN_DOMAIN_ENTRY_LEDGER
  | typeof CHAIN_DOMAIN_AUDIT_EVENT
  | typeof CHAIN_DOMAIN_DRAWING_EVENT;

export const CHAIN_DOMAINS: readonly ChainDomain[] = Object.freeze([
  CHAIN_DOMAIN_ENTRY_LEDGER,
  CHAIN_DOMAIN_AUDIT_EVENT,
  CHAIN_DOMAIN_DRAWING_EVENT,
]);

/** Campos de `entry_transactions` cubiertos por el hash en la version 1. */
export const LEDGER_CANONICAL_FIELDS_V1: readonly string[] = Object.freeze([
  "actor_admin_user_id",
  "actor_participant_id",
  "actor_type",
  "calculation_snapshot_id",
  "effective_at",
  "engine_version",
  "expires_at",
  "id",
  "metadata",
  "participant_id",
  "promotion_id",
  "quantity_delta",
  "reason_detail",
  "reason_key",
  "recorded_at",
  "reverses_transaction_id",
  "rules_version_id",
  "source_ref",
  "source_type",
  "status",
  "type",
]);

export interface ExcludedField {
  readonly field: string;
  readonly reason: string;
}

/**
 * Columnas de `entry_transactions` deliberadamente FUERA del payload.
 *
 * Existe como lista, y no como comentario, porque el test de paridad exige que
 * incluidas + excluidas = columnas de la tabla. Una columna nueva no puede
 * caer en el olvido: o esta en una lista o esta en la otra, o el test falla.
 */
export const LEDGER_EXCLUDED_FIELDS_V1: readonly ExcludedField[] = Object.freeze([
  Object.freeze({
    field: "sequence_no",
    reason:
      "GENERATED ALWAYS AS IDENTITY: lo asigna la base de datos durante el INSERT, y el hash " +
      "se calcula antes. Queda protegido por el encadenamiento, que se verifica en ese orden.",
  }),
  Object.freeze({
    field: "canonicalization_version",
    reason: "Es la etiqueta del algoritmo. Se ata al hash desde el prefijo del preimage.",
  }),
  Object.freeze({
    field: "chain_prev_hash",
    reason: "Es la ENTRADA del encadenamiento, no parte del hecho registrado.",
  }),
  Object.freeze({
    field: "chain_hash",
    reason: "Es la SALIDA. Incluirlo seria pedirle al hash que se contenga a si mismo.",
  }),
]);

/** Campos de `AuditEvent` cubiertos por el hash en la version 1. */
export const AUDIT_EVENT_CANONICAL_FIELDS_V1: readonly string[] = Object.freeze([
  "action",
  "actor_id",
  "actor_roles",
  "actor_type",
  "after",
  "before",
  "id",
  "metadata",
  "occurred_at",
  "promotion_id",
  "reason_code",
  "reason_text",
  "recorded_at",
  "request_id",
  "source_ip",
  "target_entity_id",
  "target_entity_type",
  "user_agent",
]);

/**
 * Columnas de `audit_events` deliberadamente FUERA del payload.
 *
 * Existe por el mismo motivo que `LEDGER_EXCLUDED_FIELDS_V1`: el test de
 * paridad de `tests/security` exige que incluidas + excluidas = columnas de la
 * tabla, de modo que una columna nueva no pueda entrar sin que alguien decida
 * explicitamente si el hash debe cubrirla.
 */
export const AUDIT_EVENT_EXCLUDED_FIELDS_V1: readonly ExcludedField[] = Object.freeze([
  Object.freeze({
    field: "sequence_no",
    reason:
      "GENERATED ALWAYS AS IDENTITY: lo asigna la base de datos durante el INSERT, y el hash " +
      "se calcula antes. Queda protegido por el encadenamiento, que se verifica en ese orden.",
  }),
  Object.freeze({
    field: "chain_key",
    reason:
      "Es la CLAVE de la cadena, no un dato del hecho. Entra en el hash por el prefijo del " +
      "preimage (DEC-035), y una restriccion CHECK la ata a promotion_id: no puede divergir.",
  }),
  Object.freeze({
    field: "canonicalization_version",
    reason: "Es la etiqueta del algoritmo. Se ata al hash desde el prefijo del preimage.",
  }),
  Object.freeze({
    field: "chain_prev_hash",
    reason: "Es la ENTRADA del encadenamiento, no parte del hecho registrado.",
  }),
  Object.freeze({
    field: "chain_hash",
    reason: "Es la SALIDA. Incluirlo seria pedirle al hash que se contenga a si mismo.",
  }),
]);

/**
 * Campos de un `DrawingEvent` cubiertos por el hash en la version 1 (DEC-017).
 *
 * DOS AUSENCIAS DELIBERADAS, Y LAS DOS IMPORTAN:
 *
 *   - `server_seed` NO esta. En el esquema commit-reveal la semilla se publica
 *     DESPUES del sorteo, y el registro se escribe ANTES. Un campo que hubiera
 *     que rellenar despues exigiria un UPDATE sobre una tabla append-only, o
 *     bien un hash calculado sobre un `null` que luego deja de ser `null`: las
 *     dos cosas rompen la evidencia. La revelacion es un registro APARTE que
 *     referencia a este; lo que si viaja aqui es el `commitment`, escrito antes
 *     de conocer el resultado, que es exactamente lo que hay que atar.
 *
 *   - el resultado no incluye datos personales del seleccionado. Viaja una
 *     `selected_participant_reference` -identificador interno- porque este
 *     registro se conserva indefinidamente y se ensena a terceros.
 */
export const DRAWING_EVENT_CANONICAL_FIELDS_V1: readonly string[] = Object.freeze([
  "algorithm_version",
  "approved_by",
  "authorization_id",
  "commitment",
  "completed_at",
  "draw_request_id",
  "entropy_source",
  "id",
  "initiated_at",
  "initiated_by",
  "metadata",
  "promotion_id",
  "recorded_at",
  "selected_batch_id",
  "selected_first_ordinal",
  "selected_last_ordinal",
  "selected_ordinal",
  "selected_participant_reference",
  "selected_provenance",
  "snapshot_content_digest",
  "snapshot_id",
  "status",
  "total_eligible_entries",
]);

/**
 * Semantica de bordes del predicado de saldo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO VIVE EN LA VERSION DE CANONICALIZACION Y NO EN OTRO SITIO
 * ---------------------------------------------------------------------------
 *
 * DEC-034 lo dejo anotado y conviene no perder el hilo. La caducidad de una
 * entry (DEC-033) es un cambio de saldo SIN FILA: nadie escribe nada, pasa la
 * hora y el saldo baja. La hash chain de DEC-008 encadena filas, asi que un
 * tercero puede verificar la cadena entera, encontrarla intacta, y aun asi ver
 * un saldo que no cuadra con la suma de lo que acaba de verificar.
 *
 * La unica forma de que ese tercero pueda reproducir el numero es que el corte
 * Y LA REGLA con la que se evaluo viajen con el artefacto. La regla es esta, y
 * lleva version propia precisamente porque un cambio de `<=` a `<` en una sola
 * de las dos comparaciones altera saldos historicos sin tocar una sola fila.
 *
 * El intervalo es SEMIABIERTO `[effective_at, expires_at)`:
 *
 *   - `effective_at <= corte`  INCLUSIVO en el borde inferior. Una entry que
 *     entra en vigor exactamente en el instante del corte CUENTA.
 *   - `expires_at > corte`     EXCLUSIVO en el borde superior. Una entry que
 *     caduca exactamente en el instante del corte NO cuenta.
 *
 * Elegido asi para que dos cortes consecutivos no cuenten dos veces ni pierdan
 * la misma entry: lo que sale de la ventana `[t0, t1)` entra en `[t1, t2)`.
 * Con dos comparaciones inclusivas, una entry cuyo `expires_at` coincidiera
 * con el corte se contaria en ambos lados.
 *
 * `expires_at IS NULL` significa "no caduca", que es el estado de TODAS las
 * filas mientras `entry_expiration_enabled` siga apagado (DEC-032, DEC-033).
 */
export interface BalancePredicateSemantics {
  readonly version: number;
  readonly includedStatuses: readonly string[];
  /** Borde inferior: inclusivo. */
  readonly effectiveAtOperator: "<=";
  /** Borde superior: exclusivo. */
  readonly expiresAtOperator: ">";
  readonly nullExpiryMeans: "NEVER_EXPIRES";
  readonly intervalNotation: string;
  /**
   * Predicado tal y como esta escrito en `lsw_entry_balances_at`
   * (`packages/database/drizzle/0006_entry_ledger.sql`). No es documentacion:
   * `tests/security` lo compara con el SQL real, normalizando espacios. Si
   * `backend` cambia el predicado sin cambiar la version, el test falla.
   */
  readonly sql: string;
}

export const BALANCE_PREDICATE_V1: BalancePredicateSemantics = Object.freeze({
  version: 1,
  includedStatuses: Object.freeze(["POSTED"]),
  effectiveAtOperator: "<=",
  expiresAtOperator: ">",
  nullExpiryMeans: "NEVER_EXPIRES",
  intervalNotation: "[effective_at, expires_at)",
  sql:
    "t.status = 'POSTED' " +
    "AND t.effective_at <= p_cutoff " +
    "AND (t.expires_at IS NULL OR t.expires_at > p_cutoff)",
});

/** Descriptor completo de una version de canonicalizacion. */
export interface CanonicalizationVersionDescriptor {
  readonly version: number;
  /** Especificacion de la forma canonica; ver la cabecera de `canonical.ts`. */
  readonly serialization: "RFC8785+NFC+SAFE_INTEGERS";
  readonly hashAlgorithm: "SHA-256";
  readonly ledgerFields: readonly string[];
  readonly ledgerExcludedFields: readonly ExcludedField[];
  readonly auditEventFields: readonly string[];
  readonly auditEventExcludedFields: readonly ExcludedField[];
  readonly drawingEventFields: readonly string[];
  readonly balancePredicate: BalancePredicateSemantics;
}

export const CANONICALIZATION_V1: CanonicalizationVersionDescriptor = Object.freeze({
  version: 1,
  serialization: "RFC8785+NFC+SAFE_INTEGERS",
  hashAlgorithm: "SHA-256",
  ledgerFields: LEDGER_CANONICAL_FIELDS_V1,
  ledgerExcludedFields: LEDGER_EXCLUDED_FIELDS_V1,
  auditEventFields: AUDIT_EVENT_CANONICAL_FIELDS_V1,
  auditEventExcludedFields: AUDIT_EVENT_EXCLUDED_FIELDS_V1,
  drawingEventFields: DRAWING_EVENT_CANONICAL_FIELDS_V1,
  balancePredicate: BALANCE_PREDICATE_V1,
});

/**
 * Campos que la version cubre en un dominio.
 *
 * Vive aqui, y no en `chain.ts`, porque es una propiedad de la VERSION: el dia
 * que exista una v2 con otro conjunto de campos, la respuesta cambia con la
 * version y no con el codigo que la consulta.
 *
 * Falla en cerrado ante un dominio desconocido. La alternativa -un `else` que
 * devolviera los campos del `AuditEvent`- haria que un dominio nuevo se
 * hasheara con el conjunto equivocado sin que nada lo dijera.
 */
export function canonicalFieldsFor(
  domain: ChainDomain,
  descriptor: CanonicalizationVersionDescriptor,
): readonly string[] {
  switch (domain) {
    case CHAIN_DOMAIN_ENTRY_LEDGER:
      return descriptor.ledgerFields;
    case CHAIN_DOMAIN_AUDIT_EVENT:
      return descriptor.auditEventFields;
    case CHAIN_DOMAIN_DRAWING_EVENT:
      return descriptor.drawingEventFields;
  }
}

const DESCRIPTORS = new Map<number, CanonicalizationVersionDescriptor>([[1, CANONICALIZATION_V1]]);

export const SUPPORTED_CANONICALIZATION_VERSIONS: readonly number[] = Object.freeze([
  ...DESCRIPTORS.keys(),
]);

export function isSupportedCanonicalizationVersion(version: number): boolean {
  return DESCRIPTORS.has(version);
}

/**
 * Descriptor de una version.
 *
 * Falla en cerrado: verificar una fila con una version desconocida NO es lo
 * mismo que verificarla bien. Un verificador que se saltara las versiones que
 * no entiende diria "cadena integra" sobre filas que no ha mirado.
 */
export function canonicalizationDescriptor(version: number): CanonicalizationVersionDescriptor {
  const descriptor = DESCRIPTORS.get(version);
  if (descriptor === undefined) {
    throw new Error(
      `canonicalization_version ${String(version)} desconocida. Versiones soportadas: ` +
        `${SUPPORTED_CANONICALIZATION_VERSIONS.join(", ")}. Una fila con version desconocida no ` +
        "puede darse por verificada.",
    );
  }
  return descriptor;
}

/**
 * Proyecta una fila sobre el conjunto de campos declarado por la version.
 *
 * Exige que TODOS los campos esten presentes. Un campo ausente no se convierte
 * en `null` por cortesia: si el que escribe olvida `reason_key`, el hash debe
 * fallar, no cubrir un registro incompleto como si estuviera completo.
 */
export function projectCanonicalPayload(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): CanonicalObject {
  // Se vuelca a `Map` antes de proyectar: el acceso indexado con una clave
  // calculada sobre un objeto llano es exactamente el patron que persigue
  // `security/detect-object-injection`, y aqui la fila viene de la base de
  // datos. Un `Map` no tiene prototipo que contaminar.
  const source = new Map<string, unknown>(Object.entries(row));
  const projected = new Map<string, unknown>();
  const missing: string[] = [];

  for (const field of fields) {
    if (!source.has(field)) {
      missing.push(field);
      continue;
    }
    projected.set(field, source.get(field));
  }

  if (missing.length > 0) {
    throw new Error(
      `Faltan campos obligatorios del payload canonico: ${missing.join(", ")}. ` +
        "Un campo ausente no se rellena con null: el hash debe cubrir el registro entero.",
    );
  }

  return Object.fromEntries(projected) as CanonicalObject;
}
