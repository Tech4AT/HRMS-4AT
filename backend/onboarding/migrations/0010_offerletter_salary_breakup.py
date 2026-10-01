from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('onboarding', '0009_alter_onboardingaccessgrant_area_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='offerletter',
            name='bonus_amount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='extra_allowance_amount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='salary_breakup',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
