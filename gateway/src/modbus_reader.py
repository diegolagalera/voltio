"""
Voltio Gateway — Unified Modbus TCP Reader
Supports multiple meter types via configurable protocol:

  - Carlo Gavazzi EM340/EM24 (trifásica):  FC 03 (Holding Registers), INT16/32 + divisors
  - Carlo Gavazzi EM111 (monofásica):      FC 03 (Holding Registers), INT16/32 + divisors
  - Eastron SDM630MCT V2 (sdm630mct):      FC 04 (Input Registers),  IEEE 754 Float32

Protocol is auto-selected based on device_type → register_map → protocol field.
"""

import struct
import logging
import json
import os

logger = logging.getLogger('ModbusReader')

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    logger.warning("pymodbus not installed. Install with: pip install pymodbus>=3.6.0")
    ModbusTcpClient = None

# Load unified register map
REGISTERS_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'registers.json')
with open(REGISTERS_PATH) as f:
    REGISTER_MAP = json.load(f)


# ── Decoders ──

def decode_float32(registers, index):
    """
    Decode IEEE 754 Float32 from two consecutive 16-bit registers.
    Used for Eastron SDM630MCT V2 (Big-Endian, high word first).
    """
    if index + 1 >= len(registers):
        return None
    try:
        raw_bytes = struct.pack('>HH', registers[index], registers[index + 1])
        value = struct.unpack('>f', raw_bytes)[0]
        if value != value or abs(value) > 1e10:  # NaN / Inf guard
            return None
        return round(value, 4)
    except Exception:
        return None


def decode_int_divisor(registers, index, size=2, divisor=1):
    """
    Decode INT16/INT32 register value with divisor scaling.
    Used for Carlo Gavazzi EM340/EM111 format: (high << 16 | low) / divisor.
    """
    try:
        if size == 2 and index + 1 < len(registers):
            raw = (registers[index + 1] << 16) | registers[index]
        elif size == 1 and index < len(registers):
            raw = registers[index]
        else:
            return None
        # Handle signed values (two's complement)
        if size == 2 and raw > 0x7FFFFFFF:
            raw -= 0x100000000
        elif size == 1 and raw > 0x7FFF:
            raw -= 0x10000
        return raw / divisor if divisor != 0 else raw
    except Exception:
        return None


