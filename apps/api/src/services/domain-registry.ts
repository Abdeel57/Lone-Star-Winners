/**
 * Un solo juego de servicios de dominio por juego de dependencias.
 *
 * POR QUE UNA CACHE Y NO UN CAMPO EN `AppDependencies`
 *
 *   Lo natural seria anadir `domain` a `AppDependencies` y construirlo en
 *   `createDependencies`. Con el repositorio quieto es lo que habria que hacer.
 *   Hoy `app.ts` lo esta editando otra sesion, y el acuerdo es que cada modulo
 *   aporte su `buildXxxRoutes` y UNA linea; ampliar la interfaz compartida
 *   ademas de eso es exactamente el conflicto que el acuerdo evita.
 *
 *   Asi que los seis modulos de rutas piden sus servicios aqui y reciben
 *   siempre los mismos. Que sean los mismos importa: cada juego trae su reloj y
 *   su generador de identificadores, y seis juegos distintos harian que dos
 *   escrituras de la misma operacion pudieran usar instantes distintos.
 *
 *   Es un `WeakMap` para que no retenga las dependencias cuando la aplicacion
 *   se descarta, que es lo que pasa entre tests: con un `Map` cada `createApp`
 *   de la suite dejaria un pool de conexiones vivo.
 *
 *   Cuando `app.ts` deje de estar en disputa, esto se pliega en
 *   `createDependencies` y el fichero desaparece. Queda anotado.
 */

import { DrizzleAuditEventRepository, DrizzleUnitOfWork, type Database } from "@lsw/database";

import type { AppDependencies } from "../app.js";
import { createLogger } from "../observability/logger.js";
import { createAuditSink } from "./audit-sink.js";
import { createDomainServices, type DomainServices } from "./domain-services.js";

const cache = new WeakMap<AppDependencies, DomainServices>();

/**
 * Conexion AUSENTE, que falla en el sitio.
 *
 * Pasar `undefined` disfrazado de `Database` produciria un
 * `Cannot read properties of undefined` a cien lineas de distancia del error
 * real. Este proxy dice exactamente que paso y donde, y -mas importante- hace
 * imposible que una lectura sin conexion devuelva una lista vacia que alguien
 * interprete como "no hay datos".
 */
const MISSING_DATABASE = new Proxy({} as Database, {
  get(_target, property): never {
    throw new Error(
      `No hay conexion a base de datos en estas dependencias, y algo intento usarla ` +
        `(propiedad "${String(property)}"). Solo la generacion del contrato ` +
        `(scripts/emit-contract.ts) construye rutas sin conexion, y ahi no corre ningun handler.`,
    );
  },
});

export function domainServicesFor(dependencies: AppDependencies): DomainServices {
  const existing = cache.get(dependencies);
  if (existing !== undefined) {
    return existing;
  }

  /**
   * La conexion puede NO existir, y es un caso legitimo.
   *
   * `scripts/emit-contract.ts` construye las definiciones de ruta con
   * `database: undefined` a proposito: las definiciones son datos puros, y su
   * cabecera lo dice -"un generador de contrato que exigiera una base de datos
   * viva no se podria ejecutar en CI"-.
   *
   * Los adaptadores solo GUARDAN la conexion en su constructor; no la tocan
   * hasta que corre un handler, y durante la generacion del contrato no corre
   * ninguno. Si algun dia se tocara, fallaria aqui de forma ruidosa en vez de
   * devolver datos vacios, que es la unica forma aceptable de fallar.
   */
  const handle = dependencies.database as { db: Database } | undefined;
  const db = handle === undefined ? MISSING_DATABASE : handle.db;

  const services = createDomainServices(db, {
    /**
     * HO-028: los hechos auditables se PERSISTEN, encadenados, en la misma
     * transaccion que el efecto que auditan.
     *
     * EL UNICO PUNTO DE MONTAJE QUE FALTA, Y ESTA A UNA LINEA
     *
     *   `chainPort` construye el hash de DEC-008 y vive en `@lsw/audit`, que
     *   `apps/api` todavia no declara como dependencia (HO-028, punto 2: es del
     *   Team Lead, porque exige `pnpm install`). Mientras no se pase, el
     *   repositorio no esta configurado y `createAuditSink` devuelve un
     *   sumidero que SE NIEGA: las rutas auditadas fallan en vez de confirmar
     *   efectos sin registro.
     *
     *   El dia que la dependencia exista, esto es:
     *
     *     import { createAuditEventChainPort, redactDiff } from "@lsw/audit";
     *     ...
     *     new DrizzleAuditEventRepository(db, { chainPort: createAuditEventChainPort() })
     *     ...
     *     redactor: { redact: redactDiff }
     *
     *   y nada mas. Los dos puertos son estructuralmente compatibles: si algun
     *   dia divergen, el compilador lo dira aqui.
     */
    audit: createAuditSink({
      repository: new DrizzleAuditEventRepository(db),
      unitOfWork: new DrizzleUnitOfWork(db),
      logger: createLogger(dependencies.config),
    }),
  });

  cache.set(dependencies, services);
  return services;
}
