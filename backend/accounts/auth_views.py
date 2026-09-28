"""Auth endpoints matching docs/IMPLEMENTATION-PLAN.md's contract exactly —
verified against the actual frontend proxy code (frontend/src/lib/api/proxy.ts,
frontend/src/app/api/auth/*), not just the docs, since the two had drifted:
tokens travel in the JSON body only (Next.js sets the HttpOnly cookies itself
from that body; Django never sets an auth cookie), login is by email not
username, and GET /users/me must include a `scope` field the docs had
incorrectly marked as deliberately dropped.

Every event here writes to the audit log (docs/TASKS.md P1-E2-03) and login
is defended two ways: an IP-scoped DRF throttle (LoginView.throttle_scope,
P1-E1-10) against one IP hammering many accounts, and a per-account lockout
(FailedLoginAttempt, P1-E4-01/02) against one account being brute-forced from
anywhere — deliberately separate mechanisms for deliberately separate threats.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from djangorestframework_camel_case.util import camelize
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import FailedLoginAttempt
from accounts.serializers import (
    AuthUserSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    MeUpdateSerializer,
)
from accounts.services import revoke_all_sessions
from audit.service import write_audit
from core.scope import primary_archetype, resolve_management_scope, user_effective_permissions

User = get_user_model()


def _error(code, message, fields=None, http_status=status.HTTP_400_BAD_REQUEST):
    return Response(
        {"success": False, "error": {"code": code, "message": message, "fields": fields or {}}},
        status=http_status,
    )


def _issue_tokens(user):
    refresh = RefreshToken.for_user(user)
    return {"accessToken": str(refresh.access_token), "refreshToken": str(refresh)}


def _is_locked_out(user) -> bool:
    window_start = timezone.now() - settings.ACCOUNT_LOCKOUT_WINDOW
    recent_failures = FailedLoginAttempt.objects.filter(
        user=user, created_at__gte=window_start
    ).count()
    return recent_failures >= settings.ACCOUNT_LOCKOUT_THRESHOLD


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return _error("VALIDATION_ERROR", "Invalid login payload.", serializer.errors)

        email = serializer.validated_data["email"]
        password = serializer.validated_data["password"]

        # select_for_update() serializes concurrent login attempts against the
        # SAME account: the lockout check and the failure-row write happen as
        # one atomic unit per requester, so a burst of concurrent attempts
        # can't all read the pre-attempt count before any of them commits —
        # each waits for the previous one's row lock to release first. Without
        # this, ACCOUNT_LOCKOUT_THRESHOLD is a check-then-act race.
        with transaction.atomic():
            user = User.objects.select_for_update().filter(email__iexact=email).first()

            if user is not None and _is_locked_out(user):
                write_audit(None, "auth.login_locked_out", "User", user.pk, {"email": email})
                return _error(
                    "ACCOUNT_LOCKED",
                    "Too many failed attempts. Try again in a few minutes.",
                    http_status=status.HTTP_423_LOCKED,
                )

            if user is None or not user.check_password(password) or not user.is_active:
                if user is not None:
                    FailedLoginAttempt.objects.create(user=user)
                write_audit(
                    None, "auth.login_failed", "User", getattr(user, "pk", None), {"email": email}
                )
                return _error(
                    "INVALID_CREDENTIALS",
                    "Email or password is incorrect.",
                    http_status=status.HTTP_401_UNAUTHORIZED,
                )

            tokens = _issue_tokens(user)
            write_audit(user, "auth.login_succeeded", "User", user.pk)
            return Response(
                {
                    "success": True,
                    "data": {
                        "user": AuthUserSerializer(user).data,
                        **tokens,
                    },
                }
            )


class RefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        # CamelCaseJSONParser has already converted the incoming `refreshToken`
        # key to `refresh_token` by the time it reaches request.data.
        refresh_token = request.data.get("refresh_token")
        if not refresh_token:
            return _error("VALIDATION_ERROR", "refreshToken is required.")

        try:
            refresh = RefreshToken(refresh_token)
            user = User.objects.get(pk=refresh["user_id"])

            if not user.is_active:
                # Deactivation (e.g. an employee's exit) must actually end
                # their session, not just block new logins — revoke the
                # token outright rather than silently refusing to rotate it,
                # so it can't be retried.
                refresh.blacklist()
                write_audit(None, "auth.refresh_denied_inactive", "User", user.pk)
                return _error(
                    "SESSION_EXPIRED",
                    "Refresh token is invalid or expired.",
                    http_status=status.HTTP_401_UNAUTHORIZED,
                )

            access_token = str(refresh.access_token)
            # ROTATE_REFRESH_TOKENS blacklists this token and mints a new one.
            refresh.blacklist()
            new_refresh = RefreshToken.for_user(user)
        except (TokenError, User.DoesNotExist):
            return _error(
                "SESSION_EXPIRED",
                "Refresh token is invalid or expired.",
                http_status=status.HTTP_401_UNAUTHORIZED,
            )

        write_audit(user, "auth.token_refreshed", "User", user.pk)
        return Response(
            {
                "success": True,
                "data": {"accessToken": access_token, "refreshToken": str(new_refresh)},
            }
        )


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.data.get("refresh_token")
        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                user = User.objects.filter(pk=token["user_id"]).first()
                token.blacklist()
                write_audit(user, "auth.logout", "User", getattr(user, "pk", None))
            except TokenError:
                pass  # best-effort, matches the frontend's own best-effort logout call
        return Response({"success": True})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        # Multi-role (docs/MULTI-ROLE-TESTS.md D2): `roles` is the sorted
        # list of ACTIVE role names, `archetype` the single deterministic
        # primary (most-privileged active role; employee-if-employee-record
        # when holding none), `permissions` the flat effective set.
        roles = sorted(
            user.roles.filter(is_active=True).values_list("name", flat=True)
        )

        return Response(
            {
                "success": True,
                "data": {
                    "id": str(user.pk),
                    "email": user.email,
                    "firstName": user.first_name,
                    "lastName": user.last_name,
                    "roles": roles,
                    "archetype": primary_archetype(user),
                    "permissions": sorted(user_effective_permissions(user)),
                    "scope": resolve_management_scope(user),
                    "mustChangePassword": user.must_change_password,
                },
            }
        )

    def patch(self, request):
        serializer = MeUpdateSerializer(request.user, data=request.data, partial=True)
        if not serializer.is_valid():
            return _error("VALIDATION_ERROR", "Invalid profile update.", serializer.errors)
        before = camelize(
            {"first_name": request.user.first_name, "last_name": request.user.last_name}
        )
        serializer.save()

        write_audit(
            request.user,
            "user.profile_updated",
            "User",
            request.user.pk,
            {"before": before, "after": camelize(serializer.data)},
        )
        return Response(
            {
                "success": True,
                "data": AuthUserSerializer(request.user).data,
            }
        )


class ChangePasswordView(APIView):
    """A signed-in user changes their own password (for example, replacing the
    temporary one an admin issued). Every existing session is revoked and a
    fresh token pair is returned, so a stolen refresh token stops working the
    moment the password changes. Shares the login throttle, since it also
    checks a password."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return _error("VALIDATION_ERROR", "Invalid password payload.", serializer.errors)
        current = serializer.validated_data["current_password"]
        new = serializer.validated_data["new_password"]
        user = request.user

        if not user.check_password(current):
            return _error(
                "INVALID_CREDENTIALS",
                "Current password is incorrect.",
                {"currentPassword": ["Current password is incorrect."]},
            )
        if new == current:
            return _error(
                "VALIDATION_ERROR",
                "The new password must be different.",
                {"newPassword": ["The new password must be different."]},
            )
        try:
            validate_password(new, user)
        except DjangoValidationError as exc:
            return _error(
                "VALIDATION_ERROR",
                "The new password is not acceptable.",
                {"newPassword": list(exc.messages)},
            )

        with transaction.atomic():
            user.set_password(new)
            # A successful change clears the forced-change flag an admin-set
            # temporary password raised (T06) — including the user's own first
            # change, which is exactly the case that must clear it.
            user.must_change_password = False
            user.save(update_fields=["password", "must_change_password"])
            revoked = revoke_all_sessions(user)
            write_audit(
                user, "user.password_changed", "User", user.pk, {"sessionsRevoked": revoked}
            )
        return Response({"success": True, "data": _issue_tokens(user)})


