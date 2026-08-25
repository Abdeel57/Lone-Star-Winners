# ARCHITECTURE.md

Estado: **inicial**. Este documento describe intención y fronteras,
**no** decisiones técnicas cerradas.

---

## 1. Objetivo

Construir **Lone Star Winners**: una plataforma bilingüe (español / inglés) de
**e-commerce + sweepstakes** para Estados Unidos, en la que los usuarios
adquieren mercancía elegible y esas compras **pueden generar promotional
entries** conforme a las Official Rules aprobadas por el abogado del cliente,
coexistiendo con un mecanismo **AMOE**.

La arquitectura debe sostener tres propiedades por encima de la comodidad de
implementación:

- **Auditabilidad** — toda entry debe poder reconstruirse: origen, momento,
  causa y estado.
- **Configurabilidad legal** — las reglas que fija el abogado son datos, no
  código.
- **Integrabilidad** — el sistema debe poder entregar su universo de entries a
  un third-party sweepstakes administrator.

---

## 2. Módulos principales esperados

Nombres funcionales, no paquetes definitivos.

| Módulo                 | Responsabilidad                                                                 |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Storefront**         | Catálogo, producto, carrito, checkout (capa visual).                            |
| **Commerce**           | Productos, precios, órdenes, pagos, refunds, chargebacks.                       |
| **Identity & Auth**    | Registro, sesión, verificación, roles. **Un solo sistema.**                     |
| **Sweepstakes Engine** | Promociones, elegibilidad, reglas configurables, límites, multiplicadores.      |
| **Entry Ledger**       | Registro append-only de entries y sus reversals. **Una sola fuente de verdad.** |
| **AMOE**               | Vía de participación sin compra, con la misma procedencia registrada.           |
| **Participant Portal** | Vista del participante sobre sus entries y su historial.                        |
| **Admin**              | Operación interna: promociones, productos, órdenes, revisiones.                 |
| **Audit & Snapshots**  | Evidencia inmutable, snapshots del universo de entries.                         |
| **Exports / TPA**      | Exportaciones reproducibles para el administrador externo.                      |
| **Drawing Controls**   | Controles y autorizaciones de cualquier sorteo interno.                         |
| **i18n**               | Español e inglés como idiomas de primera clase.                                 |

---

## 3. Fronteras de responsabilidad

```text
+----------------------------------------------+
| frontend  (frontend-ux)                      |
| Storefront - Portal - Admin UI - i18n visual |
+-----------------------------------------------+
                |  SOLO via docs/API_CONTRACT.md
                v
+-----------------------------------------------+
| backend  (backend-sweepstakes)                |
| Auth - Commerce - Sweepstakes - Entry Ledger  |
| AMOE - Admin services - Database              |
+-----------------------------------------------+
                |  auditoria, controles, exports
                v
+-----------------------------------------------+
| security  (security-integration)              |
| Security - Audit - TPA - QA - Integracion     |
+-----------------------------------------------+
```

Reglas de frontera:

- El frontend **no** contiene lógica de negocio de sweepstakes ni reglas de
  elegibilidad; las consume.
- El backend **no** decide presentación ni copy; expone datos y estados.
- `security` **no es propietario** del código de los otros dos: audita y
  solicita cambios mediante handoff.

---

## 4. Dependencias entre agentes

| Depende de                              | para                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| `frontend` hacia `backend`              | Contratos de API, formas de datos, estados, errores.     |
| `backend` hacia `frontend`              | Necesidades reales de la UI antes de congelar contratos. |
| `security` hacia ambos                  | Código implementado que auditar.                         |
| `frontend` y `backend` hacia `security` | Aprobación antes de `INTEGRATE`.                         |
| Todos hacia el abogado del cliente      | Official Rules (`docs/LEGAL_PENDING.md`).                |

**Regla de desbloqueo:** cuando un agente queda bloqueado, abre un handoff con
`Blocking: YES` y sigue con trabajo que no dependa de esa respuesta. No
inventa el contrato que le falta.

---

## 5. Arquitectura todavía pendiente de decidir

Nada de lo siguiente está decidido. **No debe asumirse.**

- Estructura de repositorio (monorepo vs. otra) y herramienta de workspace.
- Framework de frontend y estrategia de rendering.
- Framework de backend y estilo de API (REST / RPC / GraphQL).
- Base de datos, proveedor y ORM.
- Estrategia de autenticación y gestión de sesiones.
- Modelo concreto del entry ledger y su esquema de reversals.
- Mecanismo AMOE (depende de decisión legal).
- Procesador de pagos.
- Email, storage, analytics, colas.
- Hosting, proveedor de nube y pipeline de despliegue.
- Estrategia de testing y quality gates.
- Formato de exportación para el third-party administrator.

Cada punto se resuelve en la fase de planificación entre los tres agentes y se
registra como `DEC-xxx` en `docs/DECISIONS.md` **antes** de implementarse.

Hasta entonces solo puede crearse **estructura neutral**.
