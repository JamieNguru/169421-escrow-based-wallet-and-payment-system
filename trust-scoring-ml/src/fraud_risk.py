"""Predict a real outcome (elevated fraud rate) from client behaviour features.

Unlike the rule-labelled trust models, the target here, train_fraud_labels.json, is not a
function of the inputs, so accuracy measures predictive power rather than agreement with a
formula we wrote. Because fraud rate falls as transaction volume rises, the behaviour model
is compared with a volume-only baseline to show whether behaviour adds anything.
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import RepeatedStratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from src.external_validation import load_client_fraud_rates
from src.model_io import save_model
from src.train import CLIENT_FEATURE_COLUMNS

FRAUD_RISK_MODEL_VERSION = "fraud-risk"
HIGH_RISK_QUANTILE = 2 / 3
SEED = 42

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_fraud_rates(data_dir=DATA_DIR, refresh=False):
    """Per-client real fraud rates, cached because the raw file has ~13M transactions."""
    cache = Path(data_dir) / "processed" / "client_fraud_rates.csv"
    if cache.exists() and not refresh:
        return pd.read_csv(cache)
    rates = load_client_fraud_rates(data_dir)
    rates.to_csv(cache, index=False)
    return rates


def build_dataset(client_features, fraud_rates):
    """Join behaviour features to real fraud rates; label the top third by fraud rate as
    high risk (1). The cut-off is a quantile of the real outcome, not of the features."""
    data = client_features.merge(fraud_rates, on="client_id", how="inner")
    data["refund_rate"] = data["refund_requests"] / data["total_jobs_paid"]
    cutoff = data["real_fraud_rate"].quantile(HIGH_RISK_QUANTILE)
    data["high_fraud_risk"] = (data["real_fraud_rate"] >= cutoff).astype(int)
    return data


def make_forest(seed=SEED):
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=5, random_state=seed)


def candidates():
    """Models compared by repeated CV: the behaviour forest and two baselines."""
    return {
        "behaviour forest": (make_forest(), CLIENT_FEATURE_COLUMNS),
        "volume-only (logistic)": (
            make_pipeline(StandardScaler(), LogisticRegression()),
            ["total_jobs_paid"],
        ),
        "always majority": (DummyClassifier(strategy="prior"), CLIENT_FEATURE_COLUMNS),
    }


def compare(data, n_repeats=10, seed=SEED):
    """ROC-AUC mean and std over repeated stratified 5-fold CV, for each candidate."""
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=n_repeats, random_state=seed)
    results = {}
    for name, (model, columns) in candidates().items():
        scores = cross_val_score(model, data[columns], data["high_fraud_risk"], cv=cv, scoring="roc_auc")
        results[name] = (float(np.mean(scores)), float(np.std(scores)))
    return results


def _main():
    clients = pd.read_csv(DATA_DIR / "processed" / "client_features.csv")
    data = build_dataset(clients, load_fraud_rates())
    print(f"clients: {len(data)}, high-risk (top third by real fraud rate): {data['high_fraud_risk'].sum()}")

    print("ROC-AUC, repeated 5-fold CV (mean +/- std):")
    for name, (mean, std) in compare(data).items():
        print(f"  {name:<24} {mean:.3f} +/- {std:.3f}")

    model = make_forest().fit(data[CLIENT_FEATURE_COLUMNS], data["high_fraud_risk"])
    importances = dict(zip(CLIENT_FEATURE_COLUMNS, model.feature_importances_.round(3)))
    print(f"feature importances: {importances}")
    path = save_model(model, "client", FRAUD_RISK_MODEL_VERSION)
    print(f"saved to {path}")


if __name__ == "__main__":
    _main()
