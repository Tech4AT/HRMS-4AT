from django.conf import settings
from django.db import models


class CompanyPolicy(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # A policy document is optional — some are text-only; for file-backed ones
    # the document is uploaded via the documents app and the id stored here.
    document_id = models.PositiveBigIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    requires_acknowledgment = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class PolicyAcknowledgment(models.Model):
    policy = models.ForeignKey(CompanyPolicy, on_delete=models.CASCADE, related_name='acknowledgments')
    employee = models.ForeignKey('employees.Employee', on_delete=models.CASCADE, related_name='policy_acknowledgments')
    acknowledged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('policy', 'employee')]
        ordering = ['-acknowledged_at']

    def __str__(self):
        return f"{self.employee_id} ack {self.policy_id}"
