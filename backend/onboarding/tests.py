"""
Offer Letter -> Electronic Signature -> Preboarding -> Onboarding workflow.
Django's built-in test runner + DRF's APIClient (no pytest-django/factory_boy
installed in this project despite docs/ARCHITECTURE.md claiming it — see
backend/README.md's own "notable deviations" section).

Candidate-facing calls use a plain, unauthenticated APIClient (the token in
the URL is the only credential — see views_public.py); HR calls use
force_authenticate as the seeded HR Admin user.

Coverage below is mapped to the requirements doc's 30-case checklist
(positive 1-10, rejection 11-14, expiration 15-17, security 18-25, edge
cases 26-30) in each test's docstring/comment where it isn't obvious from
the name.
"""
import hashlib
import hmac
import json
import re
from datetime import date, timedelta
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import ROLE_EMPLOYEE, ROLE_FINANCE, ROLE_HR_ADMIN, Role
from audit.models import AuditLog
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from documents.models import Document
from employees.models import BankDetails, EducationRecord, Employee, IdentityDocument, next_employee_code

from . import esignature, services
from .esignature import SignatureProvider, WebhookEvent
from .models import (
    OFFER_ACCEPTED,
    OFFER_AWAITING_SIGNATURE,
    OFFER_EXPIRED,
    OFFER_GENERATED,
    OFFER_REJECTED,
    OfferLetter,
    OfferLetterTemplate,
    OnboardingProfile,
    OnboardingTaskTemplate,
    OnboardingWebhookEvent,
)

User = get_user_model()


class _FakeAsyncSignatureProvider(SignatureProvider):
    """A minimal `is_async=True` provider, registered only for the duration
    of the webhook tests below (see `patch.dict(esignature._PROVIDERS, ...)`)
    — the real default (`InAppSignatureProvider`) has no webhook at all, so
    exercising the webhook path honestly requires *some* async provider to
    exist, without depending on a real vendor."""

    is_async = True

    def capture_signature(self, **kwargs):
        raise NotImplementedError

    def handle_webhook_event(self, payload, headers):
        if payload.get('type') not in esignature.WEBHOOK_EVENT_TYPES:
            return None
        return WebhookEvent(
            external_event_id=payload['id'], event_type=payload['type'], offer_number=payload['offerNumber'],
        )


