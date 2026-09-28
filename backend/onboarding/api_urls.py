"""Mounted at /api/v1/ via config.api_urls auto-mount (any installed app exposing
`api_urls.urlpatterns` is included without core edits).

Mirrors the teammate's mount points: authenticated onboarding API under
`onboarding/`, unauthenticated token-based offer routes under `offers/`, and
the e-sign provider webhook.
"""

from django.urls import include, path

from onboarding.webhooks import ESignWebhookView

urlpatterns = [
    path("onboarding/", include("onboarding.urls")),
    path("offers/", include("onboarding.urls_public")),
    path("webhooks/esign", ESignWebhookView.as_view(), name="webhooks-esign"),
]
