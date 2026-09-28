from django.urls import path

from . import views_public

# Mounted at /api/v1/offers/ (config/urls.py) — entirely unauthenticated
# (AllowAny); every view resolves its offer through the token in the path,
# never a database id. See views_public.py's module docstring.
urlpatterns = [
    path('sign/<str:token>', views_public.CandidateOfferView.as_view(), name='offer-public-detail'),
    path('sign/<str:token>/sign', views_public.CandidateOfferSignView.as_view(), name='offer-public-sign'),
    path('sign/<str:token>/reject', views_public.CandidateOfferRejectView.as_view(), name='offer-public-reject'),
    path('sign/<str:token>/document', views_public.CandidateOfferDocumentView.as_view(), name='offer-public-document'),
]
