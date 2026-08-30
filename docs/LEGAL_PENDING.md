# Pending Legal Decisions

Este documento registra las decisiones que **corresponden al abogado del
cliente** y que todavía no están resueltas.

## Reglas

1. **Ningún agente inventa respuestas aquí.** `TBD` significa `TBD`.
2. Mientras un punto siga en `TBD`, lo que dependa de él debe implementarse
   como **configuración**, con un valor por defecto explícitamente marcado
   como provisional, nunca como una regla fija en el código.
3. Cuando una decisión llegue, se sustituye `TBD` por la respuesta, se indica
   la fecha y el origen, y si tiene consecuencias arquitectónicas se abre la
   correspondiente entrada en `docs/DECISIONS.md`.
4. Las Official Rules son la fuente autoritativa. Este documento solo refleja
   su estado.
5. Ninguna funcionalidad que dependa de un punto `TBD` se declara terminada.

Formato al resolver un punto:

```text
## Minimum age
RESOLVED — <respuesta>
Date: <fecha>
Source: <Official Rules v.X / correo del abogado / ...>
Impact: <DEC-xxx si aplica>
```

---

## Eligibility

TBD

## Allowed states

TBD

## Minimum age

TBD

## Promotion start/end rules

TBD

## AMOE mechanism

TBD

## Entry limits

TBD

## Multipliers

TBD

## Product eligibility

TBD

## Winner drawing method

TBD

## Third-party administrator requirements

TBD

## Official Rules

TBD

---

# Categorías añadidas en la FASE 1 (2026-08-25)

Estas cinco preguntas **no estaban en la lista original**. Las detectaron los
agentes `backend` y `security` durante la planificación, al descubrir que
afectan al diseño del sistema _antes_ de escribir código. Ver `HO-006` en
`docs/AGENT_HANDOFF.md`.

## Entry expiration

TBD

¿Las Official Rules contemplan que las entries expiren?

**Por qué importa antes de construir:** si expiran, el saldo de un participante
deja de ser una suma pura del ledger y pasa a depender de ventanas temporales.
Eso cambia el diseño del entry ledger y del export al third-party
administrator. Detectado por `backend`; debe resolverse **antes del hito B1**.

## Rounding policy for partial refunds

TBD

Cuando se reembolsa parcialmente una orden, ¿cómo se redondea la cantidad de
entries a revertir? Candidatas: proporcional con `floor`, proporcional con
banker's rounding, o por ítem.

**Por qué importa:** un participante puede perder o conservar una entry según
la política elegida. `backend` señala explícitamente que **no debe elegirla un
ingeniero**: tiene consecuencias legales y la debe aprobar el abogado.

## Record retention and right of erasure

TBD

¿Cuánto tiempo deben conservarse los registros? ¿Cómo se atiende una solicitud
de supresión de datos sin destruir la auditabilidad del sweepstakes?

**Diseño propuesto mientras siga TBD:** la supresión se implementa como
**anonimización del `Participant`** (nulificar campos de PII, conservar
`participant_id` y un `pseudonym_ref`), **nunca** como borrado de filas del
ledger. Así los conteos y la reconciliación histórica sobreviven intactos.
Detectado por `security`.

## Email verification before earning entries

TBD

¿Exigen las Official Rules que un participante verifique su email antes de
poder acumular entries?

**Por qué importa:** condiciona el flujo de registro y el momento en que se
generan las entries de una compra. Se implementa como feature flag, nunca como
supuesto. Detectado por `security`.

## Controlling language of the Official Rules

TBD

¿Qué idioma es el legalmente controlante, y cuál es traducción informativa?

**Por qué importa:** `frontend` necesita campos explícitos
`is_legally_controlling` e `is_informational_translation` por locale. Esa
relación es **texto visible** para el participante, no una suposición del
equipo. El frontend nunca autotraduce texto legal. Detectado por `frontend`.

---

## Nota de proceso

`security` advirtió además de un riesgo de cumplimiento que no es legal sino de
redacción: **el copy del checkout no puede describir la compra como "boletos"
ni como "oportunidades de ganar"**, porque contradice `CLAUDE.md` §1. Pide
revisión de compliance del copy bilingüe **antes** de `INTEGRATE`, en ambos
idiomas — una traducción laxa al español puede crear una representación legal
distinta de la del inglés.

