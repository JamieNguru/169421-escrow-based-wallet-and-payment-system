"""The served worker trust model: past dissatisfaction, validated on real Olist outcomes.

Trained on Olist sellers (features before the cutoff, later low-review share as the outcome),
it turns a worker's counts of jobs and disputed jobs into a risk (the chance of being among the
worst third on later outcomes) and a Low/Medium/High trust band. Bands are thirds of the
out-of-fold risk on the training sellers, so a worker is placed against the marketplace the
model was validated on.

Only the shrunk past low-review rate is used (AUC 0.738). Adding the late-delivery rate scores
about the same (0.741) but gives lateness a negative weight, because late deliveries overlap with
past bad reviews and the model reads the leftover as a good sign. A model that rates more late
deliveries as lower risk is not one to serve, so late deliveries are shown to users but not scored.

Mapping to Kaziforce: a job that was disputed, refunded or split stands in for a 1-2 star review
(a dissatisfied customer). Small histories are shrunk toward the marketplace average, so a new
worker lands in the middle instead of at an extreme.
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from src.model_io import load_model, save_model
from src.seller_risk import CUTOFF, SEED, SHRINKAGE, build_dataset, load_orders, seller_counts, shrink

HISTORY_MODEL_VERSION = "history"
ROLE = "worker"
# Past low reviews alone: see the module docstring for why the late rate is left out.
SERVED_COLUMNS = ["low_review_rate"]
COUNT_FIELDS = ("jobs", "disputed")


def train_history_model(orders, cutoff=CUTOFF, seed=SEED):
    """Fit the history model on Olist orders and return it with everything inference needs:
    the marketplace prior used for shrinkage and the risk cut points between the bands."""
    before = seller_counts(orders[orders["order_purchase_timestamp"] < cutoff])
    priors = {"low_review_rate": float(before["low"].sum() / before["reviewed"].sum())}

    data = build_dataset(orders, cutoff=cutoff)
    X, y = data[SERVED_COLUMNS], data["high_risk"]

    pipeline = make_pipeline(StandardScaler(), LogisticRegression())
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    # Out-of-fold, so no seller is placed by a model that saw their own outcome.
    risk = cross_val_predict(pipeline, X, y, cv=cv, method="predict_proba")[:, 1]
    pipeline.fit(X, y)

    return {
        "pipeline": pipeline,
        "columns": SERVED_COLUMNS,
        "priors": priors,
        "shrinkage": SHRINKAGE,
        "cuts": {"medium_from": float(np.quantile(risk, 1 / 3)), "low_from": float(np.quantile(risk, 2 / 3))},
        "trained_on": {"sellers": int(len(data)), "cutoff": cutoff},
    }


def _validate_counts(counts):
    values = {}
    for field in COUNT_FIELDS:
        if field not in counts:
            raise ValueError(f"Missing required counts: ['{field}']")
        value = counts[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value != int(value):
            raise ValueError(f"Count '{field}' must be a whole number, got {value!r}")
        if value < 0:
            raise ValueError(f"Count '{field}' must not be negative, got {value}")
        values[field] = int(value)
    if values["disputed"] > values["jobs"]:
        raise ValueError("'disputed' cannot be more than 'jobs'")
    return values


def band_for(risk, cuts):
    """Low trust for the riskiest third, High for the least risky third, Medium between."""
    if risk >= cuts["low_from"]:
        return "Low"
    return "High" if risk < cuts["medium_from"] else "Medium"


def predict_history(counts, model=None):
    """Trust band and risk for one worker from counts of settled jobs and of those that were
    disputed, refunded or split. Returns the band, the risk (0-1) and the shrunk rate used."""
    values = _validate_counts(counts)
    model = model if model is not None else load_model(ROLE, HISTORY_MODEL_VERSION)

    rates = {
        "low_review_rate": shrink(values["disputed"], values["jobs"], model["priors"]["low_review_rate"], model["shrinkage"])
    }
    X = pd.DataFrame([{col: rates[col] for col in model["columns"]}])
    risk = float(model["pipeline"].predict_proba(X)[0, 1])

    return {
        "role": ROLE,
        "trust_level": band_for(risk, model["cuts"]),
        "risk": risk,
        "rates": {name: float(rate) for name, rate in rates.items()},
        "model": HISTORY_MODEL_VERSION,
    }


def _main():
    model = train_history_model(load_orders())
    path = save_model(model, ROLE, HISTORY_MODEL_VERSION)
    print(f"trained on {model['trained_on']['sellers']} sellers (cutoff {model['trained_on']['cutoff']}); saved to {path}")
    print(f"prior: {model['priors']}; band cuts on risk: {model['cuts']}")


if __name__ == "__main__":
    _main()
