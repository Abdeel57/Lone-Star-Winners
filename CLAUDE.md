# CLAUDE.md — Constitución del Proyecto

**Proyecto:** Lone Star Winners
**Estado actual:** infraestructura de coordinación preparada. El desarrollo **no ha comenzado**.

Este archivo es la **constitución compartida** del proyecto. Todos los agentes
(`frontend-ux`, `backend-sweepstakes`, `security-integration`) y el Team Lead
deben leerlo antes de escribir una sola línea de código, y deben respetarlo
por encima de cualquier preferencia individual.

---

## 1. Qué es Lone Star Winners

Lone Star Winners será una **plataforma bilingüe (español / inglés) de
e-commerce + sweepstakes para Estados Unidos**.

**No** es una página mexicana tradicional de venta de boletos, ni una rifa,
ni una lotería.

El modelo es el siguiente:

- Los usuarios **adquieren mercancía elegible** en una tienda en línea.
- Esas compras **pueden generar promotional entries** conforme a las
  **Official Rules aprobadas por el abogado del cliente**.
- Debe existir además un mecanismo **AMOE** (Alternative Method of Entry),
  de modo que la participación no dependa exclusivamente de una compra.

La distinción anterior no es cosmética: condiciona el lenguaje de la interfaz,
el modelado de datos, la auditoría y el cumplimiento. Ningún agente debe
describir el producto como venta de boletos ni implementarlo como tal.

---

## 2. Principios globales

Estas veinte reglas son de cumplimiento obligatorio para todos los agentes.

1. **Las Official Rules son determinadas externamente** por el abogado del
   cliente. El repositorio las consume; no las produce.
2. **Ningún agente debe inventar requisitos legales.** Lo que no esté
   confirmado se registra como pendiente en `docs/LEGAL_PENDING.md`.
3. **Las reglas legales y comerciales importantes deben ser configurables**,
   no fijadas en código.
4. **Español e inglés son idiomas de primera clase.** Ninguno es una
   traducción secundaria del otro.
5. **Las entries deben ser auditables**: origen, momento, causa y estado de
   cada una deben poder reconstruirse.
6. **Las entries no deben borrarse silenciosamente.**
7. **Refunds, chargebacks, fraude y descalificaciones** deben poder reflejarse
   mediante **movimientos o reversals**, nunca mediante borrado o edición
   destructiva del histórico.
8. **El sistema debe poder integrar participaciones AMOE.**
9. **Las participaciones de compra y AMOE deberán poder coexistir dentro del
   mismo universo lógico manteniendo su procedencia.**
10. **La plataforma deberá poder integrarse posteriormente con un third-party
    sweepstakes administrator.**
11. **Un sistema interno de random drawing no debe activarse sin autorización
    correspondiente**, documentada explícitamente.
12. **Seguridad y auditabilidad tienen prioridad sobre shortcuts.**
13. **Mobile-first.**
14. **Nada crítico debe quedar hardcoded** si puede depender de las
    Official Rules.
15. **Los agentes deben respetar ownership de archivos**
    (`docs/TASK_OWNERSHIP.md`).
16. **Ningún agente puede modificar silenciosamente contratos establecidos por
    otro** (`docs/API_CONTRACT.md`).
17. **Todo cambio arquitectónico importante debe documentarse**
    (`docs/DECISIONS.md`).
18. **No realizar operaciones destructivas de Git**: nada de `push --force`,
    `reset --hard`, rebase destructivo ni reescritura de historial.
19. **No almacenar secretos reales dentro del repositorio.**
20. **Nunca introducir credenciales, API keys o datos de producción dentro del
    código.**

---

## 3. Protocolo de trabajo

El orden de trabajo es obligatorio y no se salta ninguna etapa:

```text
PLAN
↓
AGREE ON CONTRACT
↓
ASSIGN OWNERSHIP
↓
IMPLEMENT
↓
TEST
↓
SECURITY REVIEW
↓
INTEGRATE
↓
VERIFY
```

Queda expresamente prohibido el anti-patrón:

```text
IMPLEMENT FIRST
↓
FIGURE OUT ARCHITECTURE LATER
```

---

## 4. Prevención de conflictos

- No editar el mismo archivo simultáneamente.
- Revisar `docs/TASK_OWNERSHIP.md` antes de modificar cualquier archivo.
- Los cambios cross-domain requieren un **handoff** en `docs/AGENT_HANDOFF.md`.
- Los cambios de API requieren actualizar `docs/API_CONTRACT.md`.
- Los cambios arquitectónicos requieren una entrada en `docs/DECISIONS.md`.
- Las dudas o cambios legales requieren una entrada en `docs/LEGAL_PENDING.md`.
- No duplicar lógica.
- No crear APIs alternativas para evitar coordinarse.
- No crear dos sistemas de autenticación.
- No crear dos modelos independientes de entries.
- No crear dos fuentes de verdad diferentes.

Cuando dos agentes necesiten el mismo archivo, **gana el propietario**; el otro
solicita el cambio mediante handoff.

---

## 5. Equipo

| Teammate   | Agente                 | Dominio                                                      |
|------------|------------------------|--------------------------------------------------------------|
| `frontend` | `frontend-ux`          | Frontend, UX/UI, bilingüe, storefront, portal, admin UI       |
| `backend`  | `backend-sweepstakes`  | Base de datos, APIs, commerce, sweepstakes engine, AMOE       |
| `security` | `security-integration` | Seguridad, compliance, auditoría, exports, TPA, QA, integración |

El Team Lead coordina; no implementa en lugar de los agentes.

---

## 6. Documentación compartida

| Archivo                   | Propósito                                                |
|---------------------------|-----------------------------------------------------------|
| `CLAUDE.md`               | Este documento. Constitución y principios.                |
| `ORCHESTRATOR.md`         | Prompt de arranque para la sesión principal (Team Lead).  |
| `docs/ARCHITECTURE.md`    | Arquitectura y fronteras de responsabilidad.              |
| `docs/API_CONTRACT.md`    | Fuente de verdad de las APIs.                             |
| `docs/DECISIONS.md`       | Registro ADR de decisiones.                               |
| `docs/AGENT_HANDOFF.md`   | Comunicación entre agentes.                               |
| `docs/TASK_OWNERSHIP.md`  | Propiedad de archivos y responsabilidades.                |
| `docs/LEGAL_PENDING.md`   | Decisiones pendientes del abogado.                        |

---

## 7. El stack todavía NO está decidido

En esta fase **no** están decididos —y ningún agente debe darlos por supuestos—:

- framework de frontend (Next.js u otra opción);
- framework de backend (Express, Fastify, Nest u otro);
- ORM;
- proveedor de base de datos;
- hosting;
- procesador de pagos;
- proveedor de email;
- almacenamiento;
- analytics;
- sistema de colas;
- proveedor de nube.

Estas decisiones se toman **entre los tres agentes**, de acuerdo con los
requisitos del proyecto, y se registran en `docs/DECISIONS.md` antes de
implementarse. Hasta entonces solo puede crearse estructura neutral.

---

## 8. Seguridad del repositorio

Nunca se almacenan en el repositorio:

- passwords;
- production secrets;
- API keys;
- private keys;
- payment credentials;
- access tokens.

Cuando se requieran variables de entorno, se declaran en `.env.example` con
**valores falsos o descriptivos**. Los archivos `.env` y `.env.*` reales están
excluidos por `.gitignore`; `.env.example` **no** debe ignorarse.
