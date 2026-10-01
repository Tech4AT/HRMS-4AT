import json
import time

from lms_integration.client import LmsResponse, sign

INBOUND_SECRET = "test-inbound-secret-0123456789abcdef"
OUTBOUND_SECRET = "test-outbound-secret-0123456789abcdef"
SSO_SECRET = "test-sso-secret-0123456789abcdef0123"

LMS_SETTINGS = dict(
    LMS_INTEGRATION_ENABLED=True,
    LMS_BASE_URL="http://lms.test/api",
    LMS_OUTBOUND_SECRET=OUTBOUND_SECRET,
    LMS_INBOUND_SECRET=INBOUND_SECRET,
    LMS_SSO_SECRET=SSO_SECRET,
    LMS_SSO_LAUNCH_URL="http://lms.test/auth/hrms-sso",
    LMS_MAX_ATTEMPTS=3,
)


class FakeLms:
    """Stands in for LmsClient: records what was sent and answers from a
    queue of scripted responses (default: 200 with a learner id)."""

    configured = True

    def __init__(self, *responses):
        self.responses = list(responses)
        self.sent = []

    def url(self, path):
        return f"http://lms.test/api{path}"

    def send_event(self, payload):
        self.sent.append(payload)
        if self.responses:
            return self.responses.pop(0)
        return ok_response(learner_id=f"L{payload['employee']['employee_id']}")

    def list_learners(self, page=0, size=500):
        return LmsResponse(True, 200, {"items": [], "has_more": False})


def ok_response(**data):
    return LmsResponse(True, 200, data)


def unavailable():
    return LmsResponse(False, None, {}, "LMS unreachable: connection refused", transient=True)


def http_error(status, message="bad"):
    return LmsResponse(
        False, status, {"message": message}, f"LMS returned HTTP {status}: {message}", status >= 500
    )


def signed_post(api, envelope, secret=INBOUND_SECRET, timestamp=None):
    body = json.dumps(envelope).encode()
    ts = str(int(timestamp if timestamp is not None else time.time()))
    return api.generic(
        "POST",
        "/api/v1/integrations/lms/events",
        body,
        content_type="application/json",
        HTTP_X_SIGNATURE_TIMESTAMP=ts,
        HTTP_X_SIGNATURE=sign(secret, ts, body),
    )


def lms_event(
    event_type, employee, data, event_id=None, occurred_at="2026-09-28T10:00:00Z", **extra
):
    return {
        "event_id": event_id or f"evt_{event_type.lower()}_{employee.pk}_{occurred_at}",
        "event_type": event_type,
        "schema_version": "1.0",
        "occurred_at": occurred_at,
        "correlation_id": "corr_test",
        "source": "lms",
        "employee_id": str(employee.pk),
        "data": data,
        **extra,
    }
