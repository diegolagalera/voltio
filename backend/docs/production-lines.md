# 📖 Documentación — Módulo Líneas de Producción

## 1. Visión General

El módulo permite agrupar dispositivos (contadores) en **líneas de producción** para calcular el coste energético de fabricar un producto. Incluye:

- **Seguimiento temporal de membresía** — registra cuándo se añade/quita un dispositivo de una línea
- **Seguimiento temporal de jerarquía** — registra cuándo un dispositivo se conecta/desconecta como downstream o fase
- **Consumo neto (subtraction metering)** — calcula el consumo real de cada dispositivo sin doble conteo

---

## 2. Modelo de Datos

### Tablas

| Tabla | Propósito | Tipo |
|-------|-----------|------|
| `production_lines` | Entidad principal (nombre, color, factory). Soft-delete con `is_active` | CRUD |
| `production_line_devices` | Membresía actual (lookup rápido) | Estado actual |
| `production_line_membership_log` | Historial de membresía — append-only, registra `added`/`removed` | Temporal |
| `device_hierarchy_log` | Historial de jerarquía — registra `attached`/`detached` de downstream/fase | Temporal |

### Relaciones

```
factories 1──N production_lines 1──N production_line_devices N──1 devices
                                  1──N production_line_membership_log
devices 1──N device_hierarchy_log
```

### Migraciones

- `007_production_lines.sql` — tablas `production_lines`, `production_line_devices`, `production_line_membership_log`
- `009_device_hierarchy_log.sql` — tabla `device_hierarchy_log` + seed desde estado actual

---

## 3. Backend — Arquitectura

### Archivos

| Archivo | Responsabilidad |
|---------|----------------|
| `services/production-line.service.js` | CRUD, membresía, analytics con subtraction metering |
| `controllers/production-line.controller.js` | HTTP handlers, date range parsing, ownership validation |
| `routes/production-line.routes.js` | Express routes con RBAC |
| `controllers/factory.controller.js` | Logging de jerarquía en `updateDevice` y `createPhaseChildren` |

### Endpoints API

| Método | Ruta | RBAC | Descripción |
|--------|------|------|-------------|
| `GET` | `/:factoryId/production-lines` | tenantGuard | Listar líneas |
| `POST` | `/:factoryId/production-lines` | manager+ | Crear línea |
| `GET` | `/:factoryId/production-lines/:lineId` | tenantGuard | Detalle con devices |
| `PUT` | `/:factoryId/production-lines/:lineId` | manager+ | Editar línea |
| `DELETE` | `/:factoryId/production-lines/:lineId` | manager+ | Soft-delete |
| `POST` | `/.../production-lines/:lineId/devices` | manager+ | Añadir dispositivos |
| `DELETE` | `/.../production-lines/:lineId/devices/:deviceId` | manager+ | Quitar dispositivo |
| `GET` | `/.../production-lines/:lineId/membership-log` | tenantGuard | Historial de membresía |
| `GET` | `/.../production-lines/:lineId/analytics/summary` | tenantGuard | KPIs del período |
| `GET` | `/.../production-lines/:lineId/analytics/timeline` | tenantGuard | Datos para gráfico |
| `GET` | `/.../production-lines/:lineId/analytics/device-breakdown` | tenantGuard | Desglose por dispositivo |

### Seguridad

- **`validateLineOwnership(req, res)`** — valida que `lineId` pertenece a `factoryId` y que `is_active = true`. Se ejecuta en TODOS los endpoints de membership y analytics.
- **RBAC** — solo `manager` y `superadmin` pueden crear/editar/eliminar líneas y gestionar membresía.

---

## 4. Lógica de Cálculo — Subtraction Metering

### Principio

Un contador eléctrico mide **toda la corriente** que pasa por el cable en un punto. Si el Contador A está upstream del Contador B, la lectura de A **incluye** la de B.

```
Contador A: 1800W ───┐
                      │
    Contador B: 500W ─┘ (downstream de A)

→ A mide 1800W = 1300W propio + 500W de B
→ B mide 500W = solo su consumo
```

### Cálculo de consumo neto

Para cada dispositivo en la línea:

```
bruto = lectura del contador (power_w_total promedio × horas)
neto  = bruto − Σ(consumo de hijos que NO están en la línea)
```