class PasswordSetupCheckView(APIView):
    """GET /auth/set-password/<token> — validate a one-time set-password link
    and return the email address it belongs to, without consuming the token."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        from accounts.models import consume_password_setup_token
        record = consume_password_setup_token(token)
        if record is None:
            return _error(
                "INVALID_TOKEN",
                "This link is invalid or has already been used.",
                http_status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"success": True, "data": {"email": record.user.email}})


class PasswordSetupCompleteView(APIView):
    """POST /auth/set-password/<token>/complete — consume the token, set the
    new password, activate the account, and return JWT tokens so the candidate
    lands already signed in."""

    permission_classes = [AllowAny]

    def post(self, request, token):
        from accounts.models import consume_password_setup_token
        from django.utils import timezone

        record = consume_password_setup_token(token)
        if record is None:
            return _error(
                "INVALID_TOKEN",
                "This link is invalid or has already been used.",
                http_status=status.HTTP_404_NOT_FOUND,
            )

        password = request.data.get("password", "")
        # CamelCaseJSONParser converts confirmPassword → confirm_password
        confirm = request.data.get("confirm_password", "")

        if not password:
            return _error("VALIDATION_ERROR", "Password is required.", {"password": ["This field is required."]})
        if password != confirm:
            return _error("VALIDATION_ERROR", "Passwords do not match.", {"confirmPassword": ["Passwords do not match."]})

        user = record.user
        try:
            validate_password(password, user)
        except DjangoValidationError as exc:
            return _error("VALIDATION_ERROR", "Password does not meet requirements.", {"password": list(exc.messages)})

        with transaction.atomic():
            user.set_password(password)
            user.is_active = True
            user.must_change_password = False
            user.save(update_fields=["password", "is_active", "must_change_password"])
            record.used_at = timezone.now()
            record.save(update_fields=["used_at"])
            write_audit(user, "user.password_setup_completed", "User", user.pk, {})

        tokens = _issue_tokens(user)
        return Response({
            "success": True,
            "data": {
                "accessToken": tokens["accessToken"],
                "refreshToken": tokens["refreshToken"],
                "user": {
                    "id": user.pk,
                    "email": user.email,
                    "firstName": user.first_name,
                    "lastName": user.last_name,
                },
            },
        })
