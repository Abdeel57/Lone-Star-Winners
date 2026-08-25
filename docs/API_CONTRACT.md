# API_CONTRACT.md

**Fuente de verdad compartida entre `frontend` y `backend`** para todas las
APIs de Lone Star Winners.

## Reglas

1. **Un agente no debe asumir una API que no esté documentada aquí.**
   Si el frontend necesita un endpoint inexistente, abre un handoff en
   `docs/AGENT_HANDOFF.md`; no lo inventa ni lo mockea como definitivo.
2. El **owner** de un endpoint es quien lo implementa y mantiene. Nadie más
   cambia su forma sin handoff.
3. **Ningún cambio de API es silencioso.** Modificar request, response,
   códigos de error o autorización obliga a actualizar esta entrada.
4. Un cambio incompatible con lo ya implementado requiere además una entrada
   en `docs/DECISIONS.md`.
5. **No se crean APIs alternativas** para evitar coordinarse.
6. Los ejemplos de request/response **no contienen datos reales** ni secretos.
7. `Status: PROPOSED` significa que el frontend puede diseñar contra el
   contrato, pero **no** asumir que existe.

## Estados

- `PROPOSED` — acordado en papel, aún no implementado.
- `IMPLEMENTED` — existe en el backend y respeta este contrato.
- `TESTED` — cubierto por pruebas y revisado por `security-integration`.

---

## Plantilla

```text
Method:
Endpoint:

Purpose:

Authentication:

Request:

Response:

Errors:

Authorization:

Owner:

Status:
PROPOSED / IMPLEMENTED / TESTED
```

---

# Endpoints

_(vacío — todavía no se ha acordado ninguna API)_

Cuando existan, se agruparán por dominio, previsiblemente:

- Auth & cuenta
- Catálogo / storefront
- Carrito y checkout
- Órdenes y pagos
- Entries (procedencia: compra)
- Entries (procedencia: AMOE)
- Portal del participante
- Admin
- Auditoría y exportaciones (TPA)

> Esta agrupación es orientativa. La estructura definitiva se acuerda entre
> `frontend` y `backend` y se registra en `docs/DECISIONS.md`.