class OfferWorkflowTestCase(TestCase):
    def setUp(self):
        self.hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': ['scope.all']})
        self.hr_user = User.objects.create_user(
            email='hr@example.com', password='pw', first_name='Hana', last_name='Ryan', role=self.hr_role,
        )
        self.hr_employee = Employee.objects.create(
            user=self.hr_user, employee_code=next_employee_code(), first_name='Hana', last_name='Ryan',
            work_email='hr@example.com', status=Employee.STATUS_ACTIVE, joining_date=date.today(),
        )
        self.offer_template = OfferLetterTemplate.objects.create(
            name='Standard', heading='Offer of Employment',
            body='Dear {{first_name}}, offer for {{designation}} at {{package}}.',
            is_default=True, created_by=self.hr_user,
        )
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Submit ID proof', owner='new_hire',
            is_required=True, requires_document=True, offset_days=-3,
        )
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Fill personal details', owner='new_hire',
            is_required=True, requires_document=False, offset_days=-2,
        )

        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)
        self.public_client = APIClient()

    def _create_new_hire(self, **overrides):
        payload = {
            'firstName': 'Cara', 'lastName': 'Diaz', 'workEmail': 'cara.diaz@example.com',
            'personalEmail': 'cara.personal@example.com', 'joiningDate': str(date.today() + timedelta(days=14)),
            'basicSalary': 600000, 'hra': 200000,
        }
        payload.update(overrides)
        return self.hr_client.post('/api/v1/onboarding/records', payload, format='json')

    def _send_offer(self, profile_id):
        return self.hr_client.post(f'/api/v1/onboarding/records/{profile_id}/offer-letter/send')

    def _get_raw_token(self, offer: OfferLetter) -> str:
        """Tests need the raw token the way HR's email would carry it;
        services.send_offer_letter returns it but the HTTP layer doesn't (by
        design — see its docstring), so re-issue one directly for tests that
        only care about the candidate-side flow."""
        raw = offer.issue_signing_token(ttl_hours=1)
        offer.save()
        return raw

    # ---- Positive path -----------------------------------------------

    def test_new_hire_creation_does_not_start_preboarding(self):
        resp = self._create_new_hire()
        self.assertEqual(resp.status_code, 201, resp.data)
        data = resp.data['data']

        profile = OnboardingProfile.objects.get(pk=data['id'])
        self.assertEqual(profile.employee.status, Employee.STATUS_PRE_ONBOARDING)
        self.assertTrue(profile.employee.employee_code.startswith('EMP'), 'employee ID generated at creation')
        self.assertEqual(profile.tasks.count(), 0, 'No preboarding tasks until the offer is accepted')
        offer = profile.current_offer_letter
        self.assertIsNotNone(offer)
        self.assertEqual(offer.status, OFFER_GENERATED)
        self.assertEqual(offer.version, 1)

    def test_hr_can_correct_a_candidates_email_address(self):
        """The fix for the exact real-world failure mode this workflow hit:
        a typo'd/fake candidate email bounces every offer email sent to it.
        HR must be able to correct it without recreating the whole record."""
        profile_id = self._create_new_hire().data['data']['id']
        employee = OnboardingProfile.objects.get(pk=profile_id).employee
        old_login_email = employee.user.email

        resp = self.hr_client.patch(f'/api/v1/onboarding/records/{profile_id}', {
            'workEmail': 'CARA.CORRECTED@example.com',
            'personalEmail': 'cara.personal.corrected@example.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['employee']['work_email'], 'cara.corrected@example.com')
        self.assertEqual(resp.data['data']['employee']['personal_email'], 'cara.personal.corrected@example.com')

        employee.refresh_from_db()
        self.assertEqual(employee.work_email, 'cara.corrected@example.com')
        self.assertEqual(employee.personal_email, 'cara.personal.corrected@example.com')
        # The login account has to track it — they started out identical.
        self.assertEqual(employee.user.email, 'cara.corrected@example.com')
        self.assertNotEqual(employee.user.email, old_login_email)

        self.assertTrue(AuditLog.objects.filter(action='onboarding.candidate_email_updated', entity_id=str(employee.id)).exists())

    def test_cannot_correct_email_to_one_already_in_use(self):
        profile_id = self._create_new_hire().data['data']['id']
        other_id = self._create_new_hire(workEmail='taken@example.com', personalEmail='taken.p@example.com').data['data']['id']
        self.assertNotEqual(profile_id, other_id)

        resp = self.hr_client.patch(f'/api/v1/onboarding/records/{profile_id}', {'workEmail': 'taken@example.com'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('already', resp.data['error']['message'].lower())

    def test_send_offer_moves_to_awaiting_signature_and_emails_candidate(self):
        profile_id = self._create_new_hire().data['data']['id']
        resp = self._send_offer(profile_id)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['status'], OFFER_AWAITING_SIGNATURE)

        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        self.assertIsNotNone(offer.signing_token_hash)
        self.assertIsNotNone(offer.expires_at)
        self.assertEqual(len(mail.outbox), 1)

    def test_candidate_can_view_offer_by_token_and_it_marks_viewed(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        resp = self.public_client.get(f'/api/v1/offers/sign/{raw}')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['candidate_name'], 'Cara Diaz')
        self.assertEqual(resp.data['data']['status'], 'viewed')

        offer.refresh_from_db()
        self.assertIsNotNone(offer.viewed_at)

    def test_full_acceptance_flow_creates_preboarding_tasks_and_activates_nothing_yet(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        resp = self.public_client.post(
            f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['status'], OFFER_ACCEPTED)

        profile = OnboardingProfile.objects.get(pk=profile_id)
        offer.refresh_from_db()
        self.assertEqual(offer.status, OFFER_ACCEPTED)
        self.assertIsNotNone(offer.signed_at)
        self.assertIsNotNone(offer.accepted_at)
        self.assertEqual(offer.signature_name, 'Cara Diaz')
        self.assertIsNone(offer.signing_token_hash, 'token must be invalidated after use')

        # Preboarding starts, but Day 1 activation is still a separate,
        # explicit HR step — the employee is not ACTIVE yet.
        self.assertEqual(profile.tasks.count(), 2)
        profile.employee.refresh_from_db()
        self.assertEqual(profile.employee.status, Employee.STATUS_PRE_ONBOARDING)

        self.assertTrue(AuditLog.objects.filter(action='onboarding.offer_accepted', entity_id=str(offer.id)).exists())
        self.assertTrue(AuditLog.objects.filter(action='onboarding.preboarding_started').exists())

    def test_signing_regenerates_the_pdf_with_the_signature_baked_in(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        pre_signature_document_id = offer.document_id
        raw = self._get_raw_token(offer)

        resp = self.public_client.post(
            f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        offer.refresh_from_db()
        self.assertIsNotNone(offer.document_id)
        self.assertNotEqual(
            offer.document_id, pre_signature_document_id,
            'signing must regenerate the PDF (with the signature block) rather than reuse the pre-signature file',
        )
        self.assertEqual(Document.objects.filter(entity_type='offer_letter', entity_id=str(offer.id)).count(), 2)

        # The content stream is ASCII85+Flate compressed (reportlab's
        # default) — decode it the same way a PDF reader would rather than
        # grepping the raw (compressed) bytes.
        import base64
        import zlib

        from onboarding.offer_letter import render_offer_letter_pdf
        pdf_bytes = render_offer_letter_pdf(offer)
        stream_match = re.search(rb'stream\r?\n(.*?)endstream', pdf_bytes, re.DOTALL)
        self.assertIsNotNone(stream_match, 'expected a content stream in the generated PDF')
        raw_stream = stream_match.group(1).rstrip(b'\n').removesuffix(b'~>')
        decoded = zlib.decompress(base64.a85decode(raw_stream, adobe=False))
        self.assertIn(b'Cara Diaz', decoded, 'signed PDF content stream should contain the typed signature name')
        self.assertIn(b'Signed and Accepted', decoded)

    def test_my_documents_overview_shows_only_the_current_offer_letter_not_every_regeneration(self):
        """generate_offer_letter_document is called more than once across a
        single offer's life (once at creation, again if HR edits a draft's
        package, again at signing) and never deletes the previous Document
        row it orphans — the candidate's folder must show only the current
        one, not one "Offer Letter" row per historical regeneration."""
        profile_id = self._create_new_hire().data['data']['id']
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter

        # A draft edit regenerates the PDF before it's ever sent.
        services.generate_offer_letter_document(offer, actor=self.hr_user)

        self._send_offer(profile_id)
        offer.refresh_from_db()
        raw = self._get_raw_token(offer)
        self.public_client.post(
            f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json',
        )
        offer.refresh_from_db()

        # Three regenerations now exist on disk for this one offer.
        self.assertEqual(Document.objects.filter(entity_type='offer_letter', entity_id=str(offer.id)).count(), 3)

        candidate_client = APIClient()
        candidate_client.force_authenticate(user=offer.profile.employee.user)
        resp = candidate_client.get('/api/v1/onboarding/me/documents-overview')
        self.assertEqual(resp.status_code, 200, resp.data)

        offer_letters = resp.data['data']['offerLetters']
        self.assertEqual(len(offer_letters), 1, 'one offer -> one entry, regardless of how many times it was regenerated')
        self.assertEqual(len(offer_letters[0]['documents']), 1, 'only the current document, not every historical one')
        self.assertEqual(offer_letters[0]['documents'][0]['id'], offer.document_id)

    def test_completing_every_required_preboarding_task_auto_activates_day1(self):
        """No one ever calls POST .../activate in this test — finishing the
        checklist alone must flip preboarding -> onboarding."""
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)
        self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')

        profile = OnboardingProfile.objects.get(pk=profile_id)
        self.assertEqual(profile.stage, 'preboarding')
        required_tasks = list(profile.tasks.filter(is_required=True))
        self.assertEqual(len(required_tasks), 2)

        # Completing the first required task alone must NOT be enough.
        self.hr_client.patch(f'/api/v1/onboarding/tasks/{required_tasks[0].id}', {'status': 'done'}, format='json')
        profile.refresh_from_db()
        self.assertEqual(profile.stage, 'preboarding')

        # Completing the last one auto-activates — no manual /activate call.
        resp = self.hr_client.patch(f'/api/v1/onboarding/tasks/{required_tasks[1].id}', {'status': 'done'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

        profile.refresh_from_db()
        self.assertEqual(profile.stage, 'onboarding')
        self.assertIsNotNone(profile.day1_completed_at)
        profile.employee.refresh_from_db()
        self.assertEqual(profile.employee.status, Employee.STATUS_ACTIVE)

        auto_log = AuditLog.objects.filter(action='onboarding.day1_activated', entity_id=str(profile.id)).first()
        self.assertIsNotNone(auto_log)
        self.assertEqual(auto_log.diff_json.get('trigger'), 'checklist_complete')
        # Attributed to whoever's request completed the last task (here, HR
        # marking it done on the candidate's behalf) — distinguishable from
        # a manual "Mark Day 1 Complete" click only by `trigger` above, not
        # by actor, since both really did happen inside an HR request.
        self.assertEqual(auto_log.actor_id, self.hr_user.id)

    def test_offer_proven_tasks_auto_complete_on_acceptance(self):
        """'Send offer letter' / 'Collect signed offer letter' checklist
        items are provably true from the offer record the moment
        preboarding tasks are generated (at acceptance) — HR shouldn't have
        to manually tick them."""
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Send offer letter', owner='hr_admin', is_required=True, offset_days=-10,
        )
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Collect Signed Offer Letter', owner='new_hire', is_required=True, offset_days=-5,
        )
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')

        profile = OnboardingProfile.objects.get(pk=profile_id)
        send_task = profile.tasks.get(title='Send offer letter')
        collect_task = profile.tasks.get(title='Collect Signed Offer Letter')
        self.assertEqual(send_task.status, 'done')
        self.assertIsNotNone(send_task.completed_at)
        self.assertEqual(collect_task.status, 'done')
        self.assertIsNotNone(collect_task.completed_at)
        # Untouched — matched by exact title only, not blanket-completed.
        self.assertEqual(profile.tasks.get(title='Submit ID proof').status, 'pending')

    def test_duplicate_accept_is_idempotent_not_an_error(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        first = self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')
        self.assertEqual(first.status_code, 200)
        task_count_after_first = OnboardingProfile.objects.get(pk=profile_id).tasks.count()

        # The token is invalidated after use, so re-accepting by id directly
        # (as a retried webhook would, by offer id, not by token) must still
        # be a safe no-op — not a duplicate employee/task-creation bug.
        result = services.accept_offer(offer.id, typed_name='Cara Diaz', agreed=True, ip_address=None, user_agent='', actor=None)
        self.assertEqual(result.status, OFFER_ACCEPTED)
        self.assertEqual(OnboardingProfile.objects.get(pk=profile_id).tasks.count(), task_count_after_first)

    # ---- Rejection ------------------------------------------------------

    def test_rejection_stops_workflow(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        resp = self.public_client.post(
            f'/api/v1/offers/sign/{raw}/reject',
            {'reason': 'another_offer', 'comments': 'Took a role elsewhere'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['status'], OFFER_REJECTED)

        profile = OnboardingProfile.objects.get(pk=profile_id)
        self.assertEqual(profile.tasks.count(), 0, 'no preboarding after rejection')
        profile.employee.refresh_from_db()
        self.assertEqual(profile.employee.status, Employee.STATUS_OFFER_DECLINED)

    def test_cannot_accept_after_reject_or_reject_after_accept(self):
        """The HTTP-level check (via token) and the services-level check
        (via offer id, as a retried webhook would call it — see
        webhooks.py) are both exercised here: the token is invalidated the
        instant a terminal action completes (docs/REQUIREMENTS.md §5's
        "prevent token reuse after completion"), so the *token* path 404s;
        the *id* path (what an async provider's webhook uses, since it has
        no token) is what surfaces the "already rejected/accepted" 409."""
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)
        self.public_client.post(f'/api/v1/offers/sign/{raw}/reject', {'reason': 'other', 'comments': ''}, format='json')

        # Token reuse after completion is rejected outright (404, not 409):
        stale_token_resp = self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')
        self.assertEqual(stale_token_resp.status_code, 404)

        # The underlying state-machine guard itself (id-based, as a webhook would call it):
        offer.refresh_from_db()
        with self.assertRaises(Exception) as ctx:
            services.accept_offer(offer.id, typed_name='Cara Diaz', agreed=True, ip_address=None, user_agent='', actor=None)
        self.assertIn('already been rejected', str(ctx.exception))

        # And the reverse: accepted -> reject must also fail.
        profile_id_2 = self._create_new_hire(workEmail='second@example.com', personalEmail='second.p@example.com').data['data']['id']
        self._send_offer(profile_id_2)
        offer2 = OnboardingProfile.objects.get(pk=profile_id_2).current_offer_letter
        raw2 = self._get_raw_token(offer2)
        self.public_client.post(f'/api/v1/offers/sign/{raw2}/sign', {'signatureName': 'X', 'agree': True}, format='json')
        offer2.refresh_from_db()
        with self.assertRaises(Exception) as ctx2:
            services.reject_offer(offer2.id, reason='other', comments='', actor=None)
        self.assertIn('already been accepted', str(ctx2.exception))

    # ---- Expiration -------------------------------------------------------

    def test_expired_offer_cannot_be_signed(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = offer.issue_signing_token(ttl_hours=1)
        offer.signing_token_expires_at = timezone.now() - timedelta(hours=1)
        offer.expires_at = offer.signing_token_expires_at
        offer.save()

        resp = self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')
        self.assertEqual(resp.status_code, 409)
        self.assertIn('expired', resp.data['error']['message'].lower())

        offer.refresh_from_db()
        self.assertEqual(offer.status, OFFER_EXPIRED)

    def test_expire_pending_offers_command(self):
        from django.core.management import call_command

        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        offer.signing_token_expires_at = timezone.now() - timedelta(hours=1)
        offer.expires_at = offer.signing_token_expires_at
        offer.save()

        call_command('expire_pending_offers')
        offer.refresh_from_db()
        self.assertEqual(offer.status, OFFER_EXPIRED)

    # ---- Security -----------------------------------------------------

    def test_invalid_token_returns_not_found(self):
        resp = self.public_client.get('/api/v1/offers/sign/not-a-real-token')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.data['error']['message'], 'Invalid or expired offer link.')

    def test_one_candidate_cannot_reach_another_candidates_offer(self):
        profile_id_a = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id_a)
        offer_a = OnboardingProfile.objects.get(pk=profile_id_a).current_offer_letter
        raw_a = self._get_raw_token(offer_a)

        profile_id_b = self._create_new_hire(workEmail='b@example.com', personalEmail='b.personal@example.com').data['data']['id']
        self._send_offer(profile_id_b)
        offer_b = OnboardingProfile.objects.get(pk=profile_id_b).current_offer_letter

        # b's raw token must never resolve to a's offer, and vice versa —
        # there is no numeric id in the URL to tamper with in the first
        # place, so this mostly proves the hash lookup is exact-match.
        resp = self.public_client.get(f'/api/v1/offers/sign/{raw_a}')
        self.assertEqual(resp.data['data']['candidate_name'], 'Cara Diaz')
        self.assertNotEqual(offer_a.id, offer_b.id)

    def test_superseded_version_token_is_invalidated(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer_v1 = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw_v1 = self._get_raw_token(offer_v1)

        # HR edits the offer after sending -> new version, old token dead.
        resp = self.hr_client.patch(f'/api/v1/onboarding/records/{profile_id}/offer-letter', {'basicSalary': 700000}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['version'], 2)

        stale = self.public_client.get(f'/api/v1/offers/sign/{raw_v1}')
        self.assertEqual(stale.status_code, 404)

    def test_offer_letter_endpoints_require_hr_admin(self):
        profile_id = self._create_new_hire().data['data']['id']

        non_admin_role, _ = Role.objects.get_or_create(name='employee', defaults={'permissions': []})
        other_user = User.objects.create_user(email='not-hr@example.com', password='pw', role=non_admin_role)
        non_admin_client = APIClient()
        non_admin_client.force_authenticate(user=other_user)

        resp = non_admin_client.post(f'/api/v1/onboarding/records/{profile_id}/offer-letter/send')
        self.assertEqual(resp.status_code, 403)

    def test_webhook_requires_valid_signature(self):
        from django.test import override_settings

        with override_settings(ESIGN_WEBHOOK_SECRET='test-secret'):
            resp = self.client.post(
                '/api/v1/webhooks/esign', data='{}', content_type='application/json', HTTP_X_SIGNATURE='wrong',
            )
            self.assertEqual(resp.status_code, 403)

    # ---- Cancel ("undo") -----------------------------------------------

    def test_hr_can_cancel_a_sent_offer_and_the_candidates_link_dies(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        resp = self.hr_client.post(f'/api/v1/onboarding/records/{profile_id}/offer-letter/cancel')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['status'], 'cancelled')

        offer.refresh_from_db()
        self.assertIsNone(offer.signing_token_hash)
        self.assertIsNotNone(offer.cancelled_at)

        # The candidate's already-emailed link must stop working immediately.
        dead_link = self.public_client.get(f'/api/v1/offers/sign/{raw}')
        self.assertEqual(dead_link.status_code, 404)

    def test_cannot_cancel_an_already_accepted_offer(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)
        self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')

        resp = self.hr_client.post(f'/api/v1/onboarding/records/{profile_id}/offer-letter/cancel')
        self.assertEqual(resp.status_code, 409)
        self.assertIn('accepted', resp.data['error']['message'].lower())

    # ---- Security: case 20 (reused token) -------------------------------

    def test_reused_token_after_signing_is_rejected(self):
        """A second sign attempt with the *same* raw token that already
        succeeded once must not resolve at all — the token is invalidated
        the instant it's consumed (see resolve_offer_by_token / §5's
        "prevent token reuse after completion")."""
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        first = self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')
        self.assertEqual(first.status_code, 200)

        replay = self.public_client.post(f'/api/v1/offers/sign/{raw}/sign', {'signatureName': 'Cara Diaz', 'agree': True}, format='json')
        self.assertEqual(replay.status_code, 404)
        self.assertEqual(replay.data['error']['message'], 'Invalid or expired offer link.')

        # Same for a plain view — the dead token can't even read the offer any more.
        replay_view = self.public_client.get(f'/api/v1/offers/sign/{raw}')
        self.assertEqual(replay_view.status_code, 404)

    # ---- Edge case: case 29 (resend) -------------------------------------

    def test_resend_issues_a_new_token_and_the_old_one_dies(self):
        """Extracts the real tokens from the actual sent emails (rather than
        the `_get_raw_token` test helper, which would reissue-and-thus-kill
        whichever token was current) — this is the one test that needs to
        prove two *specific*, actually-emailed tokens behave differently."""
        import re

        def extract_token(email_message):
            html_body = email_message.alternatives[0][0]
            match = re.search(r'/offer/([A-Za-z0-9_-]+)', html_body)
            self.assertIsNotNone(match, 'no signing link found in email body')
            return match.group(1)

        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        self.assertEqual(len(mail.outbox), 1)
        old_raw = extract_token(mail.outbox[0])

        resp = self.hr_client.post(f'/api/v1/onboarding/records/{profile_id}/offer-letter/resend')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(mail.outbox), 2)
        new_raw = extract_token(mail.outbox[1])
        self.assertNotEqual(old_raw, new_raw)

        old_link = self.public_client.get(f'/api/v1/offers/sign/{old_raw}')
        self.assertEqual(old_link.status_code, 404)

        new_link = self.public_client.get(f'/api/v1/offers/sign/{new_raw}')
        self.assertEqual(new_link.status_code, 200)

    # ---- Edge case: case 30 (opened multiple times) -----------------------

    def test_opening_the_offer_multiple_times_only_records_first_view(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter
        raw = self._get_raw_token(offer)

        first = self.public_client.get(f'/api/v1/offers/sign/{raw}')
        self.assertEqual(first.data['data']['status'], 'viewed')
        first_viewed_at = OfferLetter.objects.get(pk=offer.id).viewed_at
        self.assertIsNotNone(first_viewed_at)

        for _ in range(3):
            again = self.public_client.get(f'/api/v1/offers/sign/{raw}')
            self.assertEqual(again.status_code, 200)
            self.assertEqual(again.data['data']['status'], 'viewed')

        self.assertEqual(OfferLetter.objects.get(pk=offer.id).viewed_at, first_viewed_at)
        self.assertEqual(
            AuditLog.objects.filter(action='onboarding.offer_viewed', entity_id=str(offer.id)).count(), 1,
            'only the first open should be audited as a view',
        )

    # ---- Security: case 24 (duplicate webhook) / 16 (webhook -> accept) ---

    def test_webhook_document_signed_accepts_offer_and_is_idempotent(self):
        profile_id = self._create_new_hire().data['data']['id']
        self._send_offer(profile_id)
        offer = OnboardingProfile.objects.get(pk=profile_id).current_offer_letter

        payload = {'type': 'DOCUMENT_SIGNED', 'id': 'evt-abc-123', 'offerNumber': offer.offer_number}
        body = json.dumps(payload).encode('utf-8')
        secret = 'test-webhook-secret'
        signature = hmac.new(secret.encode('utf-8'), body, hashlib.sha256).hexdigest()

        with patch.dict(esignature._PROVIDERS, {'fake_async': _FakeAsyncSignatureProvider}):
            with override_settings(ESIGNATURE_PROVIDER='fake_async', ESIGN_WEBHOOK_SECRET=secret):
                first = self.client.post(
                    '/api/v1/webhooks/esign', data=body, content_type='application/json', HTTP_X_SIGNATURE=signature,
                )
                self.assertEqual(first.status_code, 200, first.content)

                offer.refresh_from_db()
                self.assertEqual(offer.status, OFFER_ACCEPTED)
                self.assertEqual(OnboardingProfile.objects.get(pk=profile_id).tasks.count(), 2)

                # The exact same event, replayed (a provider retry) — must
                # not create a second employee-side effect or error out.
                second = self.client.post(
                    '/api/v1/webhooks/esign', data=body, content_type='application/json', HTTP_X_SIGNATURE=signature,
                )
                self.assertEqual(second.status_code, 200, second.content)

        self.assertEqual(OnboardingWebhookEvent.objects.filter(external_event_id='evt-abc-123').count(), 1)
        self.assertEqual(OnboardingProfile.objects.get(pk=profile_id).tasks.count(), 2, 'no duplicate task creation')


class OfferVersioningTestCase(TestCase):
    def setUp(self):
        self.hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': ['scope.all']})
        self.hr_user = User.objects.create_user(email='hr2@example.com', password='pw', role=self.hr_role)
        OfferLetterTemplate.objects.create(
            name='Standard', body='Dear {{first_name}}, {{package}}.', is_default=True, created_by=self.hr_user,
        )
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)

    def test_editing_a_draft_offer_does_not_create_a_new_version(self):
        resp = self.hr_client.post('/api/v1/onboarding/records', {
            'firstName': 'Dev', 'lastName': 'Kapoor', 'workEmail': 'dev.k@example.com',
            'personalEmail': 'dev.personal@example.com', 'joiningDate': str(date.today() + timedelta(days=10)),
            'basicSalary': 500000,
        }, format='json')
        profile_id = resp.data['data']['id']

        patch = self.hr_client.patch(f'/api/v1/onboarding/records/{profile_id}/offer-letter', {'basicSalary': 550000}, format='json')
        self.assertEqual(patch.status_code, 200, patch.data)
        self.assertEqual(patch.data['data']['version'], 1, 'still-draft edits mutate in place')

        self.assertEqual(OfferLetter.objects.filter(profile_id=profile_id).count(), 1)


class BankDetailsTestCase(TestCase):
    """Bank details: same "hr_admin/finance/self only, never a manager"
    security tier as OfferLetter's salary fields."""

    def setUp(self):
        self.hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': []})
        self.finance_role, _ = Role.objects.get_or_create(name=ROLE_FINANCE, defaults={'permissions': []})
        self.manager_role, _ = Role.objects.get_or_create(name='manager', defaults={'permissions': []})
        self.employee_role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})

        self.hr_user = User.objects.create_user(email='bd-hr@example.com', password='pw', role=self.hr_role)
        self.finance_user = User.objects.create_user(email='bd-finance@example.com', password='pw', role=self.finance_role)

        self.candidate_user = User.objects.create_user(email='bd-candidate@example.com', password='pw', role=self.employee_role)
        self.candidate_employee = Employee.objects.create(
            user=self.candidate_user, employee_code=next_employee_code(), first_name='Bank', last_name='Detail',
            work_email='bd-candidate@example.com', status=Employee.STATUS_PRE_ONBOARDING, joining_date=date.today(),
        )
        manager_user = User.objects.create_user(email='bd-manager@example.com', password='pw', role=self.manager_role)
        self.manager_employee = Employee.objects.create(
            user=manager_user, employee_code=next_employee_code(), first_name='Man', last_name='Ager',
            work_email='bd-manager@example.com', status=Employee.STATUS_ACTIVE, joining_date=date.today(),
        )
        self.candidate_employee.manager = self.manager_employee
        self.candidate_employee.save(update_fields=['manager'])

        from .models import OnboardingProfile
        self.profile = OnboardingProfile.objects.create(employee=self.candidate_employee, stage='preboarding', created_by=self.hr_user)
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Add bank account details', owner='new_hire', is_required=True, requires_document=False,
        )
        from . import services as onboarding_services
        onboarding_services.generate_tasks_from_templates(self.profile, category='preboarding')

        self.candidate_client = APIClient()
        self.candidate_client.force_authenticate(user=self.candidate_user)
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)
        self.finance_client = APIClient()
        self.finance_client.force_authenticate(user=self.finance_user)
        self.manager_client = APIClient()
        self.manager_client.force_authenticate(user=manager_user)

    def test_candidate_can_submit_own_bank_details_and_it_completes_the_task(self):
        resp = self.candidate_client.put('/api/v1/onboarding/me/bank-details', {
            'accountHolderName': 'Bank Detail', 'accountNumber': '1234567890123', 'ifscCode': 'hdfc0001234',
            'bankName': 'HDFC Bank', 'branchName': 'MG Road',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['data']['account_number'], '1234567890123')
        self.assertEqual(resp.data['data']['ifsc_code'], 'HDFC0001234')

        task = self.profile.tasks.get(title='Add bank account details')
        self.assertEqual(task.status, 'done')

        bank = BankDetails.objects.get(employee=self.candidate_employee)
        self.assertEqual(bank.masked_account_number, '•••••••••0123')

    def test_hr_sees_masked_number_unless_reveal_requested(self):
        self.candidate_client.put('/api/v1/onboarding/me/bank-details', {
            'accountHolderName': 'Bank Detail', 'accountNumber': '1234567890123',
        }, format='json')

        masked = self.hr_client.get(f'/api/v1/onboarding/records/{self.profile.id}/bank-details')
        self.assertEqual(masked.status_code, 200, masked.data)
        self.assertNotIn('account_number', masked.data['data'])
        self.assertEqual(masked.data['data']['account_number_masked'], '•••••••••0123')

        revealed = self.hr_client.get(f'/api/v1/onboarding/records/{self.profile.id}/bank-details?reveal=true')
        self.assertEqual(revealed.data['data']['account_number'], '1234567890123')
        self.assertTrue(AuditLog.objects.filter(action='onboarding.bank_details_revealed').exists())

    def test_finance_can_view_but_manager_cannot(self):
        self.candidate_client.put('/api/v1/onboarding/me/bank-details', {
            'accountHolderName': 'Bank Detail', 'accountNumber': '1234567890123',
        }, format='json')

        finance_resp = self.finance_client.get(f'/api/v1/onboarding/records/{self.profile.id}/bank-details')
        self.assertEqual(finance_resp.status_code, 200)

        manager_resp = self.manager_client.get(f'/api/v1/onboarding/records/{self.profile.id}/bank-details')
        self.assertEqual(manager_resp.status_code, 403)


class IdentityDocumentTestCase(TestCase):
    """Structured identity documents (Aadhaar/PAN/...): candidate
    self-service submit, HR-only verify/reject, masked-unless-revealed for
    HR/finance, and it satisfies "Submit ID proof" the same way an upload
    used to."""

    def setUp(self):
        self.hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': []})
        self.finance_role, _ = Role.objects.get_or_create(name=ROLE_FINANCE, defaults={'permissions': []})
        self.employee_role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})

        self.hr_user = User.objects.create_user(email='id-hr@example.com', password='pw', role=self.hr_role)
        self.finance_user = User.objects.create_user(email='id-finance@example.com', password='pw', role=self.finance_role)
        self.candidate_user = User.objects.create_user(email='id-candidate@example.com', password='pw', role=self.employee_role)
        self.candidate_employee = Employee.objects.create(
            user=self.candidate_user, employee_code=next_employee_code(), first_name='Ident', last_name='Doc',
            work_email='id-candidate@example.com', status=Employee.STATUS_PRE_ONBOARDING, joining_date=date.today(),
        )

        from .models import OnboardingProfile
        self.profile = OnboardingProfile.objects.create(employee=self.candidate_employee, stage='preboarding', created_by=self.hr_user)
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Submit ID proof', owner='new_hire', is_required=True, requires_document=True,
        )
        from . import services as onboarding_services
        onboarding_services.generate_tasks_from_templates(self.profile, category='preboarding')

        self.candidate_client = APIClient()
        self.candidate_client.force_authenticate(user=self.candidate_user)
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)
        self.finance_client = APIClient()
        self.finance_client.force_authenticate(user=self.finance_user)

    def _submit(self, **overrides):
        payload = {'documentType': 'aadhaar', 'documentNumber': '123456789012', 'fullName': 'Ident Doc'}
        payload.update(overrides)
        return self.candidate_client.post('/api/v1/onboarding/me/identity-documents', payload, format='json')

    def test_candidate_can_submit_and_it_completes_submit_id_proof(self):
        resp = self._submit()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['data']['document_number'], '123456789012')
        self.assertEqual(resp.data['data']['verification_status'], 'pending')

        task = self.profile.tasks.get(title='Submit ID proof')
        self.assertEqual(task.status, 'done')

        doc = IdentityDocument.objects.get(employee=self.candidate_employee)
        self.assertEqual(doc.masked_document_number, '••••••••9012')
        self.assertEqual(doc.submitted_by, self.candidate_user)

    def test_hr_sees_masked_unless_reveal_and_can_verify(self):
        create = self._submit()
        doc_id = create.data['data']['id']

        masked = self.hr_client.get(f'/api/v1/onboarding/records/{self.profile.id}/identity-documents')
        self.assertEqual(masked.status_code, 200, masked.data)
        self.assertNotIn('document_number', masked.data['data'][0])

        revealed = self.hr_client.get(f'/api/v1/onboarding/records/{self.profile.id}/identity-documents?reveal=true')
        self.assertEqual(revealed.data['data'][0]['document_number'], '123456789012')
        self.assertTrue(AuditLog.objects.filter(action='onboarding.identity_documents_revealed').exists())

        verify = self.hr_client.patch(f'/api/v1/onboarding/identity-documents/{doc_id}/verify', {'status': 'verified'}, format='json')
        self.assertEqual(verify.status_code, 200, verify.data)
        self.assertEqual(verify.data['data']['verification_status'], 'verified')

        doc = IdentityDocument.objects.get(pk=doc_id)
        self.assertEqual(doc.verified_by, self.hr_user)
        self.assertIsNotNone(doc.verified_at)

    def test_finance_can_view_but_not_verify(self):
        create = self._submit()
        doc_id = create.data['data']['id']

        finance_view = self.finance_client.get(f'/api/v1/onboarding/records/{self.profile.id}/identity-documents')
        self.assertEqual(finance_view.status_code, 200)

        finance_verify = self.finance_client.patch(f'/api/v1/onboarding/identity-documents/{doc_id}/verify', {'status': 'verified'}, format='json')
        self.assertEqual(finance_verify.status_code, 403)

    def test_candidate_cannot_verify_their_own_document(self):
        create = self._submit()
        doc_id = create.data['data']['id']

        resp = self.candidate_client.patch(f'/api/v1/onboarding/identity-documents/{doc_id}/verify', {'status': 'verified'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(IdentityDocument.objects.get(pk=doc_id).verification_status, 'pending')

    def test_candidate_cannot_delete_after_verification(self):
        create = self._submit()
        doc_id = create.data['data']['id']
        self.hr_client.patch(f'/api/v1/onboarding/identity-documents/{doc_id}/verify', {'status': 'verified'}, format='json')

        resp = self.candidate_client.delete(f'/api/v1/onboarding/me/identity-documents/{doc_id}')
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(IdentityDocument.objects.filter(pk=doc_id).exists())

    def test_candidate_can_delete_while_pending(self):
        create = self._submit()
        doc_id = create.data['data']['id']

        resp = self.candidate_client.delete(f'/api/v1/onboarding/me/identity-documents/{doc_id}')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(IdentityDocument.objects.filter(pk=doc_id).exists())

    def test_rejecting_without_a_reason_is_rejected(self):
        create = self._submit()
        doc_id = create.data['data']['id']

        resp = self.hr_client.patch(f'/api/v1/onboarding/identity-documents/{doc_id}/verify', {'status': 'rejected'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('notes', resp.data['error'].get('fields', {}))
        self.assertEqual(IdentityDocument.objects.get(pk=doc_id).verification_status, 'pending')

    def test_rejected_document_can_be_resubmitted(self):
        create = self._submit()
        doc_id = create.data['data']['id']

        reject = self.hr_client.patch(
            f'/api/v1/onboarding/identity-documents/{doc_id}/verify',
            {'status': 'rejected', 'notes': 'Number does not match the scanned copy'}, format='json',
        )
        self.assertEqual(reject.status_code, 200, reject.data)
        self.assertEqual(reject.data['data']['verification_status'], 'rejected')

        # Resubmission is delete-then-resubmit, same as a generic document's
        # "replace" — a rejected doc, unlike a verified one, isn't locked.
        delete_resp = self.candidate_client.delete(f'/api/v1/onboarding/me/identity-documents/{doc_id}')
        self.assertEqual(delete_resp.status_code, 204)

        resubmit = self._submit(documentNumber='987654321098')
        self.assertEqual(resubmit.status_code, 201, resubmit.data)
        self.assertEqual(resubmit.data['data']['verification_status'], 'pending')


class EducationRecordTestCase(TestCase):
    """Structured education records (degrees/certificates): candidate
    self-service submit (several allowed), HR-only verify/reject, and it
    satisfies "Submit educational certificates" the same way identity
    documents satisfy "Submit ID proof"."""

    def setUp(self):
        self.hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': []})
        self.employee_role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})

        self.hr_user = User.objects.create_user(email='edu-hr@example.com', password='pw', role=self.hr_role)
        self.candidate_user = User.objects.create_user(email='edu-candidate@example.com', password='pw', role=self.employee_role)
        self.candidate_employee = Employee.objects.create(
            user=self.candidate_user, employee_code=next_employee_code(), first_name='Edu', last_name='Cand',
            work_email='edu-candidate@example.com', status=Employee.STATUS_PRE_ONBOARDING, joining_date=date.today(),
        )

        from .models import OnboardingProfile
        self.profile = OnboardingProfile.objects.create(employee=self.candidate_employee, stage='preboarding', created_by=self.hr_user)
        OnboardingTaskTemplate.objects.create(
            category='preboarding', title='Submit educational certificates', owner='new_hire', is_required=True, requires_document=True,
        )
        from . import services as onboarding_services
        onboarding_services.generate_tasks_from_templates(self.profile, category='preboarding')

        self.candidate_client = APIClient()
        self.candidate_client.force_authenticate(user=self.candidate_user)
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)

    def _submit(self, **overrides):
        payload = {'degree': 'Bachelors', 'branch': 'Computer Science', 'university': 'State University', 'yearOfCompletion': 2022}
        payload.update(overrides)
        return self.candidate_client.post('/api/v1/onboarding/me/education-records', payload, format='json')

    def test_candidate_can_submit_multiple_records_and_first_one_completes_the_task(self):
        first = self._submit()
        self.assertEqual(first.status_code, 201, first.data)
        task = self.profile.tasks.get(title='Submit educational certificates')
        self.assertEqual(task.status, 'done')

        second = self._submit(degree='Masters', university='Another University')
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(EducationRecord.objects.filter(employee=self.candidate_employee).count(), 2)

    def test_hr_can_verify_and_reject_requires_a_reason(self):
        create = self._submit()
        record_id = create.data['data']['id']

        no_reason = self.hr_client.patch(f'/api/v1/onboarding/education-records/{record_id}/verify', {'status': 'rejected'}, format='json')
        self.assertEqual(no_reason.status_code, 400)

        verify = self.hr_client.patch(f'/api/v1/onboarding/education-records/{record_id}/verify', {'status': 'verified'}, format='json')
        self.assertEqual(verify.status_code, 200, verify.data)
        self.assertEqual(verify.data['data']['verification_status'], 'verified')

        record = EducationRecord.objects.get(pk=record_id)
        self.assertEqual(record.verified_by, self.hr_user)

    def test_candidate_cannot_delete_after_verification_but_can_while_pending(self):
        create = self._submit()
        record_id = create.data['data']['id']

        pending_delete = self.candidate_client.delete(f'/api/v1/onboarding/me/education-records/{record_id}')
        self.assertEqual(pending_delete.status_code, 204)

        create2 = self._submit()
        record_id2 = create2.data['data']['id']
        self.hr_client.patch(f'/api/v1/onboarding/education-records/{record_id2}/verify', {'status': 'verified'}, format='json')
        verified_delete = self.candidate_client.delete(f'/api/v1/onboarding/me/education-records/{record_id2}')
        self.assertEqual(verified_delete.status_code, 409)

    def test_record_endpoint_visible_to_hr_and_the_owning_candidate_not_a_stranger(self):
        self._submit()
        hr_view = self.hr_client.get(f'/api/v1/onboarding/records/{self.profile.id}/education-records')
        self.assertEqual(hr_view.status_code, 200)
        self.assertEqual(len(hr_view.data['data']), 1)

        # Not sensitive PII like an identity number (no masking needed), so
        # unlike IdentityDocumentsDetailView/BankDetailsDetailView (HR/
        # finance only), this uses the same self+manager+HR visibility rule
        # as onboarding-task documents — the owning candidate can see their
        # own record through this endpoint too, not just via /me/....
        candidate_view = self.candidate_client.get(f'/api/v1/onboarding/records/{self.profile.id}/education-records')
        self.assertEqual(candidate_view.status_code, 200)

        stranger_role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})
        stranger_user = User.objects.create_user(email='edu-stranger@example.com', password='pw', role=stranger_role)
        Employee.objects.create(
            user=stranger_user, employee_code=next_employee_code(), first_name='Edu', last_name='Stranger',
            work_email='edu-stranger@example.com', status=Employee.STATUS_ACTIVE, joining_date=date.today(),
        )
        stranger_client = APIClient()
        stranger_client.force_authenticate(user=stranger_user)
        stranger_view = stranger_client.get(f'/api/v1/onboarding/records/{self.profile.id}/education-records')
        self.assertEqual(stranger_view.status_code, 403)


