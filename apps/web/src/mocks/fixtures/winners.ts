import type { PublishedWinner } from "@/components/winners-showcase";

/**
 * Fixtures de ganadores publicados.
 *
 * NO CORRESPONDEN A NINGUNA RUTA DE API. `docs/API_CONTRACT.md` no publica hoy
 * ninguna ruta de ganadores -el dominio `winner.*` esta reservado a `backend` y
 * `security`-, asi que estos objetos no se sirven desde ningun handler de MSW y
 * la portada no los pide: existen para poder PROBAR la pantalla que los
 * mostrara, que es distinto de fingir que el dato ya llega.
 *
 * Todo lo que hay aqui es un nombre de pila mas inicial y una ciudad, que es lo
 * maximo que una version de reglas suele autorizar publicar. Que se puede
 * publicar de verdad de un ganador lo decide el abogado del cliente
 * (CLAUDE.md #1 y #2); estos valores son de ejemplo y no una plantilla.
 */
export const publishedWinners: readonly PublishedWinner[] = [
  {
    id: "win_0000000000000001",
    display_name: "Marisol R.",
    location: "El Paso, TX",
    promotion_title: {
      "en-US": "The Harvest Haul Sweepstakes",
      "es-US": "Sorteo promocional Harvest Haul",
    },
    promotion_slug: "harvest-haul-2024",
  },
  {
    id: "win_0000000000000002",
    display_name: "Dwayne T.",
    // Sin ubicacion: no toda version de reglas autoriza publicarla, y la
    // tarjeta tiene que verse igual de terminada sin ella.
    location: null,
    promotion_title: {
      "en-US": "The Front Porch Sweepstakes",
      "es-US": "Sorteo promocional Front Porch",
    },
    promotion_slug: "front-porch-2024",
  },
];
