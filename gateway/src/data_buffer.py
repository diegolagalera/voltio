"""
FPSaver — Local Data Buffer (Store-and-Forward)
SQLite-based offline buffer for telemetry batches.

When there's no internet:
  1. Readings are stored locally in SQLite
  2. When connectivity returns, pending batches are re-sent
  3. Only cleared after server ACK confirms receipt

Usage:
    buffer = DataBuffer('/home/pi/fpsaver/data/buffer.db')
    batch_id = buffer.store(readings)      # Returns batch UUID
    pending  = buffer.get_pending()        # Returns unsent batches
    buffer.mark_sent(batch_id)             # Mark as sent (awaiting ACK)
    buffer.mark_confirmed(batch_id)        # ACK received, safe to delete
"""

import sqlite3
import json
import uuid
import os
import logging
import threading
from datetime import datetime, timezone

logger = logging.getLogger("data_buffer")


class DataBuffer:
    """Thread-safe SQLite buffer for store-and-forward telemetry."""

    def __init__(self, db_path="data/buffer.db"):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _get_conn(self):
        """Create a new connection (SQLite connections are thread-local)."""
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent access
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_db(self):
        """Create the buffer table if it doesn't exist."""
        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS telemetry_buffer (
                        batch_id     TEXT PRIMARY KEY,
                        factory_id   TEXT NOT NULL,
                        readings     TEXT NOT NULL,
                        reading_count INTEGER NOT NULL,
                        status       TEXT NOT NULL DEFAULT 'pending',
                        created_at   TEXT NOT NULL,
                        sent_at      TEXT,
                        retry_count  INTEGER DEFAULT 0
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_buffer_status
                    ON telemetry_buffer(status)
                """)
                conn.commit()
                logger.info(f"[BUFFER] Initialized at {self._db_path}")
            finally:
                conn.close()

    def store(self, factory_id, readings):
        """
        Store a batch of readings in the buffer.
        Returns the batch_id (UUID).
        """
        batch_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    """INSERT INTO telemetry_buffer
                       (batch_id, factory_id, readings, reading_count, status, created_at)
                       VALUES (?, ?, ?, ?, 'pending', ?)""",
                    (batch_id, factory_id, json.dumps(readings), len(readings), now),
                )
                conn.commit()
                logger.info(
                    f"[BUFFER] Stored batch {batch_id[:8]} "
                    f"({len(readings)} readings)"
                )
            finally:
                conn.close()

        return batch_id

    def get_pending(self, limit=10):
        """
        Get pending batches (not yet sent or sent but not confirmed).
        Returns list of dicts with batch_id, factory_id, readings.
        """
        with self._lock:
            conn = self._get_conn()
            try:
                rows = conn.execute(
                    """SELECT batch_id, factory_id, readings, reading_count,
                              status, retry_count, created_at
                       FROM telemetry_buffer
                       WHERE status IN ('pending', 'sent')
                       ORDER BY created_at ASC
                       LIMIT ?""",
                    (limit,),
                ).fetchall()

                return [
                    {
                        "batch_id": r["batch_id"],
                        "factory_id": r["factory_id"],
                        "readings": json.loads(r["readings"]),
                        "reading_count": r["reading_count"],
                        "status": r["status"],
                        "retry_count": r["retry_count"],
                    }
                    for r in rows
                ]
            finally:
                conn.close()

    def mark_sent(self, batch_id):
        """Mark a batch as sent (awaiting server ACK)."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    """UPDATE telemetry_buffer
                       SET status = 'sent', sent_at = ?, retry_count = retry_count + 1
                       WHERE batch_id = ?""",
                    (now, batch_id),
                )
                conn.commit()
                logger.debug(f"[BUFFER] Marked sent: {batch_id[:8]}")
            finally:
                conn.close()

    def mark_confirmed(self, batch_id):
        """ACK received — delete the batch from buffer."""
        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    "DELETE FROM telemetry_buffer WHERE batch_id = ?",
                    (batch_id,),
                )
                conn.commit()
                logger.info(f"[BUFFER] Confirmed & deleted: {batch_id[:8]}")
            finally:
                conn.close()

    def get_stats(self):
        """Get buffer statistics."""
        with self._lock:
            conn = self._get_conn()
            try:
                row = conn.execute(
                    """SELECT
                         COUNT(*) as total,
                         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                         SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
                         SUM(reading_count) as total_readings
                       FROM telemetry_buffer"""
                ).fetchone()
                return {
                    "total_batches": row["total"] or 0,
                    "pending": row["pending"] or 0,
                    "awaiting_ack": row["sent"] or 0,
                    "total_readings": row["total_readings"] or 0,
                }
            finally:
                conn.close()

    def reset_stale_sent(self, max_age_seconds=120):
        """
        Reset batches stuck in 'sent' status back to 'pending'
        (ACK never arrived — will be retried).
        """
        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    """UPDATE telemetry_buffer
                       SET status = 'pending'
                       WHERE status = 'sent'
                       AND julianday('now') - julianday(sent_at) > ?/86400.0""",
                    (max_age_seconds,),
                )
                affected = conn.total_changes
                conn.commit()
                if affected > 0:
                    logger.warning(
                        f"[BUFFER] Reset {affected} stale batches to pending"
                    )
            finally:
                conn.close()

    def cleanup_old(self, max_age_hours=168):
        """Remove very old entries (safety valve, default 7 days)."""
        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    """DELETE FROM telemetry_buffer
                       WHERE julianday('now') - julianday(created_at) > ?/24.0""",
                    (max_age_hours,),
                )
                conn.commit()
            finally:
                conn.close()
