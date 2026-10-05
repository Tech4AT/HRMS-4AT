from rest_framework.routers import DefaultRouter

from assets.views import AssetViewSet

router = DefaultRouter()
router.register("assets", AssetViewSet, basename="asset")

urlpatterns = router.urls
