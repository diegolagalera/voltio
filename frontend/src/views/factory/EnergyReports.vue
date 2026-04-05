<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-white">Informes Energéticos</h2>
      <p class="text-surface-400 text-sm">{{ factory?.name || '' }}</p>
    </div>

    <!-- Tab Bar -->
    <div class="flex gap-1 mb-6 border-b border-surface-700">
      <button
        @click="activeTab = 'factory'"
        class="px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
        :class="activeTab === 'factory'
          ? 'border-primary-500 text-primary-400'
          : 'border-transparent text-surface-400 hover:text-white hover:border-surface-500'"
      >
        🏭 Fábrica
      </button>
      <button
        @click="activeTab = 'device'; loadDeviceList()"
        class="px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
        :class="activeTab === 'device'
          ? 'border-primary-500 text-primary-400'
          : 'border-transparent text-surface-400 hover:text-white hover:border-surface-500'"
      >
        ⚙️ Máquina
      </button>
    </div>

    <!-- ===== FACTORY TAB ===== -->
    <div v-show="activeTab === 'factory'">

    <!-- Date Range Selector -->
    <div class="glass-card p-4 mb-6 flex flex-wrap items-center gap-3">
      <div class="flex rounded-lg overflow-hidden border border-surface-600">
        <button
          v-for="r in ranges"
          :key="r.key"
          @click="setRange(r.key)"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedRange === r.key
            ? 'bg-primary-600 text-white'
            : 'bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-white'"
        >
          {{ r.label }}
        </button>
      </div>
      <div v-if="selectedRange === 'single_day'" class="flex items-center gap-2">
        <input type="date" v-model="singleDay" @change="fetchAll()" class="input text-sm px-3 py-2" />
      </div>
      <div v-if="selectedRange === 'custom'" class="flex items-center gap-2">
        <input type="date" v-model="customFrom" class="input text-sm px-3 py-2" />
        <span class="text-surface-400">→</span>
        <input type="date" v-model="customTo" class="input text-sm px-3 py-2" />
        <button @click="fetchAll()" class="btn-primary text-sm px-4 py-2">Consultar</button>
      </div>
      <p class="text-surface-500 text-xs ml-auto">
        {{ formatDateRange() }}
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12">
      <div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      <p class="text-surface-400 text-sm">Cargando informes...</p>
    </div>

    <template v-else>
      <!-- KPI Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="glass-card p-4">
          <p class="text-surface-200 text-sm mb-1">💰 Coste Total</p>
          <p class="text-2xl font-bold text-primary-400">{{ summary.total_cost?.toFixed(2) || '0.00' }} <span class="text-sm font-normal">€</span></p>
        </div>
        <div class="glass-card p-4">
          <p class="text-surface-200 text-sm mb-1">⚡ Consumo Total</p>
          <p class="text-2xl font-bold text-energy-400">{{ summary.total_kwh?.toFixed(1) || '0' }} <span class="text-sm font-normal">kWh</span></p>
        </div>
        <div class="glass-card p-4">
          <p class="text-surface-200 text-sm mb-1">📊 Precio Medio</p>
          <p class="text-2xl font-bold text-white">{{ summary.avg_price_kwh?.toFixed(4) || '0' }} <span class="text-sm font-normal">€/kWh</span></p>
        </div>
        <div class="glass-card p-4">
          <p class="text-surface-200 text-sm mb-1">🔺 Pico Potencia</p>
          <p class="text-2xl font-bold text-warning-400">{{ summary.peak_kw?.toFixed(1) || '0' }} <span class="text-sm font-normal">kW</span></p>
          <p v-if="summary.contracted_power_kw" class="text-surface-300 text-xs mt-1">
            Contratada: {{ summary.contracted_power_kw }} kW
          </p>
        </div>
      </div>

      <!-- Cost By Period Chart -->
      <div class="glass-card p-5 mb-6">
        <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Coste por Periodo
        </h3>
        <div ref="costChartRef" style="width: 100%; height: 350px;"></div>
      </div>

      <!-- Power Demand Chart -->
      <div class="glass-card p-5 mb-6">
        <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Curva de Demanda de Potencia
        </h3>
        <div ref="powerChartRef" style="width: 100%; height: 370px;"></div>
      </div>

      <!-- Power Quality Section (Circular 3/2020 CNMC) -->
      <div class="glass-card p-5 mb-6">
        <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Calidad Eléctrica <InfoTip title="Circular 3/2020 CNMC">Análisis de calidad eléctrica basado en la normativa vigente. Evalúa la energía reactiva por periodo tarifario (P1-P6) y el cumplimiento de potencia contratada (maxímetro). Los datos se obtienen del contador general de la fábrica.</InfoTip>
        </h3>

        <!-- Global KPI Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          <div class="rounded-lg p-3 border" :class="pfStatusBorder">
            <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">cos φ Medio <InfoTip title="Factor de Potencia">Relación entre potencia activa (kW) y potencia aparente (kVA). Indica la eficiencia con la que se usa la energía. Un cos φ ≥ 0.95 evita penalizaciones. Se calcula como media ponderada del periodo seleccionado.</InfoTip></p>
            <p class="text-2xl font-bold" :class="pfStatusColor">{{ pfKpis.avg_pf?.toFixed(3) || '—' }}</p>
            <p class="text-sm mt-0.5" :class="pfStatusColor">
              {{ pfKpis.status === 'excellent' ? '✓ Sin penalización' : pfKpis.status === 'warning' ? '⚠ Zona de riesgo' : '🔴 Penalización activa' }}
            </p>
          </div>
          <div class="rounded-lg p-3 border border-surface-700 bg-surface-800/30">
            <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Ratio kVArh/kWh <InfoTip title="Ratio de Reactiva">Proporción de energía reactiva consumida respecto a la activa. Si supera el 33% (equivalente a cos φ < 0.95), la distribuidora aplica un recargo por exceso de reactiva. Fórmula: (kVArh ÷ kWh) × 100.</InfoTip></p>
            <p class="text-2xl font-bold" :class="(pfKpis.global_ratio || 0) > 33 ? 'text-alarm-400' : 'text-energy-400'">{{ pfKpis.global_ratio?.toFixed(1) || '0' }}%</p>
            <p class="text-surface-300 text-sm mt-0.5">Límite: 33%</p>
          </div>
          <div class="rounded-lg p-3 border border-surface-700 bg-surface-800/30">
            <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Exceso Reactiva <InfoTip title="Exceso de Reactiva">Energía reactiva inductiva que supera el límite permitido (33% de la activa). Solo la parte que excede genera recargo. Fórmula: max(0, kVArh − 0.33 × kWh). Se reduce instalando baterías de condensadores.</InfoTip></p>
            <p class="text-2xl font-bold" :class="(pfKpis.total_excess_kvarh || 0) > 0 ? 'text-alarm-400' : 'text-energy-400'">{{ pfKpis.total_excess_kvarh?.toFixed(1) || '0' }} <span class="text-sm font-normal">kVArh</span></p>
          </div>
          <div class="rounded-lg p-3 border" :class="(pfKpis.total_reactive_penalty_eur || 0) > 0 ? 'border-alarm-500/30 bg-alarm-500/5' : 'border-surface-700 bg-surface-800/30'">
            <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Recargo Reactiva <InfoTip title="Recargo por Reactiva">Coste estimado del exceso de energía reactiva inductiva. La distribuidora factura cada kVArh de exceso a una tarifa regulada (~0.041554 €/kVArh). Fórmula: exceso_kVArh × 0.041554 €.</InfoTip></p>
            <p class="text-2xl font-bold" :class="(pfKpis.total_reactive_penalty_eur || 0) > 0 ? 'text-alarm-400' : 'text-energy-400'">{{ pfKpis.total_reactive_penalty_eur?.toFixed(2) || '0.00' }} <span class="text-sm font-normal">€</span></p>
            <p class="text-surface-300 text-sm mt-0.5">0.041554 €/kVArh</p>
          </div>
          <div class="rounded-lg p-3 border" :class="pfKpis.has_maximeter_penalty ? 'border-alarm-500/30 bg-alarm-500/5' : 'border-surface-700 bg-surface-800/30'">
            <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Maxímetro <InfoTip title="Maxímetro (Potencia)">Compara la potencia máxima demandada en intervalos de 15 minutos con la potencia contratada por periodo (P1–P6). Exceso 0–5%: sin recargo. 5–15%: recargo ×2 sobre término de potencia. >15%: recargo ×3. Se controla evitando picos de arranque simultáneos.</InfoTip></p>
            <p class="text-2xl font-bold" :class="pfKpis.has_maximeter_penalty ? 'text-alarm-400' : 'text-energy-400'">{{ pfKpis.has_maximeter_penalty ? '⚠ Exceso' : '✓ OK' }}</p>
            <p class="text-surface-300 text-sm mt-0.5">Pot. contratada</p>
          </div>
        </div>

        <!-- Reactive Energy by Tariff Period -->
        <div v-if="Object.keys(reactiveByPeriod).length > 0" class="mb-5">
          <h4 class="text-surface-100 text-base font-medium mb-2">⚡ Energía Reactiva por Periodo Tarifario <InfoTip title="Energía Reactiva por Periodo">Desglosa la energía activa (kWh) y reactiva (kVArh) en cada periodo tarifario (P1=Punta a P6=Super Valle). El ratio kVArh/kWh determina si hay exceso: por encima del 33% se penaliza. Los periodos dependen de la hora, día de la semana, temporada y festivos.</InfoTip></h4>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-surface-200 text-xs uppercase border-b border-surface-700">
                  <th class="py-2 px-3 text-left">Periodo</th>
                  <th class="py-2 px-3 text-right">kWh <InfoTip title="kWh">Energía activa consumida en este periodo. Es la energía útil que realiza trabajo real (motores, calor, luz).</InfoTip></th>
                  <th class="py-2 px-3 text-right">kVArh <InfoTip title="kVArh">Energía reactiva inductiva consumida. Se debe a cargas como motores, transformadores y lámparas fluorescentes. No produce trabajo útil pero la distribuidora la penaliza si es excesiva.</InfoTip></th>
                  <th class="py-2 px-3 text-right">Ratio <InfoTip title="Ratio kVArh/kWh">Proporción de reactiva sobre activa. Si supera 33% (cos φ < 0.95), hay exceso penalizable. Fórmula: (kVArh ÷ kWh) × 100.</InfoTip></th>
                  <th class="py-2 px-3 text-right">Exceso <InfoTip title="Exceso kVArh">kVArh que exceden el 33% permitido sobre los kWh. Solo esta parte genera recargo. Fórmula: kVArh − (0.33 × kWh).</InfoTip></th>
                  <th class="py-2 px-3 text-right">Recargo <InfoTip title="Recargo €">Coste estimado del exceso de reactiva. Se factura a ~0.041554 € por cada kVArh de exceso.</InfoTip></th>
                  <th class="py-2 px-3 text-right">cos φ <InfoTip title="cos φ del periodo">Factor de potencia medio durante este periodo. Por debajo de 0.95 indica consumo excesivo de reactiva.</InfoTip></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(data, period) in reactiveByPeriod" :key="period" class="border-b border-surface-800 hover:bg-surface-800/30">
                  <td class="py-2 px-3">
                    <span class="inline-block w-2.5 h-2.5 rounded-full mr-2" :style="{ backgroundColor: periodColors[period] }"></span>
                    <span class="font-medium text-white">{{ period }}</span>
                    <span class="text-surface-300 text-xs ml-1">{{ periodLabels[period] }}</span>
                  </td>
                  <td class="py-2 px-3 text-right text-white">{{ data.kwh.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right text-white">{{ data.kvarh.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right font-medium" :class="data.ratio > 33 ? 'text-alarm-400' : 'text-energy-400'">{{ data.ratio.toFixed(1) }}%</td>
                  <td class="py-2 px-3 text-right" :class="data.excess_kvarh > 0 ? 'text-alarm-400 font-medium' : 'text-surface-400'">{{ data.excess_kvarh.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right" :class="data.penalty_eur > 0 ? 'text-alarm-400 font-medium' : 'text-surface-400'">{{ data.penalty_eur.toFixed(2) }} €</td>
                  <td class="py-2 px-3 text-right" :class="data.avg_pf >= 0.95 ? 'text-energy-400' : 'text-alarm-400'">{{ data.avg_pf.toFixed(3) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-surface-600 font-medium">
                  <td class="py-2 px-3 text-white">TOTAL</td>
                  <td class="py-2 px-3 text-right text-white">{{ pfKpis.total_kwh?.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right text-white">{{ pfKpis.total_kvarh?.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right" :class="(pfKpis.global_ratio || 0) > 33 ? 'text-alarm-400' : 'text-energy-400'">{{ pfKpis.global_ratio?.toFixed(1) }}%</td>
                  <td class="py-2 px-3 text-right" :class="(pfKpis.total_excess_kvarh || 0) > 0 ? 'text-alarm-400' : 'text-surface-400'">{{ pfKpis.total_excess_kvarh?.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right" :class="(pfKpis.total_reactive_penalty_eur || 0) > 0 ? 'text-alarm-400' : 'text-surface-400'">{{ pfKpis.total_reactive_penalty_eur?.toFixed(2) }} €</td>
                  <td class="py-2 px-3 text-right" :class="(pfKpis.avg_pf || 0) >= 0.95 ? 'text-energy-400' : 'text-alarm-400'">{{ pfKpis.avg_pf?.toFixed(3) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- Maxímetro by Period -->
        <div v-if="Object.keys(maximeterData).length > 0" class="mb-5">
          <h4 class="text-surface-100 text-base font-medium mb-2">📊 Maxímetro <InfoTip title="Maxímetro">La distribuidora registra la potencia media demandada cada 15 minutos. Si la máxima supera la potencia contratada en un periodo, se aplican penalizaciones: 0–5% tolerancia, 5–15% recargo doble del término de potencia, >15% recargo triple. Optimizable con sistemas de control de demanda.</InfoTip></h4>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-surface-200 text-xs uppercase border-b border-surface-700">
                  <th class="py-2 px-3 text-left">Periodo</th>
                  <th class="py-2 px-3 text-right">Contratada <InfoTip title="Potencia Contratada">Potencia máxima que tienes contratada con la distribuidora para este periodo tarifario (en kW). Se configura en el contrato eléctrico.</InfoTip></th>
                  <th class="py-2 px-3 text-right">Máx. Demandada <InfoTip title="Máxima Demandada">Potencia media máxima registrada en un intervalo de 15 minutos durante este periodo. Es el valor que la distribuidora usa para calcular excesos.</InfoTip></th>
                  <th class="py-2 px-3 text-right">Exceso <InfoTip title="Exceso de Potencia">Porcentaje en que la demanda máxima supera la contratada. Fórmula: ((demandada − contratada) ÷ contratada) × 100.</InfoTip></th>
                  <th class="py-2 px-3 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(data, period) in maximeterData" :key="period" class="border-b border-surface-800 hover:bg-surface-800/30">
                  <td class="py-2 px-3">
                    <span class="inline-block w-2.5 h-2.5 rounded-full mr-2" :style="{ backgroundColor: periodColors[period] }"></span>
                    <span class="font-medium text-white">{{ period }}</span>
                  </td>
                  <td class="py-2 px-3 text-right text-surface-300">{{ data.contracted_kw }}</td>
                  <td class="py-2 px-3 text-right font-medium" :class="data.excess_pct > 0 ? 'text-alarm-400' : 'text-energy-400'">{{ data.max_demand_kw }}</td>
                  <td class="py-2 px-3 text-right" :class="data.excess_pct > 5 ? 'text-alarm-400 font-medium' : data.excess_pct > 0 ? 'text-warning-400' : 'text-surface-400'">{{ data.excess_pct > 0 ? `+${data.excess_pct.toFixed(1)}%` : '—' }}</td>
                  <td class="py-2 px-3">
                    <span v-if="data.status === 'critical'" class="text-alarm-400 text-xs font-medium">🚨 Exceso >15% (recargo ×3)</span>
                    <span v-else-if="data.status === 'warning'" class="text-warning-400 text-xs font-medium">⚠ Exceso 5-15% (recargo ×2)</span>
                    <span v-else-if="data.status === 'info'" class="text-cyan-400 text-xs">ℹ Exceso &lt;5% (sin recargo extra)</span>
                    <span v-else class="text-energy-400 text-xs">✓ OK</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- PF Chart -->
        <h4 class="text-surface-100 text-base font-medium mb-2">📈 Factor de Potencia por Hora</h4>
        <div ref="pfChartRef" style="width: 100%; height: 420px;"></div>

        <!-- Phase Balance -->
        <div v-if="phaseBalance" class="mt-5">
          <h4 class="text-surface-100 text-base font-medium mb-3">⚖️ Equilibrio de Fases <InfoTip title="Desequilibrio de Fases">Mide la diferencia entre las tres fases (L1, L2, L3). Un desequilibrio elevado provoca calentamiento en motores, incrementa pérdidas y reduce la vida útil de los equipos. Tensión: >2% warning, >5% crítico (EN 50160). Corriente/Potencia: >10% warning, >20% crítico.</InfoTip></h4>
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <!-- Voltage Balance -->
            <div class="rounded-lg p-3 border" :class="phaseBalance.voltage.status === 'critical' ? 'border-alarm-500/30 bg-alarm-500/5' : phaseBalance.voltage.status === 'warning' ? 'border-warning-500/30 bg-warning-500/5' : 'border-surface-700 bg-surface-800/30'">
              <div class="flex items-center justify-between mb-2">
                <p class="text-surface-200 text-xs uppercase tracking-wider">Tensión (V) <InfoTip title="Tensión">Tensión fase-neutro media por fase. Desequilibrio = (max−min)/media × 100. Límite EN 50160: 2%.</InfoTip></p>
                <span class="text-xs font-bold" :class="phaseBalance.voltage.status === 'ok' ? 'text-energy-400' : phaseBalance.voltage.status === 'warning' ? 'text-warning-400' : 'text-alarm-400'">{{ phaseBalance.voltage.imbalance_pct }}%</span>
              </div>
              <div v-for="ph in ['l1','l2','l3']" :key="'v'+ph" class="mb-1.5 last:mb-0">
                <div class="flex items-center justify-between text-xs mb-0.5">
                  <span class="text-surface-200">{{ ph.toUpperCase() }}</span>
                  <span class="text-white font-medium">{{ phaseBalance.voltage['avg_'+ph] }} V</span>
                </div>
                <div class="h-1.5 rounded-full bg-surface-700 overflow-hidden">
                  <div class="h-full rounded-full transition-all" :style="{ width: phaseBarWidth(phaseBalance.voltage, ph) }" :class="ph === 'l1' ? 'bg-red-400' : ph === 'l2' ? 'bg-yellow-400' : 'bg-blue-400'"></div>
                </div>
              </div>
            </div>
            <!-- Current Balance -->
            <div class="rounded-lg p-3 border" :class="phaseBalance.current.status === 'critical' ? 'border-alarm-500/30 bg-alarm-500/5' : phaseBalance.current.status === 'warning' ? 'border-warning-500/30 bg-warning-500/5' : 'border-surface-700 bg-surface-800/30'">
              <div class="flex items-center justify-between mb-2">
                <p class="text-surface-200 text-xs uppercase tracking-wider">Corriente (A) <InfoTip title="Corriente">Corriente media por fase. Un desequilibrio alto indica cargas mal distribuidas. Límite recomendado: 10%.</InfoTip></p>
                <span class="text-xs font-bold" :class="phaseBalance.current.status === 'ok' ? 'text-energy-400' : phaseBalance.current.status === 'warning' ? 'text-warning-400' : 'text-alarm-400'">{{ phaseBalance.current.imbalance_pct }}%</span>
              </div>
              <div v-for="ph in ['l1','l2','l3']" :key="'i'+ph" class="mb-1.5 last:mb-0">
                <div class="flex items-center justify-between text-xs mb-0.5">
                  <span class="text-surface-200">{{ ph.toUpperCase() }}</span>
                  <span class="text-white font-medium">{{ phaseBalance.current['avg_'+ph] }} A</span>
                </div>
                <div class="h-1.5 rounded-full bg-surface-700 overflow-hidden">
                  <div class="h-full rounded-full transition-all" :style="{ width: phaseBarWidth(phaseBalance.current, ph) }" :class="ph === 'l1' ? 'bg-red-400' : ph === 'l2' ? 'bg-yellow-400' : 'bg-blue-400'"></div>
                </div>
              </div>
            </div>
            <!-- Power Balance -->
            <div class="rounded-lg p-3 border" :class="phaseBalance.power.status === 'critical' ? 'border-alarm-500/30 bg-alarm-500/5' : phaseBalance.power.status === 'warning' ? 'border-warning-500/30 bg-warning-500/5' : 'border-surface-700 bg-surface-800/30'">
              <div class="flex items-center justify-between mb-2">
                <p class="text-surface-200 text-xs uppercase tracking-wider">Potencia (W) <InfoTip title="Potencia por Fase">Potencia activa media por fase. Desequilibrio indica carga desigual entre fases. Límite recomendado: 10%.</InfoTip></p>
                <span class="text-xs font-bold" :class="phaseBalance.power.status === 'ok' ? 'text-energy-400' : phaseBalance.power.status === 'warning' ? 'text-warning-400' : 'text-alarm-400'">{{ phaseBalance.power.imbalance_pct }}%</span>
              </div>
              <div v-for="ph in ['l1','l2','l3']" :key="'w'+ph" class="mb-1.5 last:mb-0">
                <div class="flex items-center justify-between text-xs mb-0.5">
                  <span class="text-surface-200">{{ ph.toUpperCase() }}</span>
                  <span class="text-white font-medium">{{ phaseBalance.power['avg_'+ph] }} W</span>
                </div>
                <div class="h-1.5 rounded-full bg-surface-700 overflow-hidden">
                  <div class="h-full rounded-full transition-all" :style="{ width: phaseBarWidth(phaseBalance.power, ph) }" :class="ph === 'l1' ? 'bg-red-400' : ph === 'l2' ? 'bg-yellow-400' : 'bg-blue-400'"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Voltage Monitoring -->
        <div v-if="voltageMonitoring" class="mt-5">
          <h4 class="text-surface-100 text-base font-medium mb-3">🔌 Monitorización de Tensión <InfoTip title="Tensión de Red (EN 50160)">La distribuidora debe suministrar tensión dentro de 230V ±7% (214–246V). Fuera de este rango puede dañar equipos. Se registra el mínimo y máximo de cada fase durante el periodo seleccionado.</InfoTip></h4>
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
            <div class="rounded-lg p-3 border border-surface-700 bg-surface-800/30">
              <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Nominal</p>
              <p class="text-lg font-bold text-white">{{ voltageMonitoring.nominal_v }} V</p>
              <p class="text-surface-300 text-xs mt-0.5">±{{ voltageMonitoring.tolerance_pct }}%</p>
            </div>
            <div class="rounded-lg p-3 border border-surface-700 bg-surface-800/30">
              <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Rango permitido</p>
              <p class="text-lg font-bold text-white">{{ voltageMonitoring.range_min }}–{{ voltageMonitoring.range_max }} V</p>
            </div>
            <div class="rounded-lg p-3 border" :class="voltageMonitoring.hours_out_of_range > 0 ? 'border-alarm-500/30 bg-alarm-500/5' : 'border-energy-500/30 bg-energy-500/5'">
              <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Horas fuera rango</p>
              <p class="text-lg font-bold" :class="voltageMonitoring.hours_out_of_range > 0 ? 'text-alarm-400' : 'text-energy-400'">{{ voltageMonitoring.hours_out_of_range }} <span class="text-sm font-normal">/ {{ voltageMonitoring.hours_total }}h</span></p>
            </div>
            <div class="rounded-lg p-3 border border-surface-700 bg-surface-800/30 lg:col-span-2">
              <p class="text-surface-200 text-xs uppercase tracking-wider mb-0.5">Estado</p>
              <p class="text-lg font-bold" :class="voltageMonitoring.status === 'ok' ? 'text-energy-400' : 'text-alarm-400'">{{ voltageMonitoring.status === 'ok' ? '✓ Dentro de rango' : '⚠ Desviaciones detectadas' }}</p>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-surface-200 text-xs uppercase border-b border-surface-700">
                  <th class="py-2 px-3 text-left">Fase</th>
                  <th class="py-2 px-3 text-right">Media (V)</th>
                  <th class="py-2 px-3 text-right">Mínimo (V)</th>
                  <th class="py-2 px-3 text-right">Máximo (V)</th>
                  <th class="py-2 px-3 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="ph in voltageMonitoring.phases" :key="'vmon'+ph" class="border-b border-surface-800 hover:bg-surface-800/30">
                  <td class="py-2 px-3">
                    <span class="inline-block w-2.5 h-2.5 rounded-full mr-2" :class="ph === 'l1' ? 'bg-red-400' : ph === 'l2' ? 'bg-yellow-400' : 'bg-blue-400'"></span>
                    <span class="font-medium text-white">{{ ph.toUpperCase() }}</span>
                  </td>
                  <td class="py-2 px-3 text-right text-white">{{ voltageMonitoring[ph].avg }}</td>
                  <td class="py-2 px-3 text-right" :class="voltageMonitoring[ph].min < voltageMonitoring.range_min ? 'text-alarm-400 font-medium' : 'text-surface-300'">{{ voltageMonitoring[ph].min }}</td>
                  <td class="py-2 px-3 text-right" :class="voltageMonitoring[ph].max > voltageMonitoring.range_max ? 'text-alarm-400 font-medium' : 'text-surface-300'">{{ voltageMonitoring[ph].max }}</td>
                  <td class="py-2 px-3">
                    <span v-if="voltageMonitoring[ph].min < voltageMonitoring.range_min || voltageMonitoring[ph].max > voltageMonitoring.range_max" class="text-alarm-400 text-xs font-medium">⚠ Fuera de rango</span>
                    <span v-else class="text-energy-400 text-xs">✓ OK</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Device Breakdown -->
      <div class="glass-card p-5">
        <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-energy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          Desglose por Máquina
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-surface-200 text-sm border-b border-surface-700">
                <th class="text-left p-3 font-medium">Máquina</th>
                <th class="text-left p-3 font-medium">Tipo</th>
                <th class="text-right p-3 font-medium">Potencia Media</th>
                <th class="text-right p-3 font-medium">kWh</th>
                <th class="text-right p-3 font-medium">Coste €</th>
                <th class="text-right p-3 font-medium">% Total</th>
                <th class="p-3 font-medium w-32"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="d in deviceBreakdown.devices" :key="d.device_id">
                <!-- Parent device row -->
                <tr class="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors">
                  <td class="p-3 text-white font-medium">
                    {{ d.device_name }}
                    <span v-if="d.phases?.length" class="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{{ d.phases.length }} fases</span>
                    <span v-if="d.downstream?.length" class="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{{ d.downstream.length }} downstream</span>
                  </td>
                  <td class="p-3 text-surface-200">{{ d.device_type }}</td>
                  <td class="p-3 text-right text-surface-300">{{ d.avg_kw }} kW</td>
                  <td class="p-3 text-right">
                    <span v-if="d.downstream?.length && d.kwh_net != null" class="text-energy-400 font-semibold">{{ d.kwh_net }}</span>
                    <span v-else class="text-energy-400 font-semibold">{{ d.kwh }}</span>
                    <p v-if="d.downstream?.length && d.kwh_gross != null && d.kwh_gross !== d.kwh_net" class="text-surface-300 text-xs">
                      bruto: {{ d.kwh_gross }}
                    </p>
                  </td>
                  <td class="p-3 text-right">
                    <span class="text-primary-400 font-semibold">{{ (d.cost_net ?? d.cost_eur)?.toFixed(2) }}€</span>
                    <p v-if="d.downstream?.length && d.cost_gross != null && d.cost_gross !== d.cost_net" class="text-surface-300 text-xs">
                      bruto: {{ d.cost_gross?.toFixed(2) }}€
                    </p>
                  </td>
                  <td class="p-3 text-right text-surface-300">{{ d.pct }}%</td>
                  <td class="p-3">
                    <div class="w-full bg-surface-800 rounded-full h-2">
                      <div class="h-full rounded-full bg-primary-500" :style="{ width: Math.min(d.pct, 100) + '%' }"></div>
                    </div>
                  </td>
                </tr>
                <!-- Phase sub-rows -->
                <tr v-for="phase in d.phases" :key="phase.device_id" class="border-b border-surface-800/30 bg-surface-800/10">
                  <td class="p-3 pl-8 text-surface-300">
                    <span class="inline-flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" :class="{
                        'bg-blue-400': phase.phase_channel === 'L1',
                        'bg-amber-400': phase.phase_channel === 'L2',
                        'bg-green-400': phase.phase_channel === 'L3'
                      }"></span>
                      {{ phase.phase_channel }} · {{ phase.device_name }}
                    </span>
                  </td>
                  <td class="p-3 text-surface-300 text-sm italic">fase</td>
                  <td class="p-3 text-right text-surface-200">{{ phase.avg_kw }} kW</td>
                  <td class="p-3 text-right text-energy-400/70">{{ phase.kwh }}</td>
                  <td class="p-3 text-right text-primary-400/70">{{ phase.cost_eur?.toFixed(2) }}€</td>
                  <td class="p-3 text-right text-surface-200">{{ phase.pct }}%</td>
                  <td class="p-3">
                    <div class="w-full bg-surface-800 rounded-full h-1.5">
                      <div class="h-full rounded-full" :class="{
                        'bg-blue-400/60': phase.phase_channel === 'L1',
                        'bg-amber-400/60': phase.phase_channel === 'L2',
                        'bg-green-400/60': phase.phase_channel === 'L3'
                      }" :style="{ width: Math.min(phase.pct, 100) + '%' }"></div>
                    </div>
                  </td>
                </tr>
                <!-- Phase subtotal -->
                <tr v-if="d.phases?.length > 1" class="border-b border-surface-700/50 bg-surface-800/20">
                  <td class="p-2 pl-8 text-surface-200 text-sm" colspan="2">
                    <span class="border-t border-dashed border-surface-600 pt-1 inline-block">Σ {{ d.phases.length }} fases</span>
                  </td>
                  <td class="p-2 text-right text-surface-200 text-sm border-t border-dashed border-surface-700">
                    {{ d.phases.reduce((s, p) => s + (p.avg_kw || 0), 0).toFixed(2) }} kW
                  </td>
                  <td class="p-2 text-right text-energy-400/80 text-sm font-semibold border-t border-dashed border-surface-700">
                    {{ d.phases.reduce((s, p) => s + (p.kwh || 0), 0).toFixed(2) }} kWh
                  </td>
                  <td class="p-2 text-right text-primary-400/80 text-sm font-semibold border-t border-dashed border-surface-700">
                    {{ d.phases.reduce((s, p) => s + (p.cost_eur || 0), 0).toFixed(2) }}€
                  </td>
                  <td class="p-2 text-right text-surface-200 text-sm border-t border-dashed border-surface-700">
                    {{ d.phases.reduce((s, p) => s + (p.pct || 0), 0).toFixed(1) }}%
                  </td>
                  <td class="p-2"></td>
                </tr>
                <!-- Downstream sub-rows -->
                <tr v-for="ds in d.downstream" :key="ds.device_id" class="border-b border-surface-800/30 bg-surface-800/10">
                  <td class="p-3 pl-8 text-surface-300">
                    <span class="inline-flex items-center gap-1.5">
                      <span class="text-amber-500 text-sm">↓</span>
                      {{ ds.device_name }}
                    </span>
                  </td>
                  <td class="p-3 text-surface-300 text-sm italic">downstream</td>
                  <td class="p-3 text-right text-surface-200">{{ ds.avg_kw }} kW</td>
                  <td class="p-3 text-right text-energy-400/70">{{ ds.kwh }}</td>
                  <td class="p-3 text-right text-primary-400/70">{{ ds.cost_eur?.toFixed(2) }}€</td>
                  <td class="p-3 text-right text-surface-200">{{ ds.pct }}%</td>
                  <td class="p-3">
                    <div class="w-full bg-surface-800 rounded-full h-1.5">
                      <div class="h-full rounded-full bg-amber-500/50" :style="{ width: Math.min(ds.pct, 100) + '%' }"></div>
                    </div>
                  </td>
                </tr>
                <!-- Downstream subtotal -->
                <tr v-if="d.downstream?.length > 1" class="border-b border-surface-700/50 bg-surface-800/20">
                  <td class="p-2 pl-8 text-surface-200 text-sm" colspan="2">
                    <span class="border-t border-dashed border-surface-600 pt-1 inline-block">Σ {{ d.downstream.length }} sub-medidores</span>
                  </td>
                  <td class="p-2 text-right text-surface-200 text-sm border-t border-dashed border-surface-700">
                    {{ d.downstream.reduce((s, c) => s + (c.avg_kw || 0), 0).toFixed(2) }} kW
                  </td>
                  <td class="p-2 text-right text-energy-400/80 text-sm font-semibold border-t border-dashed border-surface-700">
                    {{ d.downstream.reduce((s, c) => s + (c.kwh || 0), 0).toFixed(2) }} kWh
                  </td>
                  <td class="p-2 text-right text-primary-400/80 text-sm font-semibold border-t border-dashed border-surface-700">
                    {{ d.downstream.reduce((s, c) => s + (c.cost_eur || 0), 0).toFixed(2) }}€
                  </td>
                  <td class="p-2 text-right text-surface-200 text-sm border-t border-dashed border-surface-700">
                    {{ d.downstream.reduce((s, c) => s + (c.pct || 0), 0).toFixed(1) }}%
                  </td>
                  <td class="p-2"></td>
                </tr>
              </template>
              <!-- Unmonitored -->
              <tr v-if="deviceBreakdown.unmonitored?.pct > 0" class="border-b border-warning-500/20 bg-warning-500/5">
                <td class="p-3 text-warning-400 font-medium flex items-center gap-1.5">
                  <span>⚠️</span> Consumo No Monitorizado
                </td>
                <td class="p-3 text-warning-400/60 text-sm italic">sin medidor</td>
                <td class="p-3 text-right text-warning-400">{{ deviceBreakdown.unmonitored.kw }} kW</td>
                <td class="p-3 text-right text-warning-400 font-semibold">{{ deviceBreakdown.unmonitored.kwh }}</td>
                <td class="p-3 text-right text-warning-400 font-semibold">{{ deviceBreakdown.unmonitored.cost_eur?.toFixed(2) }}€</td>
                <td class="p-3 text-right text-warning-400">{{ deviceBreakdown.unmonitored.pct }}%</td>
                <td class="p-3">
                  <div class="w-full bg-surface-800 rounded-full h-2">
                    <div class="h-full rounded-full bg-warning-500/70" :style="{ width: Math.min(deviceBreakdown.unmonitored.pct, 100) + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
            <!-- Total footer -->
            <tfoot v-if="deviceBreakdown.total?.kwh">
              <tr class="border-t-2 border-surface-600">
                <td class="p-3 text-energy-400 font-bold" colspan="2">TOTAL (Contador General)</td>
                <td class="p-3 text-right text-energy-400 font-bold">{{ deviceBreakdown.total.kw }} kW</td>
                <td class="p-3 text-right text-energy-400 font-bold">{{ deviceBreakdown.total.kwh }} kWh</td>
                <td class="p-3 text-right text-primary-400 font-bold">{{ deviceBreakdown.total.cost_eur?.toFixed(2) }}€</td>
                <td class="p-3 text-right text-energy-400 font-bold">100%</td>
                <td class="p-3"></td>
              </tr>
            </tfoot>
          </table>
          <p v-if="!deviceBreakdown.devices?.length" class="text-surface-500 text-center py-6">
            No hay datos de dispositivos para este periodo.
          </p>
        </div>
      </div>
    </template>
    </div> <!-- end factory tab -->

    <!-- ===== DEVICE TAB ===== -->
    <div v-show="activeTab === 'device'">

      <!-- Device Date Range Selector -->
      <div class="glass-card p-4 mb-6 flex flex-wrap items-center gap-3">
        <div class="flex rounded-lg overflow-hidden border border-surface-600">
          <button
            v-for="r in ranges"
            :key="'dev-' + r.key"
            @click="setDeviceRange(r.key)"
            class="px-4 py-2 text-sm font-medium transition-colors"
            :class="deviceSelectedRange === r.key
              ? 'bg-primary-600 text-white'
              : 'bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-white'"
          >
            {{ r.label }}
          </button>
        </div>
        <div v-if="deviceSelectedRange === 'single_day'" class="flex items-center gap-2">
          <input type="date" v-model="deviceSingleDay" @change="fetchDeviceReport()" class="input text-sm px-3 py-2" />
        </div>
        <div v-if="deviceSelectedRange === 'custom'" class="flex items-center gap-2">
          <input type="date" v-model="deviceCustomFrom" class="input text-sm px-3 py-2" />
          <span class="text-surface-400">→</span>
          <input type="date" v-model="deviceCustomTo" class="input text-sm px-3 py-2" />
          <button @click="fetchDeviceReport()" class="btn-primary text-sm px-4 py-2">Consultar</button>
        </div>

        <!-- Device Selector -->
        <div class="ml-auto flex items-center gap-2">
          <select
            v-model="selectedDeviceId"
            @change="fetchDeviceReport()"
            class="input text-sm px-3 py-2 min-w-[240px]"
          >
            <option value="">Selecciona un dispositivo...</option>
            <optgroup label="─── Activos ───">
              <option v-for="d in activeDeviceOptions" :key="d.id" :value="d.id">
                {{ d.prefix }}{{ d.name }} ({{ d.device_type }})
              </option>
            </optgroup>
            <optgroup v-if="inactiveDeviceOptions.length" label="─── Desactivados ───">
              <option v-for="d in inactiveDeviceOptions" :key="d.id" :value="d.id">
                {{ d.prefix }}{{ d.name }} (desactivado)
              </option>
            </optgroup>
          </select>
        </div>
      </div>

      <!-- Device Loading -->
      <div v-if="deviceLoading" class="text-center py-12">
        <div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-surface-400 text-sm">Cargando informe del dispositivo...</p>
      </div>

      <!-- No device selected -->
      <div v-else-if="!selectedDeviceId" class="glass-card p-12 text-center">
        <span class="text-4xl">????️</span>
        <p class="text-surface-400 text-sm mt-3">Selecciona un dispositivo para ver su informe histórico.</p>
      </div>

      <!-- Device Report Content -->
      <template v-else-if="deviceReport.device">

        <!-- Device Header + Status -->
        <div class="glass-card p-4 mb-4 flex items-center gap-3">
          <div class="flex-1">
            <h3 class="text-white font-semibold text-lg">{{ deviceReport.device.name }}</h3>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-surface-700 text-surface-300">
                {{ deviceReport.device.device_type }}
              </span>
              <span v-if="deviceReport.device.device_role" class="text-[10px] px-2 py-0.5 rounded-full bg-energy-500/15 text-energy-400">
                {{ deviceReport.device.device_role === 'general_meter' ? 'Contador General' : deviceReport.device.device_role }}
              </span>
              <span v-if="deviceReport.device.phase_channel" class="text-[10px] px-2 py-0.5 rounded-full"
                :class="{
                  'bg-blue-500/20 text-blue-400': deviceReport.device.phase_channel === 'L1',
                  'bg-amber-500/20 text-amber-400': deviceReport.device.phase_channel === 'L2',
                  'bg-emerald-500/20 text-emerald-400': deviceReport.device.phase_channel === 'L3',
                }">
                Fase {{ deviceReport.device.phase_channel }}
              </span>
              <span v-if="!deviceReport.device.is_active" class="text-[10px] px-2 py-0.5 rounded-full bg-alarm-500/15 text-alarm-400">
                Desactivado
              </span>
            </div>
          </div>
        </div>

        <!-- Hierarchy Context Timeline -->
        <div v-if="deviceReport.hierarchy_changes?.length" class="glass-card p-3 mb-4">
          <p class="text-surface-200 text-xs uppercase tracking-wider mb-2">📋 Contexto jerárquico en el periodo</p>
          <div class="space-y-1">
            <div v-for="(h, i) in deviceReport.hierarchy_changes" :key="i" class="flex items-center gap-2 text-xs">
              <span class="text-surface-500">{{ new Date(h.from).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }}</span>
              <span class="text-surface-600">→</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-medium"
                :class="h.parent_device_id ? 'bg-cyan-500/15 text-cyan-400' : 'bg-surface-700 text-surface-300'">
                {{ h.label }}
              </span>
            </div>
          </div>
        </div>

        <!-- Device KPI Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">⚡ Consumo Total</p>
            <p class="text-2xl font-bold text-energy-400">{{ deviceKpis.total_kwh?.toFixed(1) || '0' }} <span class="text-sm font-normal">kWh</span></p>
            <p v-if="deviceKpis.estimated_cost_eur" class="text-primary-400 text-[10px] mt-1">~{{ deviceKpis.estimated_cost_eur?.toFixed(2) }}€ estimado</p>
          </div>
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">📊 Potencia Media</p>
            <p class="text-2xl font-bold text-white">{{ deviceKpis.avg_kw?.toFixed(2) || '0' }} <span class="text-sm font-normal">kW</span></p>
          </div>
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">🔺 Potencia Pico</p>
            <p class="text-2xl font-bold text-warning-400">{{ deviceKpis.peak_kw?.toFixed(2) || '0' }} <span class="text-sm font-normal">kW</span></p>
            <p v-if="deviceKpis.peak_kw_time" class="text-surface-300 text-xs mt-1">
              {{ new Date(deviceKpis.peak_kw_time).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) }}
            </p>
          </div>
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">🛡️ FP Medio</p>
            <p class="text-2xl font-bold" :class="deviceKpis.avg_pf >= 0.95 ? 'text-energy-400' : deviceKpis.avg_pf >= 0.90 ? 'text-cyan-400' : 'text-alarm-400'">{{ deviceKpis.avg_pf?.toFixed(3) || '—' }}</p>
            <p v-if="deviceKpis.hours_below_095 > 0" class="text-alarm-400 text-[10px] mt-1">{{ deviceKpis.hours_below_095 }}h bajo 0.95</p>
          </div>
        </div>

        <!-- New: Load Factor + Operating Hours -->
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">📐 Factor de Carga <InfoTip title="Factor de Carga">Mide la eficiencia de utilización: potencia media / potencia pico × 100. Un valor alto (>70%) indica uso estable. Un valor bajo (<30%) indica arranques puntuales o máquina sobredimensionada.</InfoTip></p>
            <p class="text-2xl font-bold" :class="deviceKpis.load_factor >= 70 ? 'text-energy-400' : deviceKpis.load_factor >= 40 ? 'text-cyan-400' : 'text-warning-400'">{{ deviceKpis.load_factor || 0 }}<span class="text-sm font-normal">%</span></p>
            <p class="text-surface-300 text-xs mt-1">{{ deviceKpis.avg_kw?.toFixed(2) }} / {{ deviceKpis.peak_kw?.toFixed(2) }} kW</p>
          </div>
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">🟢 Horas Operación <InfoTip title="Horas de Operación">Horas en las que la máquina consumió ≥ 100W (por encima del umbral de standby/ruido). Indica la actividad real del equipo.</InfoTip></p>
            <p class="text-2xl font-bold text-energy-400">{{ deviceKpis.operating_hours || 0 }}<span class="text-sm font-normal">h</span></p>
            <p v-if="deviceKpis.hours_total" class="text-surface-300 text-xs mt-1">de {{ deviceKpis.hours_total }}h totales</p>
          </div>
          <div class="glass-card p-4">
            <p class="text-surface-200 text-sm mb-1">⚫ Horas Inactivo <InfoTip title="Horas Inactivo">Horas con consumo < 100W (standby o apagada). Comparar con horas de operación indica el patrón de uso.</InfoTip></p>
            <p class="text-2xl font-bold text-surface-400">{{ deviceKpis.idle_hours || 0 }}<span class="text-sm font-normal">h</span></p>
            <p v-if="deviceKpis.operating_hours != null && deviceKpis.hours_total" class="text-surface-300 text-xs mt-1">
              {{ deviceKpis.hours_total > 0 ? Math.round(deviceKpis.operating_hours / deviceKpis.hours_total * 100) : 0 }}% utilización
            </p>
          </div>
        </div>

        <!-- Cost by Period -->
        <div v-if="deviceReport.cost_by_period" class="glass-card p-5 mb-6">
          <h4 class="text-surface-100 text-base font-medium mb-3">💰 Coste por Periodo Tarifario <InfoTip title="Coste por Periodo">Distribuye el consumo de esta máquina en los periodos tarifarios P1-P6 según la hora de consumo, y calcula el coste usando el precio medio €/kWh de la fábrica para cada periodo. Permite identificar si la máquina opera mayoritariamente en horas caras (P1) o baratas (P6).</InfoTip></h4>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-surface-200 text-xs uppercase border-b border-surface-700">
                  <th class="py-2 px-3 text-left">Periodo</th>
                  <th class="py-2 px-3 text-right">kWh</th>
                  <th class="py-2 px-3 text-right">€/kWh</th>
                  <th class="py-2 px-3 text-right">Coste (€)</th>
                  <th class="py-2 px-3 text-right">% del total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in Object.keys(deviceReport.cost_by_period.periods)" :key="'cbp'+p" class="border-b border-surface-800 hover:bg-surface-800/30">
                  <td class="py-2 px-3">
                    <span class="inline-block w-2.5 h-2.5 rounded-full mr-2" :style="{ backgroundColor: periodColors[p] }"></span>
                    <span class="font-medium text-white">{{ p }}</span>
                    <span class="text-surface-300 text-xs ml-1">{{ periodLabels[p] }}</span>
                  </td>
                  <td class="py-2 px-3 text-right text-white">{{ deviceReport.cost_by_period.periods[p].kwh.toFixed(1) }}</td>
                  <td class="py-2 px-3 text-right text-surface-300">{{ deviceReport.cost_by_period.periods[p].price_kwh.toFixed(4) }}</td>
                  <td class="py-2 px-3 text-right font-medium" :class="p === 'P1' ? 'text-alarm-400' : p === 'P6' ? 'text-energy-400' : 'text-white'">{{ deviceReport.cost_by_period.periods[p].cost_eur.toFixed(2) }}€</td>
                  <td class="py-2 px-3 text-right text-surface-400">{{ deviceReport.cost_by_period.total_cost_eur > 0 ? Math.round(deviceReport.cost_by_period.periods[p].cost_eur / deviceReport.cost_by_period.total_cost_eur * 100) : 0 }}%</td>
                </tr>
                <tr class="border-t border-surface-600 font-bold">
                  <td class="py-2 px-3 text-white">TOTAL</td>
                  <td class="py-2 px-3 text-right text-white">{{ deviceKpis.total_kwh?.toFixed(1) }}</td>
                  <td class="py-2 px-3"></td>
                  <td class="py-2 px-3 text-right text-energy-400">{{ deviceReport.cost_by_period.total_cost_eur.toFixed(2) }}€</td>
                  <td class="py-2 px-3 text-right text-surface-400">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Device Chart (Power + PF overlay) -->
        <div class="glass-card p-5">
          <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
            <svg class="w-5 h-5 text-energy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Consumo y Factor de Potencia por Hora
          </h3>
          <div ref="deviceChartRef" style="width: 100%; height: 350px;"></div>
        </div>

      </template>

      <!-- Device error -->
      <div v-else-if="deviceReport.error" class="glass-card p-8 text-center">
        <span class="text-3xl">❌</span>
        <p class="text-alarm-400 text-sm mt-2">{{ deviceReport.error }}</p>
      </div>

    </div> <!-- end device tab -->

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useFactoryStore } from '@/stores/factory.store.js'
import api from '@/services/api.js'
import InfoTip from '@/components/ui/InfoTip.vue'
import * as echarts from 'echarts'

const route = useRoute()
const factoryStore = useFactoryStore()
const factoryId = route.params.factoryId
const factory = computed(() => factoryStore.currentFactory)

const loading = ref(true)
const selectedRange = ref('today')
const customFrom = ref('')
const customTo = ref('')
const singleDay = ref('')

// Tab state
const activeTab = ref('factory')

// Device tab state
const allDevices = ref([])
const selectedDeviceId = ref('')
const deviceLoading = ref(false)
const deviceReport = ref({})
const deviceSelectedRange = ref('today')
const deviceCustomFrom = ref('')
const deviceCustomTo = ref('')
const deviceSingleDay = ref('')
const deviceChartRef = ref(null)
let deviceChart = null

const deviceKpis = computed(() => deviceReport.value.kpis || {})

const summary = ref({})
const costByPeriod = ref({ data: [], period_colors: {}, period_labels: {} })
const powerDemand = ref({ data: [], max_contracted: 0 })
const deviceBreakdown = ref({ devices: [], unmonitored: {}, total: {} })

const costChartRef = ref(null)
const powerChartRef = ref(null)
let costChart = null
let powerChart = null
let pfChart = null

const powerQuality = ref({ pf_timeline: [], reactive_by_period: {}, maximeter: {}, kpis: {} })
const pfChartRef = ref(null)

const pfKpis = computed(() => powerQuality.value.kpis || {})
const reactiveByPeriod = computed(() => powerQuality.value.reactive_by_period || {})
const maximeterData = computed(() => powerQuality.value.maximeter || {})
const phaseBalance = computed(() => powerQuality.value.phase_balance || null)
const voltageMonitoring = computed(() => powerQuality.value.voltage_monitoring || null)

const periodColors = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P4: '#22c55e', P5: '#06b6d4', P6: '#6366f1' }
const periodLabels = { P1: 'Punta', P2: 'Llano Alto', P3: 'Llano', P4: 'Valle Alto', P5: 'Valle', P6: 'Super Valle' }

const phaseBarWidth = (group, ph) => {
  const vals = [group['avg_l1'], group['avg_l2'], group['avg_l3']]
  const max = Math.max(...vals)
  if (max <= 0) return '0%'
  return `${Math.round((group['avg_' + ph] / max) * 100)}%`
}

const pfStatusColor = computed(() => {
  const s = pfKpis.value.status
  if (s === 'excellent') return 'text-energy-400'
  if (s === 'warning') return 'text-warning-400'
  return 'text-alarm-400'
})

const pfStatusBorder = computed(() => {
  const s = pfKpis.value.status
  if (s === 'excellent') return 'border-energy-500/30 bg-energy-500/5'
  if (s === 'warning') return 'border-warning-500/30 bg-warning-500/5'
  return 'border-alarm-500/30 bg-alarm-500/5'
})

const ranges = [
  { key: 'today', label: 'Hoy' },
  { key: 'single_day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'custom', label: 'Personalizado' },
]

const PERIOD_CHART_COLORS = {
  P1: '#ef4444', P2: '#f97316', P3: '#eab308',
  P4: '#22c55e', P5: '#06b6d4', P6: '#6366f1',
}

const setRange = (key) => {
  selectedRange.value = key
  if (key !== 'custom' && key !== 'single_day') fetchAll()
  if (key === 'single_day' && singleDay.value) fetchAll()
}

const getQueryParams = () => {
  if (selectedRange.value === 'single_day' && singleDay.value) {
    return `from=${singleDay.value}&to=${singleDay.value}`
  }
  if (selectedRange.value === 'custom' && customFrom.value && customTo.value) {
    return `from=${customFrom.value}&to=${customTo.value}`
  }
  return `range=${selectedRange.value}`
}

const formatDateRange = () => {
  const now = new Date()
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  switch (selectedRange.value) {
    case 'today': return `Hoy, ${now.toLocaleDateString('es-ES', opts)}`
    case 'single_day': {
      if (!singleDay.value) return 'Selecciona un día'
      const d = new Date(singleDay.value + 'T12:00:00')
      return d.toLocaleDateString('es-ES', { weekday: 'long', ...opts })
    }
    case 'week': {
      const from = new Date(now); from.setDate(from.getDate() - 7)
      return `${from.toLocaleDateString('es-ES', opts)} — ${now.toLocaleDateString('es-ES', opts)}`
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      return `${from.toLocaleDateString('es-ES', opts)} — ${now.toLocaleDateString('es-ES', opts)}`
    }
    case 'custom': return customFrom.value && customTo.value
      ? `${customFrom.value} — ${customTo.value}` : 'Selecciona rango'
    default: return ''
  }
}

const fetchAll = async () => {
  loading.value = true
  const q = getQueryParams()
  const group = (selectedRange.value === 'today' || selectedRange.value === 'single_day') ? 'hour' : 'day'
  try {
    // Sequential fetches to avoid overwhelming the database with concurrent queries
    try {
      const s = await api.get(`/factories/${factoryId}/reports/summary?${q}`)
      summary.value = s.data.data || {}
    } catch (e) { summary.value = {}; console.warn('[Reports] Summary failed:', e.message) }

    try {
      const c = await api.get(`/factories/${factoryId}/reports/cost-by-period?${q}&group=${group}`)
      costByPeriod.value = c.data.data || { data: [] }
    } catch (e) { costByPeriod.value = { data: [] }; console.warn('[Reports] Cost failed:', e.message) }

    try {
      const p = await api.get(`/factories/${factoryId}/reports/power-demand?${q}`)
      powerDemand.value = p.data.data || { data: [] }
    } catch (e) { powerDemand.value = { data: [] }; console.warn('[Reports] Power failed:', e.message) }

    try {
      const d = await api.get(`/factories/${factoryId}/reports/device-breakdown?${q}`)
      deviceBreakdown.value = d.data.data || { devices: [], unmonitored: {}, total: {} }
    } catch (e) { deviceBreakdown.value = { devices: [], unmonitored: {}, total: {} }; console.warn('[Reports] Devices failed:', e.message) }

    try {
      const pq = await api.get(`/factories/${factoryId}/reports/power-quality?${q}`)
      powerQuality.value = pq.data.data || { pf_timeline: [], reactive_by_period: {}, maximeter: {}, kpis: {} }
    } catch (e) { powerQuality.value = { pf_timeline: [], reactive_by_period: {}, maximeter: {}, kpis: {} }; console.warn('[Reports] PF quality failed:', e.message) }
  } catch (e) {
    console.error('[Reports] Fetch error:', e)
  } finally {
    loading.value = false
    await nextTick()
    renderCostChart()
    renderPowerChart()
    renderPfChart()
  }
}

const renderCostChart = () => {
  if (!costChartRef.value) return
  if (costChart) costChart.dispose()
  costChart = echarts.init(costChartRef.value)

  const data = costByPeriod.value.data || []
  const periods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
  const isHourly = selectedRange.value === 'today'

  const xData = data.map(d => {
    const dt = new Date(d.bucket)
    return isHourly ? `${dt.getHours()}:00` : dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  })

  const series = periods.map(p => ({
    name: `${p} ${costByPeriod.value.period_labels?.[p] || ''}`,
    type: 'bar',
    stack: 'cost',
    barMaxWidth: 40,
    itemStyle: { color: PERIOD_CHART_COLORS[p], borderRadius: 0 },
    emphasis: { focus: 'series' },
    data: data.map(d => d[p] || 0),
  }))

  costChart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 13 },
      formatter: (params) => {
        let html = `<strong>${params[0].axisValue}</strong><br/>`
        let total = 0
        params.forEach(p => {
          if (p.value > 0) {
            html += `<span style="color:${p.color}">●</span> ${p.seriesName}: <strong>${p.value.toFixed(2)}€</strong><br/>`
            total += p.value
          }
        })
        html += `<br/><strong>Total: ${total.toFixed(2)}€</strong>`
        return html
      },
    },
    legend: {
      bottom: 0, textStyle: { color: '#cbd5e1', fontSize: 15 },
      itemWidth: 14, itemHeight: 14,
    },
    grid: { left: 60, right: 20, top: 10, bottom: 50 },
    xAxis: { type: 'category', data: xData, axisLabel: { color: '#94a3b8', fontSize: 13 }, axisLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8', fontSize: 13, formatter: '{value}€' }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series,
  }, true)
}

const renderPowerChart = () => {
  if (!powerChartRef.value) return
  if (powerChart) powerChart.dispose()
  powerChart = echarts.init(powerChartRef.value)

  const data = powerDemand.value.data || []
  const maxContracted = powerDemand.value.max_contracted || 0
  const perDevice = powerDemand.value.per_device || []
  const isHourly = selectedRange.value === 'today' || selectedRange.value === 'single_day'

  const xData = data.map(d => {
    const dt = new Date(d.time)
    return isHourly ? `${dt.getHours()}:00` : dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  })

  const DEVICE_COLORS = ['#a78bfa', '#fb923c', '#34d399', '#f472b6', '#facc15']

  const series = [
    {
      name: 'Potencia Media Total',
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#06b6d4', width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(6, 182, 212, 0.3)' },
        { offset: 1, color: 'rgba(6, 182, 212, 0)' },
      ])},
      data: data.map(d => d.avg_kw),
    },
    {
      name: 'Pico',
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#f97316', width: 1, type: 'dotted' },
      data: data.map(d => d.max_kw),
    },
  ]

  // Per-device curves
  perDevice.forEach((dev, i) => {
    const color = DEVICE_COLORS[i % DEVICE_COLORS.length]
    const deviceXData = dev.data.map(d => {
      const dt = new Date(d.time)
      return isHourly ? `${dt.getHours()}:00` : dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    })
    // Map device data to the main xAxis using xData alignment
    const alignedData = xData.map(x => {
      const idx = deviceXData.indexOf(x)
      return idx >= 0 ? dev.data[idx].avg_kw : null
    })
    series.push({
      name: dev.device_name,
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color, width: 1.5 },
      data: alignedData,
    })
  })

  // Contracted power line
  if (maxContracted > 0) {
    series.push({
      name: `Contratada (${maxContracted} kW)`,
      type: 'line',
      symbol: 'none',
      lineStyle: { color: '#ef4444', width: 2, type: 'dashed' },
      data: data.map(() => maxContracted),
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(239, 68, 68, 0.05)' },
        data: [[{ yAxis: maxContracted * 0.9 }, { yAxis: maxContracted }]],
      },
    })
  }

  powerChart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 13 },
    },
    legend: {
      bottom: 0, textStyle: { color: '#cbd5e1', fontSize: 15 },
      itemWidth: 18, itemHeight: 10,
      type: 'scroll',
    },
    grid: { left: 60, right: 20, top: 15, bottom: 100 },
    dataZoom: [
      { type: 'slider', bottom: 35, height: 24, borderColor: '#334155', fillerColor: 'rgba(6,182,212,0.15)', handleStyle: { color: '#06b6d4' }, textStyle: { color: '#94a3b8', fontSize: 12 } },
      { type: 'inside' },
    ],
    xAxis: { type: 'category', data: xData, axisLabel: { color: '#94a3b8', fontSize: 13 }, axisLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8', fontSize: 13, formatter: '{value} kW' }, splitLine: { lineStyle: { color: '#1e293b' } } },
    series,
  }, true)
}

