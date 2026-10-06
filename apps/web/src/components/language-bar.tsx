import { LanguageSwitcher } from "./language-switcher";

/**
 * Franja de idioma, lo primero de cada pagina (DEC-081).
 *
 * POR QUE UNA FRANJA Y NO LA CABECERA
 * -----------------------------------
 * En telefono la cabecera ya va justa: hamburguesa, marca centrada, cuenta y
 * carrito llenan 360px, y el conmutador vivia escondido dentro del panel de
 * navegacion y al final del pie. Quien llega en el idioma que no es el suyo
 * tenia que adivinar que el cambio estaba detras de la hamburguesa. Arriba del
 * todo, con un globo y la palabra "Idioma", se encuentra sin buscarlo.
 *
 * Es la misma en TODAS las anchuras, para que el sitio del control no cambie
 * al girar el telefono o al pasar a un portatil. Por eso la cabecera de
 * escritorio ya no lleva el suyo: estarian dos iguales a 60px de distancia.
 *
 * NO ES PEGAJOSA. La cabecera si lo es, y dos elementos fijos apilados se
 * comen un tercio de la pantalla de un telefono (el mismo motivo que deja la
 * banda roja de anuncio sin fijar). Mas abajo de la pagina, el idioma sigue en
 * el panel de navegacion y en el pie.
 *
 * Mide 44px: la pastilla de 32px mas su relleno, que es justo el area de
 * pulsacion minima del sistema de diseno.
 */
export function LanguageBar() {
  return (
    <div className="border-b border-border bg-surface">
      <div className="lsw-container flex min-h-touch items-center justify-center py-1.5 sm:justify-end">
        <LanguageSwitcher showLabel />
      </div>
    </div>
  );
}
