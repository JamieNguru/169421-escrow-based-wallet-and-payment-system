"""Save and load trained trust-scoring models, tagged by role and version."""

from functools import lru_cache
from pathlib import Path

import joblib

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def model_path(role, version, models_dir=MODELS_DIR):
    """Path for a role's model at a given version tag, e.g. worker_trust_model_v1.joblib."""
    return Path(models_dir) / f"{role}_trust_model_{version}.joblib"


def save_model(model, role, version, models_dir=MODELS_DIR):
    """Serialize a trained model to models/<role>_trust_model_<version>.joblib."""
    models_dir = Path(models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)
    path = model_path(role, version, models_dir)
    joblib.dump(model, path)
    return path


def load_model(role, version, models_dir=MODELS_DIR):
    """Load a previously serialized model for a role and version tag. Loads are cached per file
    and modification time, so the service does not re-read the file on every request but still
    picks up a retrained model."""
    path = model_path(role, version, models_dir)
    return _load(str(path), path.stat().st_mtime_ns)


@lru_cache(maxsize=16)
def _load(path, _mtime_ns):
    return joblib.load(path)
