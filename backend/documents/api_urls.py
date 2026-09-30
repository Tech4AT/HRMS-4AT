from django.urls import path, re_path

from .views import (
    DocumentAcknowledgementStatusView,
    DocumentAcknowledgeView,
    DocumentDetailView,
    DocumentDownloadView,
    DocumentFileView,
    DocumentListUploadView,
    DocumentNudgeView,
    DocumentRejectView,
    DocumentRemindAcknowledgementView,
    DocumentVerifyView,
    ExpiringDocumentsView,
    FolderDetailView,
    FolderDocumentsView,
    FolderListCreateView,
    MyDocumentsView,
    PendingAcknowledgementView,
    PendingVerificationView,
)

# NOTE: the object routes use <uuid:pk> — Document's primary key is a UUID
# (see models.py). An earlier <int:pk> spelling never matched a real id, so
# detail/file/delete always 404'd in production while tests (which build real
# UUID rows) could only pass against uuid converters.
urlpatterns = [
    re_path(r"^documents/?$", DocumentListUploadView.as_view(), name="document-list-upload"),
    path("documents/mine", MyDocumentsView.as_view(), name="document-mine"),
    # Static path — must be declared before the <uuid:pk> routes. (The uuid
    # converter would not match this word anyway, but keep intent explicit.)
    path("documents/pending-acknowledgement", PendingAcknowledgementView.as_view(), name="document-pending-ack"),
    # Verification workflow (Org > Employee Documents).
    path("documents/pending-verification", PendingVerificationView.as_view(), name="document-pending-verification"),
    path("documents/expiring", ExpiringDocumentsView.as_view(), name="document-expiring"),
    path("documents/<uuid:pk>/verify", DocumentVerifyView.as_view(), name="document-verify"),
    path("documents/<uuid:pk>/reject", DocumentRejectView.as_view(), name="document-reject"),
    path("documents/<uuid:pk>/nudge", DocumentNudgeView.as_view(), name="document-nudge"),
    # Organization Documents folders (Org > Organization Documents folder rail).
    path("documents/folders", FolderListCreateView.as_view(), name="document-folders"),
    path("documents/folders/<int:pk>", FolderDetailView.as_view(), name="document-folder-detail"),
    path("documents/folders/<int:pk>/documents", FolderDocumentsView.as_view(), name="document-folder-documents"),
    path("documents/<uuid:pk>/remind-acknowledgement", DocumentRemindAcknowledgementView.as_view(), name="document-remind-ack"),
    path("documents/<uuid:pk>/acknowledge", DocumentAcknowledgeView.as_view(), name="document-acknowledge"),
    path("documents/<uuid:pk>/acknowledgements", DocumentAcknowledgementStatusView.as_view(), name="document-ack-status"),
    path("documents/<uuid:pk>", DocumentDetailView.as_view(), name="document-detail"),
    path("documents/<uuid:pk>/file", DocumentFileView.as_view(), name="document-file"),
    path("documents/<uuid:pk>/download", DocumentDownloadView.as_view(), name="document-download"),
]
