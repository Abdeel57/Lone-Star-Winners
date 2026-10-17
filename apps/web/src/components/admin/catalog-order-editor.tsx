"use client";

import { Alert, Badge, Button, Card, CardTitle, IconButton, cn } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import { FormError, LocaleField } from "@/components/auth-form-shell";
import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { IDLE } from "@/lib/action-result";
import { setCatalogOrderAction } from "@/lib/admin/catalog-order-actions";
import type { AdminCatalogOrderGroup, AdminCatalogOrderItem } from "@/lib/api";
// De la hoja y no del indice: el indice arrastra `http.ts`, que es de servidor.
import { pickLocalized } from "@/lib/api/localized";

/** Los destacados de la portada son los cuatro primeros de la mercancia. */
const HOME_FEATURED_COUNT = 4;

type Move = "up" | "down" | "top";

/**
 * Ordenar UN grupo de la tienda (DEC-088): la mercancia o los paquetes.
 *
 * PENSADO PARA EL TELEFONO. Nada de arrastrar: con el pulgar, arrastrar dentro
 * de una lista que tambien hace scroll es una loteria. Cada fila lleva tres
 * botones de area tactil completa -subir, bajar y "el primero"- y el numero de
 * lugar a la vista.
 *
 * SE GUARDA UNA VEZ. Mover no toca la tienda; "Guardar orden" manda el grupo
 * entero en el orden de la pantalla. Hasta entonces la pantalla avisa de que hay
 * cambios sin guardar y deja deshacerlos.
 *
 * LA VISTA PREVIA sigue el orden de la PANTALLA, guardado o no: es lo que se
 * vera en la portada del celular si se guarda ahora.
 *
 * Volver al orden automatico borra el orden puesto en este grupo, y por eso pide
 * confirmacion en el mismo sitio, sin ventana emergente.
 */
