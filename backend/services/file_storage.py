"""
backend/services/file_storage.py
File Storage Abstraction for ConceptLens.
Default: browser (client-side IndexedDB, 0 server storage, 0 setup).
Optional: s3 (enabled only when STORAGE_PROVIDER=s3 with bucket credentials).
Uses lightweight standard library HMAC-SHA256 SigV4 signing (0 heavy dependencies).
"""

import os
import hmac
import hashlib
import urllib.parse
import urllib.request
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple
from pathlib import Path

logger = logging.getLogger("conceptlens.storage")

DEFAULT_QUOTA_BYTES = int(os.getenv("USER_STORAGE_QUOTA_BYTES", str(100 * 1024 * 1024)))  # 100 MB default

def is_s3_configured() -> bool:
    """Returns True if S3 storage provider is explicitly enabled and credentials are set."""
    provider = os.getenv("STORAGE_PROVIDER", "browser").lower().strip()
    if provider != "s3":
        return False
    bucket = os.getenv("S3_BUCKET", "").strip()
    access_key = os.getenv("S3_ACCESS_KEY_ID", "").strip()
    secret_key = os.getenv("S3_SECRET_ACCESS_KEY", "").strip()
    return bool(bucket and access_key and secret_key)


def get_s3_config() -> Dict[str, str]:
    """Retrieves S3 connection configuration."""
    return {
        "bucket": os.getenv("S3_BUCKET", "").strip(),
        "access_key": os.getenv("S3_ACCESS_KEY_ID", "").strip(),
        "secret_key": os.getenv("S3_SECRET_ACCESS_KEY", "").strip(),
        "endpoint": os.getenv("S3_ENDPOINT", "").strip().rstrip("/"),
        "region": os.getenv("S3_REGION", "auto").strip() or "auto",
    }


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _get_signature_key(key: str, date_stamp: str, region_name: str, service_name: str) -> bytes:
    k_date = _sign(("AWS4" + key).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region_name)
    k_service = _sign(k_region, service_name)
    k_signing = _sign(k_service, "aws4_request")
    return k_signing


def generate_presigned_download_url(storage_key: str, expires_in: int = 300) -> str:
    """
    Generates an AWS SigV4 presigned GET download URL valid for `expires_in` seconds (default 5 min).
    Compatible with Cloudflare R2, Backblaze B2, MinIO, and AWS S3.
    """
    cfg = get_s3_config()
    bucket = cfg["bucket"]
    endpoint = cfg["endpoint"]
    access_key = cfg["access_key"]
    secret_key = cfg["secret_key"]
    region = cfg["region"]

    clean_key = storage_key.lstrip("/")
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    # Host & URL path resolution
    if endpoint:
        # Custom endpoint (Cloudflare R2 or Backblaze B2)
        parsed = urllib.parse.urlparse(endpoint)
        host = parsed.netloc
        # Path-style or bucket-host
        if bucket in host:
            canonical_uri = f"/{urllib.parse.quote(clean_key)}"
            base_url = f"{endpoint}/{clean_key}"
        else:
            canonical_uri = f"/{bucket}/{urllib.parse.quote(clean_key)}"
            base_url = f"{endpoint}/{bucket}/{clean_key}"
    else:
        # Default AWS S3
        host = f"{bucket}.s3.{region}.amazonaws.com"
        canonical_uri = f"/{urllib.parse.quote(clean_key)}"
        base_url = f"https://{host}/{clean_key}"

    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"

    query_params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{access_key}/{credential_scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires_in),
        "X-Amz-SignedHeaders": "host",
    }

    # Canonical query string (sorted)
    canonical_qs = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(query_params[k], safe='')}"
        for k in sorted(query_params.keys())
    )

    canonical_headers = f"host:{host}\n"
    signed_headers = "host"
    payload_hash = "UNSIGNED-PAYLOAD"

    canonical_request = (
        f"GET\n"
        f"{canonical_uri}\n"
        f"{canonical_qs}\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{payload_hash}"
    )

    string_to_sign = (
        f"AWS4-HMAC-SHA256\n"
        f"{amz_date}\n"
        f"{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    signing_key = _get_signature_key(secret_key, date_stamp, region, "s3")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    return f"{base_url}?{canonical_qs}&X-Amz-Signature={signature}"


def upload_file_to_s3(storage_key: str, data: bytes, content_type: str = "application/pdf") -> bool:
    """Uploads file bytes to S3 using SigV4 signed PUT request."""
    cfg = get_s3_config()
    bucket = cfg["bucket"]
    endpoint = cfg["endpoint"]
    access_key = cfg["access_key"]
    secret_key = cfg["secret_key"]
    region = cfg["region"]

    clean_key = storage_key.lstrip("/")
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    if endpoint:
        parsed = urllib.parse.urlparse(endpoint)
        host = parsed.netloc
        if bucket in host:
            canonical_uri = f"/{urllib.parse.quote(clean_key)}"
            url = f"{endpoint}/{clean_key}"
        else:
            canonical_uri = f"/{bucket}/{urllib.parse.quote(clean_key)}"
            url = f"{endpoint}/{bucket}/{clean_key}"
    else:
        host = f"{bucket}.s3.{region}.amazonaws.com"
        canonical_uri = f"/{urllib.parse.quote(clean_key)}"
        url = f"https://{host}/{clean_key}"

    if hasattr(data, "read"):
        raw_bytes = data.read()
    elif isinstance(data, (bytes, bytearray)):
        raw_bytes = bytes(data)
    else:
        raw_bytes = bytes(data)

    payload_hash = hashlib.sha256(raw_bytes).hexdigest()
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"

    headers = {
        "content-type": content_type,
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }

    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers.keys()))
    signed_headers = ";".join(sorted(headers.keys()))

    canonical_request = (
        f"PUT\n"
        f"{canonical_uri}\n"
        f"\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{payload_hash}"
    )

    string_to_sign = (
        f"AWS4-HMAC-SHA256\n"
        f"{amz_date}\n"
        f"{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    signing_key = _get_signature_key(secret_key, date_stamp, region, "s3")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth_header = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(url, data=raw_bytes, method="PUT")
    req.add_header("Authorization", auth_header)
    req.add_header("Content-Type", content_type)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("x-amz-date", amz_date)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status in (200, 201, 204)
    except Exception as e:
        logger.error(f"S3 upload error for {storage_key}: {e}")
        return False


def delete_file_from_s3(storage_key: str) -> bool:
    """Deletes an object from S3 using SigV4 signed DELETE request."""
    if not is_s3_configured():
        return True

    cfg = get_s3_config()
    bucket = cfg["bucket"]
    endpoint = cfg["endpoint"]
    access_key = cfg["access_key"]
    secret_key = cfg["secret_key"]
    region = cfg["region"]

    clean_key = storage_key.lstrip("/")
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    if endpoint:
        parsed = urllib.parse.urlparse(endpoint)
        host = parsed.netloc
        if bucket in host:
            canonical_uri = f"/{urllib.parse.quote(clean_key)}"
            url = f"{endpoint}/{clean_key}"
        else:
            canonical_uri = f"/{bucket}/{urllib.parse.quote(clean_key)}"
            url = f"{endpoint}/{bucket}/{clean_key}"
    else:
        host = f"{bucket}.s3.{region}.amazonaws.com"
        canonical_uri = f"/{urllib.parse.quote(clean_key)}"
        url = f"https://{host}/{clean_key}"

    payload_hash = hashlib.sha256(b"").hexdigest()
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }

    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers.keys()))
    signed_headers = ";".join(sorted(headers.keys()))

    canonical_request = (
        f"DELETE\n"
        f"{canonical_uri}\n"
        f"\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{payload_hash}"
    )

    string_to_sign = (
        f"AWS4-HMAC-SHA256\n"
        f"{amz_date}\n"
        f"{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    signing_key = _get_signature_key(secret_key, date_stamp, region, "s3")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth_header = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Authorization", auth_header)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("x-amz-date", amz_date)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status in (200, 204)
    except Exception as e:
        logger.warning(f"S3 delete error for {storage_key}: {e}")
        return False


