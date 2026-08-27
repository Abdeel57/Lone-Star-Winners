/**
 * Montaje de los puertos del sorteo interno (DEC-017).
 *
 * ---------------------------------------------------------------------------
 * ESTE FICHERO NO DECIDE NADA. LOS CINCO CERROJOS SIGUEN EN `@lsw/tpa`
 * ---------------------------------------------------------------------------
 *
 * `initiateDraw` es la UNICA puerta por la que se puede sortear, y se niega por
 * defecto. Aqui solo se le dice con que reloj, con que flags, con que
 * autorizador y con que fuente de bytes tiene que trabajar.
 *
 * Cuatro elecciones que merecen quedar escritas:
 *
 *   FLAGS. `internal_draw_enabled` se lee del REPOSITORIO (`ConfigRepository`),
 *   nunca del entorno. DEC-013: un flag legalmente material tiene que dejar
 *   rastro de quien lo cambio y por que, y un fichero de entorno no deja
 *   ninguno. Si la consulta falla se devuelve `null` -"no evaluado"-, que el
 *   dominio trata como negativa CON MOTIVO PROPIO. Un `catch` que devolviera
 *   `false` seria correcto por accidente.
 *
 *   ACCESO. El puerto delega en `authorize()` de `@lsw/security`, que es la
 *   unica fuente del catalogo (DEC-027). El dominio no reimplementa RBAC: le
 *   entrega el hecho que el catalogo no puede conocer -si hay segunda
 *   aprobacion viva de otra persona- y acata la decision.
 *
 *   ALEATORIEDAD. El puerto entrega BYTES del CSPRNG del sistema
 *   (`node:crypto`). El rechazo de muestreo NO esta aqui: vive en
 *   `selectOrdinal` de `@lsw/tpa/random`, en un solo sitio y probado. Escribir
 *   aqui una reduccion propia -un `%` sobre el rango- introduciria el sesgo
 *   exactamente donde nadie lo miraria.
 *
 *   RELOJ. `Clock` de `@lsw/tpa` devuelve ISO-8601 UTC; el del dominio de
 *   entries devuelve `Date`. Se adapta el MISMO reloj, no se construye uno
 *   nuevo: dos relojes en la misma operacion darian dos instantes distintos
 *   para el mismo hecho.
 */

import { randomBytes } from "node:crypto";

import {
  authorize,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type CapabilityId,
  type RoleId,
} from "@lsw/security";
import {
  DEFAULT_DRAW_SERVICE_CONFIG,
  type AccessControlPort,
  type AccessControlRequest,
  type AuditRecorder,
  type AuthorizationRepository,
  type Clock as TpaClock,
  type Csprng,
  type DrawServiceConfig,
  type DrawServiceDependencies,
  type DrawingEventRepository,
  type FeatureFlagPort,
  type RecordChainPort,
  type SnapshotRepository,
} from "@lsw/tpa";
import type { Clock } from "@lsw/sweepstakes";

import type { ConfigRepository } from "./ports.js";

/**
 * `Clock` de `@lsw/tpa` sobre el reloj del dominio.
 *
 * `toISOString()` produce siempre UTC con milisegundos, que es exactamente lo
 * que el puerto declara y lo que entra en el preimage de la cadena (DEC-035).
 */
export function tpaClockFrom(clock: Clock): TpaClock {
  return { now: (): string => clock.now().toISOString() };
}

/**
 * Fuente de bytes del sistema.
 *
 * `randomBytes` de `node:crypto` es el CSPRNG del sistema operativo. Devuelve
 * un `Buffer`, que ES un `Uint8Array`, pero se copia a uno plano: un `Buffer`
 * arrastra el pool interno de Node y su `.buffer` puede contener bytes de otras
 * llamadas. El dominio comprueba la longitud en cada peticion y se niega a
 * sortear si no cuadra.
 */
export function createSystemCsprng(): Csprng {
  return {
    randomBytes: (length: number): Uint8Array => Uint8Array.from(randomBytes(length)),
  };
}

