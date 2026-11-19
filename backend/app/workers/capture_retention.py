"""Private local/test cleanup: no HTTP route, no owner credentials.

Only ciphertext whose retention clock has expired may be deleted by the
SECURITY DEFINER database function. A bounded batch executes periodically
while the private backend is running; no public/demo task starts.
"""

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger("bodyvision")


def purge_due(engine: Engine, batch_size: int = 100, max_batches: int = 10) -> int:
    if not 1 <= batch_size <= 100 or not 1 <= max_batches <= 100:
        raise ValueError("Capture retention batches are bounded")
    removed_total = 0
    for _ in range(max_batches):
        with engine.begin() as connection:
            removed = connection.execute(
                text("SELECT purge_expired_synthetic_capture_batch(:batch)"),
                {"batch": batch_size},
            ).scalar_one()
        removed_total += removed
        if removed < batch_size:
            break
    return removed_total


async def retention_loop(engine: Engine, interval_seconds: int) -> None:
    if not 60 <= interval_seconds <= 86400:
        raise ValueError("Capture retention interval is out of range")
    while True:
        try:
            removed = await asyncio.to_thread(purge_due, engine)
            if removed:
                logger.info("synthetic_capture_retention_purged", extra={"removed_count": removed})
        except Exception as exc:
            # Never log SQL exception strings: they can contain connection data.
            logger.error(
                "synthetic_capture_retention_failed",
                extra={"error_type": type(exc).__name__},
            )
        await asyncio.sleep(interval_seconds)
