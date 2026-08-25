/**
 * `@lsw/security` - controles de seguridad transversales de Lone Star Winners.
 *
 * Contenido de este paquete:
 *   - roles y capacidades como DATOS (`roles.ts`, `capabilities.ts`);
 *   - autorizacion deny-by-default y separacion de funciones (`permissions.ts`);
 *   - esquema de entorno validado en el arranque (`env/`).
 *
 * Lo que este paquete NO hace, y no debe hacer:
 *   - decidir reglas legales: las fija el abogado del cliente y viven en
 *     `PromotionRulesVersion` (DEC-012);
 *   - implementar sorteos: eso es `packages/tpa` mas los cinco cerrojos de
 *     DEC-017, y sigue desactivado;
 *   - hablar con la base de datos: es una libreria de decision, sin estado.
 */

export * from "./roles.js";
export * from "./capabilities.js";
export * from "./permissions.js";
export * from "./env/index.js";