## Entry pool cap for the GMC 2025 promotion

TBD

El cliente ha fijado (2026-08-26, DEC-042) un **universo total de 10,000
participaciones** para la promoción de la camioneta GMC 2025. Debe quedar
reflejado en las Official Rules: cómo se agota el cupo, qué ocurre con una
compra elegible cuando ya no quedan participaciones, y si el cupo convive con
el mecanismo AMOE. Mientras siga TBD, el tope vive como configuración de la
promoción y la interfaz lo muestra como dato, sin urgencia fabricada.

## Prize imagery disclaimer

TBD

La promoción GMC Denali 2025 (DEC-042) muestra una fotografía real del
vehículo entregada por el cliente. El texto alternativo describe lo que se ve
("plateada, vista frontal de tres cuartos") y **no promete nada**. Falta
decidir si las Official Rules exigen un descargo del tipo "la imagen es
ilustrativa y puede no corresponder al vehículo exacto entregado" (color,
equipamiento, año-modelo). Mientras siga TBD, la interfaz no incluye ninguna
afirmación al respecto: añadir un descargo es una afirmación legal y la
redacta el abogado.

## Drawing evidence and TPA delivery (DEC-016 / DEC-017)

TBD

Cinco decisiones que el dominio de sorteo deja preparadas pero **no toma**:

1. **Commit–reveal**: si el sorteo interno debe publicar un compromiso de la
   semilla antes del sorteo y revelarla después. Construido y `DISABLED` por
   defecto. No impide elegir la semilla de mala fe antes de comprometerla;
   evitarlo exige entropía que el operador no controle.
2. **Identidad del third-party administrator** y su esquema de export
   exacto. Hoy: esquema mínimo sin PII y entrega en modo dry-run.
3. **Almacén write-once para el sellado** de la hash chain. Hoy todos los
   informes se entregan declarando `UNSEALED` (DEC-037).
4. **Si el sorteo interno llegará a autorizarse alguna vez.** Sin
   `DrawAuthorization` con referencia documental, la puerta no se abre.
5. **Retención del `DrawingEvent` y del expediente de ganador potencial**, y
   requisitos documentales de verificación de ganador.

## Order qualification point

TBD

¿Una compra elegible genera participaciones al **autorizarse** el pago o al
**capturarse**? (Y, con refunds parciales, ¿desde qué estado se revierten?)
No existe un default que no sea una decisión legal disfrazada, así que
`order_qualification.qualifying_payment_state` en la configuración de la
promoción **no tiene valor por defecto**: el pipeline falla si falta. Hasta
que se decida, ninguna promoción puede otorgar participaciones por compra.

## Visible entry numbers and export universe

TBD

¿Se numeran todas las participaciones aunque no se muestren al participante,
y tienen esos números efecto legal (sorteo por ordinal)? Hoy la exportación
al administrador externo solo puede finalizarse con la numeración visible
encendida, y la política ante reversals es que los lotes más recientes
pierden ordinales (HO-033). Ambas cosas dependen de lo que digan las
Official Rules sobre cómo se identifica una participación en el sorteo.

## Merchandise availability and entry eligibility

TBD

Al publicar `availability` por línea de carrito (HO-017) apareció una pregunta
que **backend no responde**: ¿la disponibilidad de la mercancía afecta a la
elegibilidad de la participación?

Hoy el motor de cálculo cotiza **todas** las líneas del carrito, agotadas o no,
y las Official Rules no dicen nada sobre esto. Los tres casos concretos:

1. Una compra elegible cuya mercancía **no puede entregarse** (agotada entre el
   pago y la preparación del pedido): ¿genera participaciones igualmente?
2. Si el pedido acaba **cancelado por falta de stock**, ¿la reversión usa el
   mismo motivo que un refund o uno propio? (Hoy sería un `REFUND_REVERSAL`, y
   el motivo forma parte del expediente auditable.)
3. ¿Puede una promoción declarar mercancía elegible que **no está a la venta**?

