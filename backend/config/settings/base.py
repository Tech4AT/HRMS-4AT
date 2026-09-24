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
    # Plug-in modules built on the core.
    "payroll",
    "org_calendar",
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
    "DEFAULT_THROTTLE_RATES": {"login": "20/min"},
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
