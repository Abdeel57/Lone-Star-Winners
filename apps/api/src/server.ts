/**
 * Punto de entrada del proceso.
 *
 * Responsabilidades, en este orden: validar el entorno, arrancar, y apagarse
 * limpiamente. Nada mas. Toda la logica esta en `app.ts` para que los tests
 * puedan construir la aplicacion sin abrir un puerto.
 */

import { EnvironmentValidationError, loadConfig } from "./config/env.js";
import { createApp, createDependencies } from "./app.js";

async function main(): Promise<void> {
  let config;

  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      // El fallo se imprime sin el logger: el logger se configura a partir de
      // la configuracion que acaba de fallar.
      console.error("[lsw-api] no arranca: la configuracion de entorno es invalida.");
      for (const issue of error.issues) {
        console.error(`  - ${issue}`);
      }
      console.error("[lsw-api] revisa .env.example. DEC-018: el entorno se valida en el arranque.");
      process.exit(1);
    }
    throw error;
  }

  const dependencies = createDependencies(config);
  const app = await createApp(dependencies);

  const shutdown = (signal: string): void => {
    app.log.info({ event: "server.shutdown", signal }, "cerrando");
    void (async () => {
      try {
        await app.close();
        await dependencies.database.close();
        process.exit(0);
      } catch (error) {
        app.log.error({ event: "server.shutdown.failed", err: error }, "cierre con errores");
        process.exit(1);
      }
    })();
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  await app.listen({ host: config.http.host, port: config.http.port });

  app.log.info(
    {
      event: "server.started",
      port: config.http.port,
      payment_provider: config.commerce.paymentProvider,
      openapi_over_http: config.exposeOpenApiOverHttp,
    },
    "lsw-api escuchando",
  );
}

main().catch((error: unknown) => {
  console.error("[lsw-api] fallo irrecuperable en el arranque:", error);
  process.exit(1);
});
