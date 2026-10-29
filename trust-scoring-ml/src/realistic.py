"""Train v2 trust models whose levels mean something absolute.

v1 labels users by tertile of a synthetic population in which almost everyone completes
99% of jobs, so "Low" only means "bottom third of near-perfect users" and a 99% worker
with one dispute can score Low. v2 labels by fixed thresholds instead (a worker who
completes most jobs, is rarely disputed and responds quickly is High, whatever the rest of
the population looks like), and trains on the real-derived users plus synthetic profiles
that cover the poor behaviour a live escrow platform sees but the transaction data lacks.
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

from src.feature_engineering import add_client_rate_features, add_worker_rate_features
from src.model_io import save_model
from src.train import CLIENT_FEATURE_COLUMNS, WORKER_FEATURE_COLUMNS

REALISTIC_MODEL_VERSION = "v2"

# Each term is scored 0-1, then weighted. Disputes (and a client's refund requests) are
# worth most, then completion, then timing. A 70% completion rate, a 15% dispute/refund
# rate, a delivery that overruns its promise by 100% and a 48-hour release each score zero.
SCORE_WEIGHTS = {"issues": 0.45, "completion": 0.35, "time": 0.2}
COMPLETION_FLOOR = 0.7
ISSUE_CEILING = 0.10
# Workers promise a delivery time when they quote; the penalty is how far past it they ran,
# as a share of the promise (0 = on time). Clients are timed on how fast they release payment.
OVERRUN_CEILING = 1.0
FAST_HOURS, SLOW_HOURS = 2.0, 48.0

HIGH_FROM, MEDIUM_FROM = 0.85, 0.6

SYNTHETIC_ROWS = 4000
SEED = 42

# Column names per role: completion rate, issue rate, timing. A worker's timing is their
# delivery overrun; a client's is their release time in hours.
COLUMNS = {
    "worker": ["job_completion_rate", "dispute_rate", "delivery_overrun"],
    "client": CLIENT_FEATURE_COLUMNS,
}


def trust_points(role, completion, issue_rate, timing):
    """Absolute 0-1 trust score from a completion rate, an issue rate and the role's timing
    measure (a worker's delivery overrun, a client's release time in hours)."""
    completion_pts = np.clip((completion - COMPLETION_FLOOR) / (1 - COMPLETION_FLOOR), 0, 1)
    issue_pts = np.clip(1 - issue_rate / ISSUE_CEILING, 0, 1)
    if role == "worker":
        time_pts = np.clip(1 - timing / OVERRUN_CEILING, 0, 1)
    else:
        time_pts = np.clip(1 - (timing - FAST_HOURS) / (SLOW_HOURS - FAST_HOURS), 0, 1)
    return (
        SCORE_WEIGHTS["completion"] * completion_pts
        + SCORE_WEIGHTS["issues"] * issue_pts
        + SCORE_WEIGHTS["time"] * time_pts
    )


def trust_level(points):
    return np.where(points >= HIGH_FROM, "High", np.where(points >= MEDIUM_FROM, "Medium", "Low"))


def synthetic_profiles(role, n=SYNTHETIC_ROWS, seed=SEED):
    """Profiles spread over what an escrow platform sees: completion from 50% to 100%,
    dispute/refund rates up to 30%, and either delivery overruns up to 200% of the promise
    (workers) or release times of 1 to 72 hours (clients). Squaring the uniform draw bunches
    them toward good behaviour, and a fifth are perfect completers, a fifth dispute-free and
    (for workers) half always on time, so the top of the range is well covered."""
    rng = np.random.default_rng(seed + (0 if role == "worker" else 1))
    completion = 1 - 0.5 * rng.random(n) ** 2
    completion[rng.random(n) < 0.2] = 1.0
    issue_rate = 0.3 * rng.random(n) ** 2
    issue_rate[rng.random(n) < 0.2] = 0.0
    if role == "worker":
        timing = 2 * rng.random(n) ** 2
        timing[rng.random(n) < 0.5] = 0.0
    else:
        timing = 1 + 71 * rng.random(n) ** 2
    return pd.DataFrame(dict(zip(COLUMNS[role], [completion, issue_rate, timing])))


def real_profiles(role):
    """The real-transaction-derived users from v1's training data, as feature rows. Workers
    have none: the transaction data has no delivery promises to measure an overrun against,
    so the worker model trains on the synthetic profiles alone."""
    if role == "worker":
        return pd.DataFrame(columns=COLUMNS[role])
    data_dir = Path(__file__).resolve().parent.parent / "data" / "processed"
    dataset = pd.read_csv(data_dir / f"{role}_features.csv")
    dataset = add_worker_rate_features(dataset) if role == "worker" else add_client_rate_features(dataset)
    return dataset[COLUMNS[role]]


def build_dataset(role):
    features = pd.concat([real_profiles(role), synthetic_profiles(role)], ignore_index=True)
    completion, issues, timing = (features[col].astype(float) for col in COLUMNS[role])
    return features.assign(trust_level=trust_level(trust_points(role, completion, issues, timing)))


def train_role(role):
    dataset = build_dataset(role)
    X_train, X_test, y_train, y_test = train_test_split(
        dataset[COLUMNS[role]].astype(float), dataset["trust_level"], test_size=0.2, random_state=SEED, stratify=dataset["trust_level"]
    )
    model = RandomForestClassifier(n_estimators=300, min_samples_leaf=2, random_state=SEED).fit(X_train, y_train)
    predictions = model.predict(X_test)
    print(f"{role}: label counts {dataset['trust_level'].value_counts().to_dict()}")
    print(f"{role}: test accuracy {accuracy_score(y_test, predictions):.3f}")
    print(classification_report(y_test, predictions))
    return model


def _main():
    for role in COLUMNS:
        path = save_model(train_role(role), role, REALISTIC_MODEL_VERSION)
        print(f"{role}: saved to {path}")


if __name__ == "__main__":
    _main()