export function CatalogOrderEditor({
  locale,
  group,
  canWrite,
}: {
  readonly locale: Locale;
  readonly group: AdminCatalogOrderGroup;
  readonly canWrite: boolean;
}) {
  const t = useTranslations("admin.catalogOrder");
  const [state, formAction, pending] = useActionState(setCatalogOrderAction, IDLE);

  const serverOrder = group.items.map((item) => item.id);
  const serverSignature = group.items
    .map((item) => `${item.id}:${item.display_position ?? "-"}`)
    .join(",");

  const [order, setOrder] = useState<readonly string[]>(serverOrder);
  const [syncedSignature, setSyncedSignature] = useState(serverSignature);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [pendingFocus, setPendingFocus] = useState<{ id: string; move: Move } | null>(null);

  // Tras guardar, la pagina se vuelve a pintar con lo que dice la API: la
  // pantalla parte de ahi y deja de tener cambios pendientes.
  if (serverSignature !== syncedSignature) {
    setSyncedSignature(serverSignature);
    setOrder(serverOrder);
    setConfirmingReset(false);
  }

  const byId = new Map(group.items.map((item) => [item.id, item]));
  const items = order.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
  const dirty = order.join(",") !== serverOrder.join(",");
  const isMerchandise = group.kind === "MERCHANDISE";
  const groupName = isMerchandise ? t("groupMerchandise") : t("groupPackages");
  const headingId = `catalog-order-${group.kind}`;

  // El foco sigue al producto que se acaba de mover. Si su boton queda
  // deshabilitado -llego arriba del todo o abajo del todo-, pasa al otro.
  useEffect(() => {
    if (pendingFocus === null) return;
    const index = order.indexOf(pendingFocus.id);
    const atTop = index === 0;
    const atBottom = index === order.length - 1;
    const target =
      pendingFocus.move === "down"
        ? atBottom
          ? "up"
          : "down"
        : atTop
          ? atBottom
            ? null
            : "down"
          : "up";
    if (target !== null) {
      document.getElementById(buttonId(group.kind, pendingFocus.id, target))?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus, order, group.kind]);

  function move(id: string, how: Move): void {
    const from = order.indexOf(id);
    if (from === -1) return;
    const to = how === "top" ? 0 : how === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= order.length || to === from) return;

    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setOrder(next);

    const item = byId.get(id);
    if (item !== undefined) {
      setAnnouncement(t("moved", { name: pickLocalized(item.name, locale), position: to + 1 }));
    }
    setPendingFocus({ id, move: how });
  }

  return (
    <Card elevation="raised" padding="md">
      <section aria-labelledby={headingId} className="flex flex-col gap-s4">
        <div className="flex flex-wrap items-center justify-between gap-s2">
          <CardTitle as="h2" size="sm" id={headingId}>
            {groupName}
          </CardTitle>
          <Badge tone={group.manual ? "brand" : "neutral"} size="sm" emphasis="subtle">
            {group.manual ? t("modeManual") : t("modeAutomatic")}
          </Badge>
        </div>

        <p className="text-body-sm text-text-muted">
          {isMerchandise ? t("groupMerchandiseHint") : t("groupPackagesHint")}
          {group.manual ? null : ` ${t("automaticExplained")}`}
        </p>

        <FormError result={state} />
        {state.status === "ok" && !dirty ? <Alert tone="success">{t("saved")}</Alert> : null}

        {items.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t("empty")}</p>
        ) : (
          <ol aria-label={t("listLabel", { group: groupName })} className="flex flex-col gap-s2">
            {items.map((item, index) => (
              <OrderRow
                key={item.id}
                locale={locale}
                kind={group.kind}
                item={item}
                position={index + 1}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                onHome={isMerchandise && index < HOME_FEATURED_COUNT}
                // Con cambios sin guardar, guardar coloca a TODOS en el lugar
                // que tienen en pantalla: "sin colocar" ya no describe nada.
                showUnplaced={group.manual && !dirty && item.display_position === null}
                canWrite={canWrite}
                onMove={move}
              />
            ))}
          </ol>
        )}

        {group.manual && !dirty && items.some((item) => item.display_position === null) ? (
          <p className="text-caption text-text-subtle">{t("unplacedHint")}</p>
        ) : null}

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {canWrite && items.length > 0 ? (
          <div className="flex flex-col gap-s3">
            {dirty ? (
              <p className="text-body-sm font-semibold text-warning" role="status">
                {t("unsaved")}
              </p>
            ) : null}

            <div className="flex flex-col gap-s2 sm:flex-row sm:items-center">
              <form action={formAction} className="contents">
                <LocaleField locale={locale} />
                <input type="hidden" name="kind" value={group.kind} />
                {order.map((id) => (
                  <input key={id} type="hidden" name="product_id" value={id} />
                ))}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={pending}
                  disabled={!dirty}
                  className="w-full sm:w-auto"
                >
                  {t("save")}
                </Button>
              </form>
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setOrder(serverOrder);
                    setAnnouncement("");
                  }}
                >
                  {t("undo")}
                </Button>
              ) : null}
            </div>

            {group.manual ? (
              confirmingReset ? (
                <div className="flex flex-col gap-s3 rounded-md border border-warning/45 bg-warning-subtle p-s4">
                  <p className="text-body-sm font-semibold text-text">{t("resetConfirmTitle")}</p>
                  <p className="text-body-sm text-text-muted">{t("resetConfirmBody")}</p>
                  <div className="flex flex-col gap-s2 sm:flex-row">
                    <form action={formAction} className="contents">
                      <LocaleField locale={locale} />
                      <input type="hidden" name="kind" value={group.kind} />
                      <input type="hidden" name="intent" value="automatic" />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="md"
                        loading={pending}
                        className="w-full sm:w-auto"
                      >
                        {t("resetConfirm")}
                      </Button>
                    </form>
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      className="w-full sm:w-auto"
                      onClick={() => setConfirmingReset(false)}
                    >
                      {t("resetCancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className="w-full sm:w-auto sm:self-start"
                  onClick={() => setConfirmingReset(true)}
                >
                  {t("resetCta")}
                </Button>
              )
            ) : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <PhonePreview
            locale={locale}
            kind={group.kind}
            items={items.slice(0, HOME_FEATURED_COUNT)}
          />
        ) : null}
      </section>
    </Card>
  );
}

function buttonId(kind: string, id: string, move: Move): string {
  return `catalog-order-${kind}-${id}-${move}`;
}

