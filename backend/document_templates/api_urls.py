from django.urls import re_path

from .views import (
    TemplateDetailView,
    TemplateFileView,
    TemplateFolderListView,
    TemplateGenerateView,
    TemplateListCreateView,
)

urlpatterns = [
    # Static paths must be declared before the <pk> routes.
    re_path(r"^document-templates/folders/?$", TemplateFolderListView.as_view(), name="template-folders"),
    re_path(r"^document-templates/?$", TemplateListCreateView.as_view(), name="template-list-create"),
    re_path(r"^document-templates/(?P<pk>\d+)/generate/?$", TemplateGenerateView.as_view(), name="template-generate"),
    re_path(r"^document-templates/(?P<pk>\d+)/file/?$", TemplateFileView.as_view(), name="template-file"),
    re_path(r"^document-templates/(?P<pk>\d+)/?$", TemplateDetailView.as_view(), name="template-detail"),
]