Mientras siga `TBD`, `availability` es **exclusivamente informativa**: no entra
en ninguna aritmética de entries, ni en el carrito ni en el pedido, y ninguna
línea deja de cotizarse por estar agotada. Cambiar eso sería decidir una regla
legal desde el código.

---

# Llegada del primer borrador de Official Rules (2026-08-27)

El cliente entregó **`docs/legal/Sweepstakes Official Rules - DRAFT.docx`**,
redactado por su abogado. Es el primer texto legal real del proyecto.

**Sigue siendo un borrador y conserva marcadores sin rellenar**, así que NADA de
lo que sigue se convierte en código fijo: se registra como parámetro de
configuración de la promoción y se marca `PROVISIONAL — DRAFT` hasta que llegue
una versión final. Regla 1 de este documento intacta: aquí no se inventa nada,
solo se transcribe lo que el borrador dice y se señala lo que NO dice.

## Lo que el borrador SÍ resuelve

| Punto                           | Lo que dice el borrador                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Elegibilidad**                | Residente legal de EE. UU. (50 estados + D.C.), 18+ y con mayoría de edad en su estado. Excluidos empleados, directivos, socios y sus familiares y convivientes. Cribado contra Denied Persons / Entity List (BIS), Specially Designated Nationals (Tesoro) y Table of Denial Orders (Comercio).                                                          |
| **Estados permitidos**          | **VOID en Alaska, Florida, Hawái y Nueva York**, y donde esté prohibido o restringido.                                                                                                                                                                                                                                                                    |
| **Edad mínima**                 | 18 años, y además la mayoría de edad de su estado.                                                                                                                                                                                                                                                                                                        |
| **Entradas por compra**         | **2 participaciones por cada $5.00 completos** del precio pagado, **excluyendo impuestos y envío**.                                                                                                                                                                                                                                                       |
| **Paquetes de participaciones** | Misma tasa: 2 por cada $5.00 completos, impuestos excluidos. El número incluido se declara en la página del paquete.                                                                                                                                                                                                                                      |
| **AMOE**                        | **Solo por correo postal.** Postal o ficha de 3×5 pulgadas, **escrita a mano**, con nombre legal completo, dirección, email, teléfono, fecha de nacimiento y firma. **200 participaciones por ficha válida.** Máximo **5 fichas por participante** y **2 fichas por sobre**. Matasellos dentro del periodo y recepción ≤ 7 días naturales tras el cierre. |
| **Tope por participante**       | **1,000 participaciones**, sea cual sea el método o la combinación de métodos.                                                                                                                                                                                                                                                                            |
| **Multiplicadores**             | Periodos bonus anunciados por el patrocinador, **hasta 10×**, aplicables solo a compra y paquetes. **Nunca al AMOE postal**, que vale 200 siempre. El tope de 1,000 no se mueve durante un bonus.                                                                                                                                                         |
| **Reembolsos y contracargos**   | Las participaciones atribuibles a una compra reembolsada, revertida o con contracargo **quedan anuladas y se cancelan**.                                                                                                                                                                                                                                  |
| **Probabilidades**              | Participaciones del participante ÷ total de participaciones elegibles recibidas.                                                                                                                                                                                                                                                                          |
| **Método de sorteo**            | Sorteo aleatorio realizado por el **Administrador** (tercero) con generador auditado.                                                                                                                                                                                                                                                                     |
| **Registro del sorteo**         | Antes de anunciar: total de participaciones elegibles, participaciones por participante, hora de la selección y ganador. Conservado y disponible a petición escrita.                                                                                                                                                                                      |
| **Suplentes**                   | Tres sorteos alternos; después el premio queda sin adjudicar.                                                                                                                                                                                                                                                                                             |
| **Notificación**                | Email, teléfono y/o SMS en 7 días hábiles. El ganador devuelve declaración jurada, exoneración, cesión de imagen y **W-9** en 5 días naturales.                                                                                                                                                                                                           |
| **Fiscalidad**                  | 1099-MISC si el premio vale $2,000 o más. W-9 obligatorio como condición.                                                                                                                                                                                                                                                                                 |
| **Automatización**              | Participaciones generadas por script, macro o bot: nulas.                                                                                                                                                                                                                                                                                                 |
| **Terminación anticipada**      | El patrocinador puede cancelar por fraude, fallo técnico o fuerza mayor, y puede (sin obligación) sortear entre las participaciones no sospechosas hasta ese momento.                                                                                                                                                                                     |

