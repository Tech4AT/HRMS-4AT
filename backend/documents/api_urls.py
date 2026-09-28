from django.urls import path, re_path

from .views import DocumentDetailView, DocumentFileView, DocumentListUploadView, MyDocumentsView

urlpatterns = [
    re_path(r"^documents/?$", DocumentListUploadView.as_view(), name="document-list-upload"),
    path("documents/mine", MyDocumentsView.as_view(), name="document-mine"),
    path("documents/<int:pk>", DocumentDetailView.as_view(), name="document-detail"),
    path("documents/<int:pk>/file", DocumentFileView.as_view(), name="document-file"),
]
