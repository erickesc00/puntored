## Estado actual

- **Work-Unit 0**: documentación base completada.
- **Frontend**: fuera del alcance inicial; se retomará después de validar el flujo principal del backend.

## Alcance de la primera fase

### Incluye

- Backend en TypeScript sobre NestJS.
- Persistencia relacional con **MySQL + migraciones reproducibles**.
- Autenticación y autorización por rol (`OPERATOR`, `SUPERVISOR`).
- Creación idempotente de referencias.
- Listado paginado con filtros requeridos: **status, rango de fechas y búsqueda**.
- Detalle de referencia con historial/auditoría.
- Cancelación válida con control de concurrencia.
- Recepción o simulación de notificaciones del proveedor.
- Señal de salud y métricas mínimas.
- Plan de pruebas con capas **unit, integration y e2e**.

## Flujo principal que debe quedar probado

1. Un usuario interno inicia sesión.
2. Crea una referencia de pago.
3. Reintenta la misma creación con la misma idempotency key sin duplicar registros.
4. Consulta detalle e historial.
5. Lista referencias con paginación estable y filtros mínimos.
6. Un supervisor cancela solo si la referencia sigue en estado válido.
7. El sistema resiste eventos duplicados o contradictorios del proveedor sin corromper el estado.

## Decisiones técnicas clave

| Tema | Decisión | Por qué |
|---|---|---|
| Arquitectura | Monolito modular por capas | Separa dominio, aplicación e infraestructura sin sobrediseñar el MVP. |
| Persistencia | **Prisma + MySQL** | Prisma acelera el modelado tipado y las migraciones; MySQL es familiar y suficiente para el caso. |
| Autenticación | Sesión backend con cookie segura `httpOnly` | Facilita revocación/logout y evita exponer tokens persistentes en el cliente. |
| Dinero | `amount` en minor units + `currency` obligatoria | Evita errores de precisión monetaria. |
| Concurrencia | `version` + transacción para cambios de estado | Es la forma más simple y defendible para el race cancel-vs-paid. |
| Auditoría | Tabla append-only de auditoría | Cubre trazabilidad básica de eventos relevantes; Basado en eventos simples. |
| Idempotencia | Una tabla MySQL simple para claves de idempotencia | Mantenerlo en DB ahorra uso de Redis a cambio de rendimiento. |

## Supuestos de negocio, dominio y seguridad

### Negocio y dominio

- La referencia externa (`externalReference`) tiene longitud máxima de **30 caracteres**.
- El estado inicial de toda referencia creada localmente es `PENDING`.
- Los estados relevantes del MVP son `PENDING`, `PAID`, `CANCELLED` y `EXPIRED`.
- La transición entre los estados: `PAID`, `CANCELLED` y `EXPIRED` solo es válida desde `PENDING`.
- Todos los timestamps se manejarán en **UTC**.
- La paginación debe ser estable usando un orden determinístico, pensado para crecer hasta ~1M de registros.

### Seguridad

- Passwords almacenados con hash seguro; nunca en texto plano (bcrypt).
- Cookie de sesión `httpOnly`, `SameSite=Lax`, `Secure` en ambientes compatibles.
- Expiración de sesión: **30 minutos idle** y **8 horas absolute timeout**.
- Errores de login genéricos para evitar enumeración de usuarios.
- Rate limiting fuerte en login y razonable en endpoints sensibles.
- Mínimo privilegio: `OPERATOR` crea/consulta; `SUPERVISOR` además cancela.
- Validación en fronteras del sistema; no confiar solo en tipos de TypeScript.
- Las notificaciones del proveedor usarán un mecanismo MVP autenticado por secreto compartido o equivalente simple y documentado.

## Reglas críticas documentadas

### 1. Prisma + MySQL

La elección actual para persistencia es **Prisma sobre MySQL**. Se prioriza:

- migraciones reproducibles,
- tipado fuerte en TypeScript,
- transacciones explícitas

### 2. Idempotencia simple en una sola tabla MySQL

La implementación MVP usará una tabla dedicada, conceptualmente similar a:

- `scope`
- `actor_id`
- `idempotency_key`
- `request_hash`
- `reference_id` o resultado asociado
- `response_code`
- timestamps / expiración

Regla:

- misma key + mismo actor + mismo payload normalizado => devolver resultado original,
- misma key + mismo actor + payload distinto => conflicto,
- no se introduce Redis ni coordinación distribuida en esta fase.

### 3. Regla de contradicción del proveedor