// Handle resize
const handleResize = () => {
  costChart?.resize()
  powerChart?.resize()
  pfChart?.resize()
  deviceChart?.resize()
}

// ══════════════════════════════════════
// DEVICE TAB LOGIC
// ══════════════════════════════════════

const activeDeviceOptions = computed(() => {
  return allDevices.value
    .filter(d => d.is_active)
    .map(d => ({
      id: d.id,
      name: d.name,
      device_type: d.device_type,
      prefix: d.parent_relation === 'phase_channel' ? `  ↳ ${d.phase_channel} · ` :
              d.parent_relation === 'downstream' ? '  ↓ ' : '',
    }))
})

const inactiveDeviceOptions = computed(() => {
  return allDevices.value
    .filter(d => !d.is_active)
    .map(d => ({
      id: d.id,
      name: d.name,
      device_type: d.device_type,
      prefix: d.parent_relation === 'phase_channel' ? `  ↳ ${d.phase_channel} · ` :
              d.parent_relation === 'downstream' ? '  ↓ ' : '',
    }))
})

const loadDeviceList = async () => {
  if (allDevices.value.length > 0) return // already loaded
  try {
    const res = await api.get(`/factories/${factoryId}/devices?include_inactive=true`)
    allDevices.value = res.data.data || []
  } catch (e) {
    console.warn('[Reports] Failed to load devices:', e.message)
    allDevices.value = []
  }
}

