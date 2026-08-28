/**
 * Aserciones sobre errores que vienen de PostgreSQL a traves de drizzle.
 *
 * POR QUE EXISTE
 *   drizzle-orm (>= 0.44) envuelve todo fallo de consulta en `DrizzleQueryError`,
 *   cuyo `message` es `Failed query: <sql>` y cuyo `cause` es el error real de
 *   `pg` (con el texto del `RAISE EXCEPTION` del trigger, el `constraint`, el
 *   `detail`...). `expect(...).rejects.toThrow(/texto/)` solo mira `message`,
 *   asi que una prueba que afirmaba "el trigger dice X" dejo de ver X.
 *
 *   Este matcher recorre la cadena de `cause` y junta mensaje, `detail`,
 *   `constraint` y `code`, de modo que la prueba puede seguir afirmando lo que
 *   el motor dijo — y tambien puede afirmar por NOMBRE de restriccion, que es
 *   mas estable que la prosa (el texto de un `RAISE` no es contrato).
 *
 * USO
 *   await expect(app.execute(sql`...`)).rejects.toSatisfy(dbErrorMatching(/moneda/iu));
 *   await expect(app.execute(sql`...`)).rejects.toSatisfy(dbErrorMatching(/entry_transactions_delta_not_zero/u));
 */

interface PgLikeError {
  readonly message?: unknown;
  readonly cause?: unknown;
  readonly detail?: unknown;
  readonly constraint?: unknown;
  readonly code?: unknown;
}

/** Texto agregado de un error y de toda su cadena de `cause`. */
export function dbErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (typeof current === "object") {
      const e = current as PgLikeError;
      for (const field of [e.message, e.detail, e.constraint, e.code]) {
        if (typeof field === "string" && field.length > 0) parts.push(field);
      }
      current = e.cause;
      continue;
    }
    break;
  }
  return parts.join("\n");
}

/**
 * Predicado para `rejects.toSatisfy`: verdadero si el patron aparece en el
 * error o en cualquiera de sus causas. Sirve igual para errores de la
 * aplicacion sin `cause` (se evalua el propio error).
 */
export function dbErrorMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    const text = dbErrorText(error);
    const ok = pattern.test(text);
    if (!ok && process.env.LSW_DB_ERROR_DEBUG === "1") {
      // Diagnostico opcional: vitest no imprime `cause`, y sin esto un fallo de
      // patron no dice que dijo el motor.
      console.error(`[db-error] patron ${String(pattern)} no aparece en:\n${text}`);
    }
    return ok;
  };
}
