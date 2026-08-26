/**
 * `@lsw/tpa` - el contrato con el administrador externo y el estado de la
 * entrega.
 *
 *   `snapshot.ts`       la fila: estados, manifiesto persistido, huellas.
 *   `reconciliation.ts` la ultima comprobacion antes de que el snapshot se
 *                       vuelva inmutable, con la linea de caducidad como
 *                       seccion obligatoria (DEC-033 / DEC-034).
 *   `adapter.ts`        el contrato del third-party administrator.
 *   `winner.ts`         sorteo interno y ganador potencial.
 *
 * Lo que este paquete NO hace:
 *   - producir los bytes del export ni calcular hashes: eso es `@lsw/audit`,
 *     que es donde vive la canonicalizacion. Duplicar aqui una segunda forma
 *     canonica seria crear dos definiciones de "el mismo snapshot";
 *   - entregar nada sin configuracion explicita: el administrador externo no
 *     esta elegido (`docs/LEGAL_PENDING.md`) y el adaptador por defecto se
 *     niega;
 *   - sortear: eso exige los cinco cerrojos de DEC-017, y sigue desactivado.
 */

export * from "./snapshot.js";
export * from "./reconciliation.js";
export * from "./adapter.js";
export * from "./winner.js";
