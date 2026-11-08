# Correo promocional con Resend: dependencias y diseño (DEC-098, DEC-099)

Estado: **código preparado y apagado.** Nada de lo descrito aquí envía correos ni
importa contactos por sí solo.

## Dependencias antes de activar

Cada puerta está impuesta en el código, no solo escrita aquí.

| #   | Dependencia                                                                     | Quién decide | Dónde se aplica                                                                    |
| --- | ------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| 1   | Texto de la casilla en inglés y español (`LEGAL_PENDING` 33)                    | Abogado      | `MARKETING_EMAIL_CONSENT.legallyApproved`; sin él no arrancan ni casilla ni `live` |
| 2   | Si un cambio de texto obliga a pedir otra vez el permiso (34)                   | Abogado      | Hoy solo cuenta la versión vigente: lo más prudente                                |
| 3   | Contenido obligatorio de cada correo y plazos de la vía gratuita (35, 36)       | Abogado      | Revisión humana de cada broadcast                                                  |
| 4   | Política de Privacidad: correo promocional, baja y medición de clics (37, 42)   | Abogado      | Antes de encender la casilla                                                       |
| 5   | Si se escribe a quien vive en un estado excluido (35)                           | Abogado      | Hoy no se sincroniza a nadie de un estado excluido ni sin estado declarado         |
| 6   | Autorización **escrita** de Resend para correo promocional de un sorteo         | Resend       | `RESEND_PROMOTIONAL_USE.authorizedInWriting`; sin ella `live` no arranca           |
| 7   | Subdominio propio de marketing, verificado en Resend                            | Propietario  | `MARKETING_FROM_ADDRESS` debe estar en otro dominio que el de los códigos          |
| 8   | Clave de API propia de marketing, distinta de la de los códigos                 | Propietario  | El arranque falla si son iguales                                                   |
| 9   | Crear en Resend los dos segmentos y activar el seguimiento de clics             | Propietario  | `RESEND_SEGMENT_*`; sin ellos `live` no arranca                                    |
| 10  | Elegir la edición que fija los estados excluidos                                | Negocio/ESG  | `MARKETING_TARGET_PROMOTION_SLUG`; sin ella o sin Reglas legibles no se sincroniza |
| 11  | Ventana de atribución (días tras el clic; por defecto 7)                        | BISMARK      | `MARKETING_ATTRIBUTION_WINDOW_DAYS`                                                |
| 12  | Crear y encender automatizaciones en Resend                                     | Negocio      | `MARKETING_AUTOMATION_EVENTS_ENABLED`, apagada; además la automatización es manual |
| 13  | Plan de Resend: Marketing Free hasta 1,000 contactos; Transaccional Pro $20/mes | Propietario  | Fuera del código                                                                   |

## Principios

1. **Solo se sincroniza a quien tiene permiso verificable.** La vista
   `marketing_eligible_contacts` es el único origen. Sin evento `GRANTED` vigente
   no hay contacto.
2. **Resend nunca da permiso.** Puede quitarlo (baja, queja, borrado), pero un
   `unsubscribed: false` que llegue de Resend no escribe nada.
3. **El código no puede enviar.** El adaptador solo habla con `/contacts` y, si se
   enciende, `/events/send`. No existen llamadas a `/emails` ni a `/broadcasts`.
4. **Los códigos de acceso no comparten nada con el marketing**: ni clave, ni
   dominio, ni ritmo de peticiones.
5. **Sin datos personales en informes ni en eventos**: no se guardan dirección,
   IP, navegador ni asunto.

## Quién entra

`marketing_eligible_contacts` exige, todo a la vez: último evento `GRANTED`, correo
verificado, participante e identidad activos, sin anonimizar, sin ser personal y
sin supresión. El sincronizador añade dos filtros: versión vigente del texto y
estado declarado que no esté excluido en las Reglas de la edición elegida.

- **`BUYERS`**: algún pedido `CONFIRMED` o `PARTIALLY_REFUNDED` sin contracargo
  abierto o perdido. Los `REFUNDED` (también los anulados) no cuentan.
- **`REGISTERED_NO_PURCHASE`**: el resto.

Al proveedor solo llegan el correo, el idioma y si es comprador. No se envían
nombre, estado ni fecha de nacimiento.

## Cómo funciona

**Sincronizador** (`pnpm --filter @lsw/api marketing:sync`). Una pasada y termina;
no hay ningún cron configurado.

