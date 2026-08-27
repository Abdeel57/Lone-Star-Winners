/**
 * `@lsw/tpa` - el contrato con el administrador externo, la entrega, y el
 * sorteo interno con sus cerrojos.
 *
 *   `snapshot.ts`               la fila: estados, manifiesto persistido, huellas.
 *   `reconciliation.ts`         la forma del informe previo a finalizar, con la
 *                               linea de caducidad como seccion obligatoria
 *                               (DEC-033 / DEC-034).
 *   `reconciliation-checks.ts`  las comprobaciones, como funcion pura.
 *   `adapter.ts`                el contrato del third-party administrator y el
 *                               esquema de export con minimizacion de PII.
 *   `manual-download-adapter.ts` el primer adaptador completo, en dry-run.
 *   `export-package.ts`         el paquete entregable y que parte de el es
 *                               reproducible byte a byte (DEC-016, DEC-035/036).
 *   `zip.ts`                    el contenedor determinista.
 *   `ports.ts`                  todo lo que el dominio pide prestado.
 *   `random.ts`                 seleccion uniforme con rechazo de muestreo.
 *   `commit-reveal.ts`          esquema opcional, apagado, pendiente de cliente.
 *   `winner.ts`                 entidades del sorteo.
 *   `potential-winner.ts`       el expediente y su maquina de estados.
 *   `draw.ts`                   la unica puerta por la que se puede sortear.
 *
 * Lo que este paquete NO hace:
 *   - producir los bytes canonicos ni calcular hashes de la cadena: eso es
 *     `@lsw/audit`, que es donde vive la canonicalizacion. Duplicar aqui una
 *     segunda forma canonica seria crear dos definiciones de "el mismo
 *     snapshot". Lo que hay aqui son PUERTOS que aquel implementa;
 *   - entregar nada sin configuracion explicita: el administrador externo no
 *     esta elegido (`docs/LEGAL_PENDING.md`), el adaptador por defecto se niega
 *     y el completo arranca en dry-run;
 *   - sortear por su cuenta: `initiateDraw` exige los cinco cerrojos de DEC-017
 *     a la vez, y el primero -el flag- sigue apagado.
 */

export * from "./snapshot.js";
export * from "./reconciliation.js";
export * from "./reconciliation-checks.js";
export * from "./adapter.js";
export * from "./manual-download-adapter.js";
export * from "./export-package.js";
export * from "./zip.js";
export * from "./ports.js";
export * from "./random.js";
export * from "./commit-reveal.js";
export * from "./winner.js";
export * from "./potential-winner.js";
export * from "./draw.js";
