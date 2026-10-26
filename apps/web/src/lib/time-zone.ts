/**
 * Zona horaria OPERATIVA del negocio (DEC-095): Nuevo Mexico, con su horario
 * de verano.
 *
 * DOS CLASES DE INSTANTE, DOS ZONAS
 * ---------------------------------
 * DEC-011 manda que los instantes LEGALES -apertura y cierre de una promocion,
 * vigencia de una version de reglas, plazos de la via gratuita- se formateen
 * contra `promotion.legal_timezone`, la zona que declaran las Official Rules.
 * Eso no cambia.
 *
 * Los instantes OPERATIVOS -cuando se hizo un pedido, se cobro, se envio o se
 * anulo; el corte de caja; la traza de auditoria; cuando se dio de alta un
 * participante- no tienen zona legal propia y hasta DEC-095 se formateaban en
 * UTC "como zona neutra". Para quien atiende el mostrador en Nuevo Mexico no
 * era neutra: una venta de las 7 de la tarde aparecia como "manana a la 1 de
 * la madrugada", y el corte de caja -que SI se calculaba en esta zona- no
 * cuadraba con lo que la pantalla del pedido decia. Desde DEC-095 todos esos
 * instantes se formatean aqui.
 *
 * Es la MISMA zona que usa la API para el corte (`DAILY_CUT_TIME_ZONE` en
 * `apps/api/src/services/daily-cut.ts`); `DAILY_CUT_TIME_ZONE` de la web es un
 * alias de esta constante para que no puedan divergir.
 *
 * Sigue siendo EXPLICITA en cada llamada (DEC-011 prohibe la zona del servidor
 * o la del navegador como fuente de verdad): lo que cambia es el valor, no la
 * regla.
 */
export const BUSINESS_TIME_ZONE = "America/Denver";
