/**
 * `@lsw/security` - controles de seguridad transversales de Lone Star Winners.
 *
 * Contenido de este paquete:
 *   - roles y capacidades como DATOS (`roles.ts`, `capabilities.ts`);
 *   - feature flags como DATOS, con sus defaults (`flags.ts`, DEC-032);
 *   - autorizacion deny-by-default y separacion de funciones (`permissions.ts`);
 *   - politica de sesion, MFA, step-up y rate limiting (`session.ts`, DEC-006);
 *   - la regla de lint propia de `HO-014` (`lint/`), que se declara aqui y se
 *     conecta desde `eslint.config.mjs`, propiedad de `backend`;
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
export * from "./flags.js";
export * from "./capabilities.js";
export * from "./permissions.js";
export * from "./session.js";
export * from "./lint/no-unraw-regexp-source.js";
export * from "./env/index.js";
