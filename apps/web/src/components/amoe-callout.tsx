import { buttonVariants, Card, CardTitle } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { AmoeMode } from "@/lib/api";

/**
 * Aviso de la via gratuita de participacion.
 *
 * QUE GOBIERNA QUE
 * ----------------
 * - `amoe_enabled` gobierna si la funcion EXISTE. Apagado, este componente no
 *   renderiza NADA: ni un hueco, ni un "proximamente". Anunciar un metodo
 *   gratuito que no esta configurado seria afirmar algo sobre las condiciones
 *   de participacion, que es materia del abogado del cliente (CLAUDE.md #1).
 *   Ocultar es aqui el estado deliberado, no una omision.
 * - `amoe_mode` gobierna QUE se renderiza. Por eso DEC-032 lo hace enum y no
 *   booleano: las cuatro modalidades no comparten pantalla ni instrucciones.
 *
 * EL CASO INTERMEDIO EXISTE Y ESTA CUBIERTO
 * -----------------------------------------
 * El flag encendido con `amoe_mode` a `null` es un estado real: alguien
 * enciende la funcion antes de que se publique la modalidad. La interfaz dice
 * que la via existe y que los detalles no estan publicados. No elige una
 * modalidad por su cuenta, porque elegir seria inventarse el procedimiento.
 *
 * NINGUNA INSTRUCCION CONCRETA VIVE AQUI
 * --------------------------------------
 * Ni direccion postal, ni formato de sobre, ni limites, ni plazos. Todo eso
 * son Official Rules. Este componente dice que la via existe y remite al
 * documento.
 */
export function AmoeCallout({
  enabled,
  mode,
  className,
}: {
  /** Valor de `amoe_enabled`, leido en servidor (DEC-013). */
  readonly enabled: boolean;
  readonly mode: AmoeMode | null;
  readonly className?: string;
}) {
  const t = useTranslations("amoe");

  if (!enabled) return null;

  /**
   * `switch` exhaustivo sobre el enum de DEC-032.
   *
   * Vive dentro del componente para cerrar sobre `t` con su tipo real: las
   * claves de traduccion son una union cerrada (`src/global.d.ts`), y pasar el
   * traductor a una funcion suelta obligaria a ensancharlo a `string`, que es
   * justo la comprobacion que interesa conservar.
   *
   * Si el backend anadiera una quinta modalidad, esto deja de compilar en vez
   * de renderizar un hueco donde deberia ir el unico metodo de participacion
   * que no exige comprar nada.
   */
  const modeText = (): string => {
    if (mode === null) return t("modeNotPublished");

    switch (mode) {
      case "ONLINE_FORM":
        return t("ONLINE_FORM");
      case "MAIL_IN_REVIEW":
        return t("MAIL_IN_REVIEW");
      case "CODE":
        return t("CODE");
      case "EXTERNAL_INSTRUCTIONS":
        return t("EXTERNAL_INSTRUCTIONS");
    }
  };

  return (
    <Card
      as="section"
      elevation="flat"
      padding="md"
      {...(className === undefined ? {} : { className })}
    >
      <CardTitle as="h2" size="sm">
        {t("heading")}
      </CardTitle>

      <p className="mt-s3 text-body-md text-text-muted">{modeText()}</p>

      {/*
       * El enlace a la pagina completa vive DENTRO del bloque que ya esta detras
       * de `amoe_enabled`: si la via no existe, no existe ni el aviso ni el
       * enlace. Un enlace a `/amoe` fuera de esta guarda llevaria al estado
       * "esta promocion no ofrece via gratuita", que en la portada leeria como
       * una promesa incumplida en vez de como una funcion desactivada.
       */}
      <div className="mt-s4">
        <Link href="/amoe" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {t("learnMore")}
        </Link>
      </div>
    </Card>
  );
}
