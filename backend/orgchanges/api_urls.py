from rest_framework.routers import DefaultRouter

from orgchanges import views as v

router = DefaultRouter()
router.register(r"org-changes", v.OrgChangeViewSet, basename="orgchange")
router.register(r"org-changes-due", v.DueOrgChangesView, basename="orgchange-due")

urlpatterns = [*router.urls]
