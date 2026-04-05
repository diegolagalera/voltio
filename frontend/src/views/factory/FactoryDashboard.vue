<template>
  <div>
    <!-- Factory Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-3xl font-bold text-white">{{ factory?.name || '' }}</h2>
        <p class="text-surface-300 text-base">{{ factory?.city || factory?.location_address || '' }}</p>
      </div>
      <div class="flex items-center gap-3">
        <!-- View mode toggle -->
        <div class="flex items-center bg-surface-800 rounded-lg p-0.5 border border-surface-700">
          <button
            @click="viewMode = 'cards'"
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-all"
            :class="viewMode === 'cards'
              ? 'bg-primary-500/20 text-primary-400 shadow-sm'
              : 'text-surface-400 hover:text-white'"
          >
            📋 Cards
          </button>
          <button
            @click="viewMode = 'graph'"
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-all"
            :class="viewMode === 'graph'
              ? 'bg-primary-500/20 text-primary-400 shadow-sm'
              : 'text-surface-400 hover:text-white'"
          >
            🔗 Gráfico
          </button>
        </div>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
          :class="dataStatusClass"
        >
          <span class="w-2 h-2 rounded-full" :class="dataStatusDotClass"></span>
          {{ dataStatusLabel }}
        </span>
      </div>
    </div>

    <!-- ═══ GRAPH VIEW ═══ -->
    <FactoryGraphView
      v-if="viewMode === 'graph'"
      :devices="devices"
      :telemetry-data="telemetryStore.realtimeData"
      :cost-info="costInfo"
      :factory-id="factoryId"
      :contracted-power-kw="costInfo?.contracted_power_kw || 0"
      :saved-positions="graphPositions"
      @update:positions="onPositionsUpdate"
      @reset:positions="onPositionsReset"
    />

    <!-- ═══ CARDS VIEW ═══ -->
    <template v-else>
    <!-- Cost Summary Bar -->
    <div v-if="costInfo" class="glass-card p-5 mb-6 flex flex-wrap items-center gap-4 sm:gap-8">
      <div class="flex items-center gap-3">
        <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: costInfo.color }"></span>
        <div>
          <p class="text-surface-200 text-base">Periodo actual <InfoTip title="Periodo tarifario">Franja horaria actual según tu tarifa eléctrica. Cada periodo (P1–P6) tiene un precio diferente. P1 es el más caro (punta) y P6 el más barato (valle).</InfoTip></p>
          <p class="text-white font-bold text-xl">{{ costInfo.period }} <span class="text-base font-normal text-surface-300">{{ costInfo.period_label }}</span></p>
        </div>
      </div>
      <div>
        <p class="text-surface-200 text-base">Precio energía <InfoTip title="Precio actual">Coste por kWh en el periodo tarifario actual. Incluye: energía + peaje + cargo. Si tu tarifa es indexada, varía cada hora según el mercado.</InfoTip></p>
        <p class="text-primary-400 font-bold text-xl">{{ costInfo.price_kwh?.toFixed(4) }} <span class="text-base font-normal">€/kWh</span></p>
      </div>
      <div>
        <p class="text-surface-200 text-base">Tarifa</p>
        <p class="text-white font-semibold text-base">{{ costInfo.tariff_type }} · {{ costInfo.pricing_model === 'fixed' ? 'Fijo' : costInfo.pricing_model === 'indexed_omie' ? 'Indexado OMIE' : 'PVPC' }}</p>
      </div>
      <div class="hidden sm:block">
        <p class="text-surface-200 text-base">Desglose <InfoTip title="Componentes del precio">E = Energía (coste de generación) · P = Peaje (transporte y distribución) · C = Cargo (costes regulados del sistema). Suma = precio final €/kWh.</InfoTip></p>
        <p class="text-surface-300 text-base">
          E: {{ costInfo.breakdown?.energy?.toFixed(4) }}€ + P: {{ costInfo.breakdown?.peaje?.toFixed(4) }}€ + C: {{ costInfo.breakdown?.cargo?.toFixed(4) }}€
        </p>
      </div>
    </div>
    <!-- Power Limit Gauge -->
    <div v-if="costInfo?.contracted_power_kw" class="glass-card p-4 mb-6">
      <div class="flex items-center justify-between mb-2">
        <!-- E: Peak demand (left) -->
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span class="text-white text-base font-semibold">Potencia en uso <InfoTip title="Potencia en uso">Consumo total instantáneo de la fábrica vs la potencia contratada. Si superas el 100% del contratado, la compañía eléctrica puede aplicar penalizaciones.</InfoTip></span>
          <div v-if="peakDemandKw > 0" class="hidden sm:flex items-center gap-1 ml-2 bg-surface-800/60 rounded-full px-2.5 py-0.5">
            <span class="text-surface-300 text-sm uppercase">Pico máx</span>
            <span class="text-warning-400 font-bold text-sm">{{ peakDemandKw.toFixed(1) }} kW</span>
            <InfoTip title="Demanda máxima">Valor máximo de potencia demandada registrado por el contador general. Útil para dimensionar la potencia contratada.</InfoTip>
          </div>
        </div>
        <!-- Power reading (right, fixed width to avoid layout shift) -->
        <div class="text-right whitespace-nowrap">
          <span class="font-bold text-xl" :class="powerGaugeColor">{{ totalFactoryKw.toFixed(1) }} kW</span>
          <span class="text-surface-300 text-base"> / {{ costInfo.contracted_power_kw }} kW</span>
          <span class="text-surface-300 text-sm ml-1">({{ costInfo.period }})</span>
        </div>
      </div>
      <div class="w-full bg-surface-800 rounded-full h-3 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="powerGaugeBarClass"
          :style="{ width: Math.min(powerUsagePct, 100) + '%' }"
        ></div>
      </div>
      <div class="flex justify-between mt-1">
        <span class="text-sm font-medium" :class="powerGaugeColor">{{ totalFactoryKw.toFixed(1) }} kW consumidos</span>
        <span v-if="powerUsagePct > 90" class="text-alarm-400 text-sm font-semibold animate-pulse">
          ⚠️ {{ powerUsagePct.toFixed(0) }}% — Cerca del límite
        </span>
        <span v-else class="text-surface-300 text-sm">
          {{ powerUsagePct.toFixed(0) }}% del contratado
        </span>
        <span class="text-surface-300 text-sm">{{ costInfo.contracted_power_kw }} kW máx</span>
      </div>
      <!-- D: Reactive power penalty warning -->
      <div v-if="pfBannerVisible" class="mt-2 bg-alarm-500/10 border border-alarm-500/30 rounded-lg p-2.5 flex items-center gap-2">
        <span class="text-alarm-400 text-lg">⚡</span>
        <div class="flex-1">
          <p class="text-alarm-400 text-base font-semibold">Penalización por reactiva <InfoTip title="Penalización reactiva (RD 1164/2001)">Si el factor de potencia general baja de 0.90, la distribuidora puede aplicar un recargo sobre la factura. Se corrige instalando baterías de condensadores.</InfoTip></p>
          <p class="text-surface-200 text-sm">
            FP detectado: <span class="font-bold text-alarm-400">{{ pfTriggeredValue.toFixed(3) }}</span>
            <template v-if="generalPF >= 0.90"> → Actual: <span class="font-bold text-energy-400">{{ generalPF.toFixed(3) }} ✓</span></template>
            — Recomendado ≥ 0.95. Recargo estimado: ~{{ pfTriggeredPenalty.toFixed(1) }}% sobre energía.
          </p>
        </div>
        <button
          @click="pfBannerVisible = false"
          class="shrink-0 p-1 rounded-md text-surface-500 hover:text-alarm-400 hover:bg-alarm-500/10 transition-colors"
          title="Cerrar aviso"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Daily Cost Chart (above devices) -->
    <DailyCostChart v-if="costInfo" :factory-id="factoryId" class="mb-6" />

    <!-- ═══ Section 1: Contador General ═══ -->
    <template v-if="generalMeterGroup">
      <h3 class="text-surface-200 text-base uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-energy-400"></span> Contador General <InfoTip title="Contador General">Medidor principal de la fábrica. Mide el consumo total de todas las líneas. Es el de referencia para la factura eléctrica.</InfoTip>
      </h3>
      <router-link
        :to="`/factory/${$route.params.factoryId}/device/${generalMeterGroup.id}`"
        class="glass-card glass-card-hover p-5 block mb-6 border border-energy-500/20"
      >
        <div class="flex items-start justify-between mb-4">
          <div>
            <h4 class="text-white font-semibold text-xl">{{ generalMeterGroup.name }}</h4>
            <p class="text-surface-300 text-base mt-0.5">
              {{ t(`devices.type.${generalMeterGroup.device_type}`) }} · {{ generalMeterGroup.model || 'EM340' }}
              <span v-if="generalMeterGroup.host" class="text-surface-300"> · {{ generalMeterGroup.host }}</span>
            </p>
          </div>
          <span class="badge bg-energy-500/20 text-energy-400 text-sm">⚡ General</span>
        </div>
        <div v-if="getDeviceData(generalMeterGroup.id)" class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-200 text-base mb-1">{{ t('telemetry.power') }} <InfoTip title="Potencia activa">Energía útil consumida en este instante (watios). Es la que se factura. Potencia × horas = kWh.</InfoTip></p>
              <p class="text-2xl font-bold text-primary-400">
                {{ formatValue(getDeviceData(generalMeterGroup.id)?.power_w_total || getDeviceData(generalMeterGroup.id)?.power_w, 'W') }}
              </p>
            </div>
            <div class="bg-surface-800/50 rounded-lg p-3">
              <p class="text-surface-200 text-base mb-1">{{ t('telemetry.powerFactor') }} <InfoTip title="Factor de potencia">Eficiencia eléctrica (0 a 1). Ideal ≥ 0.95. Por debajo de 0.95 se aplica recargo por energía reactiva (Circular 3/2020 CNMC). Se mejora con baterías de condensadores.</InfoTip></p>
              <p class="text-2xl font-bold" :class="getPFColor(getDeviceData(generalMeterGroup.id)?.power_factor)">
                {{ (getDeviceData(generalMeterGroup.id)?.power_factor || 0).toFixed(3) }}
              </p>
            </div>
          </div>
          <div v-if="costInfo?.price_kwh" class="bg-surface-800/30 rounded-lg p-2.5 flex items-center justify-between">
            <span class="text-surface-200 text-base">💰 Coste actual <InfoTip title="Coste por hora">Estimación del coste si se mantiene la potencia actual durante 1 hora. Cálculo: (potencia_kW × precio_€/kWh).</InfoTip></span>
            <span class="font-bold text-base text-white">{{ getDeviceCostPerHour(generalMeterGroup.id) }} €/hora</span>
          </div>
          <!-- C: Phase imbalance badge -->
          <div v-if="generalMeterGroup.device_type !== 'monofasica'" class="grid grid-cols-3 gap-2 text-center">
            <div v-for="(phase, i) in ['L1', 'L2', 'L3']" :key="phase" class="bg-surface-800/30 rounded-lg py-2 px-1">
              <p class="text-surface-300 text-sm">{{ phase }}</p>
              <p class="text-white text-base font-semibold">{{ formatValue(getDeviceData(generalMeterGroup.id)?.[`voltage_l${i+1}_n`], 'V') }}</p>
              <p class="text-surface-200 text-sm">{{ formatValue(getDeviceData(generalMeterGroup.id)?.[`current_l${i+1}`], 'A') }}</p>
            </div>
          </div>
          <div v-if="generalImbalance !== null" class="bg-surface-800/30 rounded-lg p-2 flex items-center justify-between">
            <span class="text-surface-200 text-base">⚖️ Desequilibrio fases <InfoTip title="Desequilibrio de corriente">Diferencia porcentual entre las corrientes de las 3 fases. Si supera el 10%, puede causar sobrecalentamiento en transformadores y penalizaciones. Se calcula: ((máx - mín) / media) × 100.</InfoTip></span>
            <span class="font-bold text-base" :class="generalImbalance > 10 ? 'text-alarm-400' : generalImbalance > 5 ? 'text-warning-400' : 'text-energy-400'">
              {{ generalImbalance > 10 ? '⚠️' : '✓' }} {{ generalImbalance.toFixed(1) }}%
            </span>
          </div>
        </div>
        <div v-else class="text-center py-4">
          <p class="text-surface-500 text-sm">{{ t('common.noData') }}</p>
        </div>
      </router-link>
    </template>

    <!-- ═══ Section 2: Medidores por Fases ═══ -->
    <template v-if="phaseGroups.length">
      <h3 class="text-surface-200 text-base uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-primary-400"></span> Medidores por Fases <InfoTip title="Medidores trifásicos">Equipos trifásicos donde cada fase (L1, L2, L3) se monitoriza por separado. La suma de las 3 fases = el total del medidor.</InfoTip>
      </h3>
      <div class="space-y-4 mb-6">
        <div
          v-for="group in phaseGroups"
          :key="group.id"
          class="glass-card p-5 border border-primary-500/20"
        >
          <div class="flex items-start justify-between mb-4">
            <div>
              <h4 class="text-white font-semibold text-xl">{{ group.name }}</h4>
              <p class="text-surface-300 text-base mt-0.5">
                {{ t(`devices.type.${group.device_type}`) }} · {{ group.model || 'EM24' }}
                <span v-if="group.host" class="text-surface-300"> · {{ group.host }}</span>
                · {{ group.phaseChildren.length }} fases
              </p>
            </div>
            <span class="badge badge-info text-sm">{{ t(`devices.type.${group.device_type}`) }}</span>
          </div>

          <div v-if="getDeviceData(group.id)" class="bg-surface-800/30 rounded-lg p-3 mb-4 flex items-center gap-6">
            <div>
              <p class="text-surface-300 text-sm uppercase tracking-wider">Potencia Total <InfoTip title="Potencia total">Suma de las 3 fases (L1+L2+L3). Es la lectura real del medidor trifásico.</InfoTip></p>
              <p class="text-primary-400 font-bold text-xl">
                {{ formatValue(getDeviceData(group.id)?.power_w_total || getDeviceData(group.id)?.power_w, 'W') }}
              </p>
            </div>
            <div>
              <p class="text-surface-300 text-sm uppercase tracking-wider">Factor Potencia</p>
              <p class="font-bold text-xl" :class="getPFColor(getDeviceData(group.id)?.power_factor)">
                {{ (getDeviceData(group.id)?.power_factor || 0).toFixed(3) }}
              </p>
            </div>
            <div v-if="costInfo?.price_kwh">
              <p class="text-surface-300 text-sm uppercase tracking-wider">Coste Total</p>
              <p class="text-white font-bold text-xl">{{ getDeviceCostPerHour(group.id) }} <span class="text-base font-normal text-surface-200">€/hora</span></p>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              v-for="phase in group.phaseChildren"
              :key="phase.id"
              class="bg-surface-800/40 rounded-lg p-4 border-l-3"
              :class="{
                'border-l-blue-400': phase.phase_channel === 'L1',
                'border-l-amber-400': phase.phase_channel === 'L2',
                'border-l-emerald-400': phase.phase_channel === 'L3',
              }"
            >
              <router-link :to="`/factory/${$route.params.factoryId}/device/${phase.id}`" class="block hover:opacity-80 transition-opacity">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-white font-medium text-base">{{ phase.name }}</span>
                  <span class="text-xs font-bold px-2 py-0.5 rounded-full"
                    :class="{
                      'bg-blue-500/20 text-blue-400': phase.phase_channel === 'L1',
                      'bg-amber-500/20 text-amber-400': phase.phase_channel === 'L2',
                      'bg-emerald-500/20 text-emerald-400': phase.phase_channel === 'L3',
                    }"
                  >{{ phase.phase_channel }}</span>
                </div>
                <div v-if="getPhaseData(phase)">
                  <p class="text-primary-400 font-bold text-xl">
                    {{ formatValue(getPhaseData(phase)?.power_w, 'W') }}
                  </p>
                  <div class="flex items-center justify-between mt-1">
                    <span class="text-surface-300 text-sm">PF {{ (getPhaseData(phase)?.power_factor || 0).toFixed(3) }}</span>
                    <span v-if="costInfo?.price_kwh" class="text-surface-200 text-sm">{{ getPhaseCostPerHour(phase) }} €/h</span>
                  </div>
                </div>
                <p v-else class="text-surface-300 text-sm">Sin datos</p>
              </router-link>

              <!-- Downstream children of this phase -->
              <div v-if="getPhaseDownstream(phase.id).length" class="mt-3 pt-3 border-t border-surface-700/50 space-y-1.5">
                <p class="text-surface-300 text-sm uppercase tracking-wider mb-1">↓ Cargas conectadas</p>
                <router-link
                  v-for="child in getPhaseDownstream(phase.id)"
                  :key="child.id"
                  :to="`/factory/${$route.params.factoryId}/device/${child.id}`"
                  class="flex items-center justify-between bg-surface-800/50 rounded p-2 hover:bg-surface-700/40 transition-colors"
                >
                  <span class="text-surface-300 text-sm truncate">{{ child.name }}</span>
                  <span v-if="getDeviceData(child.id)" class="text-primary-400 text-sm font-bold shrink-0 ml-2">
                    {{ formatValue(getDeviceData(child.id)?.power_w_total || getDeviceData(child.id)?.power_w, 'W') }}
                  </span>
                </router-link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ Section 3: Cargas Downstream ═══ -->
    <template v-if="downstreamGroups.length">
      <h3 class="text-surface-200 text-base uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-amber-400"></span> Cargas Downstream <InfoTip title="Downstream">Sub-medidores conectados aguas abajo de un medidor principal. Miden ramas individuales del circuito eléctrico del equipo padre.</InfoTip>
      </h3>
      <div class="space-y-4 mb-6">
        <div
          v-for="group in downstreamGroups"
          :key="group.id"
          class="glass-card p-5 border border-amber-500/20"
        >
          <!-- Parent header -->
          <div class="flex items-start justify-between mb-3">
            <router-link :to="`/factory/${$route.params.factoryId}/device/${group.id}`" class="block">
              <h4 class="text-white font-semibold text-xl">{{ group.name }}</h4>
              <p class="text-surface-300 text-base mt-0.5">
                {{ t(`devices.type.${group.device_type}`) }} · {{ group.model || 'EM340' }}
                <span v-if="group.host" class="text-surface-300"> · {{ group.host }}</span>
                · {{ group.downstreamChildren.length }} carga{{ group.downstreamChildren.length > 1 ? 's' : '' }} conectada{{ group.downstreamChildren.length > 1 ? 's' : '' }}
              </p>
            </router-link>
            <span class="badge" :class="{
              'badge-info': group.device_type === 'trifasica',
              'badge-energy': group.device_type === 'master',
              'badge-warning': group.device_type === 'monofasica',
            }">
              {{ t(`devices.type.${group.device_type}`) }}
            </span>
          </div>

          <!-- Parent power summary with net consumption -->
          <div v-if="getDeviceData(group.id)" class="grid grid-cols-3 gap-3 mb-4">
            <div class="bg-surface-800/40 rounded-lg p-3">
              <p class="text-surface-300 text-sm uppercase tracking-wider">Bruto <InfoTip title="Potencia bruta">Potencia total que mide el equipo padre. Incluye todo lo que pasa por ese circuito: las cargas downstream + cualquier carga sin sub-medidor.</InfoTip></p>
              <p class="text-surface-300 font-bold text-xl">
                {{ formatValue(getDeviceData(group.id)?.power_w_total || getDeviceData(group.id)?.power_w, 'W') }}
              </p>
            </div>
            <div class="bg-surface-800/40 rounded-lg p-3">
              <p class="text-surface-300 text-sm uppercase tracking-wider">Cargas ↓ <InfoTip title="Suma de cargas">Suma de la potencia de todos los sub-medidores downstream conectados. Son las cargas que estamos monitorizando individualmente.</InfoTip></p>
              <p class="text-amber-400 font-bold text-xl">
                {{ formatValue(getChildPowerSum(group), 'W') }}
              </p>
            </div>
            <div class="bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
              <p class="text-amber-400 text-sm uppercase tracking-wider font-bold">Consumo Neto <InfoTip title="Consumo neto">Bruto − Cargas = consumo no monitorizado. Es lo que consume el propio equipo padre u otras cargas en su circuito que no tienen sub-medidor.</InfoTip></p>
              <p class="font-bold text-xl" :class="isNetAnomalous(group) ? 'text-alarm-400' : 'text-white'">
                <span v-if="isNetAnomalous(group)" class="inline-flex items-center gap-1">
                  ⚠️ {{ formatValue(getNetPower(group), 'W') }}
                  <InfoTip title="Anomalía detectada">El neto es negativo: las cargas downstream suman más potencia que el medidor padre. Posibles causas: desfase temporal entre lecturas, error de calibración, o generación local (solar). Revisa los medidores.</InfoTip>
                </span>
                <span v-else>{{ formatValue(getNetPower(group), 'W') }}</span>
              </p>
            </div>
          </div>

          <!-- Downstream children -->
          <div class="space-y-2">
            <router-link
              v-for="(child, idx) in group.downstreamChildren"
              :key="child.id"
              :to="`/factory/${$route.params.factoryId}/device/${child.id}`"
              class="flex items-center gap-3 bg-surface-800/30 rounded-lg p-3 hover:bg-surface-700/40 transition-colors border-l-3 border-l-amber-500/50"
            >
              <!-- Tree connector -->
              <span class="text-amber-500/60 text-sm font-mono shrink-0">{{ idx === group.downstreamChildren.length - 1 ? '└─' : '├─' }}</span>
              <!-- Child info -->
              <div class="flex-1 min-w-0">
                <p class="text-white text-base font-medium truncate">{{ child.name }}</p>
                <p class="text-surface-300 text-sm">
                  {{ t(`devices.type.${child.device_type}`) }} · {{ child.model || '' }} · IP {{ child.host || '—' }}
                </p>
              </div>
              <!-- Child power -->
              <div v-if="getDeviceData(child.id)" class="text-right shrink-0">
                <p class="text-primary-400 font-bold text-base">
                  {{ formatValue(getDeviceData(child.id)?.power_w_total || getDeviceData(child.id)?.power_w, 'W') }}
                </p>
                <p class="text-surface-300 text-sm">
                  PF {{ (getDeviceData(child.id)?.power_factor || 0).toFixed(3) }}
                  <span v-if="costInfo?.price_kwh"> · {{ getDeviceCostPerHour(child.id) }} €/h</span>
                </p>
              </div>
              <span v-else class="text-surface-300 text-sm">—</span>
            </router-link>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ Section 4: Dispositivos ═══ -->
    <template v-if="standaloneDevices.length">
      <h3 class="text-surface-200 text-base uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-surface-400"></span> Dispositivos <InfoTip title="Dispositivos independientes">Medidores que no tienen sub-medidores ni pertenecen a otro medidor como fase o downstream. Cada uno mide un equipo o circuito individual.</InfoTip>
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <router-link
          v-for="device in standaloneDevices"
          :key="device.id"
          :to="`/factory/${$route.params.factoryId}/device/${device.id}`"
          class="glass-card glass-card-hover p-5 block"
        >
          <div class="flex items-start justify-between mb-4">
            <div>
              <h4 class="text-white font-semibold text-lg">{{ device.name }}</h4>
              <p class="text-surface-300 text-base mt-0.5">
                {{ t(`devices.type.${device.device_type}`) }} · {{ device.model || 'EM340' }}
                <span v-if="device.host" class="text-surface-300"> · {{ device.host }}</span>
              </p>
            </div>
            <span class="badge" :class="{
              'badge-info': device.device_type === 'trifasica',
              'badge-energy': device.device_type === 'master',
              'badge-warning': device.device_type === 'monofasica',
            }">
              {{ t(`devices.type.${device.device_type}`) }}
            </span>
          </div>

          <div v-if="getDeviceData(device.id)" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-surface-800/50 rounded-lg p-3">
                <p class="text-surface-200 text-base mb-1">{{ t('telemetry.power') }} <InfoTip title="Potencia activa">Energía útil consumida ahora (W). Potencia × horas = kWh facturados.</InfoTip></p>
                <p class="text-2xl font-bold text-primary-400">
                  {{ formatValue(getDeviceData(device.id)?.power_w_total || getDeviceData(device.id)?.power_w, 'W') }}
                </p>
              </div>
              <div class="bg-surface-800/50 rounded-lg p-3">
                <p class="text-surface-200 text-base mb-1">{{ t('telemetry.powerFactor') }} <InfoTip title="Factor de potencia">Eficiencia eléctrica (0–1). ≥ 0.95 ideal (verde), &lt; 0.95 penalizable por exceso de reactiva (Circular 3/2020 CNMC). Se mejora con condensadores.</InfoTip></p>
                <p class="text-2xl font-bold" :class="getPFColor(getDeviceData(device.id)?.power_factor)">
                  {{ (getDeviceData(device.id)?.power_factor || 0).toFixed(3) }}
                </p>
              </div>
            </div>
            <div v-if="costInfo?.price_kwh" class="bg-surface-800/30 rounded-lg p-2.5 flex items-center justify-between">
              <span class="text-surface-200 text-base">💰 Coste actual <InfoTip title="Coste por hora">Potencia actual (kW) × precio (€/kWh) = coste si se mantiene 1 hora.</InfoTip></span>
              <span class="font-bold text-base text-white">{{ getDeviceCostPerHour(device.id) }} €/hora</span>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center">
              <div v-if="device.device_type !== 'monofasica'" v-for="(phase, i) in ['L1', 'L2', 'L3']" :key="phase" class="bg-surface-800/30 rounded-lg py-2 px-1">
                <p class="text-surface-300 text-sm">{{ phase }}</p>
                <p class="text-white text-base font-semibold">{{ formatValue(getDeviceData(device.id)?.[`voltage_l${i+1}_n`], 'V') }}</p>
                <p class="text-surface-200 text-sm">{{ formatValue(getDeviceData(device.id)?.[`current_l${i+1}`], 'A') }}</p>
              </div>
              <template v-if="device.device_type === 'monofasica'">
                <div class="bg-surface-800/30 rounded-lg py-2 px-1 col-span-3">
                  <p class="text-white text-base font-semibold">
                    {{ formatValue(getDeviceData(device.id)?.voltage, 'V') }} · {{ formatValue(getDeviceData(device.id)?.current, 'A') }}
                  </p>
                </div>
              </template>
            </div>
          </div>
          <div v-else class="text-center py-4">
            <p class="text-surface-300 text-sm">{{ t('common.noData') }}</p>
          </div>
        </router-link>
      </div>
    </template>
    </template>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useFactoryStore } from '@/stores/factory.store.js'
