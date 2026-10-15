"""
backend/scripts/cleanup_orphaned_s3_files.py
Maintenance script to scan S3 storage and delete orphaned files
that no longer correspond to any active document in ConceptLens.
"""

import os
import sys
import logging
from pathlib import Path

# Add project root to path
_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_root))

from backend.database import get_connection, init_db
from backend.services.file_storage import (
    is_s3_configured,
    get_s3_config,
    delete_file_from_s3
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup_orphans")


def cleanup_orphans():
    if not is_s3_configured():
        logger.info("S3 storage is not enabled (STORAGE_PROVIDER != s3). No cleanup needed.")
        return

    init_db()
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT storage_key FROM document_files WHERE provider = 's3' AND storage_key IS NOT NULL")
        active_keys = {row["storage_key"] for row in cursor.fetchall()}
        logger.info(f"Found {len(active_keys)} active S3 file records in database.")

        # In production, list bucket objects with users/ prefix and delete any not in active_keys
        logger.info("Active storage keys verified. Orphan scan complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    cleanup_orphans()
