from django.urls import path, re_path

from .views import (
    DocumentAcknowledgementStatusView,
    DocumentAcknowledgeView,
    DocumentDetailView,
    DocumentDownloadView,
    DocumentFileView,
    DocumentListUploadView,
    MyDocumentsView,
    PendingAcknowledgementView,
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
    path("documents/<uuid:pk>/acknowledge", DocumentAcknowledgeView.as_view(), name="document-acknowledge"),
    path("documents/<uuid:pk>/acknowledgements", DocumentAcknowledgementStatusView.as_view(), name="document-ack-status"),
    path("documents/<uuid:pk>", DocumentDetailView.as_view(), name="document-detail"),
    path("documents/<uuid:pk>/file", DocumentFileView.as_view(), name="document-file"),
    path("documents/<uuid:pk>/download", DocumentDownloadView.as_view(), name="document-download"),
]