import { useTelemetryStore } from '@/stores/telemetry.store.js'
import { useWebSocket } from '@/composables/useWebSocket.js'
import { useAuthStore } from '@/stores/auth.store.js'
import api from '@/services/api.js'
import InfoTip from '@/components/ui/InfoTip.vue'
import DailyCostChart from '@/components/factory/DailyCostChart.vue'
import FactoryGraphView from '@/components/factory/FactoryGraphView.vue'

const { t } = useI18n()
const route = useRoute()
const factoryStore = useFactoryStore()
const telemetryStore = useTelemetryStore()
const authStore = useAuthStore()

const viewMode = ref('cards')
const { connected: wsConnected, connect, joinFactory, leaveFactory } = useWebSocket()

// ── Data freshness indicator ──
// Check if RPi is actually sending data, not just if WS is connected
const DATA_FRESH_THRESHOLD = 30_000  // 30 seconds for realtime mode
const now = ref(Date.now())
let freshnessTimer = null

const isDataFresh = computed(() => {
  const lastReceived = telemetryStore.lastRealtimeReceived
  if (!lastReceived) {
    // No WS data yet — check devices' last_updated from API
    const devs = factoryStore.devices || []
    const newestUpdate = devs.reduce((max, d) => {
      const ts = d.last_updated ? new Date(d.last_updated).getTime() : 0
      return ts > max ? ts : max
    }, 0)
    return newestUpdate > 0 && (now.value - newestUpdate) < DATA_FRESH_THRESHOLD
  }
  return (now.value - lastReceived) < DATA_FRESH_THRESHOLD
})

