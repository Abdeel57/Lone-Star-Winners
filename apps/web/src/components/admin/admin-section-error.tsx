import { EmptyState, type HeadingLevel } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { ApiErrorState } from "@/components/api-error-state";
import type { ApiFailure } from "@/lib/api";

/**
 * Un fallo de lectura del panel, separando DOS cosas que no son la misma.
 *
 * EL PROBLEMA
 * -----------
 * El panel llama a rutas de administracion que el backend todavia no sirve
 * (HO-034 punto 5): unas estan en construccion ahora mismo y otras las trae otra
 * sesion. Mientras no existen, la API responde 404 y la pantalla pintaba
 * "no hemos podido cargar esta seccion", con su identificador de peticion, como
 * si algo se hubiera roto.
 *
 * Eso manda a quien opera a hacer lo que no debe: reintentar, abrir un ticket,
 * llamar a soporte. No hay nada averiado; esa parte del sistema aun no existe, y
 * decirlo cuesta lo mismo que no decirlo.
 *
 * COMO SE DISTINGUEN, SIN ADIVINAR
 * --------------------------------
 * No hace falta ninguna heuristica: la distincion ya esta en el contrato.
 * `apps/api/src/http/errors.ts` lo dice literalmente -"un `NOT_FOUND` generico
 * obligaria al frontend a mirar la url"- y por eso CADA 404 de dominio tiene su
 * propio codigo: `ORDER_NOT_FOUND`, `PROMOTION_NOT_FOUND`,
 * `PRODUCT_NOT_FOUND`, `RULES_VERSION_NOT_FOUND`, `CART_ITEM_NOT_FOUND`.
 *
 * El `NOT_FOUND` pelado solo lo emite el manejador de ruta no encontrada de
 * Fastify (`app.setNotFoundHandler`). Es decir: **404 + `NOT_FOUND` significa
 * exactamente "esa ruta no esta montada"**, y nunca "ese recurso no existe".
 *
 * El dia que el endpoint exista, este estado desaparece solo. No hay ninguna
 * lista de rutas pendientes que alguien tenga que acordarse de actualizar, que
 * es justo lo que envejeceria mal.
 */
export function isSectionNotConnected(failure: ApiFailure): boolean {
  return failure.kind === "http" && failure.status === 404 && failure.code === "NOT_FOUND";
}

export function AdminSectionError({
  failure,
  headingLevel,
}: {
  readonly failure: ApiFailure;
  readonly headingLevel?: HeadingLevel;
}) {
  const t = useTranslations("admin.notConnected");

  if (!isSectionNotConnected(failure)) {
    return (
      <ApiErrorState failure={failure} {...(headingLevel === undefined ? {} : { headingLevel })} />
    );
  }

  return (
    <EmptyState
      {...(headingLevel === undefined ? {} : { headingLevel })}
      title={t("title")}
      description={t("body")}
    />
  );
}
