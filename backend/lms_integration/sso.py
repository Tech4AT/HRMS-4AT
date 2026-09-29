"""SSO hand-off: HRMS -> LMS without a second login (PRD §5, "Global navigation").

HRMS mints a short-lived, single-use token for the signed-in employee and the
browser POSTs it to the LMS auth service (LMS_SSO_LAUNCH_URL). The LMS
verifies it with LMS_SSO_SECRET, rejects a reused `jti`, finds the learner by
`sub` (= external_employee_id) and issues its own normal session JWT.

HRMS never learns the LMS's internal JWT secret, and the LMS never learns
the HRMS one: the only shared key is LMS_SSO_SECRET, used for nothing else.
"""

import uuid
from datetime import timedelta

import jwt
from django.conf import settings
from django.utils import timezone

from lms_integration.events import external_employee_id

ISSUER = "4at-hrms"
AUDIENCE = "4at-lms"
ALGORITHM = "HS256"


class SsoNotConfigured(Exception):
    pass


def safe_target(target) -> str | None:
    """Only a path inside the LMS, never an absolute or protocol-relative URL
    (that would turn the hand-off into an open redirect)."""
    if not target or not isinstance(target, str):
        return None
    if not target.startswith("/") or target.startswith("//") or "\\" in target or len(target) > 500:
        return None
    return target


def launch(employee, target=None) -> dict:
    secret, url = settings.LMS_SSO_SECRET, settings.LMS_SSO_LAUNCH_URL
    if not secret or not url:
        raise SsoNotConfigured("LMS_SSO_SECRET and LMS_SSO_LAUNCH_URL must both be set.")
    now = timezone.now()
    expires = now + timedelta(seconds=settings.LMS_SSO_TOKEN_TTL_SECONDS)
    link = getattr(employee, "lms_link", None)
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": external_employee_id(employee),
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "employee_code": employee.employee_code,
        "email": employee.work_email or employee.user.email,
        "name": employee.full_name,
        "learner_id": link.learner_id if link else None,
    }
    target = safe_target(target)
    if target:
        claims["target"] = target
    token = jwt.encode(claims, secret, algorithm=ALGORITHM)
    return {
        "launch_url": url,
        "method": "POST",
        "field": "token",
        "token": token,
        "expires_at": expires,
        "jti": claims["jti"],
    }


def decode(token: str) -> dict:
    """What the LMS side must do, in Python — used by the tests and as the
    reference for the Java implementation."""
    return jwt.decode(
        token, settings.LMS_SSO_SECRET, algorithms=[ALGORITHM], audience=AUDIENCE, issuer=ISSUER
    )