const getDeviceQueryParams = () => {
  if (deviceSelectedRange.value === 'single_day' && deviceSingleDay.value) {
    return `from=${deviceSingleDay.value}&to=${deviceSingleDay.value}`
  }
  if (deviceSelectedRange.value === 'custom' && deviceCustomFrom.value && deviceCustomTo.value) {
    return `from=${deviceCustomFrom.value}&to=${deviceCustomTo.value}`
  }
  return `range=${deviceSelectedRange.value}`
}

const setDeviceRange = (key) => {
  deviceSelectedRange.value = key
  if (key !== 'custom' && key !== 'single_day' && selectedDeviceId.value) fetchDeviceReport()
  if (key === 'single_day' && deviceSingleDay.value && selectedDeviceId.value) fetchDeviceReport()
}

const fetchDeviceReport = async () => {
  if (!selectedDeviceId.value) return
  deviceLoading.value = true
  try {
    const q = getDeviceQueryParams()
    const res = await api.get(`/factories/${factoryId}/reports/device/${selectedDeviceId.value}?${q}`)
    deviceReport.value = res.data.data || {}
  } catch (e) {
    console.error('[Reports] Device report failed:', e.message)
    deviceReport.value = { error: 'Error al cargar el informe del dispositivo. Inténtalo de nuevo.' }
  } finally {
    deviceLoading.value = false
    await nextTick()
    renderDeviceChart()
  }
}

