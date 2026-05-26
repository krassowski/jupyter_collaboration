# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""

from typing import Any

from jupyterlab.galata import configure_jupyter_server
from pycrdt.store.base import BaseYStore, YDocNotFound
from traitlets.config import LoggingConfigurable

c: Any
configure_jupyter_server(c)  # noqa

# Fast room eviction so conflict tests don't need to wait 60 seconds.
c.YDocExtension.document_cleanup_delay = 1

# Force-close dead WebSocket connections quickly.  Playwright's setOffline(true)
# blocks network I/O without tearing down existing TCP connections, so pings are
# needed to make the server detect the disconnection.  The conflict test goes
# offline for 10 s; with interval=2 + timeout=5 the dead connection closes ≤7 s
# after going offline, leaving enough margin before the test comes back online.
c.ServerApp.websocket_ping_interval = 2  # seconds between pings
c.ServerApp.websocket_ping_timeout = 5  # close connection if no pong within 5 s

# Use a no-op ystore so every room is always rebuilt from the file via
# _apply_deterministic_source_content.  Without this, the SQLiteYStore
# persists R1's Yjs history; when R2 is created after room eviction it
# loads that history (source Text still at clock N), the stale SYNC_STEP2
# from the reconnecting client finds a valid parent, and no conflict fires.
# This is safe for all galata tests because the test server starts fresh on
# every CI run and each test uses a unique tmpPath — no test relies on
# ystore history surviving across rooms.


class _NoOpYStoreMeta(type(LoggingConfigurable), type(BaseYStore)):
    pass


class _NoOpYStore(LoggingConfigurable, BaseYStore, metaclass=_NoOpYStoreMeta):
    def __init__(self, path: str, metadata_callback=None, log=None, **kwargs):
        LoggingConfigurable.__init__(self, **kwargs)

    async def write(self, data: bytes) -> None:
        pass

    async def read(self):
        if False:
            yield  # satisfy the async-generator protocol

    async def apply_updates(self, ydoc) -> None:
        raise YDocNotFound

    async def start(self, *, task_status=None, from_context_manager: bool = False):
        self.started.set()


c.YDocExtension.ystore_class = _NoOpYStore

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
