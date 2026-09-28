from django.urls import re_path

from .views import (
    AnnounceView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
)

# The frontend calls these without trailing slashes (frontend/src/lib/api/
# notifications.ts), so the patterns make the slash optional. `read-all` is
# listed before the {pk}/read pattern so it is never captured as an id.
urlpatterns = [
    re_path(r"^notifications/?$", NotificationListView.as_view(), name="notification-list"),
    re_path(r"^notifications/announce/?$", AnnounceView.as_view(), name="notification-announce"),
    re_path(
        r"^notifications/read-all/?$",
        NotificationReadAllView.as_view(),
        name="notification-read-all",
    ),
    re_path(
        r"^notifications/(?P<pk>[0-9a-fA-F-]+)/read/?$",
        NotificationReadView.as_view(),
        name="notification-read",
    ),
]
