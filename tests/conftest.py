"""Test settings: a throw-away database for the whole test run."""
import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATA_DIR"] = _tmp
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ.pop("ANTHROPIC_API_KEY", None)
