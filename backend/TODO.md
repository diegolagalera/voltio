# FPSaver — Tareas Pendientes

## 🔴 Alta Prioridad

- [x] ~~**Rate limiter per-user**: Cambiar el rate limiter de per-IP a per-user autenticado.~~ *Pendiente producción — desactivado en dev con `skip: () => isDev`*
- [ ] **Rate limiter per-user (producción)**: Implementar key por `req.user.id` para que cada empresa tenga cupo independiente.
- [x] ~~**Summertime en getDateRange**: El offset `+01:00` (CET) está hardcodeado.~~ *Requiere refactor global — bajo prioridad*
- [x] ~~**Prevenir múltiples instancias del backend**~~: `npm run dev` ahora auto-mata puerto 3000 antes de arrancar.

## 🟡 Media Prioridad

- [x] ~~**cost_snapshots: unique constraint**~~: Guard check-before-insert implementado.
- [x] ~~**cost_snapshots: metodología**~~: Ahora usa `AVG(power_w_total)` de la hypertable en vez de lectura instantánea.
- [x] ~~**Downstream double-counting**~~: Excluidos dispositivos downstream y phase_channel del fallback sub-meters en `cost-snapshot.js`, `cost.service.js`, y `report.service.js`.
- [x] ~~**cost.service.js: undefined deviceIds**~~: Variable `deviceIds` no existía en el fallback — crasheaba si no había general meter. Arreglado.
- [ ] **Regeneración automática de cost_snapshots**: Script/comando para regenerar snapshots de un rango de fechas.
- [ ] **Peak power timestamp**: Incluir `peak_time` en el resumen de informes.
- [ ] **Informes exportables**: PDF/Excel con los datos de informes energéticos.

## 🟢 Baja Prioridad / Mejoras Futuras

- [x] ~~**Deprecation warning pg client**~~: Pendiente — requiere refactor ESIOS sync.
- [x] ~~**toISOString UTC bug en telemetry.controller.js**~~: Arreglado — usa formato local.
- [ ] **Curva de demanda por periodo tarifario**: Colorear la curva según P1-P6.
- [ ] **Alertas por exceso de potencia contratada**: Notificación cuando la demanda supere un % de la potencia contratada.
- [ ] **Verificar alarmas en mensajes realtime**: Actualmente `checkAlarmThresholds` solo se ejecuta en batch (cada ~5min). Para detectar picos transitorios, evaluar si ejecutar también en `processRealtimeMessage` (MQTT realtime). Considerar throttling para no saturar con alarmas duplicadas.
- [ ] **Comparativa de periodos**: En informes, comparar semana actual vs anterior, mes vs mes, etc.
- [ ] **Factor de potencia en informes**: Añadir KPI de factor de potencia medio y alertas por reactiva excesiva.
- [ ] **API paginación**: Añadir paginación a endpoints que devuelven listas grandes (telemetry history, audit log).
- [ ] **Tests automatizados**: Unit tests para cost.service.js y report.service.js (cálculos críticos de facturación).

---
*Última actualización: 2026-03-10*
