"""Compatibility shim: re-export the canonical `write_audit` so modules written
against the `audit.utils` import path resolve to our implementation.

Our audit model stores the change payload in the `diff` field (see
`audit.models.AuditLog`); `audit.service.write_audit` already implements the
`(actor, action, entity_type, entity_id, diff)` contract, so this module only
re-exports it — the single source of truth stays in `audit/service.py`.
"""

from audit.service import write_audit

__all__ = ["write_audit"]
