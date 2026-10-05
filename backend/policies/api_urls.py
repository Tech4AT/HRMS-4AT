from django.urls import path

from . import views

urlpatterns = [
    path('policies', views.PolicyListView.as_view(), name='policy-list'),
    path('policies/admin-list', views.PolicyAdminListView.as_view(), name='policy-admin-list'),
    path('policies/<int:pk>', views.PolicyDetailView.as_view(), name='policy-detail'),
    path('policies/<int:pk>/acknowledge', views.PolicyAcknowledgeView.as_view(), name='policy-acknowledge'),
    path('policies/<int:pk>/acknowledgments', views.PolicyAcknowledgmentsView.as_view(), name='policy-acknowledgments'),
]