const dataStatusClass = computed(() => {
  if (!wsConnected.value) return 'bg-surface-600 text-surface-400'
  if (isDataFresh.value) return 'bg-energy-500/15 text-energy-400'
  return 'bg-warning-500/15 text-warning-400'
})

const dataStatusDotClass = computed(() => {
  if (!wsConnected.value) return 'bg-surface-500'
  if (isDataFresh.value) return 'bg-energy-400 animate-pulse-glow'
  return 'bg-warning-400'
})

const dataStatusLabel = computed(() => {
  if (!wsConnected.value) return 'Offline'
  if (isDataFresh.value) return t('telemetry.realtime')
  return 'Sin datos recientes'
})

const showSettingsButton = computed(() => {
  const role = authStore.user?.role
  return role === 'superadmin' || role === 'manager'
})

const factory = computed(() => factoryStore.currentFactory)
const devices = computed(() => factoryStore.devices)

// Group devices: trifásicos with phase children are merged into grouped cards
const phaseChildIds = computed(() => {
  const ids = new Set()
  for (const d of devices.value) {
    if (d.parent_relation === 'phase_channel' && d.parent_device_id) ids.add(d.id)
  }
  return ids
})

const phaseMap = computed(() => {
  const map = {}
  for (const d of devices.value) {
    if (d.parent_relation === 'phase_channel' && d.parent_device_id) {
      if (!map[d.parent_device_id]) map[d.parent_device_id] = []
      map[d.parent_device_id].push(d)
    }
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => (a.phase_channel || '').localeCompare(b.phase_channel || ''))
  }
  return map
})

