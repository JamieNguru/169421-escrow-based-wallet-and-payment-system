"""Role-aware inference: load the correct trust model and classify a user's features."""

import pandas as pd

from src.model_io import load_model
from src.train import CLIENT_FEATURE_COLUMNS, WORKER_FEATURE_COLUMNS

FEATURE_COLUMNS_BY_ROLE = {
    "worker": WORKER_FEATURE_COLUMNS,
    "client": CLIENT_FEATURE_COLUMNS,
}


def predict_trust(role, features, version="v1"):
    """Predict a trust classification for a single user.

    role: "worker" or "client".
    features: dict of the role's feature columns (see FEATURE_COLUMNS_BY_ROLE) to values.
    Returns a dict with the predicted trust_level and the probability of each class.
    """
    if role not in FEATURE_COLUMNS_BY_ROLE:
        raise ValueError(f"Unknown role '{role}'; expected one of {list(FEATURE_COLUMNS_BY_ROLE)}")

    feature_columns = FEATURE_COLUMNS_BY_ROLE[role]
    missing = [col for col in feature_columns if col not in features]
    if missing:
        raise ValueError(f"Missing required features for role '{role}': {missing}")

    model = load_model(role, version)
    X = pd.DataFrame([{col: features[col] for col in feature_columns}])

    trust_level = model.predict(X)[0]
    probabilities = dict(zip(model.classes_, model.predict_proba(X)[0]))

    return {"role": role, "trust_level": trust_level, "probabilities": probabilities}
