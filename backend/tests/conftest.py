import os
import pytest

# By default, unit tests isolate against local SQLite unless TEST_WITH_POSTGRES=1 is set.
# This prevents wiping remote development databases and keeps test suite execution sub-second.
if not os.getenv("TEST_WITH_POSTGRES"):
    os.environ["DATABASE_URL"] = ""


@pytest.fixture(autouse=True)
def disable_rate_limiter_in_tests():
    try:
        from backend.routers.auth import limiter
        prev = limiter.enabled
        limiter.enabled = False
        yield
        limiter.enabled = prev
    except Exception:
        yield