// Section 1: General meter
const generalMeterGroup = computed(() =>
  devices.value.find(d => d.device_role === 'general_meter' && !phaseChildIds.value.has(d.id))
)

// Section 2: Trifásicos with phase children (excluding general meter)
const phaseGroups = computed(() =>
  devices.value
    .filter(d => phaseMap.value[d.id]?.length && d.device_role !== 'general_meter')
    .map(d => ({ ...d, phaseChildren: phaseMap.value[d.id] || [] }))
)

// Downstream: group children under their parent
const downstreamChildIds = computed(() => {
  const ids = new Set()
  for (const d of devices.value) {
    if (d.parent_relation === 'downstream' && d.parent_device_id) ids.add(d.id)
  }
  return ids
})

const downstreamMap = computed(() => {
  const map = {}
  for (const d of devices.value) {
    if (d.parent_relation === 'downstream' && d.parent_device_id) {
      if (!map[d.parent_device_id]) map[d.parent_device_id] = []
      map[d.parent_device_id].push(d)
    }
  }
  return map
})

// Section 3: Downstream groups (parents with downstream children)
const downstreamGroups = computed(() =>
  devices.value
    .filter(d =>
      downstreamMap.value[d.id]?.length &&
      d.device_role !== 'general_meter' &&
      !phaseChildIds.value.has(d.id) &&
      !(phaseMap.value[d.id]?.length)
    )
    .map(d => ({ ...d, downstreamChildren: downstreamMap.value[d.id] || [] }))
)

