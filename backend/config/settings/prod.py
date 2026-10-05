from .base import *  # noqa: F401,F403

DEBUG = False

if not SECRET_KEY or SECRET_KEY == "insecure-dev-only-key":  # noqa: F405
    raise RuntimeError("DJANGO_SECRET_KEY must be set to a real value in prod")

if not ALLOWED_HOSTS:  # noqa: F405
    raise RuntimeError("DJANGO_ALLOWED_HOSTS must be set in prod")

if not ESIGN_WEBHOOK_SECRET or ESIGN_WEBHOOK_SECRET == "dev-only-webhook-secret":  # noqa: F405
    raise RuntimeError("ESIGN_WEBHOOK_SECRET must be set to a real value in prod")

if LMS_INTEGRATION_ENABLED:  # noqa: F405
    for _lms_var, _lms_val in [
        ("LMS_OUTBOUND_SECRET", LMS_OUTBOUND_SECRET),  # noqa: F405
        ("LMS_INBOUND_SECRET", LMS_INBOUND_SECRET),  # noqa: F405
        ("LMS_SSO_SECRET", LMS_SSO_SECRET),  # noqa: F405
    ]:
        if not _lms_val:
            raise RuntimeError(f"{_lms_var} must be set when LMS_INTEGRATION_ENABLED=true in prod")

# TLS-dependent hardening. Defaults True (behind an ALB/Docker that terminates
# TLS). On the bare-metal EC2 box served over plain HTTP, set
# DJANGO_SECURE_SSL_REDIRECT=False and DJANGO_SECURE_COOKIES=False until a
# domain + certificate exist — otherwise every request 301-loops to https (port
# 443 is dead) and Secure-flagged cookies are dropped, breaking login. Flip both
# to True the moment TLS is in front.
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = env.bool("DJANGO_SECURE_COOKIES", default=True)  # noqa: F405
CSRF_COOKIE_SECURE = env.bool("DJANGO_SECURE_COOKIES", default=True)  # noqa: F405

# WhiteNoise: serve /admin static files without a CDN. Insert after SecurityMiddleware.
MIDDLEWARE = [  # noqa: F405
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
] + MIDDLEWARE[1:]  # noqa: F405

STATIC_ROOT = env("DJANGO_STATIC_ROOT", default="/app/staticfiles")  # noqa: F405
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "format": '{"time":"%(asctime)s","level":"%(levelname)s","name":"%(name)s","message":"%(message)s"}',
        },
    },
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        },
    },
    "root": {
        "handlers": ["stdout"],
        "level": "INFO",
    },
    "loggers": {
        "django.request": {"handlers": ["stdout"], "level": "WARNING", "propagate": False},
        "django.security": {"handlers": ["stdout"], "level": "WARNING", "propagate": False},
    },
}
