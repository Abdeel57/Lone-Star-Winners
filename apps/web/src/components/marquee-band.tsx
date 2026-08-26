import { getTranslations } from "next-intl/server";

/**
 * Cinta de texto en movimiento.
 *
 * QUE PUEDE DECIR UNA CINTA ASI EN ESTE PRODUCTO
 * ----------------------------------------------
 * Solo hechos permanentes. La referencia visual usa esta pieza para repetir un
 * reclamo -cifras, multiplicadores, plazos-, y aqui eso seria a la vez urgencia
 * fabricada y una cifra de participaciones fuera del carrito. Lo que queda, y
 * es suficiente, son las tres afirmaciones que definen el producto: lo que se
 * adquiere es MERCANCIA ELEGIBLE, las participaciones son PROMOCIONALES y se
 * rigen por las REGLAS OFICIALES, y el sitio se llama Lone Star Winners.
 *
 * Ninguna de las tres caduca, ninguna depende del estado de una promocion y
 * ninguna empuja a nada. Por eso esta cinta puede estar en movimiento sin ser
 * un reclamo.
 *
 * ACCESIBILIDAD
 * -------------
 * La pista visible va `aria-hidden` ENTERA -esta duplicada, y anunciar seis
 * veces las mismas tres frases seria ruido- y el equivalente accesible es un
 * parrafo oculto que las dice una sola vez.
 *
 * MOVIMIENTO
 * ----------
 * La animacion es CSS pura (`.lsw-marquee-track`). Con `prefers-reduced-motion`
 * se apaga por completo y la cinta queda quieta mostrando el primer tramo, que
 * es texto legible tal cual. No se acelera ni se acorta: se detiene.
 */

/**
 * Cuantas veces se repiten las frases DENTRO de una pista.
 *
 * La pista se duplica y se desplaza media pista, asi que el bucle es continuo
 * siempre; lo que este numero decide es que una sola pista sea mas ancha que la
 * pantalla mas grande. Con tres frases de este largo, cuatro repeticiones pasan
 * de los 2000px y no queda hueco vacio en ningun monitor.
 */
const REPEATS = 4;

export async function MarqueeBand() {
  const t = await getTranslations();

  const phrases = [t("marquee.item1"), t("marquee.item2"), t("marquee.item3")] as const;

  return (
    <div
      role="region"
      aria-label={t("a11y.marquee")}
      className="lsw-topo relative overflow-hidden border-y border-border bg-surface-sunken py-s3"
    >
      {/* El texto, una vez, para tecnologia de asistencia. */}
      <p className="sr-only">{phrases.join(". ")}</p>

      <div aria-hidden="true" className="lsw-marquee-track">
        {/* Dos pistas identicas: al desplazarse -50% el fotograma coincide con
            el inicio y el bucle no tiene salto. */}
        <MarqueeTrack phrases={phrases} />
        <MarqueeTrack phrases={phrases} />
      </div>
    </div>
  );
}

function MarqueeTrack({ phrases }: { readonly phrases: readonly string[] }) {
  /*
   * La clave lleva el numero de repeticion Y la frase. Solo el indice seria
   * posicional -React avisa con razon-, y solo la frase se repetiria cuatro
   * veces. La combinacion es estable y unica sin depender del orden.
   */
  const items = Array.from({ length: REPEATS }, (_unused, repeat) =>
    phrases.map((phrase) => ({ key: `${String(repeat)}-${phrase}`, phrase })),
  ).flat();

  return (
    <ul className="flex shrink-0 items-center">
      {items.map((item) => (
        <li key={item.key} className="flex shrink-0 items-center whitespace-nowrap">
          <span className="lsw-display text-overline text-text-muted">{item.phrase}</span>
          {/* Rombo separador: el detalle de la referencia que convierte una
              lista de frases en una cinta. */}
          <span className="px-s5 text-caption leading-none text-brand">◆</span>
        </li>
      ))}
    </ul>
  );
}