Si el proveedor envía un evento tardío que contradice un estado terminal válido ya persistido localmente, el sistema **no reescribe automáticamente** el estado final. Ese evento se **rechaza y audita**. El MVP prioriza una fuente de verdad consistente y defendible por encima de reconciliación automática avanzada.

### 4. Estrategia de sesión y seguridad

El MVP usará sesión server-side persistida en MySQL, no JWT almacenado en navegador. Esto permite:

- logout real,
- revocación simple,
- expiración centralizada,
- menor exposición de credenciales/tokens en cliente.

## Observabilidad mínima esperada

La evidencia operativa básica NO se limita a `/health`.

Puede incluir:

- `health` / readiness contra base de datos,
- logs estructurados con correlation ID,
- sin exponer secretos o datos sensibles,
- métricas mínimas de:
  - errores,
  - latencia,
  - creaciones,
  - cancelaciones,
  - fallos/rechazos del proveedor.

## Estrategia de pruebas

La solución debe cubrir tres capas:

| Capa | Qué valida |
|---|---|
| Unit | reglas de transición, elegibilidad de cancelación, expiración, normalización de idempotencia |
| Integration | persistencia Prisma/MySQL, índices/restricciones, autorización, duplicados, carrera cancel-vs-paid |
| E2E | flujo principal de mayor riesgo: login -> create -> retry seguro -> list/detail -> cancel válido o conflicto |

También se deben cubrir explícitamente errores, duplicados y transiciones inválidas. Lo no probado deberá quedar explicado.

## Riesgos y deuda consciente

- La autenticación por sesión agrega trabajo de persistencia y seguridad desde el inicio.
- La regla de contradicción del proveedor resuelve el MVP, pero no reemplaza una futura reconciliación operativa.

## Plan de implementación por work-unit

| Work-Unit | Objetivo | Estado |
|---|---|---|
| 0 | Documentación base única del repo antes de código | ✅ Completado |
| 1 | Foundation + DB + auth + salud/observabilidad mínima | Pendiente |
| 2 | References: create/list/detail/cancel + auditoría + idempotencia | Pendiente |
| 3 | Provider ingest + pruebas de riesgo + cierre de documentación/API | Pendiente |

### Desglose operativo actual

- **WU0**: consolidar README canónico, supuestos, decisiones, riesgos y plan.
- **WU1**: endurecer scaffold NestJS, Prisma/MySQL, migraciones, sesiones, guards, `/health`, métricas básicas.
- **WU2**: referencias de pago con create/list/detail/cancel, auditoría e idempotencia en MySQL.
- **WU3**: eventos del proveedor, protección ante duplicados/contradicciones, pruebas unit/integration/e2e y cierre documental.

## Instalación, ejecución y pruebas

### Estado honesto hoy

Hoy ya existe una base funcional del backend en `backend/` con:

- Prisma schema + migración inicial + seed.
- `docker-compose.yml` para MySQL local y API.
- Auth/session base con cookie segura server-side.
- `/api/health` y `/api/metrics`.

### Comandos actuales

```bash
cd backend
cp .env.example .env
docker compose up -d mysql
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

Para levantar API + DB con Compose:

```bash
cd backend
cp .env.example .env
docker compose up
```

### Usuarios demo seed

- `operator` / `Puntored123!`
- `supervisor` / `Puntored123!`

## Contrato API

Base disponible en esta fase:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/health`
- `GET /api/metrics`

Se agregará una colección de Postman preparada para interactuar con la API en work-units posteriores.

## Uso de inteligencia artificial

### Resumen actual

- Se está usando IA para apoyar análisis del enunciado, estructuración SDD, documentación, revisión de gaps entre especificación e implementación y ejecución guiada del plan.
- Las decisiones de arquitectura, alcance, trade-offs y simplificación del MVP fueron validadas explícitamente por el desarrollador.
- Todo lo documentado y luego implementado debe poder ser explicado, depurado y modificado manualmente.

## Preguntas abiertas controladas

- Si la búsqueda MVP sobre `externalReference` + `concept` alcanza, o si en defensa se espera algo más amplio.
- Si la simulación del proveedor reutilizará exactamente el callback o si habrá una ruta interna separada.

## Próxima actualización esperada de este README

Cuando termine la siguiente work-unit, este documento debe incorporar:

- comandos reales con Docker Compose,
- migraciones y seed,
- usuarios demo,
- rutas/API efectivas,
- cobertura implementada,
- deuda consciente actualizada.
