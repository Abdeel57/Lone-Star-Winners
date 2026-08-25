# THREAT_MODEL.md

Modelo de amenazas de **Lone Star Winners**.

Propietario: agente `security-integration` (DEC-024).
Version: 1 (hito S1). Se revisa en cada hito y **antes de activar cualquier
promocion**.

Metodo: identificacion de activos, fronteras de confianza y amenazas por
frontera, con la mitigacion y su estado real. Se usa STRIDE como lista de
comprobacion, no como estructura: lo que ordena este documento es el dano.

Estados posibles de una mitigacion:

```text
IMPLEMENTADA   existe y se verifica automaticamente
PARCIAL        existe la decision y parte del control; falta implementacion
PLANIFICADA    decidida, sin implementar; depende de otro hito
ABIERTA        sin mitigacion acordada
```

---

## 1. Activos

```text
A1  Entry ledger              origen, momento, causa y estado de cada entry
A2  Traza de auditoria        quien hizo que, cuando y por que
A3  Export snapshots          la evidencia que ve un tercero
A4  PII de participantes      nombre, correo, direccion, futuros documentos
A5  Credenciales y sesiones   acceso al sistema
A6  Configuracion legal       PromotionRulesVersion y feature flags
A7  Dinero                    pedidos, pagos, refunds, chargebacks
A8  Clave de firma de export  fuera del repositorio y del .env
```

## 2. Actores

```text
Participante legitimo     cuenta propia, acceso publico
Participante abusivo      multicuenta, automatizacion de AMOE, fraude de pago
Personal interno          SUPPORT, PROMOTION_MANAGER, COMPLIANCE_OFFICER,
                          DRAW_OFFICER, EXPORT_OFFICER, SECURITY_ADMIN
Atacante externo          sin credenciales
Atacante con credenciales cuenta de personal comprometida
Proveedor externo         pagos, email, almacenamiento, administrador de
                          sweepstakes
Insider con acceso a BD   el escenario que mas gente omite del modelo
```

## 3. Fronteras de confianza

```text
   navegador
      |  (1) HTTPS publico, cookie httpOnly
      v
   apps/web (Next.js)
      |  (2) HTTP servidor a servidor
      v
   apps/api (Fastify)  <---- (3) webhooks de pago (entrada no confiable)
      |
      |  (4) roles de base de datos diferenciados
      v
   PostgreSQL          ----> (5) almacen write-once de sellado y exports
                       ----> (6) entrega al third-party administrator
```

Cada numero es un punto donde el nivel de confianza cambia. Las amenazas de la
seccion 4 estan agrupadas por el activo que ponen en riesgo, con la frontera
indicada.

---

## 4. Amenazas

### T-01 — Entries duplicadas por webhook reintentado

Frontera 3. Es el fallo con mayor coste reputacional posible en un sweepstakes,
y el mas facil de provocar sin mala intencion: los proveedores de pago
reintentan por diseno.

Mitigacion: `UNIQUE (provider, provider_event_id)` persistido **antes** de
procesar, y `UNIQUE (promotion_id, source_type, source_ref)` sobre todo award.
Un duplicado debe fallar como error de restriccion, nunca como un `if`
(DEC-009).

Estado: PLANIFICADA (depende de `packages/database`).

### T-02 — Webhook falsificado

Frontera 3. Sin verificacion de firma, un tercero fabrica eventos de pago y,
con ellos, entries. Requiere cuerpo crudo, motivo por el que la API es un
proceso Fastify separado (DEC-004).

Mitigacion: verificacion de firma con tolerancia de reloj acotada; evento
persistido antes de procesarse; rechazo auditado.

Estado: PLANIFICADA. **Bloquea produccion** (DEC-018).

### T-03 — Borrado o edicion de entries

Frontera 4. El atajo natural de cualquier ORM para un refund es `UPDATE` o
`DELETE`, y seria una violacion irreversible del principio #6.

Mitigacion en tres capas independientes: `REVOKE UPDATE, DELETE` al rol `app`;
triggers `BEFORE UPDATE OR DELETE` que lanzan excepcion; y test de invariante
que **intenta activamente** ambas operaciones y exige que fallen (DEC-007).

Estado: PARCIAL (decidida; el test existe como gate pendiente).

### T-04 — Reescritura coherente del historico

Insider con acceso total a la base de datos. Append-only detecta el borrado,
pero no la reescritura completa y coherente: si alguien recalcula todos los
hashes, la cadena vuelve a cuadrar.

Mitigacion: hash chain por promocion **mas** sellado diario del
`chain_head_hash` en un almacen externo write-once, fuera del alcance del rol
`app` (DEC-008). Sin ese anclaje externo, la hash chain es decorativa frente a
este actor concreto.

