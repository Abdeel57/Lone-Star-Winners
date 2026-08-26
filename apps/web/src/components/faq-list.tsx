import { useTranslations } from "next-intl";

/**
 * Preguntas frecuentes.
 *
 * Usa `details` / `summary` nativos y no un acordeon de JavaScript. El elemento
 * nativo ya trae expansion por teclado, `aria-expanded` implicito, y -lo que
 * mas importa aqui- el contenido plegado sigue siendo texto real del documento:
 * el buscador del navegador (Ctrl+F) lo encuentra y el navegador lo despliega.
 * Un acordeon hecho a mano suele romper las tres cosas.
 *
 * QUE PUEDE Y QUE NO PUEDE DECIR ESTE TEXTO
 * -----------------------------------------
 * Puede describir COMO FUNCIONA EL SITIO. No puede establecer condiciones de
 * participacion. Por eso ninguna respuesta dice quien puede participar, desde
 * que estados, con que edad ni como se sortea: todas remiten a las Reglas
 * Oficiales, que es donde eso se define (CLAUDE.md #1 y #2).
 *
 * La respuesta a "estoy comprando participaciones" es la mas importante del
 * producto, y por eso esta escrita en negativo explicito en los dos idiomas: lo
 * que se compra es mercancia.
 */

/** Preguntas publicadas, en orden. Anadir una obliga a traducirla en ambos. */
const QUESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

type QuestionKey = (typeof QUESTION_KEYS)[number];

export function FaqList() {
  const t = useTranslations("faq");

  /**
   * `switch` exhaustivo en vez de `t(key + ".question")`.
   *
   * Una clave construida en tiempo de ejecucion no la comprueba el tipado de
   * `src/global.d.ts`: una pregunta sin traducir apareceria como la clave en
   * crudo. Asi, anadir una entrada al array obliga a escribirla aqui y, por
   * tanto, en los dos diccionarios.
   *
   * Va dentro del componente para cerrar sobre `t` conservando su tipo: las
   * claves son una union cerrada y extraer esto a una funcion suelta obligaria
   * a ensancharla a `string`.
   */
  const entryFor = (key: QuestionKey): { question: string; answer: string } => {
    switch (key) {
      case "q1":
        return { question: t("q1.question"), answer: t("q1.answer") };
      case "q2":
        return { question: t("q2.question"), answer: t("q2.answer") };
      case "q3":
        return { question: t("q3.question"), answer: t("q3.answer") };
      case "q4":
        return { question: t("q4.question"), answer: t("q4.answer") };
      case "q5":
        return { question: t("q5.question"), answer: t("q5.answer") };
      case "q6":
        return { question: t("q6.question"), answer: t("q6.answer") };
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {QUESTION_KEYS.map((key) => {
        const entry = entryFor(key);

        return (
          <details
            key={key}
            className="group rounded-lg border border-border bg-surface px-s5 py-s4 transition-colors duration-fast ease-standard open:border-brand/40 open:bg-surface-raised hover:border-border-strong"
          >
            <summary className="lsw-display flex cursor-pointer list-none items-center justify-between gap-4 text-heading-sm text-text marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
              {entry.question}

              {/* Signo de apertura: gira al desplegar. Es decorativo -el estado
                  real lo anuncia el propio `details`- y por eso queda oculto
                  para tecnologia de asistencia. */}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                focusable="false"
                className="h-5 w-5 shrink-0 text-brand transition-transform duration-fast ease-standard group-open:rotate-45 motion-reduce:transition-none"
              >
                <path
                  d="M10 4v12M4 10h12"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </summary>

            <p className="mt-s4 text-body-md text-text-muted">{entry.answer}</p>
          </details>
        );
      })}
    </div>
  );
}
