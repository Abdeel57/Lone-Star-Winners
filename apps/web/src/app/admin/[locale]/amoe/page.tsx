import { Alert, buttonVariants, Card, CardTitle, EmptyState, cn } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AmoeDecisionPanel, AmoeSubmissionRow } from "@/components/admin/amoe-review";
import { AdminPager } from "@/components/admin/admin-pager";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { AmoeTranscribeForm } from "@/components/admin/amoe-transcribe-form";
import { adminHref } from "@/i18n/admin-routing";
import { amoeStatusLabeller } from "@/i18n/admin-labels";
import { isLocale, type Locale } from "@/i18n/locales";
import { transcribeAmoeAction } from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { normalizeAmoeConfig, type NormalizedAmoeField } from "@/lib/amoe-config";
import {
  AMOE_SUBMISSION_STATUSES,
  fetchActivePromotion,
  fetchAdminAmoeSubmissions,
  fetchAmoeConfig,
  type AmoeSubmissionStatus,
  type PromotionSummary,
} from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Cola de revision AMOE.
 *
 * POR QUE LA DECISION ES UNA PANTALLA Y NO UN BOTON EN LA FILA
 * ------------------------------------------------------------
 * Aprobar un envio AMOE otorga participaciones que no pasaron por ninguna
 * compra. Un boton en la fila del listado significa decidir sin haber leido lo
 * que la persona envio, y con el raton a un pixel del boton de la fila de al
 * lado. Aqui el listado ENLAZA a la decision -que es una navegacion, no una
 * mutacion- y la decision se toma en un panel que ensena el envio completo,
 * exige motivo y exige confirmacion explicita.
 *
 * Todo el estado viaja en la URL (`?status=&cursor=&submission=&decision=`),
 * asi que funciona sin JavaScript, se puede compartir el enlace de un envio
 * concreto con quien tenga que revisarlo, y el boton de "atras" del navegador
 * hace lo que se espera.
 *
 * EL FILTRO POR DEFECTO ES `PENDING_REVIEW` y no "todos": una cola de revision
 * que abre con los mil aprobados del mes es una cola que nadie usa. Los envios
 * ya decididos siguen siendo alcanzables, pero hay que PEDIRLOS: el filtro de
 * arriba manda `?status=APPROVED` -o el que toque- a la API, que es la unica
 * forma de verlos desde que la cola filtra.
 *
 * ---------------------------------------------------------------------------
 * DOS LECTURAS INDEPENDIENTES, Y NINGUNA PUEDE TUMBAR A LA OTRA
 * ---------------------------------------------------------------------------
 * Esta pantalla hace dos cosas que no dependen entre si: REVISAR la cola y
 * TRANSCRIBIR una ficha postal. La cola sale de
 * `GET /admin/amoe-submissions`; el formulario, de
 * `GET /promotions/{slug}/amoe-config`, que es de donde salen los campos que
 * declara la modalidad vigente.
 *
 * Hasta la ronda de cierre de HO-041, un fallo de la primera pintaba el estado
 * de error en el sitio de TODA la pantalla y el formulario no llegaba a
 * existir: con la cola caida, la unica via gratuita de la promocion dejaba de
 * ser operable, que es un dano mayor que no poder mirar una lista. Ahora el
 * fallo se pinta dentro de la lista que falla y el resto de la pantalla sigue
 * viva.
 *
 * Y la cola fallaba: la peticion se mandaba SIN `promotion_id`, que el contrato
 * declara obligatorio (seccion 11), asi que la API respondia 422
 * `VALIDATION_FAILED`. El identificador sale de la promocion activa, que es la
 * misma lectura que ya necesitaba el formulario.
 */