// Section 4: Standalone devices (no hierarchy involvement)
const standaloneDevices = computed(() =>
  devices.value.filter(d =>
    d.device_role !== 'general_meter' &&
    !phaseChildIds.value.has(d.id) &&
    !(phaseMap.value[d.id]?.length) &&
    !downstreamChildIds.value.has(d.id) &&
    !(downstreamMap.value[d.id]?.length)
  )
)

const getDeviceData = (deviceId) => {
  const rt = telemetryStore.realtimeData[deviceId]
  return rt?.data || null
}

const formatValue = (value, unit) => {
  if (value == null || value === undefined) return '—'
  if (unit === 'W' && value > 1000) return `${(value / 1000).toFixed(1)} kW`
  if (unit === 'A') return `${value.toFixed(2)} A`
  return `${value.toFixed(1)} ${unit}`
}

const getPFColor = (pf) => {
  if (!pf) return 'text-surface-400'
  if (pf >= 0.95) return 'text-energy-400'
  return 'text-alarm-400'
}

const getDeviceCostPerHour = (deviceId) => {
  if (!costInfo.value?.price_kwh) return '0.00'
  const data = getDeviceData(deviceId)
  if (!data) return '0.00'
  const powerKw = (data.power_w_total || data.power_w || 0) / 1000
  const costPerHour = powerKw * costInfo.value.price_kwh
  return costPerHour.toFixed(2)
}

