import { buttonVariants } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { SectionHeading } from "./section-heading";

/**
 * Cierre de la portada: lo que este sitio si puede garantizar.
 *
 * POR QUE OCUPA EL SITIO DE LOS GANADORES
 * ---------------------------------------
 * La referencia visual cierra su portada con un carrusel de ganadores: foto,
 * cheque, nombre, ciudad, y un "podrias ser el siguiente". Aqui
 * `winner_publication_enabled` esta APAGADO (DEC-032) y no hay ningun ganador
 * que se pueda publicar, asi que ese bloque no existe.
 *
 * Dejar el hueco no era opcion: es la ultima pantalla antes del pie y la que
 * decide con que impresion se sale. Lo que ocupa su sitio tiene el mismo peso
 * visual -antetitulo dorado, titular grande, tres piezas- y dice tres cosas que
 * son CIERTAS del sistema tal como esta construido hoy:
 *
 *   1. cada promocion se rige por sus Reglas Oficiales, publicadas integras
 *      (DEC-012, y la ruta `/official-rules` existe);
 *   2. cada participacion conserva su procedencia y nada se borra en silencio
 *      (CLAUDE.md #5, #6 y #7: el ledger es de movimientos, no de saldos
 *      editables);
 *   3. cuando una promocion declara administrador independiente, su pagina lo
 *      dice (principio #10, y el campo `administrator_name` del contrato).
 *
 * Ninguna de las tres es una promesa comercial ni una afirmacion legal nueva:
 * las tres describen decisiones ya tomadas y ya implementadas. Cuando el flag
 * se encienda y existan ganadores publicados, la seccion de ganadores aparece
 * ENCIMA de esta; esta no se retira, porque lo que dice sigue siendo verdad.
 */
export function TrustBand() {
  const t = useTranslations("home.trust");
  const tNav = useTranslations("nav");

  const pillars = [
    { key: "pillar1", title: t("pillar1.title"), body: t("pillar1.body") },
    { key: "pillar2", title: t("pillar2.title"), body: t("pillar2.body") },
    { key: "pillar3", title: t("pillar3.title"), body: t("pillar3.body") },
  ] as const;

  return (
    <section
      aria-labelledby="trust"
      className="lsw-atmosphere lsw-grain relative isolate py-s16 lg:py-s20"
    >
      <div className="lsw-container">
        <SectionHeading id="trust" eyebrow={t("eyebrow")} title={t("title")} size="lg" />

        <p className="mt-s6 max-w-narrow text-body-lg text-text-muted">{t("body")}</p>

        {/* Tres pilares. Numerados con filete dorado arriba, no con iconos: un
            icono generico junto a una afirmacion legal la decora, y decorar una
            afirmacion legal es empezar a suavizarla. */}
        <ul className="mt-s10 grid list-none gap-s8 lg:grid-cols-3 lg:gap-s10">
          {pillars.map((pillar) => (
            <li key={pillar.key} className="border-t border-brand/40 pt-s5">
              <h3 className="lsw-display text-heading-md text-text">{pillar.title}</h3>
              <p className="mt-s3 text-body-md text-text-muted">{pillar.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-s10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/official-rules"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            {tNav("officialRules")}
          </Link>

          <Link href="/faq" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            {t("faqLink")}
          </Link>
        </div>
      </div>
    </section>
  );
}