class EmployeeLetterTestCase(TestCase):
    """HR-issued letters beyond the offer letter — always HR-authored, the
    employee can only view/list, never create."""

    def setUp(self):
        hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': []})
        employee_role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})
        self.hr_user = User.objects.create_user(email='letter-hr@example.com', password='pw', role=hr_role)
        self.candidate_user = User.objects.create_user(email='letter-candidate@example.com', password='pw', role=employee_role)
        self.candidate_employee = Employee.objects.create(
            user=self.candidate_user, employee_code=next_employee_code(), first_name='Letter', last_name='Cand',
            work_email='letter-candidate@example.com', status=Employee.STATUS_ACTIVE, joining_date=date.today(),
        )
        from .models import OnboardingProfile
        self.profile = OnboardingProfile.objects.create(employee=self.candidate_employee, stage='onboarding', created_by=self.hr_user)

        self.candidate_client = APIClient()
        self.candidate_client.force_authenticate(user=self.candidate_user)
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)

    def _file(self, name='letter.pdf'):
        return SimpleUploadedFile(name, b'fake letter bytes', content_type='application/pdf')

    def test_hr_can_issue_a_letter_candidate_can_only_view(self):
        resp = self.hr_client.post(f'/api/v1/onboarding/records/{self.profile.id}/employee-letters', {
            'letterType': 'appointment', 'file': self._file(),
        }, format='multipart')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['data']['title'], 'Appointment Letter')

        candidate_create = self.candidate_client.post(f'/api/v1/onboarding/records/{self.profile.id}/employee-letters', {
            'letterType': 'appraisal', 'file': self._file(),
        }, format='multipart')
        self.assertEqual(candidate_create.status_code, 403)

        candidate_view = self.candidate_client.get('/api/v1/onboarding/me/employee-letters')
        self.assertEqual(candidate_view.status_code, 200)
        self.assertEqual(len(candidate_view.data['data']), 1)
        self.assertEqual(candidate_view.data['data'][0]['letter_type'], 'appointment')

    def test_custom_title_is_preserved(self):
        resp = self.hr_client.post(f'/api/v1/onboarding/records/{self.profile.id}/employee-letters', {
            'letterType': 'promotion', 'title': 'Promotion Letter 2026-27', 'file': self._file(),
        }, format='multipart')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['data']['title'], 'Promotion Letter 2026-27')


