from django.urls import path

from . import exits

urlpatterns = [
    path('mine', exits.MyResignationView.as_view(), name='exits-mine'),
    path('mine/withdraw', exits.MyResignationWithdrawView.as_view(), name='exits-mine-withdraw'),
    path('resignations', exits.ResignationListView.as_view(), name='exits-resignations'),
    path('resignations/<int:pk>/<str:decision>', exits.ResignationDecisionView.as_view(), name='exits-resignation-decision'),
    path('initiate', exits.InitiateExitView.as_view(), name='exits-initiate'),
]
