"""The one check that stands between the test suite and a real database.

The suite empties every table before each test and drops scratch databases.
Anything that deletes data calls `assert_disposable_database` first, with the
URL it is about to act on - not the URL it was configured with. The two can
differ: the app reads its settings once, at import time, so whatever imports
`core.config` first decides which database the engine points at.
"""
from sqlalchemy.engine import URL, make_url

LOCAL_HOSTS = ("localhost", "127.0.0.1")
REQUIRED_SUFFIX = "_test"


class UnsafeDatabaseError(RuntimeError):
    pass


def assert_disposable_database(url: str | URL) -> URL:
    """Return the parsed URL if its data may be deleted; raise otherwise.

    Disposable means the host is this machine and the database name ends with
    `_test`. Everything else - production, a shared server, the local
    development database - is refused.
    """
    parsed = make_url(url)
    if parsed.host not in LOCAL_HOSTS or not (parsed.database or "").endswith(REQUIRED_SUFFIX):
        raise UnsafeDatabaseError(
            f"Refusing to delete data in {parsed.host}/{parsed.database}: "
            f"the database must be on localhost and its name must end with '{REQUIRED_SUFFIX}'."
        )
    return parsed
