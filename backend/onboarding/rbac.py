"""Step 1 of plugging into the core: declare onboarding's permissions and the
default scope each starter role gets. Admins can change these later; re-running
migrate never overwrites their changes (see core/registry.py).

Registered with `enabled=False`: the views are authenticated but do not enforce
these codes yet (see docs/RBAC-WIRING-AUDIT.md), so they stay out of the role
UI until the module enforces them."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module, register_permissions

register_module(
    ModuleSpec(
        key="onboarding",
        label="Onboarding",
        enabled=False,
        permissions=(
            PermissionSpec(
                "onboarding.read",
                "View onboarding records, tasks and offer letters within the holder's scope",
                label="View onboarding records",
                group="Onboarding",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "onboarding.write",
                "Create or change onboarding records, tasks and offer letters",
                label="Manage onboarding records",
                group="Onboarding",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "onboarding.manage",
                "Manage onboarding templates and background verification",
                label="Manage onboarding setup",
                group="Onboarding",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)


# ---------------------------------------------------------------------------
# Fine-grained CoreHR Preboarding Privileges (catalog mirrored from the HR
# reference UI). Candidate / offer management for the preboarding flow,
# namespaced preboarding.* alongside the coarse onboarding.* codes above.
# ---------------------------------------------------------------------------
_PRE_HR = {"HR Admin": ScopeTier.ALL}

register_permissions(
    PermissionSpec("preboarding.candidates.view_all", "View all candidates.",
                   label="View All Candidates", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.candidate.add", "Add a new candidate.",
                   label="Add Candidate", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.offer.start", "Start the offer process for a candidate.",
                   label="Start Offer Process", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.candidate_tasks.update", "Update a candidate's tasks.",
                   label="Update Candidate Tasks", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.candidate_tasks.remind", "Remind a candidate about their tasks.",
                   label="Remind Candidate Tasks", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.document.upload_on_behalf", "Upload a document on a candidate's behalf.",
                   label="Upload Document on Behalf of Candidate", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.document.verify", "Verify a candidate's document.",
                   label="Verify Candidate Document", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.offer.create", "Create an offer for a candidate.",
                   label="Create Offer", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.offer.remind_approver", "Remind an approver to approve or reject an offer.",
                   label="Remind Approver to Approve or Reject Offer", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
    PermissionSpec("preboarding.offer.release", "Release an offer to a candidate.",
                   label="Release Offer", group="CoreHR Preboarding Privileges", default_grants=_PRE_HR),
)