export default async function AdminAmoePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    cursor?: string;
    status?: string;
    submission?: string;
    decision?: string;
  }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const { cursor, status: requestedStatus, submission: selectedId, decision } = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.amoeReview" });
  const tTranscribe = await getTranslations({ locale, namespace: "admin.amoeTranscribe" });

  const screen = await openAdminScreen({
    locale,
    current: "amoe",
    path: "/amoe",
    title: t("title"),
    capability: "amoe.review.read",
  });

  if (!screen.ok) return screen.node;

  const canApprove = can(screen.actor, "amoe.review.approve");
  const canReject = can(screen.actor, "amoe.review.reject");
  const canTranscribe = can(screen.actor, "amoe.submission.transcribe");

  /*
   * LA PROMOCION ACTIVA, UNA SOLA VEZ Y PARA LAS DOS MITADES.
   *
   * La cola la necesita porque `promotion_id` es obligatorio; el formulario,
   * porque la configuracion AMOE pertenece a una promocion concreta, con su
   * ventana y su version de reglas (DEC-012). Antes solo la leia el formulario,
   * y esa es la razon de que la cola se quedara sin identificador.
   *
   * `fetchActivePromotion` traduce el 404 a `null`: entre promociones no hay
   * ninguna abierta y eso es un estado normal del negocio, no una averia.
   */
  const promotion = await fetchActivePromotion(locale);
  const activePromotion: PromotionSummary | null = promotion.ok ? promotion.data : null;

  /*
   * El filtro sale de la URL y se compara contra el enum del contrato: lo que
   * no sea uno de los cinco estados NO se reenvia a la API -produciria un 422-
   * y se cae al de por defecto. Es comprobacion de FORMA, no una regla de
   * negocio.
   */
  const status: AmoeSubmissionStatus =
    AMOE_SUBMISSION_STATUSES.find((value) => value === requestedStatus) ?? DEFAULT_STATUS;

  /*
   * LAS DOS LECTURAS QUE DEPENDEN DE LA PROMOCION, EN PARALELO.
   *
   * Son independientes entre si -una es la cola, la otra la configuracion AMOE-
   * y encadenarlas sumaba un viaje de ida y vuelta a la pantalla mas lenta del
   * panel. Lo que NO se paraleliza es la promocion activa: de ella salen el
   * identificador y el `slug` que las dos necesitan.
   *
   * `result` tiene tres valores posibles y los tres significan cosas distintas:
   * un fallo de la propia lectura de la promocion se PROPAGA como fallo -no se
   * disfraza de "no hay promocion", que es lo que hacia una version anterior de
   * esto-; `null` es la ausencia real de promocion abierta; y lo demas es la
   * respuesta de la cola.
   */
  const [result, transcription] = await Promise.all([
    !promotion.ok
      ? promotion
      : activePromotion === null
        ? null
        : fetchAdminAmoeSubmissions(
            {
              promotion_id: activePromotion.id,
              status,
              ...(cursor === undefined ? {} : { cursor }),
            },
            locale,
            screen.session,
          ),
    /*
     * LA CONFIGURACION AMOE, SOLO SI SE VA A TRANSCRIBIR.
     *
     * El formulario de transcripcion pinta EXACTAMENTE los campos que declara
     * la modalidad vigente, asi que hay que leerla; sin la capacidad, esa
     * peticion seria trafico para una pantalla que no se va a ver.
     */
    canTranscribe && activePromotion !== null
      ? loadTranscriptionContext(activePromotion, locale)
      : null,
  ]);

  const selected =
    result !== null && result.ok && selectedId !== undefined
      ? (result.data.items.find((item) => item.submission_id === selectedId) ?? null)
      : null;

  const activeDecision = decision === "reject" ? "reject" : "approve";

  /** Filtros que hay que conservar al pasar de pagina y al volver del panel. */
  const queryWithStatus: Readonly<Record<string, string>> = { status };

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="amoe"
      title={t("title")}
      description={t("description")}
    >
      <div className="flex flex-col gap-s6">
        {/*
         * Quien solo tiene lectura ve la cola entera y no ve ningun boton de
         * decision. No es una pantalla degradada: `SUPPORT` necesita poder
         * mirar la cola para responder a quien pregunta por su envio, y
         * ensenarle botones que le van a devolver un 403 seria peor.
         */}
        {canApprove || canReject ? null : <Alert tone="info">{t("readOnlyNotice")}</Alert>}

        {/*
         * TRANSCRIPCION DE FICHAS POSTALES (§13.10, DEC-054 punto 4).
         *
         * Va ARRIBA de la cola y no en una pantalla aparte: quien abre un
         * sobre y quien revisa la cola suelen ser la misma persona en la
         * misma sesion, y separar las dos cosas obligaria a navegar entre
         * ellas por cada ficha.
         *
         * Tres estados y los tres se dicen: sin capacidad no se pinta nada
         * -es cortesia, el control es del backend-; con capacidad y sin
         * promocion o sin modalidad postal, se explica por que no hay
         * formulario; con las dos cosas, el formulario.
         *
         * Y NO DEPENDE DE LA COLA. Es el bloque que la ronda de cierre de
         * HO-041 saca de debajo del estado de error: la modalidad postal es la
         * unica via gratuita de la promocion, y dejarla sin formulario porque
         * una lista de al lado devolvio un 422 es apagar la via, no informar de
         * un fallo.
         */}
        {!canTranscribe ? null : (
          <Card as="section" elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {tTranscribe("heading")}
            </CardTitle>

            <div className="mt-s4">
              {transcription === null ? (
                <Alert tone="info">{tTranscribe("unavailable")}</Alert>
              ) : (
                <AmoeTranscribeForm
                  locale={locale}
                  action={transcribeAmoeAction}
                  promotionId={transcription.promotionId}
                  fields={transcription.fields}
                  maxCardsPerEnvelope={transcription.maxCardsPerEnvelope}
                />
              )}
            </div>
          </Card>
        )}

        {selected === null ? null : (
          <AmoeDecisionPanel
            submission={selected}
            locale={locale}
            decision={activeDecision}
            canApprove={canApprove}
            canReject={canReject}
          />
        )}

        <section aria-labelledby="amoe-queue" className="flex flex-col gap-s5">
          <h2 id="amoe-queue" className="lsw-display text-heading-lg text-text">
            {t("queueHeading")}
          </h2>

          <StatusFilter locale={locale} current={status} />

          {/*
           * TRES DESENLACES, Y NINGUNO TUMBA LA PANTALLA.
           *
           * 1. Sin promocion abierta no hay cola que pedir -`promotion_id` es
           *    obligatorio- y se dice eso, como estado deliberado: entre
           *    promociones es lo normal.
           * 2. Con la peticion fallida -la de la cola, o la de la promocion de
           *    la que depende- el error se pinta AQUI DENTRO, con encabezado
           *    `h3` porque cuelga del `h2` de la seccion. El formulario de
           *    transcripcion de arriba sigue en pie.
           * 3. Y si va bien, la lista.
           */}
          {result === null ? (
            <EmptyState
              headingLevel="h3"
              title={t("noPromotionTitle")}
              description={t("noPromotionBody")}
            />
          ) : !result.ok ? (
            <AdminSectionError failure={result.error} headingLevel="h3" />
          ) : result.data.items.length === 0 ? (
            /*
             * El vacio de la cola por defecto y el de un filtro NO dicen lo
             * mismo: "no hay nada esperando revision" delante de un filtro de
             * aprobados seria falso, porque lo que no hay son aprobados.
             */
            <EmptyState
              headingLevel="h3"
              title={status === DEFAULT_STATUS ? t("emptyTitle") : t("emptyFilteredTitle")}
              description={status === DEFAULT_STATUS ? t("emptyBody") : t("emptyFilteredBody")}
            />
          ) : (
            <ul className="flex list-none flex-col gap-s4">
              {result.data.items.map((item) => (
                <li key={item.submission_id}>
                  <div className="flex flex-col gap-s3">
                    <AmoeSubmissionRow
                      submission={item}
                      locale={locale}
                      selected={item.submission_id === selectedId}
                    />

                    {/*
                     * LA PROPIA TRANSCRIPCION NO SE DECIDE (§13.10).
                     *
                     * Ni aprobar ni rechazar: el backend bloquea las dos rutas
                     * con 409 `SEPARATION_OF_DUTIES`, porque rechazar una ficha
                     * valida tambien es un dano -le niega participaciones a
                     * alguien- y quien la transcribio es quien podria tapar su
                     * propio error al teclearla.
                     *
                     * Se retiran los DOS enlaces y se dice por que UNA vez. La
                     * fila ya avisa arriba de que la transcribio quien mira;
                     * aqui lo que hace falta es que no haya adonde pulsar.
                     */}
                    {item.transcribed_by_me ? (
                      <p className="text-body-sm text-text-muted">{t("ownTranscriptionBody")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-s3">
                        {canApprove ? (
                          <Link
                            href={decisionHref(locale, item.submission_id, "approve", status)}
                            className={buttonVariants({ variant: "secondary", size: "sm" })}
                          >
                            {t("reviewApprove")}
                          </Link>
                        ) : null}

                        {canReject ? (
                          <Link
                            href={decisionHref(locale, item.submission_id, "reject", status)}
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                          >
                            {t("reviewReject")}
                          </Link>
                        ) : null}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {result?.ok !== true ? null : (
            <AdminPager
              locale={locale}
              path="/amoe"
              nextCursor={result.data.next_cursor}
              hasItems={result.data.items.length > 0}
              // El filtro viaja con el cursor: sin el, la segunda pagina de los
              // aprobados volveria a los pendientes.
              extraQuery={queryWithStatus}
            />
          )}
        </section>

        <Card elevation="flat" padding="md">
          <p className="text-caption text-text-subtle">{t("ledgerNote")}</p>
        </Card>
      </div>
    </AdminChrome>
  );
}

/**
 * Estado con el que abre la cola.
 *
 * Es una decision de PRESENTACION, no de negocio: la API acepta los cinco y
 * tiene su propio valor por defecto. Aqui se declara igualmente y se envia
 * SIEMPRE explicito, porque el enlace de la navegacion tiene que llevar a un
 * estado concreto y no a "lo que la API decida hoy".
 *
 * `PENDING_REVIEW` NO ES UN FILTRO EXACTO, y conviene saberlo antes de leer la
 * pantalla: backend confirma (HO-041) que con este valor -y sin ninguno- la
 * respuesta es la COLA DE TRABAJO, es decir `SUBMITTED` mas `PENDING_REVIEW`
 * juntos; con cualquier otro valor la consulta si es de ese estado exacto. Por
 * eso las dos primeras pestanas se solapan a proposito: la primera es "lo que
 * hay que decidir" y la segunda, "lo que todavia no se ha triado".
 */
const DEFAULT_STATUS: AmoeSubmissionStatus = "PENDING_REVIEW";

/**
 * Enlace a la decision, conservando el filtro.
 *
 * El panel de decision busca el envio DENTRO de la pagina cargada, asi que sin
 * arrastrar `status` un envio aprobado abriria sobre la cola de pendientes y no
 * se encontraria a si mismo.
 */
function decisionHref(
  locale: Locale,
  submissionId: string,
  decision: "approve" | "reject",
  status: AmoeSubmissionStatus,
): string {
  const search = new URLSearchParams({ status, submission: submissionId, decision });
  return `${adminHref(locale, "/amoe")}?${search.toString()}`;
}

/**
 * Filtro por estado, como ENLACES y no como formulario.
 *
 * Son navegaciones -cambian lo que se mira, no el sistema-, asi que funcionan
 * sin JavaScript, se pueden abrir en otra pestana y el boton de atras hace lo
 * que se espera. El estado vigente se marca con `aria-current`, que es lo que
 * lo anuncia a un lector de pantalla; el color solo lo repite.
 *
 * La lista sale de `AMOE_SUBMISSION_STATUSES`, el enum del contrato: un estado
 * nuevo aparece aqui solo, y su texto lo resuelve el mismo traductor que usa
 * la insignia de cada fila (DEC-022).
 */
async function StatusFilter({
  locale,
  current,
}: {
  readonly locale: Locale;
  readonly current: AmoeSubmissionStatus;
}) {
  const t = await getTranslations({ locale, namespace: "admin.amoeReview" });
  const statusLabel = await amoeStatusLabeller(locale);

  return (
    <nav aria-label={t("filterLabel")} className="flex flex-wrap gap-s2">
      {AMOE_SUBMISSION_STATUSES.map((value) => {
        const active = value === current;

        return (
          <Link
            key={value}
            href={`${adminHref(locale, "/amoe")}?status=${value}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
              active ? "font-semibold" : "",
            )}
          >
            {statusLabel(value)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Lo que el formulario de transcripcion necesita para existir.
 *
 * TRES CONDICIONES, Y LAS TRES SON NECESARIAS: que haya promocion activa -una
 * ficha pertenece a una promocion concreta-, que la via gratuita este encendida
 * y que la modalidad sea POSTAL. La transcripcion solo se admite con
 * `MAIL_IN_REVIEW`: con cualquier otra la API responde 409
 * `AMOE_MODE_NOT_MAIL_IN`, y ofrecer el formulario seria mandar a alguien a
 * teclear una ficha entera para que reboten.
 *
 * Devuelve `null` ante cualquier fallo o cualquier ausencia. La pantalla lo
 * pinta como estado deliberado -"no hay ficha que transcribir ahora mismo"- y
 * no como averia: entre promociones es lo normal.
 *
 * LA PROMOCION LLEGA COMO PARAMETRO y ya no se pide aqui dentro: la pantalla la
 * necesita tambien para la cola -`promotion_id` es obligatorio- y dos lecturas
 * de la misma promocion en el mismo render podrian devolver dos promociones
 * distintas justo en el cambio de una a otra, con el formulario apuntando a una
 * y la cola a la otra.
 */
async function loadTranscriptionContext(
  promotion: PromotionSummary,
  locale: Locale,
): Promise<{
  readonly promotionId: string;
  readonly fields: readonly NormalizedAmoeField[];
  readonly maxCardsPerEnvelope: number | null;
} | null> {
  const config = await fetchAmoeConfig(promotion.slug, locale);
  if (!config.ok) return null;

  const normalized = normalizeAmoeConfig(config.data);
  if (!normalized.enabled) return null;
  if (normalized.mode !== "MAIL_IN_REVIEW") return null;
  if (normalized.fields.length === 0) return null;

  /*
   * `promotion_id` sale de la CONFIGURACION y no del resumen: el envio se
   * dirige por identificador y la configuracion ya lo trae, asi que usar el del
   * resumen abriria la puerta a mandar la ficha a otra promocion si alguna vez
   * las dos lecturas se desincronizaran.
   */
  const promotionId = normalized.promotionId ?? promotion.id;

  return {
    promotionId,
    fields: normalized.fields,
    maxCardsPerEnvelope: config.data.mail_in?.max_cards_per_envelope ?? null,
  };
}