class ModbusReader:
    """
    Unified Modbus TCP reader supporting both Carlo Gavazzi and Eastron meters.
    Protocol is auto-selected based on device_type in the register map.
    """

    def __init__(self, timeout=3, retries=2):
        self.timeout = timeout
        self.retries = retries
        self._clients = {}

    def _get_client(self, host, port=502):
        """Get or create a cached Modbus TCP client."""
        key = f"{host}:{port}"
        if key not in self._clients:
            if ModbusTcpClient is None:
                logger.error("pymodbus not available")
                return None
            self._clients[key] = ModbusTcpClient(
                host=host,
                port=port,
                timeout=self.timeout,
                retries=self.retries,
            )
        return self._clients[key]

    def connect(self, host, port=502):
        """Connect to a Modbus TCP device."""
        client = self._get_client(host, port)
        if client is None:
            return False
        try:
            if not client.connected:
                result = client.connect()
                if result:
                    logger.debug(f"Connected to {host}:{port}")
                else:
                    logger.warning(f"Failed to connect to {host}:{port}")
                return result
            return True
        except Exception as e:
            logger.error(f"Connection error to {host}:{port}: {e}")
            return False

    def disconnect(self, host=None, port=502):
        """Close Modbus connection(s)."""
        if host:
            key = f"{host}:{port}"
            if key in self._clients:
                try:
                    self._clients[key].close()
                except Exception:
                    pass
                del self._clients[key]
        else:
            for client in self._clients.values():
                try:
                    client.close()
                except Exception:
                    pass
            self._clients.clear()

    def disconnect_all(self):
        """Close all Modbus TCP connections."""
        self.disconnect()

    def _get_protocol(self, device_type):
        """Get protocol string for a device type."""
        device_map = REGISTER_MAP.get(device_type, {})
        return device_map.get('protocol', 'holding_int')

    def read_device(self, host, port=502, modbus_address=1, device_type='trifasica'):
        """
        Read all registers from a meter using the correct protocol.

        - holding_int:    FC 03 (read_holding_registers) for Carlo Gavazzi
        - input_float32:  FC 04 (read_input_registers) for Eastron SDM630

        Returns:
            dict: Raw register blocks keyed by label, or None on error.
        """
        if not self.connect(host, port):
            return None

        client = self._get_client(host, port)
        device_map = REGISTER_MAP.get(device_type, {})
        protocol = device_map.get('protocol', 'holding_int')
        read_blocks = device_map.get('read_blocks', [])

        if not read_blocks:
            logger.error(f"No read_blocks defined for device type: {device_type}")
            return None

        raw_data = {}

        try:
            for block in read_blocks:
                start = block['start']
                count = block['count']
                label = block['label']

                # Select read function based on protocol
                if protocol == 'input_float32':
                    result = client.read_input_registers(
                        address=start, count=count, device_id=modbus_address,
                    )
                else:  # holding_int (Carlo Gavazzi)
                    result = client.read_holding_registers(
                        address=start, count=count, device_id=modbus_address,
                    )

                if not result.isError():
                    raw_data[label] = {
                        'start': start,
                        'registers': result.registers,
                    }
                else:
                    logger.warning(
                        f"Modbus read error ({label}) for {host} "
                        f"slave {modbus_address}: {result}"
                    )

        except Exception as e:
            logger.error(f"Modbus exception for {host}:{port}: {e}")
            self.disconnect(host, port)
            return None

        return raw_data if raw_data else None

    def probe_device(self, host, port=502, modbus_address=1):
        """
        Probe a Modbus TCP device to identify its type.

        Tries FC 04 (Eastron) first, then FC 03 (Carlo Gavazzi).
        Detects meter type by reading voltage registers.

        Returns:
            dict with 'alive', 'type', 'model', 'voltage_sample', 'protocol' or None
        """
        if not self.connect(host, port):
            return None

        client = self._get_client(host, port)

        # ── Try 1: FC 04 (Input Registers) → Eastron SDM630 ──
        try:
            result = client.read_input_registers(
                address=0, count=12, device_id=modbus_address,
            )
            if not result.isError():
                regs = result.registers
                v_l1 = decode_float32(regs, 0)

                # Valid voltage on ANY phase = Eastron SDM630
                # SDM630MCT V2 is ALWAYS a 3-phase meter by hardware design.
                # Even with only 1 CT connected, it's still trifásica.
                if v_l1 is not None and 50 < v_l1 < 500:
                    v_l2 = decode_float32(regs, 2)
                    v_l3 = decode_float32(regs, 4)

                    # Track which phases actually have readings (informational)
                    phases_active = []
                    if v_l1 and v_l1 > 50:
                        phases_active.append('L1')
                    if v_l2 and v_l2 > 50:
                        phases_active.append('L2')
                    if v_l3 and v_l3 > 50:
                        phases_active.append('L3')

                    self.disconnect(host, port)
                    return {
                        'alive': True,
                        'type': 'sdm630mct',                          # Internal: register map key
                        'detected_type': 'trifasica',                 # ALWAYS trifásica (hardware)
                        'model': 'SDM630MCT-V2',                      # Exact hardware model
                        'protocol': 'input_float32',
                        'three_phase': True,                           # Always True for SDM630
                        'phases_active': phases_active,                # Which CTs are connected
                        'voltage_sample': round(v_l1, 1),
                        'voltages': {
                            'l1': round(v_l1, 1) if v_l1 else 0,
                            'l2': round(v_l2, 1) if v_l2 else 0,
                            'l3': round(v_l3, 1) if v_l3 else 0,
                        },
                    }
        except Exception as e:
            logger.debug(f"FC 04 probe failed for {host}: {e}")

        # ── Try 2: FC 03 (Holding Registers) → Carlo Gavazzi ──
        try:
            result = client.read_holding_registers(
                address=0, count=12, device_id=modbus_address,
            )
            if not result.isError():
                regs = result.registers

                # Carlo Gavazzi uses INT32 with divisor 10
                v_l1 = decode_int_divisor(regs, 0, size=2, divisor=10)
                v_l2 = decode_int_divisor(regs, 2, size=2, divisor=10)
                v_l3 = decode_int_divisor(regs, 4, size=2, divisor=10)

                if v_l1 is not None and 50 < v_l1 < 500:
                    # Three-phase if L2 and L3 have valid voltage
                    is_three_phase = (
                        v_l2 is not None and v_l2 > 50
                        and v_l3 is not None and v_l3 > 50
                    )

                    if is_three_phase:
                        detected_type = 'trifasica'
                        model = 'EM340'
                    else:
                        detected_type = 'monofasica'
                        model = 'EM111'

                    self.disconnect(host, port)
                    return {
                        'alive': True,
                        'type': detected_type,                # Internal (= detected_type for CG)
                        'detected_type': detected_type,       # Backend schema
                        'model': model,                       # Exact hardware model
                        'protocol': 'holding_int',
                        'three_phase': is_three_phase,
                        'voltage_sample': round(v_l1, 1),
                        'voltages': {
                            'l1': round(v_l1, 1) if v_l1 else 0,
                            'l2': round(v_l2, 1) if v_l2 else 0,
                            'l3': round(v_l3, 1) if v_l3 else 0,
                        },
                    }
        except Exception as e:
            logger.debug(f"FC 03 probe failed for {host}: {e}")

        self.disconnect(host, port)
        return None