/**
 * Flags PERSISTIDOS. `null` = no evaluado, jamas `false` por defecto.
 *
 * La lectura no se envuelve en un `catch`: si el repositorio falla, la promesa
 * se rechaza y la ruta responde error. Devolver `null` ante un fallo confundiria
 * "la base de datos no contesta" con "el flag no se pudo evaluar", y el segundo
 * caso tiene su propio codigo de negativa en el dominio.
 */
export function createFeatureFlagPort(config: ConfigRepository): FeatureFlagPort {
  return {
    isEnabled: async (key: string): Promise<boolean | null> => {
      const record = await config.read();
      const flags: Readonly<Record<string, boolean | undefined>> = record.featureFlags;
      const value = flags[key];
      /**
       * Ausente del catalogo sembrado = NO EVALUADO. Ver DEC-032: un flag que no
       * existe en la tabla no es un flag apagado, es una pregunta sin respuesta,
       * y el dominio tiene un codigo de negativa distinto para cada caso.
       *
       * HO-027: aqui `??` SI es equivalente al ternario, y se comprueba en vez
       * de aplicarse a ciegas. `value` es `boolean | undefined` -nunca `null`- y
       * `??` solo se dispara con `null` o `undefined`, asi que un `false` sigue
       * saliendo como `false` y no se convierte en "no evaluado".
       */
      return value ?? null;
    },
  };
}

/**
 * Control de acceso REAL. No hay doble ni atajo.
 *
 * `stepUpMaxAgeSeconds` llega desde la configuracion de la API y `authorize` lo
 * recorta a `STEP_UP_MAX_AGE_SECONDS_LIMIT`; se pasa el minimo ya calculado para
 * que el valor efectivo sea el mismo que aplica el autorizador de rutas.
 */
export function createAccessControlPort(stepUpMaxAgeSeconds: number): AccessControlPort {
  return {
    decide: (request: AccessControlRequest) => {
      const decision = authorize({
        roles: request.actorRoles as readonly RoleId[],
        capability: request.capability as CapabilityId,
        secondsSinceLastMfa: request.secondsSinceLastMfa,
        stepUpMaxAgeSeconds: Math.min(stepUpMaxAgeSeconds, STEP_UP_MAX_AGE_SECONDS_LIMIT),
        reasonProvided: request.reasonProvided,
        secondApprovalGranted: request.secondApprovalGranted,
        featureFlagEnabled: request.featureFlagEnabled,
      });

      return Promise.resolve(
        decision.allowed
          ? { allowed: true }
          : { allowed: false, reason: decision.reason, detail: decision.detail },
      );
    },
  };
}

export interface DrawDependenciesInput {
  readonly clock: Clock;
  readonly config: ConfigRepository;
  readonly authorizations: AuthorizationRepository;
  readonly snapshots: SnapshotRepository;
  readonly drawings: DrawingEventRepository;
  readonly chain: RecordChainPort;
  readonly audit: AuditRecorder;
  readonly stepUpMaxAgeSeconds: number;
  /** Solo para tests: una fuente determinista permite comprobar el rechazo de muestreo. */
  readonly csprng?: Csprng;
  readonly configOverrides?: Partial<DrawServiceConfig>;
}

export function createDrawDependencies(input: DrawDependenciesInput): DrawServiceDependencies {
  return {
    clock: tpaClockFrom(input.clock),
    flags: createFeatureFlagPort(input.config),
    access: createAccessControlPort(input.stepUpMaxAgeSeconds),
    authorizations: input.authorizations,
    snapshots: input.snapshots,
    drawings: input.drawings,
    chain: input.chain,
    audit: input.audit,
    csprng: input.csprng ?? createSystemCsprng(),
    // `commitRevealMode` sigue en `DISABLED`: DEC-017 lo recoge como nota NO
    // VINCULANTE, pendiente del cliente y de su abogado.
    config: { ...DEFAULT_DRAW_SERVICE_CONFIG, ...input.configOverrides },
  };
}
