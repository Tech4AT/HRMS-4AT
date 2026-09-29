"""Storage-backend gating for the documents primitive.

Unset AWS_STORAGE_BUCKET_NAME => local FileSystemStorage (dev without creds
keeps working). Set => S3Storage. The S3 path is exercised against moto, so
these tests never touch real AWS.
"""

import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage, default_storage
from django.test import override_settings

storages = pytest.importorskip("storages")
moto = pytest.importorskip("moto")

TEST_BUCKET = "hrms-test-documents"
S3_STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": TEST_BUCKET,
            "region_name": "us-east-1",
            "access_key": "testing",
            "secret_key": "testing",
            "file_overwrite": False,
            "default_acl": None,
        },
    },
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def test_default_storage_is_local_filesystem_without_bucket():
    """Local-fallback path: no bucket configured => plain local disk."""
    assert isinstance(default_storage, FileSystemStorage)


def test_s3_storage_roundtrip_against_moto():
    """S3Storage save/open/delete works (moto stands in for AWS)."""
    from storages.backends.s3 import S3Storage

    with moto.mock_aws():
        import boto3

        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=TEST_BUCKET)
        storage = S3Storage(
            bucket_name=TEST_BUCKET,
            region_name="us-east-1",
            access_key="testing",
            secret_key="testing",
            file_overwrite=False,
            default_acl=None,
        )
        name = storage.save("documents/probe/hello.txt", ContentFile(b"hello-s3"))
        assert storage.exists(name)
        with storage.open(name, "rb") as f:
            assert f.read() == b"hello-s3"
        storage.delete(name)
        assert not storage.exists(name)


@pytest.mark.django_db
@override_settings(STORAGES=S3_STORAGES)
def test_document_upload_list_download_unchanged_on_s3():
    """Same API shape on S3: upload/list/download through the endpoints,
    bytes streamed back through the backend (private bucket, no public URL)."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    from rest_framework.test import APIClient

    from accounts.models import User
    from documents.models import Document
    from employees.models import Employee

    with moto.mock_aws():
        import boto3

        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=TEST_BUCKET)

        owner = User.objects.create_user(
            username="s3owner@x.com", email="s3owner@x.com", password="Verify@12345"
        )
        employee = Employee.objects.create(user=owner, employee_code="E-S3")

        client = APIClient()
        client.force_authenticate(owner)
        upload = SimpleUploadedFile("contract.pdf", b"s3-bytes", content_type="application/pdf")
        res = client.post(
            "/api/v1/documents",
            {"entity_type": "employee_document", "entity_id": str(employee.pk), "file": upload},
            format="multipart",
        )
        assert res.status_code == 201, res.content[:500]
        doc_id = res.json()["data"]["id"]

        # The row's file really lives on the (mocked) S3 backend.
        doc = Document.objects.get(pk=doc_id)
        assert doc.file.storage is not None
        assert doc.file.name.startswith("documents/employee_document/")

        listed = client.get(
            f"/api/v1/documents?entity_type=employee_document&entity_id={employee.pk}"
        ).json()["data"]
        assert len(listed) == 1
        # Serializer still points at the protected endpoint, never a raw URL.
        assert listed[0]["viewUrl"] == f"/api/documents/{doc_id}/file"
        assert listed[0]["downloadUrl"] == f"/api/documents/{doc_id}/file?mode=download"

        dl = client.get(f"/api/v1/documents/{doc_id}/download")
        assert dl.status_code == 200
        assert b"".join(dl.streaming_content) == b"s3-bytes"
