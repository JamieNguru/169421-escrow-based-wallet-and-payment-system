"""Role-aware inference: load the correct trust model and classify a user's features."""

import pandas as pd

from src.model_io import load_model
from src.realistic import COLUMNS as REALISTIC_COLUMNS
from src.realistic import REALISTIC_MODEL_VERSION
from src.train import CLIENT_FEATURE_COLUMNS, WORKER_FEATURE_COLUMNS

# v1 timed workers on response hours; v2 on how far they overran their promised delivery time.
V1_FEATURE_COLUMNS_BY_ROLE = {
    "worker": WORKER_FEATURE_COLUMNS,
    "client": CLIENT_FEATURE_COLUMNS,
}
FEATURE_COLUMNS_BY_ROLE = REALISTIC_COLUMNS


def predict_trust(role, features, version=REALISTIC_MODEL_VERSION):
    """Predict a trust classification for a single user.

    role: "worker" or "client".
    features: dict of the role's feature columns (see FEATURE_COLUMNS_BY_ROLE) to values.
    Returns a dict with the predicted trust_level and the probability of each class.
    """
    columns_by_role = FEATURE_COLUMNS_BY_ROLE if version == REALISTIC_MODEL_VERSION else V1_FEATURE_COLUMNS_BY_ROLE
    if role not in columns_by_role:
        raise ValueError(f"Unknown role '{role}'; expected one of {list(columns_by_role)}")

    feature_columns = columns_by_role[role]
    missing = [col for col in feature_columns if col not in features]
    if missing:
        raise ValueError(f"Missing required features for role '{role}': {missing}")

    model = load_model(role, version)
    X = pd.DataFrame([{col: features[col] for col in feature_columns}])

    trust_level = model.predict(X)[0]
    probabilities = dict(zip(model.classes_, model.predict_proba(X)[0]))

    return {"role": role, "trust_level": trust_level, "probabilities": probabilities}