| `MARKETING_SYNC_MODE` | Efecto                                                    |
| --------------------- | --------------------------------------------------------- |
| `off` (por defecto)   | No lee ni escribe nada                                    |
| `dry_run`             | Calcula el plan y devuelve solo cifras; no llama a Resend |
| `live`                | Aplica el plan. Bloqueado hasta cumplir las dependencias  |

Compara lo deseado con `marketing_contact_sync` y aplica primero las salidas. Solo
se da de baja en Resend a quien retiró su permiso; a quien sale por otra causa
(cuenta suspendida, por ejemplo) se le saca del segmento, porque una baja volvería
por webhook como si la hubiera pedido. Antes de cada alta vuelve a comprobar el
permiso. Hace como máximo 2.5 peticiones
por segundo, porque el límite de Resend (10/s) es **de equipo y lo comparten los
códigos de acceso**. Ante un 429 se detiene y sigue en la siguiente pasada.

**Webhook** (`POST /api/v1/webhooks/email/resend`, firma Svix sobre el cuerpo crudo,
tolerancia de 5 minutos). Sin `RESEND_WEBHOOK_SECRET` responde 404. Cada evento se
procesa una sola vez, en una transacción.

| Evento                                  | Efecto                                                      |
| --------------------------------------- | ----------------------------------------------------------- |
| `contact.updated` con baja              | Retirada, origen `UNSUBSCRIBE_LINK`                         |
| `contact.updated` sin baja              | Nada: Resend no da permiso                                  |
| `contact.deleted`                       | Retirada, origen `EMAIL_PROVIDER`                           |
| `email.complained`                      | Retirada y supresión `COMPLAINT`                            |
| `email.bounced` permanente              | Supresión `HARD_BOUNCE`; los temporales no suprimen         |
| `suppression.added`                     | Supresión según origen; una queja también retira el permiso |
| `suppression.removed`                   | Se registra; no levanta la supresión de aquí                |
| Entregas, aperturas y clics de campañas | Se guardan para medir. Los de correos transaccionales no    |

**Atribución.** Sin cookies y sin tocar pedidos ni checkout. Un pedido confirmado se
atribuye a la campaña del último clic de esa persona dentro de la ventana. Exige
tener activado el seguimiento de clics en Resend.

**Estadísticas** (`GET /api/v1/admin/marketing/stats`, capacidad `dashboard.read`):
permisos dados, retirados y sin permiso, audiencia por segmento, supresiones,
bajas y, por campaña, entregas, aperturas y clics únicos, rebotes, quejas, y
pedidos e importe atribuidos. Solo cifras.

**Campañas y automatizaciones.** El broadcast se crea y se envía desde Resend, por
una persona. `PUT /api/v1/admin/marketing/campaigns/:provider_broadcast_id` solo le
pone nombre para los informes. Con las automatizaciones encendidas, el paso de
registrado a comprador emite `lsw.contact.became_buyer`, siempre con `contact_id`:
enviarlo con `email` haría que Resend creara el contacto sin pasar por el permiso.

## Variables

`MARKETING_SYNC_MODE`, `RESEND_MARKETING_API_KEY`, `RESEND_WEBHOOK_SECRET`,
`MARKETING_FROM_ADDRESS`, `RESEND_SEGMENT_BUYERS_ID`, `RESEND_SEGMENT_REGISTERED_ID`,
`MARKETING_TARGET_PROMOTION_SLUG`, `MARKETING_AUTOMATION_EVENTS_ENABLED`,
`MARKETING_ATTRIBUTION_WINDOW_DAYS`.

## Despliegue seguro, por pasos

1. Desplegar con todo apagado, después del sorteo vigente. Comprobar que
   `GET /config` devuelve `optional_consents: []` y que el perfil no cambia.
2. Con el texto aprobado: fijar versión y `legallyApproved`, desplegar y encender
   la casilla. Empieza a haber permisos; nadie recibe nada.
3. Con la autorización de Resend: crear subdominio, clave, segmentos y webhook.
   Configurar el webhook antes de sincronizar.
4. Ejecutar `dry_run` y revisar las cifras.
5. `live` con un lote pequeño. Revisar contactos en Resend.
6. Primer broadcast: borrador, revisión del abogado, envío manual.
7. Solo entonces, automatizaciones.