## Marcadores que el abogado todavía no ha rellenado

Nombre del sweepstakes · dirección del patrocinador · **nombre y dirección del
Administrador** · fecha de inicio y de fin · URL del sitio · **dirección postal
para el AMOE** · año, marca, modelo, versión, **VIN**, millaje y **ARV** del
vehículo · importe de la alternativa en efectivo · **fecha del sorteo** ·
estado y condado para arbitraje · email de contacto.

Sin la fecha de inicio/fin y sin el punto de cualificación de la orden, ninguna
promoción puede otorgar participaciones por compra.

## Cuatro contradicciones con lo ya construido — NO se resuelven aquí

Se registran porque afectan al diseño y **ninguna la decide un ingeniero**.

### 1. El AMOE del borrador es solo postal; el sistema tiene AMOE en línea

El borrador describe **exclusivamente** entrada por correo con ficha manuscrita.
El sistema tiene un flujo de revisión de participaciones gratuitas en línea
(pantalla "Revisión gratuita" del panel, `/admin/amoe-submissions`).

Son dos mecanismos distintos, no dos vistas del mismo. Preguntas para el
abogado: ¿el AMOE en línea desaparece, o convive y hay que añadirlo a las
Official Rules? Si convive, ¿cuántas participaciones vale y con qué límite?

Mientras siga `TBD`, **el AMOE en línea no puede generar participaciones en
producción**: concedería participaciones que las Official Rules no contemplan.

### 2. El tope de 10,000 participaciones (DEC-042) NO aparece en el borrador

DEC-042 fijó un universo total de **10,000 participaciones** para la promoción
de la GMC 2025. El borrador **no menciona ningún tope total**; solo un tope
**por participante** de 1,000, que es otra cosa.