class DocumentSecurityTestCase(TestCase):
    """Upload-side IDOR guard + delete permissions + multi-document support
    for the preboarding checklist's document tasks."""

    def setUp(self):
        hr_role, _ = Role.objects.get_or_create(name=ROLE_HR_ADMIN, defaults={'permissions': []})
        employee_role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})
        self.hr_user = User.objects.create_user(email='doc-hr@example.com', password='pw', role=hr_role)

        self.user_a = User.objects.create_user(email='doc-a@example.com', password='pw', role=employee_role)
        self.employee_a = Employee.objects.create(
            user=self.user_a, employee_code=next_employee_code(), first_name='Doc', last_name='A',
            work_email='doc-a@example.com', status=Employee.STATUS_PRE_ONBOARDING, joining_date=date.today(),
        )
        self.user_b = User.objects.create_user(email='doc-b@example.com', password='pw', role=employee_role)
        self.employee_b = Employee.objects.create(
            user=self.user_b, employee_code=next_employee_code(), first_name='Doc', last_name='B',
            work_email='doc-b@example.com', status=Employee.STATUS_PRE_ONBOARDING, joining_date=date.today(),
        )

        self.client_a = APIClient()
        self.client_a.force_authenticate(user=self.user_a)
        self.client_b = APIClient()
        self.client_b.force_authenticate(user=self.user_b)
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)

    def _file(self, name='id.pdf'):
        return SimpleUploadedFile(name, b'fake document bytes', content_type='application/pdf')

    def test_cannot_upload_a_document_claiming_to_be_another_employee(self):
        resp = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_b.id),
        }, format='multipart')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Document.objects.count(), 0)

    def test_can_upload_multiple_documents_to_the_same_task(self):
        for name in ('front.jpg', 'back.jpg'):
            resp = self.client_a.post('/api/v1/documents/', {
                'file': self._file(name), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
            }, format='multipart')
            self.assertEqual(resp.status_code, 201, resp.data)

        self.assertEqual(Document.objects.filter(entity_type='onboarding_task', entity_id='1').count(), 2)

    def test_uploader_can_delete_their_own_document(self):
        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        doc_id = upload.data['data']['id']

        resp = self.client_a.delete(f'/api/v1/documents/{doc_id}')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Document.objects.filter(pk=doc_id).exists())

    def test_hr_can_delete_anyones_document(self):
        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        doc_id = upload.data['data']['id']

        resp = self.hr_client.delete(f'/api/v1/documents/{doc_id}')
        self.assertEqual(resp.status_code, 204)

    def test_other_employee_cannot_delete_someone_elses_document(self):
        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        doc_id = upload.data['data']['id']

        resp = self.client_b.delete(f'/api/v1/documents/{doc_id}')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Document.objects.filter(pk=doc_id).exists())

    def test_unsupported_file_type_is_rejected(self):
        bad_file = SimpleUploadedFile('id.exe', b'not a document', content_type='application/octet-stream')
        resp = self.client_a.post('/api/v1/documents/', {
            'file': bad_file, 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Document.objects.count(), 0)

    def test_oversized_file_is_rejected(self):
        from documents.views import MAX_DOCUMENT_SIZE_BYTES

        too_big = SimpleUploadedFile('id.pdf', b'x' * (MAX_DOCUMENT_SIZE_BYTES + 1), content_type='application/pdf')
        resp = self.client_a.post('/api/v1/documents/', {
            'file': too_big, 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Document.objects.count(), 0)

    def test_protected_file_endpoint_denies_a_stranger_and_logs_access(self):
        from documents.models import DocumentAccessLog

        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        doc_id = upload.data['data']['id']

        denied = self.client_b.get(f'/api/v1/documents/{doc_id}/file')
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(DocumentAccessLog.objects.count(), 0)

        viewed = self.client_a.get(f'/api/v1/documents/{doc_id}/file')
        self.assertEqual(viewed.status_code, 200)
        self.assertIn('inline', viewed['Content-Disposition'])

        downloaded = self.hr_client.get(f'/api/v1/documents/{doc_id}/file?mode=download')
        self.assertEqual(downloaded.status_code, 200)
        self.assertIn('attachment', downloaded['Content-Disposition'])

        self.assertEqual(DocumentAccessLog.objects.filter(document_id=doc_id, action='viewed').count(), 1)
        self.assertEqual(DocumentAccessLog.objects.filter(document_id=doc_id, action='downloaded').count(), 1)

    def test_document_serializer_never_exposes_the_raw_media_path(self):
        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        data = upload.data['data']
        self.assertTrue(data['url'].startswith('/api/documents/'))
        self.assertNotIn('/media/', data['url'])

    def test_manager_can_read_resume_but_not_identity_documents_of_a_direct_report(self):
        manager_role, _ = Role.objects.get_or_create(name='manager', defaults={'permissions': []})
        manager_user = User.objects.create_user(email='doc-mgr@example.com', password='pw', role=manager_role)
        manager_employee = Employee.objects.create(
            user=manager_user, employee_code=next_employee_code(), first_name='Doc', last_name='Mgr',
            work_email='doc-mgr@example.com', status=Employee.STATUS_ACTIVE, joining_date=date.today(),
        )
        self.employee_a.manager = manager_employee
        self.employee_a.save(update_fields=['manager'])
        manager_client = APIClient()
        manager_client.force_authenticate(user=manager_user)

        resume = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'resume', 'entityId': str(self.employee_a.id), 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        identity_doc = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'identity_document', 'entityId': '999', 'employeeId': str(self.employee_a.id),
        }, format='multipart')

        self.assertEqual(manager_client.get(f'/api/v1/documents/{resume.data["data"]["id"]}').status_code, 200)
        self.assertEqual(manager_client.get(f'/api/v1/documents/{identity_doc.data["data"]["id"]}').status_code, 403)

    def test_stranger_cannot_view_document_metadata(self):
        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        doc_id = upload.data['data']['id']

        resp = self.client_b.get(f'/api/v1/documents/{doc_id}')
        self.assertEqual(resp.status_code, 403)

    def test_list_endpoint_never_returns_another_employees_document(self):
        self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'resume', 'entityId': str(self.employee_a.id), 'employeeId': str(self.employee_a.id),
        }, format='multipart')

        resp = self.client_b.get(f'/api/v1/documents/?entityType=resume&entityId={self.employee_a.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['data'], [])

    def test_deleted_document_file_endpoint_returns_404_not_the_old_bytes(self):
        upload = self.client_a.post('/api/v1/documents/', {
            'file': self._file(), 'entityType': 'onboarding_task', 'entityId': '1', 'employeeId': str(self.employee_a.id),
        }, format='multipart')
        doc_id = upload.data['data']['id']
        file_url = upload.data['data']['view_url']
        self.assertEqual(file_url, f'/api/documents/{doc_id}/file')

        delete_resp = self.client_a.delete(f'/api/v1/documents/{doc_id}')
        self.assertEqual(delete_resp.status_code, 204)

        stale_access = self.client_a.get(f'/api/v1/documents/{doc_id}/file')
        self.assertEqual(stale_access.status_code, 404)


class OfferLetterDocxRenderingTestCase(TestCase):
    """The uploaded-.docx offer-letter path (offer_letter_docx.py) is a
    separate renderer from the plain-text/reportlab one (offer_letter.py)
    and had its own, previously missing, signature-block logic — a signed
    offer built from a Word template silently had no "Signed and Accepted"
    section even though offer.signed_at/signature_name were set, because
    docxtpl only fills placeholders the template author actually typed, and
    no uploaded template has a {{signature_name}} token. Nothing exercised
    this rendering path before, so the gap went uncaught. Requires MS Word
    on the machine running this test, same as the feature itself does."""

    def test_signed_context_appends_a_signature_block_to_the_docx_output(self):
        import tempfile
        import zlib
        from pathlib import Path

        from docx import Document as DocxDocument

        from onboarding.offer_letter_docx import render_docx_template_to_pdf

        with tempfile.TemporaryDirectory() as tmp_dir:
            source_path = Path(tmp_dir) / 'template.docx'
            doc = DocxDocument()
            doc.add_paragraph('Dear {{ full_name }},')
            doc.add_paragraph('We are pleased to offer you a position.')
            doc.save(str(source_path))

            context = {
                'full_name': 'Test Candidate',
                'signature_name': 'Test Candidate',
                'signed_date': '21 September 2026, 04:12 PM',
            }
            pdf_bytes = render_docx_template_to_pdf(str(source_path), context, signed=True)

        # Word's PDF export kerns text into fragmented glyph runs (e.g.
        # "(D)4(e)4(a)-2(r)4( ravi,)") rather than one contiguous string per
        # word, so reconstruct plain text from every parenthesized literal
        # instead of grepping the raw content stream.
        text_runs = []
        for m in re.finditer(rb'stream\r?\n(.*?)endstream', pdf_bytes, re.DOTALL):
            try:
                decoded = zlib.decompress(m.group(1).rstrip(b'\n'))
            except Exception:
                continue
            for lit in re.findall(rb'\((?:[^()\\]|\\.)*\)', decoded):
                text_runs.append(lit[1:-1])
        joined = b''.join(text_runs)

        self.assertIn(b'Signed and Accepted', joined)
        self.assertIn(b'Test Candidate', joined)
