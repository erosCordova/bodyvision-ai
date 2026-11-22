class DomainError(Exception):
    """Controlled API failure; optional cookies to expire on the error response."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict | None = None,
        *,
        clear_cookies: tuple[tuple[str, str], ...] = (),
    ):
        self.status, self.code, self.message = status, code, message
        self.details = details or {}
        # (name, path) pairs. The global handler must expire them itself:
        # an exception discards headers set on the endpoint's injected Response.
        self.clear_cookies = clear_cookies
