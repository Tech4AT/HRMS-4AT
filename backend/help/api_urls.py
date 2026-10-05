"""Mounted automatically under /api/v1/ (config/api_urls.py).

trailing_slash=False: every call in lib/api/help.ts omits the trailing slash,
same reasoning as leave/api_urls.py."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from help.views import CategoryAssignmentView, MyCategoriesView, TicketViewSet

router = DefaultRouter(trailing_slash=False)
router.register("help/tickets", TicketViewSet, basename="help-ticket")

urlpatterns = [
    path("help/category-assignments", CategoryAssignmentView.as_view(), name="help-category-assignments"),
    path("help/my-categories", MyCategoriesView.as_view(), name="help-my-categories"),
    *router.urls,
]
