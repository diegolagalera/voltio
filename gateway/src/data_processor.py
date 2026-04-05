"""
Voltio Gateway — Unified Data Processor
Converts raw Modbus register blocks into engineering values.

Supports two decode modes based on meter protocol:
  - holding_int:    INT16/INT32 with divisor scaling (Carlo Gavazzi EM340/EM111)
  - input_float32:  IEEE 754 Float32, Big-Endian (Eastron SDM630MCT V2)
"""

import struct
import logging

logger = logging.getLogger('DataProcessor')


class DataProcessor:
    """Converts raw Modbus registers to engineering values for any supported meter."""

    def __init__(self, register_map):
        self.register_map = register_map

    # ── Decoders ──

    def _decode_float32(self, registers, index):
        """IEEE 754 Float32 from two 16-bit registers (Big-Endian)."""
        if index + 1 >= len(registers):
            return None
        try:
            raw_bytes = struct.pack('>HH', registers[index], registers[index + 1])
            value = struct.unpack('>f', raw_bytes)[0]
            if value != value or abs(value) > 1e10:
                return None
            return round(value, 4)
        except Exception:
            return None

    def _decode_int_divisor(self, registers, index, size=2, divisor=1):
        """INT16/INT32 with divisor scaling (Carlo Gavazzi format)."""
        try:
            if size == 2 and index + 1 < len(registers):
                raw = (registers[index + 1] << 16) | registers[index]
            elif size == 1 and index < len(registers):
                raw = registers[index]
            else:
                return None
            # Two's complement for signed values
            if size == 2 and raw > 0x7FFFFFFF:
                raw -= 0x100000000
            elif size == 1 and raw > 0x7FFF:
                raw -= 0x10000
            return raw / divisor if divisor != 0 else raw
        except Exception:
            return None

    # ── Block resolver ──

    def _find_and_decode(self, raw_data, address, protocol, reg_info=None):
        """
        Find the correct block for a register address and decode its value.

        Each block in raw_data has 'start' (base address) and 'registers' (list).
        """
        for block_label, block_data in raw_data.items():
            block_start = block_data['start']
            registers = block_data['registers']
            block_end = block_start + len(registers)

            local_index = address - block_start

            if protocol == 'input_float32':
                # Float32: always 2 registers
                if block_start <= address < block_end and address + 1 < block_end:
                    return self._decode_float32(registers, local_index)
            else:
                # INT with divisor: size and divisor from register definition
                size = reg_info.get('size', 2) if reg_info else 2
                divisor = reg_info.get('divisor', 1) if reg_info else 1
                end_needed = address + size - 1

                if block_start <= address and end_needed < block_end:
                    return self._decode_int_divisor(registers, local_index, size, divisor)

        return None

    # ── Main process ──

    def process(self, raw_data, device_type='trifasica'):
        """
        Process raw register blocks into engineering values.

        Args:
            raw_data: dict of block_label -> {'start': int, 'registers': [int]}
            device_type: Key in register map

        Returns:
            dict: parameter_name -> float value
        """
        processed = {}
        device_map = self.register_map.get(device_type)

        if not device_map:
            logger.error(f"No register map for device type: {device_type}")
            return processed

        protocol = device_map.get('protocol', 'holding_int')
        registers_config = device_map.get('registers', {})

        for name, reg_info in registers_config.items():
            address = reg_info['address']
            value = self._find_and_decode(raw_data, address, protocol, reg_info)
            if value is not None:
                processed[name] = value

        return processed

    # ── Telemetry mapper (matches backend DB schema) ──

    def process_to_telemetry(self, raw_data, device_type='trifasica'):
        """
        Process raw data into a payload matching the backend's
        telemetry-insert.helper.js field names EXACTLY.

        Field names match the DB columns in 001_schema.sql.
        Works for any meter type — missing fields simply omitted.
        """
        v = self.process(raw_data, device_type)

        if not v:
            return None

        telemetry = {
            # Voltages (V)
            'voltage_l1_n': v.get('voltage_l1_n'),
            'voltage_l2_n': v.get('voltage_l2_n'),
            'voltage_l3_n': v.get('voltage_l3_n'),
            'voltage_l1_l2': v.get('voltage_l1_l2'),
            'voltage_l2_l3': v.get('voltage_l2_l3'),
            'voltage_l3_l1': v.get('voltage_l3_l1'),

            # Currents (A)
            'current_l1': v.get('current_l1'),
            'current_l2': v.get('current_l2'),
            'current_l3': v.get('current_l3'),

            # Active power (W)
            'power_w_l1': v.get('power_w_l1'),
            'power_w_l2': v.get('power_w_l2'),
            'power_w_l3': v.get('power_w_l3'),
            'power_w_total': v.get('power_w_total'),

            # Apparent power (VA)
            'power_va_l1': v.get('power_va_l1'),
            'power_va_l2': v.get('power_va_l2'),
            'power_va_l3': v.get('power_va_l3'),
            'power_va_total': v.get('power_va_total'),

            # Reactive power (VAR)
            'power_var_l1': v.get('power_var_l1'),
            'power_var_l2': v.get('power_var_l2'),
            'power_var_l3': v.get('power_var_l3'),
            'power_var_total': v.get('power_var_total'),

            # Power factor
            'power_factor': v.get('power_factor_total'),
            'power_factor_l1': v.get('power_factor_l1'),
            'power_factor_l2': v.get('power_factor_l2'),
            'power_factor_l3': v.get('power_factor_l3'),

            # Frequency
            'frequency_hz': v.get('frequency_hz'),

            # Energy
            'energy_kwh_total': v.get('energy_kwh_total'),
            'energy_kvarh_total': v.get('energy_kvarh_total'),
            'energy_kwh_partial': v.get('energy_kwh_partial'),
            'energy_kwh_l1': v.get('energy_kwh_l1') or v.get('energy_kwh_total_l1'),
            'energy_kwh_l2': v.get('energy_kwh_l2') or v.get('energy_kwh_total_l2'),
            'energy_kwh_l3': v.get('energy_kwh_l3') or v.get('energy_kwh_total_l3'),
            # SDM630 export → schema neg_total
            'energy_kwh_neg_total': v.get('energy_kwh_export_total'),
            'energy_kvarh_neg_total': v.get('energy_kvarh_export_total'),

            # Demand
            'demand_w': v.get('demand_w') or v.get('demand_w_total'),
            'demand_w_max': v.get('demand_w_max'),
        }

        # Remove None values
        return {k: val for k, val in telemetry.items() if val is not None}