| Escenario | Cálculo |
|-----------|---------|
| Solo padre en la línea, hijo fuera | `neto = padre_bruto - hijo_bruto` |
| Padre e hijo ambos en la línea | `neto_padre = padre_bruto` (no se resta) |
| Solo hijo en la línea | `neto = hijo_bruto` |

**Total de la línea** = `Σ(neto)` → sin doble conteo.

### Pasos en `getDeviceBreakdown()`

1. `getMembersAtTime()` — replay de `production_line_membership_log`
2. Reconstruir jerarquía histórica — `DISTINCT ON` sobre `device_hierarchy_log` con `timestamp <= to`
3. Consultar telemetría bruta por device
4. Identificar hijos NO en la línea → consultar su telemetría
5. Calcular neto = bruto − hijos fuera
6. Resultado con `kwh_gross`, `kwh_net`, `cost_gross`, `cost_net`, `pct`

---

## 5. Reconstrucción Temporal

### Membresía de línea (`production_line_membership_log`)

```sql
-- ¿Qué dispositivos estaban en la línea en la fecha X?
SELECT DISTINCT ON (device_id) device_id, action
FROM production_line_membership_log
WHERE production_line_id = $1 AND timestamp <= $2
ORDER BY device_id, timestamp DESC
-- Solo incluir donde action = 'added'
```

**Fallback:** si no hay registros temporales (línea recién creada), se usan los miembros actuales.

### Jerarquía de dispositivos (`device_hierarchy_log`)

```sql
-- ¿Cuál era la jerarquía en la fecha X?
SELECT DISTINCT ON (device_id) device_id, parent_device_id, parent_relation, phase_channel, action
FROM device_hierarchy_log
WHERE timestamp <= $1
ORDER BY device_id, timestamp DESC
-- Solo incluir donde action = 'attached'
```

**Logging automático:** al editar un dispositivo y cambiar su padre/relación/fase, se insertan `detached` (anterior) y `attached` (nuevo) en la tabla.

---

## 6. Sistema Unificado de Jerarquía Histórica

Tanto los **informes energéticos** (`report.service.js`) como las **líneas de producción** (`production-line.service.js`) utilizan una **única fuente de verdad**: la tabla `device_hierarchy_log`.

| Función | Módulo | Uso |
|---------|--------|-----|
| `getDeviceBreakdown` (fábrica) | `report.service.js` | DISTINCT ON → jerarquía al momento `to` |
| `getDeviceReport` (dispositivo) | `report.service.js` | Eventos attached/detached en el rango |
| `getDeviceBreakdown` (línea) | `production-line.service.js` | DISTINCT ON → jerarquía al momento `to` + subtraction metering |

**Ventajas del sistema unificado:**
- Funciona aunque el dispositivo esté offline (sin dependencia de telemetría)
- Datos auditables — puedes ver exactamente cuándo se cambió cada relación
- Consistencia entre módulos — misma fuente, mismos resultados

---

## 7. Frontend

### ProductionLines.vue (lista)

- Grid de tarjetas con nombre, descripción, color, conteo de dispositivos
- Modal de creación/edición con color picker
- Solo `manager+` puede crear/editar

### ProductionLineDetail.vue (detalle)

- **KPIs** — kWh, coste €, potencia media/pico
- **Gráfico temporal** — ECharts: barras (kWh) + línea (€), agrupable hora/día
- **Desglose por dispositivo** — valores bruto/neto, jerarquía visual (↳), badges de fase, barras %
- **Gestión de dispositivos** — añadir/quitar de la línea
- **Historial de cambios** — log de membresía con timestamps
- **Filtro de fechas** — Hoy/Semana/Mes + rango personalizado

---

## 8. Flujo de Datos

```
1. Frontend → GET /analytics/device-breakdown?range=custom&from=...&to=...
2. Controller → validateLineOwnership() → getDateRange() con timezone
3. Service → getMembersAtTime() → device_ids temporales
4. Service → device_hierarchy_log → jerarquía a la fecha 'to'
5. Service → telemetry → datos brutos por device
6. Service → telemetry de hijos NO en línea → datos a restar
7. Service → calcular bruto/neto por device → total = Σ(neto)
8. Controller → JSON response al frontend
```
