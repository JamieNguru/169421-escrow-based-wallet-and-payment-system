"""Does past behaviour predict real fraud later? A time-split check of the v2 trust models.

Accuracy against trust_level is circular (the label is derived from the same features), so
this builds each client's features from transactions before the cutoff only, scores them
with the served v2 models, and compares the score with the client's real fraud rate in
train_fraud_labels.json after the cutoff. Nothing from after the cutoff reaches the
features, and the outcome was never used to train anything.

Every client is scored as both a worker and a client: roles are a synthetic coin flip with
no bearing on real fraud, so scoring both avoids re-drawing them. Delivery promises don't
exist in card transactions, so the worker's delivery_overrun is fixed at 0 (on time), which
leaves the worker score driven by completion and dispute rate alone.
"""

from pathlib import Path

import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

from src.external_validation import load_client_fraud_rates, partial_spearman
from src.feature_engineering import (
    add_client_rate_features,
    add_worker_rate_features,
    aggregate_client_behavior,
    build_client_dataset,
    build_worker_dataset,
)
from src.model_io import load_model
from src.realistic import COLUMNS, REALISTIC_MODEL_VERSION, trust_points

CUTOFF = "2017-01-01"
# Clients need enough fraud-labelled transactions after the cutoff for their fraud rate to
# mean something (fraud is about 0.2% of transactions).
MIN_FUTURE_LABELLED = 1000

# Expected trust on a 0-1 scale from the predicted level probabilities.
LEVEL_VALUE = {"Low": 0.0, "Medium": 0.5, "High": 1.0}

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def past_features(transactions, cutoff=CUTOFF):
    """One row per client with history before the cutoff: the worker and client model
    inputs side by side, computed from transactions dated before the cutoff only."""
    past = transactions[transactions["date"] < cutoff]
    agg = aggregate_client_behavior(past)

    workers = add_worker_rate_features(build_worker_dataset(agg.assign(role="worker")))
    clients = add_client_rate_features(build_client_dataset(agg.assign(role="client")))

    features = workers.merge(clients, on="client_id")
    features["delivery_overrun"] = 0.0
    return features


def load_future_fraud_rates(data_dir=DATA_DIR, start=CUTOFF, refresh=False):
    """Per-client real fraud rate from the cutoff onwards, cached because the raw file has
    ~13M transactions."""
    cache = Path(data_dir) / "processed" / "client_future_fraud_rates.csv"
    if cache.exists() and not refresh:
        return pd.read_csv(cache)
    rates = load_client_fraud_rates(data_dir, start=start).rename(
        columns={"real_fraud_rate": "future_fraud_rate", "real_labeled_transactions": "future_labeled_transactions"}
    )
    rates.to_csv(cache, index=False)
    return rates


def build_dataset(features, fraud_rates, min_future=MIN_FUTURE_LABELLED):
    """Join past features to later fraud rates. High risk (1) is a later fraud rate above
    the median of the clients kept."""
    data = features.merge(fraud_rates, on="client_id", how="inner")
    data = data[data["future_labeled_transactions"] >= min_future].reset_index(drop=True)
    data["high_risk"] = (data["future_fraud_rate"] > data["future_fraud_rate"].median()).astype(int)
    return data


def expected_scores(model, X):
    """Continuous 0-1 trust score: the predicted level probabilities weighted by level."""
    values = [LEVEL_VALUE[level] for level in model.classes_]
    return pd.Series(model.predict_proba(X) @ values, index=X.index)


def evaluate(data, scores):
    """How well a trust score ranks clients by later fraud. A good score is negatively
    correlated with later fraud rate and gives an ROC-AUC above 0.5 for (1 - score)
    picking out the high-risk clients. The partial correlation holds past volume constant."""
    scores = pd.Series(scores).reset_index(drop=True)
    rate = data["future_fraud_rate"]
    rho_partial, p_partial = partial_spearman(scores, rate, data["total_jobs"])
    return {
        "n": len(data),
        "auc": float(roc_auc_score(data["high_risk"], -scores)),
        "spearman": float(spearmanr(scores, rate)[0]),
        "partial_spearman": float(rho_partial),
        "partial_p": float(p_partial),
    }


def score_all(data, version=REALISTIC_MODEL_VERSION):
    """Model and untrained-rule scores for every client, per role."""
    scores = {}
    for role in ("worker", "client"):
        columns = COLUMNS[role]
        scores[f"{role} model ({version})"] = expected_scores(load_model(role, version), data[columns].astype(float))
        completion, issues, timing = (data[col].astype(float) for col in columns)
        scores[f"{role} rule (untrained)"] = trust_points(role, completion, issues, timing)
    scores["volume only (past transactions)"] = data["total_jobs"].astype(float)
    return scores


def _main():
    transactions = pd.read_parquet(
        DATA_DIR / "processed" / "transactions_clean.parquet",
        columns=["id", "client_id", "date", "amount", "has_error", "funds_error", "credential_error"],
    )
    features = past_features(transactions)
    del transactions
    fraud_rates = load_future_fraud_rates()

    data = build_dataset(features, fraud_rates)
    print(
        f"cutoff {CUTOFF}: {len(features)} clients with earlier history, {len(data)} with >= "
        f"{MIN_FUTURE_LABELLED} fraud-labelled transactions after it; high-risk: {data['high_risk'].sum()}"
    )

    print(f"\n{'score':<34}{'AUC':>7}{'Spearman':>10}{'partial':>9}{'p':>8}")
    for name, scores in score_all(data).items():
        r = evaluate(data, scores)
        print(f"{name:<34}{r['auc']:>7.3f}{r['spearman']:>10.3f}{r['partial_spearman']:>9.3f}{r['partial_p']:>8.3f}")


if __name__ == "__main__":
    _main()
