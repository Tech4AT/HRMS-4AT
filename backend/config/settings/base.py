"""Shared settings. dev.py / test.py / prod.py each import * from here and
override only what differs between environments."""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="insecure-dev-only-key")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    # Core primitives 1 & 2 (employees app / accounts app) — see docs/ARCHITECTURE.md.
    "core",
    "accounts",
    "employees",
    "audit",
    # Core primitives 3, 5 & 6 (approvals / notifications / documents) — docs/ARCHITECTURE.md.
    "approvals",
    "notifications",
    "documents",
    # Plug-in modules built on the core.
    "payroll",
    "onboarding",
    # ORG module Wave 1: effective-dated org changes (promotions, transfers).
    "orgchanges",
    "policies",
    # approvals, notifications, documents, and further plugin apps land here
    # as Phase 0/2/3+ scaffolding proceeds (docs/TASKS.md P0-E1-03/04).
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="hrms"),
        "USER": env("POSTGRES_USER", default="hrms"),
        "PASSWORD": env("POSTGRES_PASSWORD", default="hrms"),
        "HOST": env("POSTGRES_HOST", default="localhost"),
        "PORT": env("POSTGRES_PORT", default="5432"),
    }
}

AUTH_USER_MODEL = "accounts.User"

# Argon2 first — stronger than Django's PBKDF2 default (P1-E1-07).
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Documents primitive (#6): files land on local disk under MEDIA_ROOT for now;
# swapping to S3 later is a storage-backend change, not a schema change.
MEDIA_URL = "media/"
MEDIA_ROOT = env("DJANGO_MEDIA_ROOT", default=str(BASE_DIR / "media"))

# Notifications primitive (#5): console backend until real SMTP/SES is wired for
# prod. send_email() is fail-silent regardless (notifications/service.py).
EMAIL_BACKEND = env(
    "DJANGO_EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend"
)
DEFAULT_FROM_EMAIL = env("DJANGO_DEFAULT_FROM_EMAIL", default="no-reply@hrms.local")
# Display name used in email templates (notifications/utils.py renders it into
# every HTML email context as `company_name`). Overridable via env.
COMPANY_NAME = env("COMPANY_NAME", default="4AT HRMS")
# Base URL of the Next.js frontend, used to build absolute candidate-facing
# links (offer signing, set-password). Overridable via env.
FRONTEND_ORIGIN = env("FRONTEND_ORIGIN", default="http://localhost:3000")
# Lifetime (hours) of the one-time set-password link issued by the onboarding
# flow (accounts.models.issue_password_setup_token). Overridable via env.
PASSWORD_SETUP_TOKEN_TTL_HOURS = env.int("PASSWORD_SETUP_TOKEN_TTL_HOURS", default=72)
# Lifetime (hours) of the candidate-facing offer signing token
# (onboarding.models.OfferLetter.issue_signing_token). Overridable via env.
OFFER_SIGNING_TOKEN_TTL_HOURS = env.int("OFFER_SIGNING_TOKEN_TTL_HOURS", default=168)  # 7 days
# E-signature provider selection for the onboarding module
# (onboarding.esignature.get_signature_provider). Overridable via env.
ESIGNATURE_PROVIDER = env("ESIGNATURE_PROVIDER", default="in_app")
ESIGN_WEBHOOK_SECRET = env("ESIGN_WEBHOOK_SECRET", default="dev-only-webhook-secret")
# Real delivery: set DJANGO_EMAIL_BACKEND to the SMTP backend and fill these in
# (env). Left blank the console backend prints emails to the server log instead.
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # JWTAuthentication reads `Authorization: Bearer <token>` — the frontend's
    # Next.js proxy layer holds the actual HttpOnly cookies and forwards the
    # access token as a bearer header (frontend/src/lib/api/proxy.ts); Django
    # itself never sets or reads an auth cookie. SessionAuthentication stays
    # enabled too, for /admin/ and the browsable API.
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    # Every DRF response auto-converts snake_case model fields to the camelCase
    # the frontend contract expects, and incoming request bodies convert back
    # (docs/TASKS.md P0-E1-06) — write Django code in normal snake_case.
    "DEFAULT_RENDERER_CLASSES": (
        "djangorestframework_camel_case.render.CamelCaseJSONRenderer",
        "djangorestframework_camel_case.render.CamelCaseBrowsableAPIRenderer",
    ),
    "DEFAULT_PARSER_CLASSES": (
        "djangorestframework_camel_case.parser.CamelCaseJSONParser",
        "djangorestframework_camel_case.parser.CamelCaseFormParser",
        "djangorestframework_camel_case.parser.CamelCaseMultiPartParser",
    ),
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "core.pagination.ContractPageNumberPagination",
    "PAGE_SIZE": 20,
    # LoginView sets throttle_scope="login" (P1-E1-10) — this is the IP-based
    # defense against one IP hammering many accounts; FailedLoginAttempt
    # (accounts/models.py) is the separate, per-account defense against one
    # account being brute-forced from anywhere. Deliberately generous (not a
    # tight production value) since this also has to not lock out normal
    # local dev/test usage.
    # The offer_public_* scopes below belong to the onboarding module's
    # unauthenticated candidate-facing offer endpoints (token-guarded but
    # still rate-limited); additive entries, the login scope is unchanged.
    "DEFAULT_THROTTLE_RATES": {
        "login": "20/min",
        "offer_public_read": "60/min",
        "offer_public_write": "20/min",
    },
}

# P1-E4-02: 5 failed attempts locks the account for this long. A window
# query (count failures within the trailing window), not a stored "locked
# until" timestamp — self-expiring, no unlock step needed.
ACCOUNT_LOCKOUT_THRESHOLD = 5
ACCOUNT_LOCKOUT_WINDOW = timedelta(minutes=15)

# docs/IMPLEMENTATION-PLAN.md's contract: 15m access / 7d refresh, rotate +
# blacklist on every refresh so a stolen refresh token can only be replayed
# once before it's rejected (P1-E1-06).
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

# Cookie defaults Phase 1's auth endpoints rely on (P0-E1-05).
# SESSION_COOKIE_SECURE mirrors CSRF here since DEBUG-conditional secure cookies
# are what local dev over http needs; both flip to True outside DEBUG.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_PATH = "/"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_PATH = "/"
CSRF_COOKIE_SECURE = not DEBUG
