"""Signed service-to-service HTTP between HRMS and the LMS (Contract §4).

Both directions use the same scheme, each with its own secret:

    X-Signature-Timestamp: <unix seconds>
    X-Signature:           sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

The timestamp is inside the MAC and must be within SIGNATURE_TOLERANCE of the
receiver's clock, so a captured request cannot be replayed later; the
event_id idempotency key makes a replay inside the window a no-op anyway.

LMS endpoints this client calls (added to the LMS api-gateway, see
docs/LMS-INTEGRATION.md "Changes required in the LMS"):

    POST {LMS_BASE_URL}/integrations/hrms/events      one outbound event
    GET  {LMS_BASE_URL}/integrations/hrms/learners    page of linked learners
"""

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from django.conf import settings

SIGNATURE_TOLERANCE_SECONDS = 300
TIMESTAMP_HEADER = "X-Signature-Timestamp"
SIGNATURE_HEADER = "X-Signature"


def sign(secret: str, timestamp: str, body: bytes) -> str:
    message = timestamp.encode("ascii") + b"." + body
    return "sha256=" + hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify(
    secret: str, timestamp: str, signature: str, body: bytes, *, now: float | None = None
) -> bool:
    """Rejects outright when no secret is configured, rather than accepting
    unsigned calls."""
    if not secret or not timestamp or not signature:
        return False
    try:
        sent = int(timestamp)
    except ValueError:
        return False
    current = time.time() if now is None else now
    if abs(current - sent) > SIGNATURE_TOLERANCE_SECONDS:
        return False
    return hmac.compare_digest(sign(secret, timestamp, body), signature)


class LmsNotConfigured(Exception):
    pass


@dataclass
class LmsResponse:
    ok: bool
    http_status: int | None
    data: dict
    error: str = ""
    transient: bool = False  # worth retrying (timeouts, 5xx, 429)
    duration_ms: int = 0


class LmsClient:
    def __init__(self, base_url=None, secret=None, timeout=None):
        self.base_url = (base_url if base_url is not None else settings.LMS_BASE_URL).rstrip("/")
        self.secret = secret if secret is not None else settings.LMS_OUTBOUND_SECRET
        self.timeout = timeout or settings.LMS_TIMEOUT_SECONDS

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.secret)

    def url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def send_event(self, payload: dict) -> LmsResponse:
        return self._request(
            "POST",
            "/integrations/hrms/events",
            payload,
            headers={
                "Idempotency-Key": payload.get("event_id", ""),
                "X-Correlation-Id": payload.get("correlation_id", ""),
            },
        )

    def list_learners(self, page: int = 0, size: int = 500) -> LmsResponse:
        query = urllib.parse.urlencode({"page": page, "size": size})
        return self._request("GET", f"/integrations/hrms/learners?{query}", None)

    def _request(self, method: str, path: str, payload, headers=None) -> LmsResponse:
        if not self.configured:
            raise LmsNotConfigured("LMS_BASE_URL and LMS_OUTBOUND_SECRET must both be set.")
        body = (
            b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        )
        timestamp = str(int(time.time()))
        request = urllib.request.Request(self.url(path), data=body or None, method=method)
        request.add_header("Content-Type", "application/json")
        request.add_header("Accept", "application/json")
        request.add_header(TIMESTAMP_HEADER, timestamp)
        request.add_header(SIGNATURE_HEADER, sign(self.secret, timestamp, body))
        for key, value in (headers or {}).items():
            if value:
                request.add_header(key, value)

        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read() if hasattr(exc, "read") else b""
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return LmsResponse(
                ok=False,
                http_status=None,
                data={},
                error=f"LMS unreachable: {getattr(exc, 'reason', exc)}",
                transient=True,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        duration_ms = int((time.monotonic() - started) * 1000)

        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except (ValueError, UnicodeDecodeError):
            data = {"raw": raw[:500].decode("utf-8", "replace")}
        if not isinstance(data, dict):
            data = {"data": data}

        ok = 200 <= status < 300
        error = "" if ok else _error_message(status, data)
        transient = status >= 500 or status in (408, 425, 429)
        return LmsResponse(ok, status, data, error, transient, duration_ms)


def _error_message(status: int, data: dict) -> str:
    detail = data.get("message") or data.get("error") or data.get("raw") or ""
    if isinstance(detail, dict):
        detail = detail.get("message") or json.dumps(detail)[:300]
    return f"LMS returned HTTP {status}" + (f": {detail}" if detail else "")
