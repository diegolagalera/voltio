"""
Voltio Gateway — Network Scanner
Scans the local network for Modbus TCP devices (USR-TCP232-410S adapters).
Detects Eastron SDM630MCT V2 energy meters via probe and reports discoveries.
"""

import socket
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger('NetworkScanner')


class NetworkScanner:
    """Scans the local network for Modbus TCP devices and identifies Eastron meters."""

    def __init__(self, modbus_reader, scan_range=None, scan_port=502, scan_timeout=1):
        """
        Args:
            modbus_reader: ModbusReader instance for probing devices
            scan_range: tuple (start_ip, end_ip) e.g. ('192.168.1.1', '192.168.1.254')
            scan_port: Modbus TCP port to scan (default: 502)
            scan_timeout: Timeout per port scan in seconds
        """
        self.modbus_reader = modbus_reader
        self.scan_range = scan_range or ('192.168.1.1', '192.168.1.254')
        self.scan_port = scan_port
        self.scan_timeout = scan_timeout

    def _ip_range(self, start_ip, end_ip):
        """Generate a list of IPs between start and end (inclusive)."""
        start_parts = list(map(int, start_ip.split('.')))
        end_parts = list(map(int, end_ip.split('.')))

        # Support same /24 subnet
        base = '.'.join(map(str, start_parts[:3]))
        start_host = start_parts[3]
        end_host = end_parts[3]

        return [f"{base}.{i}" for i in range(start_host, end_host + 1)]

    def _check_port(self, ip, port):
        """Check if a TCP port is open on a given IP."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.scan_timeout)
            result = sock.connect_ex((ip, port))
            sock.close()
            return result == 0
        except Exception:
            return False

    def scan(self, scan_range=None):
        """
        Scan the network for Modbus TCP devices (Eastron SDM630MCT V2).

        Phase 1: Fast parallel TCP port scan to find open port 502 hosts.
        Phase 2: Sequential Modbus probe to identify meter type.

        Args:
            scan_range: Optional override tuple (start_ip, end_ip)

        Returns:
            list of discovered devices:
            [
                {
                    'ip_address': '192.168.1.200',
                    'port': 502,
                    'modbus_address': 1,
                    'detected_type': 'sdm630mct',
                    'detected_model': 'SDM630MCT-V2',
                    'three_phase': True,
                    'voltage_sample': 230.5,
                    'voltages': {'l1': 230.5, 'l2': 231.2, 'l3': 229.8},
                },
            ]
        """
        range_to_scan = scan_range or self.scan_range
        ips = self._ip_range(range_to_scan[0], range_to_scan[1])

        logger.info(
            f"Starting network scan: {range_to_scan[0]} → {range_to_scan[1]} "
            f"({len(ips)} IPs, port {self.scan_port})"
        )
        start_time = time.time()

        # ── Phase 1: Fast TCP port scan (parallel) ──
        open_hosts = []
        with ThreadPoolExecutor(max_workers=20) as executor:
            future_to_ip = {
                executor.submit(self._check_port, ip, self.scan_port): ip
                for ip in ips
            }
            for future in as_completed(future_to_ip):
                ip = future_to_ip[future]
                try:
                    if future.result():
                        open_hosts.append(ip)
                        logger.info(f"  ✓ Port {self.scan_port} open on {ip}")
                except Exception as e:
                    logger.debug(f"  ✗ Error scanning {ip}: {e}")

        logger.info(
            f"Port scan complete: {len(open_hosts)} hosts found "
            f"in {time.time() - start_time:.1f}s"
        )

        if not open_hosts:
            return []

        # ── Phase 2: Modbus probe (sequential) ──
        discovered = []
        for ip in sorted(open_hosts):
            logger.info(f"Probing Modbus device at {ip}:{self.scan_port}...")

            probe_result = self.modbus_reader.probe_device(
                host=ip,
                port=self.scan_port,
                modbus_address=1,
            )

            if probe_result and probe_result.get('alive'):
                device = {
                    'ip_address': ip,
                    'port': self.scan_port,
                    'modbus_address': 1,
                    'detected_type': probe_result.get('detected_type', probe_result['type']),
                    'type': probe_result['type'],
                    'detected_model': probe_result['model'],
                    'three_phase': probe_result.get('three_phase', False),
                    'voltage_sample': probe_result.get('voltage_sample', 0),
                    'voltages': probe_result.get('voltages', {}),
                }
                discovered.append(device)
                logger.info(
                    f"  ✓ Detected {device['detected_model']} "
                    f"at {ip} — L1={device['voltages'].get('l1', 0)}V "
                    f"L2={device['voltages'].get('l2', 0)}V "
                    f"L3={device['voltages'].get('l3', 0)}V"
                )
            else:
                logger.info(f"  ✗ Port open but no valid Modbus response at {ip}")

        elapsed = time.time() - start_time
        logger.info(
            f"Network scan complete: {len(discovered)} devices found in {elapsed:.1f}s"
        )

        return discovered

    def format_discovery_message(self, factory_id, discovered_devices):
        """
        Format discovery results as an MQTT message payload.

        Returns:
            dict ready to be JSON-serialized and published
        """
        return {
            'factory_id': factory_id,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'scan_range': list(self.scan_range),
            'devices_found': len(discovered_devices),
            'devices': discovered_devices,
        }