// Phase helpers — read L1/L2/L3 from parent's realtime data
const getPhaseData = (phase) => {
  const parentId = phase.parent_device_id
  if (!parentId) return null
  const parentData = getDeviceData(parentId)
  if (!parentData) return null
  const ch = phase.phase_channel // 'L1', 'L2', 'L3'
  const chLower = ch?.toLowerCase() // 'l1', 'l2', 'l3'
  return {
    power_w: parentData[`power_w_${chLower}`] || 0,
    power_va: parentData[`power_va_${chLower}`] || 0,
    power_var: parentData[`power_var_${chLower}`] || 0,
    power_factor: parentData[`power_factor_${chLower}`] || parentData.power_factor || 0,
    current_a: parentData[`current_${chLower}`] || 0,
    voltage_v: parentData[`voltage_${chLower}_n`] || 0,
    frequency_hz: parentData.frequency_hz || 50,
  }
}

const getPhaseCostPerHour = (phase) => {
  if (!costInfo.value?.price_kwh) return '0.00'
  const data = getPhaseData(phase)
  if (!data) return '0.00'
  const powerKw = (data.power_w || 0) / 1000
  return (powerKw * costInfo.value.price_kwh).toFixed(2)
}

// Downstream helpers
const getChildPowerSum = (group) => {
  let sum = 0
  for (const child of (group.downstreamChildren || [])) {
    const data = getDeviceData(child.id)
    if (data) sum += (data.power_w_total || data.power_w || 0)
  }
  return sum
}