function OrderRow({
  locale,
  kind,
  item,
  position,
  isFirst,
  isLast,
  onHome,
  showUnplaced,
  canWrite,
  onMove,
}: {
  readonly locale: Locale;
  readonly kind: string;
  readonly item: AdminCatalogOrderItem;
  readonly position: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onHome: boolean;
  readonly showUnplaced: boolean;
  readonly canWrite: boolean;
  readonly onMove: (id: string, how: Move) => void;
}) {
  const t = useTranslations("admin.catalogOrder");
  const name = pickLocalized(item.name, locale);
  const price = formatMoney(item.price_from, locale);

  // En el telefono, dos pisos: arriba que producto es y en que lugar va; abajo
  // los botones. En una sola fila, tres botones de area tactil completa dejaban
  // al nombre menos de tres letras de ancho.
  return (
    <li
      className={cn(
        "flex flex-col gap-s2 rounded-md border bg-surface p-s2 sm:flex-row sm:items-center sm:gap-s3",
        onHome ? "border-brand/50" : "border-border",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-s3">
        <span
          aria-hidden="true"
          className="w-7 shrink-0 text-center font-display text-heading-sm font-bold tabular-nums text-text"
        >
          {position}
        </span>
        <Thumbnail url={item.image_url} />
        <div className="flex min-w-0 flex-1 flex-col gap-s1">
          <p className="truncate text-body-sm font-semibold text-text">
            <span className="sr-only">{t("position", { position })} </span>
            {name}
          </p>
          <p className="text-caption text-text-subtle tabular-nums">{price ?? t("noPrice")}</p>
          {onHome || showUnplaced ? (
            <div className="flex flex-wrap gap-s1">
              {onHome ? (
                <Badge tone="brand" size="sm" emphasis="subtle">
                  {t("onHome")}
                </Badge>
              ) : null}
              {showUnplaced ? (
                <Badge tone="warning" size="sm" emphasis="subtle">
                  {t("unplaced")}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {canWrite ? (
        <div className="flex shrink-0 items-center justify-end gap-s1">
          <IconButton
            id={buttonId(kind, item.id, "top")}
            variant="ghost"
            label={t("moveTop", { name })}
            icon={<ArrowIcon direction="top" />}
            disabled={isFirst}
            onClick={() => onMove(item.id, "top")}
          />
          <IconButton
            id={buttonId(kind, item.id, "up")}
            variant="secondary"
            label={t("moveUp", { name })}
            icon={<ArrowIcon direction="up" />}
            disabled={isFirst}
            onClick={() => onMove(item.id, "up")}
          />
          <IconButton
            id={buttonId(kind, item.id, "down")}
            variant="secondary"
            label={t("moveDown", { name })}
            icon={<ArrowIcon direction="down" />}
            disabled={isLast}
            onClick={() => onMove(item.id, "down")}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Lo que vera la portada en un celular: los primeros del grupo en dos columnas,
 * como las tarjetas de la tienda. Sigue el orden de la pantalla.
 */
function PhonePreview({
  locale,
  kind,
  items,
}: {
  readonly locale: Locale;
  readonly kind: string;
  readonly items: readonly AdminCatalogOrderItem[];
}) {
  const t = useTranslations("admin.catalogOrder");
  const headingId = `catalog-order-preview-${kind}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-s2">
      <h3 id={headingId} className="text-body-sm font-semibold text-text">
        {t("previewHeading")}
      </h3>
      <p className="text-caption text-text-subtle">
        {kind === "MERCHANDISE" ? t("previewHomeMerch") : t("previewHomePackages")}.{" "}
        {t("previewNote")}
      </p>
      <div className="mx-auto w-full max-w-[18rem] rounded-[1.75rem] border-4 border-border-strong bg-surface-sunken p-s3">
        <ol className="grid grid-cols-2 gap-s2">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-s1 rounded-md bg-surface p-s1">
              <div className="relative aspect-square overflow-hidden rounded-sm bg-surface-raised">
                {item.image_url === null ? null : (
                  // `img` y no `next/image`: una miniatura de vista previa no
                  // merece un dominio declarado ni un tamano calculado.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                )}
                <span className="absolute left-1 top-1 rounded-sm bg-surface/90 px-1 text-overline font-bold tabular-nums text-text">
                  {index + 1}
                </span>
              </div>
              <p className="line-clamp-2 text-overline text-text">
                {pickLocalized(item.name, locale)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Thumbnail({ url }: { readonly url: string | null }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-raised">
      {url === null ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

function ArrowIcon({ direction }: { readonly direction: "up" | "down" | "top" }) {
  const path =
    direction === "up"
      ? "M10 15.5V4.5M5 9.5l5-5 5 5"
      : direction === "down"
        ? "M10 4.5v11M5 10.5l5 5 5-5"
        : "M4 3.75h12M10 16.5V7.5M5.5 12l4.5-4.5 4.5 4.5";
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false" className="h-5 w-5">
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
