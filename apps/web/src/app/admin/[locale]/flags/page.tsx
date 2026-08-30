import { Alert, Badge, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import {
  FlagToggleForm,
  SettingChangeDecisionForm,
  SettingChangeRequestForm,
} from "@/components/admin/flag-forms";
import { flagLabeller, reasonLabeller, rulesKeyLabeller } from "@/i18n/admin-labels";
import { formatZonedDateTime } from "@/i18n/formatters";
import { isLocale, type Locale } from "@/i18n/locales";
import {
  decideSettingChangeAction,
  requestSettingChangeAction,
  updateFeatureFlagAction,
} from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { FLAG_UPDATE_REASONS } from "@/lib/admin/reason-codes";
import {
  fetchAdminFeatureFlags,
  fetchAdminSettingChangeRequests,
  type AdminFeatureFlagRow,
  type AdminSettingChangeRequest,
} from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Interruptores de la plataforma: feature flags y modalidad AMOE
 * (§13.9, DEC-054 punto 3, modificado por HO-041 resolucion fase 1).
 *
 * SE LLAMA "INTERRUPTORES" Y NO "AJUSTES" (HO-041, ronda de cierre e2e). En la
 * navegacion del panel esta pantalla se rotulaba "Ajustes", exactamente igual
 * que `/adjustments`, y el menu en espanol tenia dos entradas con el mismo
 * nombre llevando a sitios que no se parecen en nada: una cambia el
 * comportamiento del sistema y la otra mueve participaciones del ledger de una
 * persona. En ingles no colisionaban -"Settings" y "Adjustments"- y por eso el
 * choque no se veia leyendo el diccionario: se veia mirando el menu en espanol.
 *
 * `admin.nav.flags` dice ahora "Interruptores" / "Feature flags", y el titulo
 * de la pantalla acompana.
 *
 * DOS CLASES DE AJUSTE, DOS GESTOS DISTINTOS
 * ------------------------------------------
 * - **No material**: interruptor con motivo. Una persona, una capacidad
 *   (`flag.update`), sin segundo factor.
 * - **Legalmente material** y la **modalidad AMOE**: se SOLICITA el cambio y
 *   otra persona lo aprueba. Encender `amoe_enabled` o apagar
 *   `entry_caps_enabled` cambia lo que la plataforma afirma o aplica sobre las
 *   condiciones de participacion, y DEC-032 pide segunda aprobacion para eso.
 *
 * La pantalla no elige cual toca: lo dice `is_legally_material`, que publica el
 * backend desde el catalogo de `packages/security`. Un espejo de esa lista aqui
 * seria una segunda fuente de verdad sobre que es legalmente material, que es
 * justo lo que `CLAUDE.md` §4 prohibe.
 *
 * LO QUE ESTA PANTALLA NO ES
 * --------------------------
 * No es un control de acceso. Ocultar un boton es cortesia -no mandar a nadie a
 * una puerta cerrada-; quien autoriza es el backend en cada peticion, y sus
 * respuestas se pintan tal cual: el 403 del autorizador, el 409
 * `FLAG_LEGALLY_MATERIAL` cuando alguien intenta cambiar por `PATCH` un flag
 * material, y el 409 `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` cuando alguien
 * intenta aprobar su propia solicitud.
 */
export default async function AdminFlagsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.flags" });

  const screen = await openAdminScreen({
    locale,
    current: "flags",
    path: "/flags",
    title: t("title"),
    capability: "flag.read",
  });

  if (!screen.ok) return screen.node;

  const [flags, requests] = await Promise.all([
    fetchAdminFeatureFlags(locale, screen.session),
    fetchAdminSettingChangeRequests({ status: "PENDING_APPROVAL" }, locale, screen.session),
  ]);

  /*
   * DOS CAPACIDADES, DOS GESTOS. Quien solo tiene `flag.update` ve los
   * interruptores de los no materiales y, en los materiales, la explicacion de
   * que capacidad falta. No se oculta el bloque entero: pareceria que la
   * funcion no existe, y el ticket seria "no se puede encender AMOE" en vez de
   * "no tengo permiso para pedirlo".
   */
  const canUpdate = can(screen.actor, "flag.update");
  const canUpdateMaterial = can(screen.actor, "flag.update.legally_material");

  const reasons = FLAG_UPDATE_REASONS.map((value) => value);

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="flags"
      title={t("title")}
      description={t("body")}
    >
      {!flags.ok ? (
        <AdminSectionError failure={flags.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          {/* LAS SOLICITUDES PENDIENTES VAN PRIMERO. Es trabajo que espera a
              alguien; los interruptores estan siempre y pueden esperar. */}
          <Card as="section" elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("pendingHeading")}
            </CardTitle>

            <p className="mt-s2 text-body-sm text-text-muted">{t("pendingBody")}</p>

            <div className="mt-s4">
              {!requests.ok ? (
                <AdminSectionError failure={requests.error} headingLevel="h3" />
              ) : requests.data.items.length === 0 ? (
                <EmptyState
                  headingLevel="h3"
                  title={t("pendingEmptyTitle")}
                  description={t("pendingEmptyBody")}
                />
              ) : (
                <ul className="flex list-none flex-col gap-s4">
                  {requests.data.items.map((request) => (
                    <li key={request.id}>
                      <PendingRequestCard
                        request={request}
                        locale={locale}
                        canDecide={canUpdateMaterial}
                        reasons={reasons}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* MODALIDAD AMOE. Va aparte de la lista de flags porque no es un
              flag: es un ENUM, y cambiarla exige el mismo control dual que un
              flag material desde HO-041 (su ruta propia desaparecio). */}
          <Card as="section" elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("amoeModeHeading")}
            </CardTitle>

            <p className="mt-s2 text-body-sm text-text-muted">
              {flags.data.amoe_mode === null
                ? t("amoeModeUnset")
                : t("amoeModeCurrent", { mode: flags.data.amoe_mode })}
            </p>

            <div className="mt-s4">
              {(flags.data.amoe_mode_pending_change_request_id ?? null) !== null ? (
                <Alert tone="info">{t("hasPendingRequest")}</Alert>
              ) : canUpdateMaterial ? (
                <SettingChangeRequestForm
                  locale={locale}
                  action={requestSettingChangeAction}
                  settingKind="AMOE_MODE"
                  settingKey="amoe_mode"
                  currentMode={flags.data.amoe_mode}
                  reasons={await labelled(locale, reasons)}
                />
              ) : (
                <Alert tone="info">
                  {t("noMaterialCapability", { capability: "flag.update.legally_material" })}
                </Alert>
              )}
            </div>
          </Card>

          <section aria-labelledby="flags-list">
            <h2 id="flags-list" className="lsw-display text-heading-lg text-text">
              {t("listHeading")}
            </h2>

            <ul className="mt-s4 flex list-none flex-col gap-s4">
              {flags.data.items.map((flag) => (
                <li key={flag.key}>
                  <FlagCard
                    flag={flag}
                    locale={locale}
                    canUpdate={canUpdate}
                    canUpdateMaterial={canUpdateMaterial}
                    reasons={reasons}
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </AdminChrome>
  );
}

/** Traduce las claves de motivo una vez, para todos los formularios. */
async function labelled(
  locale: Locale,
  reasons: readonly string[],
): Promise<readonly { readonly value: string; readonly label: string }[]> {
  const label = await reasonLabeller(locale);
  return reasons.map((value) => ({ value, label: label(value) }));
}

/**
 * Un flag, con el gesto que le corresponde.
 *
 * LA MATERIALIDAD SE VE ANTES DE TOCAR NADA: una insignia junto al nombre y la
 * clave legal de la que depende, con su identificador tecnico. Delante de un
 * cliente eso seria inaceptable; delante de quien opera es lo que permite
 * buscarla en `docs/LEGAL_PENDING.md` y preguntar por ella.
 */
async function FlagCard({
  flag,
  locale,
  canUpdate,
  canUpdateMaterial,
  reasons,
}: {
  readonly flag: AdminFeatureFlagRow;
  readonly locale: Locale;
  readonly canUpdate: boolean;
  readonly canUpdateMaterial: boolean;
  readonly reasons: readonly string[];
}) {
  const t = await getTranslations({ locale, namespace: "admin.flags" });
  const flagLabel = await flagLabeller(locale);
  const keyLabel = await rulesKeyLabeller(locale);
  const options = await labelled(locale, reasons);

  const pending = flag.pending_change_request_id ?? null;

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-start justify-between gap-s3">
        <div className="min-w-0">
          <p className="lsw-display text-heading-sm text-text">{flagLabel(flag.key)}</p>
          <p className="mt-s1 break-all font-mono text-caption text-text-subtle">{flag.key}</p>
        </div>

        <div className="flex flex-wrap items-center gap-s2">
          <Badge tone={flag.enabled ? "success" : "neutral"} size="sm">
            {flag.enabled ? t("stateOn") : t("stateOff")}
          </Badge>

          {flag.is_legally_material ? (
            <Badge tone="warning" size="sm">
              {t("legallyMaterial")}
            </Badge>
          ) : null}
        </div>
      </div>

      {flag.legal_dependency === undefined || flag.legal_dependency === null ? null : (
        <p className="mt-s3 text-body-sm text-text-muted">
          {t("legalDependency", { key: keyLabel(flag.legal_dependency) })}
        </p>
      )}

      {flag.updated_at === undefined || flag.updated_at === null ? null : (
        <p className="mt-s1 text-caption text-text-subtle">
          {t("updatedAt", {
            instant: formatZonedDateTime(flag.updated_at, locale, { timeZone: "UTC" }) ?? "",
          })}
        </p>
      )}

      <div className="mt-s4">
        {/*
         * CON UNA SOLICITUD VIVA NO SE OFRECE OTRO GESTO.
         *
         * Dos cambios en vuelo sobre el mismo valor dejarian a alguien
         * aprobando uno que ya no es el actual. Se dice que hay una pendiente y
         * la lista de arriba es donde se decide.
         */}
        {pending !== null ? (
          <Alert tone="info">{t("hasPendingRequest")}</Alert>
        ) : flag.is_legally_material ? (
          canUpdateMaterial ? (
            <SettingChangeRequestForm
              locale={locale}
              action={requestSettingChangeAction}
              settingKind="FEATURE_FLAG"
              settingKey={flag.key}
              enabled={flag.enabled}
              reasons={options}
            />
          ) : (
            <Alert tone="info">
              {t("noMaterialCapability", { capability: "flag.update.legally_material" })}
            </Alert>
          )
        ) : canUpdate ? (
          <FlagToggleForm
            locale={locale}
            action={updateFeatureFlagAction}
            flagKey={flag.key}
            enabled={flag.enabled}
            reasons={options}
          />
        ) : (
          <Alert tone="info">{t("noUpdateCapability", { capability: "flag.update" })}</Alert>
        )}
      </div>
    </Card>
  );
}

/**
 * Una solicitud pendiente, con lo que se pide y quien lo pidio.
 *
 * EL VALOR SOLICITADO SE LEE, NO SE ADIVINA. `requested_value` es opaco en el
 * contrato -su forma depende de `setting_kind`- y aqui se leen las dos claves
 * conocidas. Si no aparece ninguna, se dice que no esta publicado en vez de
 * pintar `[object Object]`: aprobar un cambio sin ver el valor seria firmar en
 * blanco.
 */
async function PendingRequestCard({
  request,
  locale,
  canDecide,
  reasons,
}: {
  readonly request: AdminSettingChangeRequest;
  readonly locale: Locale;
  readonly canDecide: boolean;
  readonly reasons: readonly string[];
}) {
  const t = await getTranslations({ locale, namespace: "admin.flags" });
  const flagLabel = await flagLabeller(locale);
  const reasonLabel = await reasonLabeller(locale);
  const options = await labelled(locale, reasons);

  const requested = request.requested_value ?? null;
  const enabled =
    requested !== null && typeof requested.enabled === "boolean" ? requested.enabled : null;
  const mode =
    requested !== null && typeof requested.amoe_mode === "string" ? requested.amoe_mode : null;
  const modeCleared = requested !== null && requested.amoe_mode === null;

  const requestedAt =
    request.requested_at === undefined || request.requested_at === null
      ? null
      : formatZonedDateTime(request.requested_at, locale, { timeZone: "UTC" });

  return (
    <Card elevation="flat" padding="md">
      <div className="flex flex-wrap items-start justify-between gap-s3">
        <div className="min-w-0">
          <p className="lsw-display text-heading-sm text-text">
            {request.setting_kind === "AMOE_MODE"
              ? t("amoeModeHeading")
              : flagLabel(request.setting_key)}
          </p>
          <p className="mt-s1 break-all font-mono text-caption text-text-subtle">
            {request.setting_key}
          </p>
        </div>

        <Badge tone="warning" size="sm">
          {t("statusPending")}
        </Badge>
      </div>

      <p className="mt-s3 text-body-md text-text">
        {enabled !== null
          ? enabled
            ? t("requestedOn")
            : t("requestedOff")
          : mode !== null
            ? t("requestedMode", { mode })
            : modeCleared
              ? t("requestedModeNone")
              : t("requestedUnknown")}
      </p>

      {request.reason_code === undefined || request.reason_code === null ? null : (
        <p className="mt-s2 text-body-sm text-text-muted">
          {t("requestReason", { reason: reasonLabel(request.reason_code) })}
        </p>
      )}

      {/* La nota libre la escribio una persona: se renderiza como TEXTO, nunca
          como marcado, igual que cualquier otro campo tecleado por alguien. */}
      {request.reason_text === undefined || request.reason_text === null ? null : (
        <p className="mt-s1 whitespace-pre-line text-body-sm text-text-muted">
          {request.reason_text}
        </p>
      )}

      {requestedAt === null ? null : (
        <p className="mt-s2 text-caption text-text-subtle">
          {t("requestedAt", { instant: requestedAt })}
        </p>
      )}

      {canDecide ? (
        <SettingChangeDecisionForm
          locale={locale}
          action={decideSettingChangeAction}
          requestId={request.id}
          requestedByMe={request.requested_by_me}
          reasons={options}
        />
      ) : (
        <Alert tone="info" className="mt-s4">
          {t("noMaterialCapability", { capability: "flag.update.legally_material" })}
        </Alert>
      )}
    </Card>
  );
}
