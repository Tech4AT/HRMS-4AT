# Hand-written (not `makemigrations`): the offer_number backfill for existing
# rows has to run *between* adding the column and adding its uniqueness
# constraint, which an auto-generated migration can't sequence on its own.
import django.db.models.deletion
from django.db import migrations, models


def backfill_offer_numbers(apps, schema_editor):
    """Every pre-existing OfferLetter predates versioning — one row each,
    so `version=1`/`is_current=True` (the field defaults) are already
    correct for all of them. They just need a unique `offer_number` before
    the uniqueness constraint below can be added."""
    OfferLetter = apps.get_model('onboarding', 'OfferLetter')
    for n, offer in enumerate(OfferLetter.objects.order_by('id'), start=1):
        offer.offer_number = f'OFR{n:05d}'
        offer.save(update_fields=['offer_number'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('onboarding', '0006_background_verification'),
    ]

    operations = [
        migrations.AddField(
            model_name='offerletter',
            name='offer_number',
            field=models.CharField(db_index=True, default='', max_length=20),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='offerletter',
            name='version',
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='is_current',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='previous_version',
            field=models.OneToOneField(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='next_version', to='onboarding.offerletter',
            ),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='signing_token_hash',
            field=models.CharField(blank=True, db_index=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='signing_token_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='viewed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='signed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='accepted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='rejected_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='cancelled_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='signature_name',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='signature_ip',
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='signature_user_agent',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='rejection_reason',
            field=models.CharField(
                blank=True, default='', max_length=30,
                choices=[
                    ('compensation', 'Compensation'), ('another_offer', 'Accepted another offer'),
                    ('personal_reasons', 'Personal reasons'), ('joining_date', 'Joining date'),
                    ('location', 'Location'), ('job_role', 'Job role'), ('other', 'Other'),
                ],
            ),
        ),
        migrations.AddField(
            model_name='offerletter',
            name='rejection_comments',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='offerletter',
            name='status',
            field=models.CharField(
                choices=[
                    ('draft', 'Draft'), ('generated', 'Generated'), ('sent', 'Sent'), ('viewed', 'Viewed'),
                    ('awaiting_signature', 'Awaiting signature'), ('signed', 'Signed'), ('accepted', 'Accepted'),
                    ('rejected', 'Rejected'), ('expired', 'Expired'), ('cancelled', 'Cancelled'),
                ],
                default='draft', max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='offerletter',
            name='profile',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name='offer_letters', to='onboarding.onboardingprofile',
            ),
        ),
        migrations.AlterModelOptions(
            name='offerletter',
            options={'ordering': ['-version']},
        ),
        migrations.RunPython(backfill_offer_numbers, noop),
        migrations.AddIndex(
            model_name='offerletter',
            index=models.Index(fields=['offer_number'], name='onboarding__offer_n_ef7dd9_idx'),
        ),
        migrations.AddConstraint(
            model_name='offerletter',
            constraint=models.UniqueConstraint(
                condition=models.Q(('is_current', True)), fields=('offer_number',), name='unique_current_offer_version',
            ),
        ),
        migrations.CreateModel(
            name='OnboardingWebhookEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(max_length=40)),
                ('external_event_id', models.CharField(max_length=200)),
                ('event_type', models.CharField(max_length=60)),
                ('payload_json', models.JSONField(blank=True, default=dict)),
                ('received_at', models.DateTimeField(auto_now_add=True)),
                ('processed_at', models.DateTimeField(blank=True, null=True)),
                ('offer', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='webhook_events', to='onboarding.offerletter',
                )),
            ],
        ),
        migrations.AddConstraint(
            model_name='onboardingwebhookevent',
            constraint=models.UniqueConstraint(fields=('provider', 'external_event_id'), name='unique_webhook_event'),
        ),
    ]
