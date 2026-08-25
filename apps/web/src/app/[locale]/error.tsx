"use client";

import { Button, ErrorState } from "@lsw/ui";
import { useTranslations } from "next-intl";

/**
 * Frontera de error del segmento de idioma.
 *
 * Es un Client Component porque React lo exige para poder reintentar. El texto
 * sigue saliendo de los diccionarios: `NextIntlClientProvider` esta por encima,
 * en el layout.
 *
 * Deliberadamente NO muestra `error.message`: el mensaje de una excepcion puede
 * arrastrar detalle interno, y el participante no puede hacer nada con el. El
 * identificador util es `error.digest`, que es lo que permite localizar el
 * fallo en los logs del servidor.
 */
export default function LocaleError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("error");
  const tStates = useTranslations("states.loadFailed");

  return (
    <div className="lsw-container py-s16">
      <ErrorState
        headingLevel="h1"
        title={t("title")}
        description={t("body")}
        requestIdLabel={tStates("requestIdLabel")}
        {...(error.digest === undefined ? {} : { requestId: error.digest })}
        action={
          <Button variant="secondary" onClick={reset}>
            {t("retry")}
          </Button>
        }
      />
    </div>
  );
}
