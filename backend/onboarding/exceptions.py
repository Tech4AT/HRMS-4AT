"""Typed offer-workflow errors, mapped to the exact error envelope/messages
docs/REQUIREMENTS.md §25 specifies. Raised from services.py, caught in
views_public.py/views.py and turned into the `{success, error}` response —
kept as exceptions rather than boolean return values so a caller can't
accidentally ignore a rejected state transition."""


class OfferWorkflowError(Exception):
    """Base class — a state transition that isn't valid from the offer's
    current status. Maps to 409 CONFLICT."""

    code = 'CONFLICT'
    status_code = 409

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class InvalidOfferTokenError(OfferWorkflowError):
    code = 'NOT_FOUND'
    status_code = 404

    def __init__(self, message: str = 'Invalid or expired offer link.'):
        super().__init__(message)


class OfferExpiredError(OfferWorkflowError):
    def __init__(self, message: str = 'This offer has expired.'):
        super().__init__(message)


class OfferAlreadyAcceptedError(OfferWorkflowError):
    def __init__(self, message: str = 'This offer has already been accepted.'):
        super().__init__(message)


class OfferAlreadyRejectedError(OfferWorkflowError):
    def __init__(self, message: str = 'This offer has already been rejected.'):
        super().__init__(message)