Estado: PARCIAL (DEC-008 aceptada; implementacion depende del ledger).

### T-05 — Manipulacion del sorteo

Personal interno. Cinco vectores: activar el modulo sin autorizacion, sortear
sobre datos en vivo, elegir la semilla a posteriori, repetir el sorteo hasta
obtener el resultado deseado, o acumular los dos roles implicados.

Mitigacion: los cinco cerrojos de DEC-017 (flag apagado por defecto,
`DrawAuthorization` viva con referencia documental, separacion de funciones,
snapshot `FINALIZED` con hash recalculado en el momento, CSPRNG con rechazo de
muestreo) y registro inmutable de cada sorteo, incluidos los que no producen
ganador. La propuesta _commit-reveal_ sigue sobre la mesa y requiere decision
del cliente.

Estado: PARCIAL. Cerrojos 1 y 3 verificados por test hoy; el resto llega con el
modulo, que sigue sin autorizar.

### T-06 — Robo del export

Fronteras 5 y 6. Un export contiene el universo de entries y datos personales:
es el objetivo mas valioso del sistema en un unico fichero.

Mitigacion: control de acceso por capacidad, step-up auth, enlaces de vida
corta, cifrado en transito y en reposo, almacenamiento no publico, registro de
**cada acceso** y firma desprendida. Nunca como adjunto de correo ordinario.

Estado: PARCIAL (capacidades y step-up existen; la entrega no).

### T-07 — Export alterado despues de finalizar

Frontera 5. Si un snapshot finalizado se puede sobrescribir, su hash deja de
significar nada.

Mitigacion: inmutabilidad tras finalizar; una correccion es una version nueva
que referencia la anterior con motivo; Merkle root que permite al administrador
externo verificar un registro concreto sin recibir todo el fichero y detecta
reordenacion (DEC-016).

Estado: PLANIFICADA.

### T-08 — Snapshot no reproducible

Frontera 5. Si regenerar el mismo corte produce bytes distintos, un tercero no
puede verificar nada. Causas reales y aburridas: finales de linea segun el
sistema operativo, orden de filas no determinista, formato numerico dependiente
de locale, un `generated_at` dentro de las filas de datos.

Mitigacion: `.gitattributes` con `eol=lf` (DEC-026), gate de CRLF en CI, orden
fijo, UTF-8 sin BOM, ISO-8601 UTC y marcas de tiempo solo en el manifiesto.

Estado: PARCIAL (la parte de repositorio esta IMPLEMENTADA; el generador no
existe).

### T-09 — Toma de control de una cuenta administrativa

Fronteras 1 y 2. Una cuenta de personal comprometida es el camino mas corto a
casi todo lo demas.

Mitigacion: MFA/TOTP obligatorio en todo rol administrativo, sesiones opacas y
revocables con TTL y timeout de inactividad mas cortos, step-up para
operaciones sensibles, deny-by-default y separacion de funciones para acotar el
dano de una sola cuenta.

Estado: PARCIAL (matriz y step-up IMPLEMENTADOS como decision y como codigo de
decision; la implementacion de sesion es de `backend`).

### T-10 — Escalada de privilegios por autorizacion en el cliente

Frontera 2. Ocultar un boton no es autorizacion. El fallo clasico es un
endpoint administrativo que solo esta protegido porque la interfaz no lo
muestra.

Mitigacion: registro central de rutas deny-by-default; una ruta sin permiso
declarado **no arranca**; test de contrato que compara las rutas reales con
`docs/API_CONTRACT.md` y falla si divergen (DEC-015).

Estado: PARCIAL (el vocabulario de capacidades existe; el registro de rutas es
de `backend` y el test de contrato es un gate pendiente).

### T-11 — Auto-concesion de permisos

Personal interno con `rbac.role.assign`. Quien puede asignar roles puede
asignarse el que quiera.

Mitigacion: segunda aprobacion, step-up, motivo obligatorio y auditoria del
cambio de rol; y `SECURITY_ADMIN` deliberadamente sin capacidades operativas,
de modo que auto-concederse una deja rastro explicito en la auditoria.

Estado: IMPLEMENTADA como politica; su cumplimiento depende del backend.

### T-12 — Un participante lee el ledger de otro

Frontera 1. Referencia directa a objeto insegura: cambiar un identificador en
la URL.

Mitigacion: capacidades con sufijo `.self`, que nunca autorizan sobre datos
ajenos; y test de invariante especifico cuando exista el endpoint.

Estado: PARCIAL.