const renderDeviceChart = () => {
  if (!deviceChartRef.value) return
  if (deviceChart) deviceChart.dispose()
  deviceChart = echarts.init(deviceChartRef.value)

  const data = (deviceReport.value.timeline || [])
  const isHourly = deviceSelectedRange.value === 'today' || deviceSelectedRange.value === 'single_day'

  if (data.length === 0) return

  const xData = data.map(d => {
    const dt = new Date(d.time)
    return isHourly ? `${dt.getHours()}:00` : dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  })

  deviceChart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 13 },
      formatter: (params) => {
        const label = params[0]?.axisValue || ''
        let html = `<strong>${label}</strong><br/>`
        params.forEach(p => {
          if (p.value != null) {
            const unit = p.seriesName.includes('FP') ? '' : (p.seriesName.includes('kWh') ? ' kWh' : ' kW')
            const val = p.seriesName.includes('FP') ? p.value?.toFixed(3) : p.value?.toFixed(2)
            html += `<span style="color:${p.color}">●</span> ${p.seriesName}: <strong>${val}${unit}</strong><br/>`
          }
        })
        return html
      },
    },
    legend: {
      bottom: 0, textStyle: { color: '#cbd5e1', fontSize: 15 },
      itemWidth: 18, itemHeight: 10,
    },
    grid: { left: 60, right: 60, top: 20, bottom: 50 },
    xAxis: {
      type: 'category', data: xData,
      axisLabel: { color: '#94a3b8', fontSize: 13 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Potencia (kW)',
        nameTextStyle: { color: '#94a3b8', fontSize: 12 },
        axisLabel: { color: '#94a3b8', fontSize: 13, formatter: '{value}' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      {
        type: 'value',
        name: 'FP',
        nameTextStyle: { color: '#94a3b8', fontSize: 12 },
        min: 0.70,
        max: 1.0,
        axisLabel: { color: '#94a3b8', fontSize: 13, formatter: '{value}' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Consumo (kWh)',
        type: 'bar',
        yAxisIndex: 0,
        barMaxWidth: 30,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(52, 211, 153, 0.8)' },
            { offset: 1, color: 'rgba(52, 211, 153, 0.2)' },
          ]),
          borderRadius: [4, 4, 0, 0],
        },
        data: data.map(d => d.delta_kwh ?? 0),
      },
      {
        name: 'Potencia Media',
        type: 'line',
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#06b6d4', width: 2 },
        data: data.map(d => d.avg_kw ?? 0),
      },
      {
        name: 'Potencia Pico',
        type: 'line',
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#f97316', width: 1, type: 'dotted' },
        data: data.map(d => d.max_kw ?? 0),
      },
      {
        name: 'FP',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        connectNulls: true,
        lineStyle: { color: '#a78bfa', width: 2 },
        data: data.map(d => d.avg_pf),
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: 0.90,
              lineStyle: { color: '#ef4444', type: 'dashed', width: 1 },
              label: { show: false },
            },
          ],
        },
      },
    ],
  }, true)
}