Además, la cláusula de probabilidades ("participaciones del participante ÷
total recibidas") describe un universo **abierto**. Un universo cerrado de
10,000 cambia esa fórmula y exige decir qué pasa con una compra elegible cuando
el cupo se agota.

Mientras siga `TBD`, el tope total sigue siendo configuración de la promoción y
la interfaz lo muestra como dato, sin urgencia fabricada.

### 3. "Entry Package Purchase" y el lenguaje de `CLAUDE.md` §1

La Opción 2 permite **comprar paquetes de participaciones** directamente. La
constitución del proyecto (§1) dice que el producto no es venta de boletos y
que las participaciones son promocionales derivadas de mercancía elegible.

El borrador lo escribió el abogado y manda. Pero el modelo de datos y el copy
bilingüe se construyeron sobre la otra premisa, así que hace falta decidir cómo
se presenta un paquete en la tienda sin que el texto lo convierta en la venta
de una oportunidad de ganar. Es exactamente la revisión de compliance de copy
que `security` ya había pedido en la nota de proceso de arriba.

### 4. El sorteo lo hace el Administrador externo

El borrador atribuye el sorteo al **Administrador**, no al patrocinador. Eso
refuerza el punto 4 de "Drawing evidence and TPA delivery": el sorteo interno
probablemente **no llegue a autorizarse nunca**, y el trabajo real está en la
exportación al tercero. El registro que el borrador exige —total, desglose por
participante, hora, ganador— coincide con lo que produce el export snapshot.

## Puntos de arriba que el borrador NO toca

Siguen `TBD` sin cambios: caducidad de participaciones, redondeo en reembolsos
parciales, retención y derecho de supresión, verificación de email antes de
acumular, idioma legalmente controlante, descargo sobre la imagen del premio,
punto de cualificación de la orden, numeración visible de participaciones y
efecto de la disponibilidad de mercancía sobre la elegibilidad.

El borrador está redactado **solo en inglés**, así que el idioma controlante
sigue sin decidirse formalmente y no hay versión en español que revisar.

---

# Segundo borrador de Official Rules (2026-08-29)

El cliente entregó **`docs/legal/Sweepstakes Official Rules - DRAFT v2 (2026-08-29).docx`**
(nombre original: "Sweeptakes Official Rules - ACTUALIZADO"), acompañado de tres
mensajes con precisiones comerciales. **Sigue siendo un borrador**: el abogado
avisa de que puede haber cambios, "aunque ya no tan drásticos". Todo lo que
sigue queda marcado `PROVISIONAL — DRAFT v2` y vive como configuración de la
`PromotionRulesVersion` (DEC-012), nunca como constante. Regla 1 intacta: aquí
se transcribe, no se inventa.

## Lo que cambia respecto al primer borrador

| Punto                           | Borrador 1 (2026-08-27)              | Borrador 2 (2026-08-29)                                                                                                                                                                             |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tope por participante**       | 1,000                                | **10,000**, por cualquier método o combinación de métodos. Fijo durante los periodos bonus.                                                                                                         |
| **Compra de mercancía (Op. 1)** | 2 por cada $5.00 completos           | **1 participación por cada $1.00 completo** del precio pagado, **impuestos y envío excluidos**. Se aplica automáticamente a la cuenta del comprador, sujeto al tope.                                |
| **Paquetes (Op. 2)**            | 2 por cada $5.00 completos           | **2 participaciones por cada $1.00 completo** del precio del paquete, impuestos excluidos. **El número incluido se declara en la página donde se ofrece el paquete.**                               |
| **AMOE postal (Op. 3)**         | 200 por ficha                        | **2,000 por ficha válida**. Máximo **5 fichas por participante** en todo el periodo; **2 fichas por sobre**. Manuscrita, con nombre legal, dirección, email, teléfono, fecha de nacimiento y firma. |
| **Plazos AMOE**                 | igual                                | Matasellos dentro del periodo; **recepción ≤ 7 días naturales** tras el cierre.                                                                                                                     |
| **Bonus**                       | hasta 10×                            | Igual: hasta **10×** (2X, 5X, 10X) sobre **Opciones 1 y 2**; **nunca** sobre el AMOE postal; el tope de 10,000 no se mueve; **se anuncian en el sitio antes de empezar**.                           |
| **Premio**                      | vehículo con alternativa en efectivo | **Sin alternativa en efectivo**. "Sponsor **will** substitute" si el vehículo no está disponible. No canjeable por dinero.                                                                          |
| **Sorteo**                      | [DRAWING DATE]                       | **14 días naturales tras el cierre** del periodo, por el Administrador, con RNG auditado. Tres sorteos alternos.                                                                                    |
| **Registro del sorteo**         | exigido antes de anunciar            | **La frase desapareció.** El export al administrador (DEC-016) sigue produciendo ese registro.                                                                                                      |
| **Patrocinador**                | [SPONSOR NAME]                       | **Lone Star Winners LLC** (la dirección sigue en marcador).                                                                                                                                         |

## Lo que el cliente añadió por mensaje (no consta en el documento)

- **Paquetes de $10, $20, $50 y $100** → 20, 40, 100 y 200 participaciones. Es
  coherente con la tasa de 2 por $1; el número por paquete NO se escribe en el
  producto, sale de la tasa (DEC-052).
- **Multiplicadores temporales 2X, 5X, 10X con duración concreta** ("5X durante
  las próximas 12 horas"), pensados para incentivar la compra de paquetes en
  momentos puntuales.
- **Catálogo inicial**: llavero/holder para AirTag; llavero con soporte para
  teléfono; power bank portátil; libreta con pluma; luz LED manos libres de
  cuello; termos; gorras premium (≈5 modelos × 5 colores, imagen pendiente).
- **Confirmación explícita**: el 10,000 es **por persona**, y una persona que
  solo use el método gratuito puede alcanzar el mismo máximo (5 × 2,000).

## Consecuencias sobre las cuatro contradicciones del primer borrador

1. **AMOE en línea vs postal.** El borrador 2 sigue siendo **solo postal**. Se
   configura la modalidad `MAIL_IN_REVIEW`; el formulario en línea existe en el
   código pero **no se enciende** (la vía la gobiernan `amoe_enabled` +
   `amoe_mode`). Provisionalmente resuelto.
2. **Universo total de 10,000 (DEC-042).** **No existe.** El 10,000 es el tope
   **por participante**. El concepto `entry_pool` (tope total, "emitidas") se
   retira de la interfaz y del contrato (DEC-052 supersede esa parte de
   DEC-042). Lo que se muestra es "máximo 10,000 participaciones por persona",
   como dato de las Reglas.
3. **Paquetes vs `CLAUDE.md` §1.** El abogado los incluye expresamente como
   "Entry Package Purchase". Se modelan como productos del catálogo de tipo
   `ENTRY_PACKAGE`, con tasa propia en la versión de reglas (DEC-052). El
   producto **sigue sin ser una rifa**: lo que se vende es un paquete definido
   por las Official Rules, con AMOE gratuito equivalente. `CLAUDE.md` §1
   necesita una enmienda de una frase que solo el usuario / Team Lead puede
   escribir (`docs/TASK_OWNERSHIP.md`, archivos reservados); se propone en el
   cierre de esta ronda.
4. **Sorteo por el Administrador.** Sin cambios.

## Puntos que el borrador 2 resuelve (todos `PROVISIONAL — DRAFT v2`)

```text
## Entry limits
RESOLVED (provisional) — 10,000 por participante, cualquier método o combinación;
per_order_max sin declarar (null = sin tope por pedido).
Date: 2026-08-29 · Source: Official Rules DRAFT v2 §4 "Entry Limits" + mensaje del cliente
Impact: DEC-052 (el tope se aplica también a la concesión AMOE)

## Multipliers
RESOLVED (provisional) — hasta 10× (2X, 5X, 10X), sobre Opciones 1 y 2, nunca AMOE;
anunciados en el sitio antes de empezar; el tope no se mueve.
Date: 2026-08-29 · Source: DRAFT v2 §4 "Bonus Entry Periods" + mensaje del cliente
Impact: DEC-052 (`product_kind_scope`), DEC-054 (atajo "periodo bonus")

## AMOE mechanism
RESOLVED (provisional) — postal (MAIL_IN_REVIEW): 2,000 por ficha válida, 5 fichas
por participante en el periodo, 2 por sobre, datos obligatorios de la ficha, matasellos
en periodo y recepción ≤ 7 días tras el cierre.
Date: 2026-08-29 · Source: DRAFT v2 §4 "Option 3"
Impact: DEC-052 (tope en la concesión), DEC-054 (transcripción de fichas desde el panel)

## Purchase entry formula
RESOLVED (provisional) — mercancía: 1 por cada $1.00 completo; paquetes: 2 por cada
$1.00 completo; impuestos y envío excluidos; "completo" = redondeo hacia abajo (FLOOR)
sobre el subtotal elegible del pedido.
Date: 2026-08-29 · Source: DRAFT v2 §4 Opciones 1 y 2
Impact: DEC-052 (modo ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND)

## Allowed states
RESOLVED (provisional) — void en Alaska, Florida, Hawái y Nueva York.
Date: 2026-08-29 · Source: DRAFT v2 §1 · Impact: puerta por estado PENDIENTE DE CONSTRUIR (abajo)

## Minimum age
RESOLVED (provisional) — 18 años y mayoría de edad del estado de residencia.
Date: 2026-08-29 · Source: DRAFT v2 §1 · Impact: puerta de edad PENDIENTE DE CONSTRUIR (abajo)

## Winner drawing method
RESOLVED (provisional) — sorteo aleatorio por el Administrador (tercero), 14 días tras el
cierre, RNG auditado; 3 sorteos alternos.
Date: 2026-08-29 · Source: DRAFT v2 §7 · Impact: refuerza DEC-016/DEC-017 (sorteo interno no se autoriza)
```

## Preguntas nuevas para el abogado

1. **Tope y compras.** Cuando una compra haría superar las 10,000, el sistema
   otorga solo hasta el tope (el "espacio" que queda) y la venta se completa.
   ¿Es correcto, o debe impedirse vender un paquete que ya no puede generar
   participaciones? Mismo criterio para una ficha postal que supere el tope:
   se concede lo que quepa y se registra el recorte.
2. **Bonus sobre mercancía.** El texto dice Opciones 1 y 2; el cliente habla
   de paquetes. El sistema permite acotar cada bonus (solo paquetes, solo
   mercancía o ambos). ¿Conviene que el texto lo diga?
3. **"Complete $1.00".** Se redondea hacia abajo **una sola vez** sobre el
   subtotal elegible del pedido (impuestos y envío fuera), no línea a línea.
   ¿Correcto? (Con paquetes de precio entero el resultado es el mismo; con
   mercancía de centavos, no.)
4. **Devoluciones parciales.** Sigue TBD cómo se prorratea el reverso.
5. **Paquetes, impuestos y envío.** Un paquete no se envía. ¿Lleva impuesto? El
   motor excluye impuestos y envío del cálculo en los dos casos.
6. **Ficha postal.** Qué debe registrar quien transcribe (fecha de matasellos,
   referencia del sobre, cuántas fichas venían) y qué pasa con la tercera ficha
   de un sobre: ¿nula solo ella o todo el sobre?
7. **Persona sin cuenta que envía fichas.** El sistema crea un participante con
   el email de la ficha (sin contraseña) para poder asignarle las
   participaciones. ¿Requiere verificación adicional?
8. **Anuncio de bonus.** El sitio publica los periodos bonus antes de que
   empiecen (página de la promoción y portada). ¿Es suficiente?
9. **Registro del sorteo.** La frase sobre conservar el registro desapareció
   en el borrador 2; el export lo sigue produciendo. ¿Intencionado?
10. **Estrategia ante bonus solapados.** El sistema exige declararla
    (`HIGHEST_WINS`, `STACK`, `EXCLUSIVE`, `PRIORITY_ORDER`). Provisionalmente
    `HIGHEST_WINS` (gana el mayor, no se acumulan). ¿Correcto?
11. **Marcadores sin rellenar**: nombre del sweepstakes, dirección del
    patrocinador, Administrador y su dirección, fechas de inicio y fin, URL,
    **dirección postal del AMOE**, año/marca/modelo/versión/VIN/millaje/ARV,
    estado y condado de arbitraje, email de contacto.

## Lo que sigue TBD

Caducidad de participaciones, prorrateo de reembolsos parciales, retención y
supresión, verificación de email antes de acumular, **idioma controlante** (el
borrador 2 sigue solo en inglés), descargo sobre la imagen del premio, **punto
de cualificación de la orden** (autorización vs captura), numeración visible,
efecto de la disponibilidad de mercancía. Mientras cualquiera de las claves
requeridas de DEC-012 siga TBD, **la promoción no puede activarse**; hoy lo
siguen: `partial_refund_rounding_policy`, `entry_expiration`,
`official_rules_document`, `controlling_language`.

## Puertas de cumplimiento pendientes de construir (fuera de esta ronda)

- **Puerta por estado** (AK, FL, HI, NY) en registro y checkout:
  `state_eligibility_enforcement_enabled` + `allowed_jurisdictions`. Hoy no
  existe ni el campo de estado en el perfil.
- **Puerta de edad** (`age_gate_enabled`): hoy no se pide fecha de nacimiento
  al registrarse.
- **Cribado BIS / SDN / TDO**: no existe; probablemente sea tarea del
  Administrador al verificar al ganador, no de la plataforma. Preguntar.

## Preguntas añadidas durante la implementación (2026-08-29, HO-041)

12. **Zona horaria de un periodo bonus.** El panel pide inicio y fin como
    instantes absolutos (UTC) y el sitio los anuncia convertidos a la zona
    legal de la promoción. Si el abogado prefiere que las Reglas expresen los
    bonus en hora de pared de la zona legal ("de 12:00 a 24:00 hora central"),
    hay que decidir qué pasa con un periodo que cruza un cambio de horario.
13. **Tope anunciado con `entry_caps_enabled` apagado.** El escaparate solo
    anuncia "máximo 10,000 por persona" cuando el tope está en vigor; con el
    flag apagado no lo dice aunque la versión de reglas lo declare. Confirmar
    que el flag debe estar encendido desde el primer día de la promoción.