### T-13 — Fuga de PII por sobre-exportacion

Frontera 6. Exportar "todo por si acaso" es la forma mas comun de convertir un
incidente menor en uno grave.

Mitigacion: esquema de export definido por lo que el administrador exige, con
`containsPii` explicito; version de esquema registrada en cada entrega;
`pii.view.full` y `pii.export` con step-up, motivo y, la segunda, doble
aprobacion.

Estado: PARCIAL.

### T-14 — Abuso de la via AMOE

Participante abusivo. Automatizacion, multicuenta o envio masivo.

Restriccion importante: los controles **no pueden** desfavorecer ilegalmente al
participante sin compra. Se limita el abuso tecnico, nunca el derecho que
concedan las Official Rules.

Mitigacion: rate limiting, deteccion de duplicados, normalizacion de identidad,
cola de revision con motivo obligatorio y conservacion del historico de todo
rechazo. La cuantia y el metodo los fija el abogado; el software los aplica.

Estado: PLANIFICADA. Depende de `docs/LEGAL_PENDING.md`.

### T-15 — Deadline evaluado en la zona horaria equivocada

Un cierre evaluado con la zona del navegador o del servidor admite o rechaza
entries incorrectamente, con consecuencia legal directa.

Mitigacion: `timestamptz` en UTC, `promotion.legal_timezone` IANA explicita y
evaluacion **en el servidor** (DEC-011). Distincion entre `occurred_at` y
`recorded_at`.

Estado: PARCIAL (decidida; `TZ=UTC` ya declarado y validado en el entorno).

### T-16 — Cambio silencioso de un flag legalmente material

Personal interno. Activar AMOE, publicar un ganador o habilitar el sorteo sin
dejar constancia de quien lo decidio.

Mitigacion: flags persistidos en base de datos, apagados por defecto, con
motivo obligatorio y auditoria; prohibido leerlos de variables de entorno, y
muy especialmente de `NEXT_PUBLIC_*`. El gate de CI falla si aparece un flag
con pinta de legalmente material en el entorno del navegador (DEC-013).

Estado: IMPLEMENTADA en la parte de entorno; el resto depende del backend.

### T-17 — Secreto commiteado

Cualquier frontera. Es el incidente mas frecuente de todos, y casi siempre por
accidente.

Mitigacion: `gitleaks` en pre-commit y sobre el historial completo en CI;
comprobacion de `.env` trackeado y de material criptografico; analisis de
`.env.example` en busca de valores con pinta de reales.

Estado: IMPLEMENTADA en CI. El hook requiere activacion manual (HO-008).

### T-18 — Dependencia comprometida

Cadena de suministro. `packages/security` decide quien puede hacer que, asi que
cada dependencia suya es superficie de ataque: por eso no tiene ninguna en
tiempo de ejecucion.

Mitigacion: `osv-scanner` en CI y semanal, lockfile congelado, y minimizacion
deliberada de dependencias en los paquetes de seguridad.

Estado: IMPLEMENTADA (el escaner se salta mientras no exista lockfile).

### T-19 — Perdida de datos sin restauracion probada

Disponibilidad e integridad. Una copia de seguridad que nunca se ha restaurado
no es una copia de seguridad: es una suposicion.

Mitigacion: copias cifradas, retencion configurable y **procedimiento de
restauracion probado**. RPO y RTO son decision del cliente; el equipo tecnico
no inventa garantias contractuales.

Estado: ABIERTA. Hito S2 (`docs/runbooks/`).

### T-20 — Confundir "seleccionado" con "ganador"

Proceso, no software. Publicar o comunicar un ganador antes de verificar su
elegibilidad.

Mitigacion: el resultado de un sorteo es un `PotentialWinner`; la publicacion es
una capacidad distinta, con doble aprobacion y condicionada por flag; sustituir
a un seleccionado conserva el historico y nunca lo reemplaza en silencio.

Estado: PARCIAL (tipos y capacidades existen; el flujo, no).

---

## 5. Fuera de alcance de esta version

- Seguridad fisica y del proveedor de nube (hosting sin decidir).
- Amenazas del procesador de pagos (sin elegir; DEC pendiente).
- Amenazas del administrador externo de sweepstakes (sin elegir).
- DDoS volumetrico: se asume mitigacion del proveedor de borde.
- Cumplimiento de privacidad estatal: es decision del abogado del cliente. El
  software aporta retencion configurable, no criterio legal.

## 6. Revision

Este modelo se revisa: al cerrar cada hito; al anadir una integracion externa;
al cambiar la matriz de autorizacion; y **obligatoriamente antes de activar una
promocion** o de habilitar el sorteo interno.
