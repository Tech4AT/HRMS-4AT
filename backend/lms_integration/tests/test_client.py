"""The real HTTP client against a local stub LMS: signing, headers, error
classification."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from lms_integration.client import LmsClient, LmsNotConfigured, sign, verify

SECRET = "stub-secret-0123456789abcdef0123456789"


class StubLms(BaseHTTPRequestHandler):
    received = []
    reply = (200, {"learner_id": "L-1"})

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        StubLms.received.append((self.path, dict(self.headers), body))
        status, payload = StubLms.reply
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


@pytest.fixture
def stub():
    server = HTTPServer(("127.0.0.1", 0), StubLms)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    StubLms.received = []
    yield f"http://127.0.0.1:{server.server_address[1]}/api"
    server.shutdown()


def test_signature_roundtrip_and_tolerance():
    body = b'{"a":1}'
    ts = str(int(time.time()))
    signature = sign(SECRET, ts, body)
    assert verify(SECRET, ts, signature, body)
    assert not verify(SECRET, ts, signature, b'{"a":2}')
    assert not verify(
        SECRET, str(int(time.time()) - 301), sign(SECRET, str(int(time.time()) - 301), body), body
    )
    assert not verify("", ts, signature, body)


def test_send_event_is_signed(stub):
    StubLms.reply = (200, {"learner_id": "L-1"})
    response = LmsClient(stub, SECRET, 5).send_event(
        {"event_id": "evt_1", "correlation_id": "corr_1", "x": 1}
    )
    assert response.ok and response.data["learner_id"] == "L-1"
    path, headers, body = StubLms.received[0]
    assert path == "/api/integrations/hrms/events"
    assert headers["Idempotency-Key"] == "evt_1" and headers["X-Correlation-Id"] == "corr_1"
    assert verify(SECRET, headers["X-Signature-Timestamp"], headers["X-Signature"], body)


@pytest.mark.parametrize(
    "status,transient", [(500, True), (503, True), (429, True), (400, False), (404, False)]
)
def test_errors_are_classified(stub, status, transient):
    StubLms.reply = (status, {"message": "nope"})
    response = LmsClient(stub, SECRET, 5).send_event({"event_id": "e"})
    assert not response.ok and response.http_status == status and response.transient is transient
    assert "nope" in response.error


def test_unreachable_is_transient():
    response = LmsClient("http://127.0.0.1:9", SECRET, 1).send_event({"event_id": "e"})
    assert not response.ok and response.transient and response.http_status is None


def test_unconfigured_client_refuses():
    with pytest.raises(LmsNotConfigured):
        LmsClient("", "", 1).send_event({})