# ── Module-level convenience functions ──

_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        _reader = ModbusReader()
    return _reader


def read_device(host, port=502, device_type='trifasica', modbus_address=1):
    """Module-level convenience to read a device."""
    return _get_reader().read_device(host, port, modbus_address, device_type)


def probe_device(host, port=502, modbus_address=1):
    """Module-level convenience to probe a device."""
    return _get_reader().probe_device(host, port, modbus_address)


def close_all_clients():
    """Module-level convenience to close all connections."""
    if _reader:
        _reader.disconnect_all()


# ── Quick Test (run directly) ──

if __name__ == '__main__':
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    )

    host = os.environ.get('MODBUS_HOST', '192.168.1.200')
    port = int(os.environ.get('MODBUS_PORT', '502'))

    print(f"\n{'='*60}")
    print(f"  Voltio Gateway — Unified Modbus Quick Test")
    print(f"  Target: {host}:{port}")
    print(f"{'='*60}\n")

    # Step 1: Probe to identify meter type
    print("[1] Probing device (trying FC 04 → FC 03)...")
    probe_result = probe_device(host, port)

    if probe_result:
        meter_type = probe_result['type']
        model = probe_result['model']
        protocol = probe_result['protocol']

        print(f"    ✓ Device: {model} ({meter_type})")
        print(f"    ✓ Protocol: {protocol}")
        print(f"    ✓ Three-phase: {probe_result['three_phase']}")
        print(f"    ✓ Voltages: L1={probe_result['voltages']['l1']}V, "
              f"L2={probe_result['voltages']['l2']}V, "
              f"L3={probe_result['voltages']['l3']}V")
    else:
        print(f"    ✗ No device found at {host}:{port}")
        print("    Check: 1) IP correct? 2) Adapter powered? 3) Port 502?")
        exit(1)

    # Step 2: Full read with correct protocol
    print(f"\n[2] Reading all registers ({protocol})...")
    raw = read_device(host, port, device_type=meter_type)

    if raw:
        print(f"    ✓ Read {len(raw)} register blocks")
        for label, block_data in raw.items():
            print(f"      - {label}: {len(block_data['registers'])} registers "
                  f"(start: {block_data['start']})")

        # Decode and display
        from data_processor import DataProcessor
        processor = DataProcessor(REGISTER_MAP)
        processed = processor.process(raw, meter_type)

        print(f"\n    ✓ Processed {len(processed)} parameters:")
        key_params = [
            'voltage_l1_n', 'voltage_l2_n', 'voltage_l3_n',
            'current_l1', 'current_l2', 'current_l3',
            'power_w_total', 'power_factor_total', 'frequency_hz',
            'energy_kwh_total',
        ]
        for name in key_params:
            if name in processed:
                reg_info = REGISTER_MAP[meter_type]['registers'].get(name, {})
                unit = reg_info.get('unit', '')
                print(f"      {name}: {processed[name]} {unit}")
    else:
        print(f"    ✗ Failed to read registers")

    close_all_clients()
    print(f"\n{'='*60}")
    print("  Test complete!")
    print(f"{'='*60}")
