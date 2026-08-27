/**
 * Puerto de reloj.
 *
 * POR QUE EL DOMINIO NO LEE EL RELOJ
 *
 *   DEC-011 exige que todo instante sea explicito y evaluable contra la zona
 *   legal de la promocion. DEC-035 va mas lejos: `recorded_at` entra en el
 *   preimage de la hash chain, de modo que el instante que se hashea y el que
 *   se guarda tienen que ser EL MISMO valor. Con un `new Date()` esparcido por
 *   el codigo eso deja de ser demostrable: dos llamadas separadas por una
 *   linea devuelven instantes distintos.
 *
 *   Ademas, la regla de lint de DEC-017 prohibe literalmente `new Date()` sin
 *   argumentos y `Date.now()` en este paquete. No es un capricho de estilo: un
 *   timestamp no es entropia y un reloj implicito no es reproducible.
 *
 * POR QUE AQUI NO HAY `SystemClock`
 *
 *   Porque no puede haberlo: leer el reloj del sistema exige `Date.now()`, que
 *   esta prohibido en `packages/sweepstakes`. El adaptador que lee el reloj de
 *   verdad vive en la capa de aplicacion (`apps/api`), donde esa regla no
 *   aplica y donde la decision "que instante es ahora" es legitima.
 *
 *   El dominio recibe el reloj ya construido. Es exactamente la separacion que
 *   hace que un test pueda fijar el instante sin parchear globales.
 */

export interface Clock {
  /** Instante actual en UTC. Quien lo implementa decide de donde sale. */
  now(): Date;
}

/**
 * Reloj detenido. El instante no cambia entre llamadas, que es justo lo que se
 * quiere al comprobar que dos escrituras de la misma operacion comparten
 * `recorded_at`.
 */
export class FixedClock implements Clock {
  private readonly instant: Date;

  public constructor(instant: Date | string | number) {
    const resolved = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(resolved.getTime())) {
      throw new RangeError(`Instante invalido para FixedClock: ${String(instant)}`);
    }
    // Copia defensiva: `Date` es mutable y quien lo paso podria moverlo.
    this.instant = new Date(resolved.getTime());
  }

  public now(): Date {
    return new Date(this.instant.getTime());
  }
}

/**
 * Reloj que solo avanza cuando se le dice.
 *
 * Existe para los tests de ventanas temporales -caducidad, periodos de
 * multiplicador, limites AMOE por periodo-, donde hace falta cruzar una
 * frontera concreta sin esperar a que pase el tiempo real.
 */
export class ManualClock implements Clock {
  private epochMs: number;

  public constructor(instant: Date | string | number) {
    const resolved = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(resolved.getTime())) {
      throw new RangeError(`Instante invalido para ManualClock: ${String(instant)}`);
    }
    this.epochMs = resolved.getTime();
  }

  public now(): Date {
    return new Date(this.epochMs);
  }

  /** Avanza el reloj. Retroceder esta prohibido: ningun registro lo admitiria. */
  public advanceMs(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new RangeError("Un reloj de dominio solo avanza.");
    }
    this.epochMs += milliseconds;
  }

  public setTo(instant: Date | string | number): void {
    const resolved = instant instanceof Date ? instant : new Date(instant);
    const next = resolved.getTime();
    if (Number.isNaN(next)) {
      throw new RangeError(`Instante invalido: ${String(instant)}`);
    }
    if (next < this.epochMs) {
      throw new RangeError("Un reloj de dominio solo avanza.");
    }
    this.epochMs = next;
  }
}