# Database operations for document_files table

def get_user_storage_usage(conn, user_id: str) -> int:
    """Returns the total bytes used by a user in document_files."""
    cursor = conn.execute(
        "SELECT COALESCE(SUM(size), 0) AS total_size FROM document_files WHERE user_id = ?",
        (user_id,)
    )
    row = cursor.fetchone()
    return int(row["total_size"]) if row else 0


def save_document_file_record(
    conn,
    document_id: str,
    user_id: str,
    provider: str,
    storage_key: Optional[str],
    size: int,
    mime: str,
    sha256: str,
    file_data: Optional[bytes] = None
) -> None:
    """Inserts or updates the document_files record."""
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute("SELECT document_id FROM document_files WHERE document_id = ?", (document_id,))
    if cursor.fetchone():
        if file_data is not None:
            conn.execute(
                """
                UPDATE document_files
                SET user_id = ?, provider = ?, storage_key = ?, size = ?, mime = ?, sha256 = ?, file_data = ?, created_at = ?
                WHERE document_id = ?
                """,
                (user_id, provider, storage_key, size, mime, sha256, file_data, now_iso, document_id)
            )
        else:
            conn.execute(
                """
                UPDATE document_files
                SET user_id = ?, provider = ?, storage_key = ?, size = ?, mime = ?, sha256 = ?, created_at = ?
                WHERE document_id = ?
                """,
                (user_id, provider, storage_key, size, mime, sha256, now_iso, document_id)
            )
    else:
        conn.execute(
            """
            INSERT INTO document_files (
                document_id, user_id, provider, storage_key, size, mime, sha256, created_at, file_data
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (document_id, user_id, provider, storage_key, size, mime, sha256, now_iso, file_data)
        )


def get_document_file_record(conn, document_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves document file record by document_id."""
    cursor = conn.execute("SELECT * FROM document_files WHERE document_id = ?", (document_id,))
    row = cursor.fetchone()
    return dict(row) if row else None


def delete_document_file(conn, document_id: str) -> None:
    """Deletes document_files record and removes from S3 if applicable."""
    record = get_document_file_record(conn, document_id)
    if record:
        if record.get("provider") == "s3" and record.get("storage_key"):
            delete_file_from_s3(record["storage_key"])
        conn.execute("DELETE FROM document_files WHERE document_id = ?", (document_id,))