const renderPfChart = () => {
  if (!pfChartRef.value) return
  if (pfChart) pfChart.dispose()
  pfChart = echarts.init(pfChartRef.value)

  const data = powerQuality.value.pf_timeline || []
  const isHourly = selectedRange.value === 'today' || selectedRange.value === 'single_day'

  const xData = data.map(d => {
    const dt = new Date(d.time)
    return isHourly ? `${dt.getHours()}:00` : dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  })

  pfChart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 13 },
      formatter: (params) => {
        const p = params[0]
        if (p.value == null) return `<strong>${p.axisValue}</strong><br/>Sin datos`
        const avgPf = params[0]?.value ?? '—'
        const minPf = params[1]?.value ?? '—'
        const maxPf = params[2]?.value ?? '—'
        let html = `<strong>${p.axisValue}</strong><br/>`
        html += `<span style="color:#06b6d4">●</span> FP Medio: <strong>${typeof avgPf === 'number' ? avgPf.toFixed(3) : avgPf}</strong><br/>`
        html += `<span style="color:#f97316">●</span> FP Mínimo: <strong>${typeof minPf === 'number' ? minPf.toFixed(3) : minPf}</strong><br/>`
        html += `<span style="color:#22c55e">●</span> FP Máximo: <strong>${typeof maxPf === 'number' ? maxPf.toFixed(3) : maxPf}</strong>`
        if (typeof avgPf === 'number' && avgPf < 0.90) html += `<br/><span style="color:#ef4444">⚠ Zona de penalización</span>`
        return html
      },
    },
    legend: {
      bottom: 0, textStyle: { color: '#cbd5e1', fontSize: 15 },
      itemWidth: 18, itemHeight: 10,
    },
    grid: { left: 60, right: 20, top: 20, bottom: 85 },
    dataZoom: [
      { type: 'slider', bottom: 30, height: 22, borderColor: '#334155', fillerColor: 'rgba(6,182,212,0.15)', handleStyle: { color: '#06b6d4' }, textStyle: { color: '#94a3b8', fontSize: 12 } },
      { type: 'inside' },
    ],
    xAxis: {
      type: 'category', data: xData,
      axisLabel: { color: '#94a3b8', fontSize: 13 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      min: (value) => Math.max(0.70, Math.floor(value.min * 20) / 20),
      max: 1.0,
      axisLabel: { color: '#94a3b8', fontSize: 13, formatter: '{value}' },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [
      {
        name: 'FP Medio',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#06b6d4', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(6, 182, 212, 0.25)' },
            { offset: 1, color: 'rgba(6, 182, 212, 0)' },
          ]),
        },
        data: data.map(d => d.avg_pf),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', width: 1.5 },
          data: [
            {
              yAxis: 0.90,
              label: { formatter: 'Penalización (0.90)', color: '#ef4444', fontSize: 12, position: 'insideEndTop' },
              lineStyle: { color: '#ef4444' },
            },
            {
              yAxis: 0.95,
              label: { formatter: 'Óptimo (0.95)', color: '#22c55e', fontSize: 12, position: 'insideEndTop' },
              lineStyle: { color: '#22c55e', type: 'dotted' },
            },
          ],
        },
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(239, 68, 68, 0.06)' },
          data: [[{ yAxis: 0 }, { yAxis: 0.90 }]],
        },
      },
      {
        name: 'FP Mínimo',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#f97316', width: 1, type: 'dotted' },
        data: data.map(d => d.min_pf),
      },
      {
        name: 'FP Máximo',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#22c55e', width: 1, type: 'dotted' },
        data: data.map(d => d.max_pf),
      },
    ],
  }, true)
}

onMounted(async () => {
  await factoryStore.fetchFactory(factoryId)
  window.addEventListener('resize', handleResize)
  await fetchAll()
})

onUnmounted(() => {
  costChart?.dispose()
  powerChart?.dispose()
  pfChart?.dispose()
  deviceChart?.dispose()
  window.removeEventListener('resize', handleResize)
})
</script>