const getNetPower = (group) => {
  const data = getDeviceData(group.id)
  if (!data) return 0
  const gross = data.power_w_total || data.power_w || 0
  return gross - getChildPowerSum(group)
}

// Detect if net power is anomalously negative (children > parent)
const isNetAnomalous = (group) => {
  return getNetPower(group) < 0
}

// Downstream children of a specific phase sub-device
const getPhaseDownstream = (phaseId) => {
  return devices.value.filter(d =>
    d.parent_device_id === phaseId &&
    d.parent_relation === 'downstream'
  )
}

// Total factory power — prefer general_meter, fallback to sum of root devices
const totalFactoryKw = computed(() => {
  // Try general meter first
  const generalMeter = devices.value.find(d => d.device_role === 'general_meter')
  if (generalMeter) {
    const data = getDeviceData(generalMeter.id)
    if (data) return (data.power_w_total || data.power_w || 0) / 1000
  }
  // Fallback: sum only root devices (no parent) to avoid double counting
  let total = 0
  for (const device of devices.value) {
    if (device.parent_device_id) continue // skip children
    const data = getDeviceData(device.id)
    if (data) {
      total += (data.power_w_total || data.power_w || 0) / 1000
    }
  }
  return total
})

const powerUsagePct = computed(() => {
  if (!costInfo.value?.contracted_power_kw) return 0
  return (totalFactoryKw.value / costInfo.value.contracted_power_kw) * 100
})

