"""A view that throttles by scope needs a rate for that scope, or DRF raises
ImproperlyConfigured on every request to it (an HTTP 500, not a throttle). That
happened once already: a merge dropped the onboarding offer scopes from settings
while the views kept using them, and nothing in the suite noticed because no test
sent a request through those views."""

import pytest
from django.conf import settings
from django.urls import get_resolver
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def _view_classes():
    resolver = get_resolver()
    seen = []

    def walk(patterns):
        for pattern in patterns:
            if hasattr(pattern, "url_patterns"):
                walk(pattern.url_patterns)
                continue
            callback = pattern.callback
            cls = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
            if cls is not None and cls not in seen:
                seen.append(cls)

    walk(resolver.url_patterns)
    return seen


def test_every_throttle_scope_in_use_has_a_configured_rate():
    rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    used = {
        cls.throttle_scope: cls for cls in _view_classes() if getattr(cls, "throttle_scope", None)
    }

    assert used, "expected at least the login scope to be found"
    missing = {
        scope: cls.__module__ + "." + cls.__name__
        for scope, cls in used.items()
        if scope not in rates
    }
    assert (
        not missing
    ), f"throttle scopes with no rate (every request to these views would 500): {missing}"


@pytest.mark.parametrize("scope", ["login", "offer_public_read", "offer_public_write"])
def test_the_known_public_scopes_are_configured(scope):
    assert scope in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


def test_the_public_offer_endpoint_answers_an_unknown_token_with_404_not_500():
    response = APIClient().get("/api/v1/offers/sign/not-a-real-token")

    assert response.status_code == 404, response.content
