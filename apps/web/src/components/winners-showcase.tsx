import { Card, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";

import type { Locale } from "@/i18n/locales";
import { pickLocalized, type LocalizedText } from "@/lib/api";

import { SectionHeading } from "./section-heading";

/**
 * Un ganador publicado.
 *
 * ESTO NO ES UN CONTRATO DE API.
 * ------------------------------
 * `docs/API_CONTRACT.md` no publica hoy ninguna ruta de ganadores: el dominio
 * de sorteo y publicacion (`draw.*`, `winner.*`) esta reservado y su forma la
 * decide `backend` junto con `security`. Esta interfaz es solo la FORMA DE
 * PRESENTACION que necesita la seccion, declarada aqui para que la pantalla
 * exista y este probada cuando el dato llegue.
 *
 * Consecuencia deliberada: el frontend NO llama a ninguna ruta de ganadores, ni
 * inventa uno. La portada pasa hoy una lista vacia. Cuando exista la ruta, lo
 * unico que cambia es de donde sale la lista; ni un componente mas.
 *
 * Lo que NO lleva, y no llevara mientras nadie lo apruebe: apellido completo,
 * fotografia identificable de terceros ni ningun dato que no autorice
 * expresamente la version de reglas de esa promocion. Que se puede publicar de
 * un ganador es materia legal (CLAUDE.md #1 y #2).
 */
export interface PublishedWinner {
  readonly id: string;
  /** Nombre tal como la promocion autoriza publicarlo. No se transforma. */
  readonly display_name: string;
  /** Ciudad y estado, si la version de reglas autoriza publicarlos. */
  readonly location: string | null;
  /** Titulo de la promocion, contenido dinamico localizado (DEC-030). */
  readonly promotion_title: LocalizedText;
  readonly promotion_slug: string;
}

/**
 * Seccion de ganadores publicados.
 *
 * ESTA SECCION VIVE DETRAS DE `winner_publication_enabled`
 * --------------------------------------------------------
 * Hoy ese flag esta APAGADO (DEC-032), de modo que la seccion no se renderiza y
 * su sitio lo ocupa la banda de confianza. Publicar un ganador es una
 * afirmacion legalmente material -sobre una persona concreta, ademas- y no
 * puede depender de que alguien se acuerde de comprobar un flag en la pantalla:
 * depende de que la lista llegue vacia mientras el flag este apagado, que es lo
 * que la portada garantiza.
 *
 * Sin ganadores publicados tampoco se renderiza: una seccion titulada
 * "Ganadores confirmados" con la rejilla vacia sugeriria que hubo ganadores y
 * no se dice quienes.
 */
export function WinnersShowcase({
  winners,
  locale,
}: {
  readonly winners: readonly PublishedWinner[];
  readonly locale: Locale;
}) {
  const t = useTranslations("winners");
  const tA11y = useTranslations("a11y");

  if (winners.length === 0) return null;

  return (
    <section
      aria-labelledby="winners"
      className="lsw-band-sunken relative isolate py-s16 lg:py-s20"
    >
      <div className="lsw-container">
        <SectionHeading
          id="winners"
          eyebrow={t("eyebrow")}
          title={t("title")}
          lead={t("intro")}
          size="lg"
        />

        <ul
          aria-label={tA11y("winnersList")}
          className="mt-s10 grid list-none gap-s5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {winners.map((winner) => (
            <Card
              as="li"
              key={winner.id}
              elevation="flat"
              padding="lg"
              // Marco dorado: es la unica rejilla del sitio donde cada pieza
              // lleva borde de marca completo, y eso es lo que la distingue de
              // una rejilla de producto a primera vista.
              className="border-brand/45"
            >
              <p className="lsw-display text-heading-lg text-text">{winner.display_name}</p>

              {winner.location === null ? null : (
                <p className="mt-s3 flex items-center gap-2 text-body-sm text-text-muted">
                  <PinIcon />
                  <span className="sr-only">{t("locationLabel")}</span>
                  {winner.location}
                </p>
              )}

              <p className={cn("mt-s5 border-t border-border pt-s4")}>
                <span className="lsw-eyebrow text-text-subtle">{t("promotionLabel")}</span>
                <span className="lsw-display mt-s2 block text-body-md text-brand">
                  {pickLocalized(winner.promotion_title, locale)}
                </span>
              </p>
            </Card>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4 shrink-0 text-brand"
    >
      <path
        d="M10 17.5s5.5-5.1 5.5-9a5.5 5.5 0 1 0-11 0c0 3.9 5.5 9 5.5 9Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8.4" r="1.9" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