const powerGaugeColor = computed(() => {
  if (powerUsagePct.value > 90) return 'text-alarm-400'
  if (powerUsagePct.value > 70) return 'text-warning-400'
  return 'text-energy-400'
})

const powerGaugeBarClass = computed(() => {
  if (powerUsagePct.value > 90) return 'bg-alarm-500'
  if (powerUsagePct.value > 70) return 'bg-warning-500'
  return 'bg-energy-500'
})

const factoryId = route.params.factoryId
const costInfo = ref(null)
const graphPositions = ref({})
let costInterval = null
let savePositionsTimer = null


// ── Improvement C: Phase imbalance ──
const getImbalance = (deviceId) => {
  const data = getDeviceData(deviceId)
  if (!data) return null
  const i1 = parseFloat(data.current_l1 || 0)
  const i2 = parseFloat(data.current_l2 || 0)
  const i3 = parseFloat(data.current_l3 || 0)
  if (i1 === 0 && i2 === 0 && i3 === 0) return null
  const avg = (i1 + i2 + i3) / 3
  if (avg === 0) return null
  const maxI = Math.max(i1, i2, i3)
  const minI = Math.min(i1, i2, i3)
  return ((maxI - minI) / avg) * 100
}

const generalImbalance = computed(() => {
  if (!generalMeterGroup.value) return null
  return getImbalance(generalMeterGroup.value.id)
})

// ── Improvement D: Reactive power penalty ──
const pfBannerVisible = ref(false)
const pfTriggeredValue = ref(0)
const pfTriggeredPenalty = ref(0)

const generalPF = computed(() => {
  if (!generalMeterGroup.value) return 0
  const data = getDeviceData(generalMeterGroup.value.id)
  return parseFloat(data?.power_factor || 0)
})

const calcPenalty = (pf) => {
  if (pf >= 0.90) return 0
  if (pf >= 0.85) return 4.16
  if (pf >= 0.80) return 4.16 * 2
  return 4.16 * 3
}

// Show banner when PF drops below 0.90 — capture the triggered value
watch(generalPF, (newPF) => {
  if (newPF > 0 && newPF < 0.90 && !pfBannerVisible.value) {
    pfTriggeredValue.value = newPF
    pfTriggeredPenalty.value = calcPenalty(newPF)
    pfBannerVisible.value = true
  }
})

// Simplified penalty estimation per RD 1164/2001
// Real penalty depends on cos φ bands, this is a first approximation
const reactivePenaltyPct = computed(() => {
  const pf = generalPF.value
  if (pf >= 0.95) return 0
  if (pf >= 0.90) return 0  // no penalty above 0.90
  if (pf >= 0.85) return 4.16
  if (pf >= 0.80) return 4.16 * 2
  return 4.16 * 3  // very poor
})

// ── Improvement E: Peak demand ──
const peakDemandKw = computed(() => {
  if (!generalMeterGroup.value) return 0
  const data = getDeviceData(generalMeterGroup.value.id)
  return parseFloat(data?.demand_w_max || 0) / 1000
})

const fetchCost = async () => {
  try {
    const res = await api.get(`/factories/${factoryId}/cost/current`)
    costInfo.value = res.data.data
  } catch (e) { /* no contract yet */ }
}

onMounted(async () => {
  await factoryStore.fetchFactory(factoryId)
  await factoryStore.fetchDevices(factoryId)

  // Fetch initial latest data for each device
  for (const device of factoryStore.devices) {
    await telemetryStore.fetchLatest(device.id)
  }

  // Connect WebSocket for real-time
  connect()
  joinFactory(factoryId)

  // Fetch cost info + refresh every 60s
  await fetchCost()
  costInterval = setInterval(fetchCost, 60000)

  // Freshness timer: re-evaluate data staleness every 5s
  freshnessTimer = setInterval(() => { now.value = Date.now() }, 5000)

  // Load saved graph positions
  try {
    const posRes = await api.get(`/factories/${factoryId}/graph-positions`)
    graphPositions.value = posRes.data.data || {}
  } catch (e) { /* no positions saved yet — use algorithmic layout */ }
})

onUnmounted(() => {
  leaveFactory(factoryId)
  if (costInterval) clearInterval(costInterval)
  if (savePositionsTimer) clearTimeout(savePositionsTimer)
  if (freshnessTimer) clearInterval(freshnessTimer)
})

// ── Graph Position Persistence ──
const onPositionsUpdate = (updatedPositions) => {
  // Merge into local state immediately
  graphPositions.value = { ...graphPositions.value, ...updatedPositions }

  // Debounce the API save (500ms)
  if (savePositionsTimer) clearTimeout(savePositionsTimer)
  savePositionsTimer = setTimeout(async () => {
    try {
      await api.put(`/factories/${factoryId}/graph-positions`, {
        positions: graphPositions.value
      })
    } catch (e) {
      console.warn('Failed to save graph positions:', e)
    }
  }, 500)
}

const onPositionsReset = async () => {
  try {
    await api.delete(`/factories/${factoryId}/graph-positions`)
    graphPositions.value = {}
  } catch (e) {
    console.warn('Failed to reset graph positions:', e)
  }
}
</script>
