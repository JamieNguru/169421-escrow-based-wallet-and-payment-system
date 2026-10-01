"""Prepare, split, tune, and train the worker and client trust-scoring Random Forests."""

from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split

from src.feature_engineering import (
    add_client_rate_features,
    add_client_trust_label,
    add_worker_rate_features,
    add_worker_trust_label,
)
from src.model_io import save_model

MODEL_VERSION = "v1"

# Rates rather than raw counts/volume: trust_level itself is derived from these same
# rates (see feature_engineering.add_trust_label), and a raw count/volume pair makes
# predictions unstable when total_jobs falls outside the training range (see #64).
WORKER_FEATURE_COLUMNS = ["job_completion_rate", "dispute_rate", "response_time_hours"]
CLIENT_FEATURE_COLUMNS = ["payment_completion_rate", "refund_rate", "escrow_release_time_hours"]

DEFAULT_PARAMS = {"n_estimators": 200}

# Proposal section 3.2.3: tune the number of trees and the maximum depth.
PARAM_GRID = {"n_estimators": [100, 200, 400], "max_depth": [None, 5, 10, 20]}


def prepare_worker_dataset(worker_dataset):
    """Add the trust_level label and the rate features the worker model trains on."""
    return add_worker_rate_features(add_worker_trust_label(worker_dataset))


def prepare_client_dataset(client_dataset):
    """Add the trust_level label and the rate features the client model trains on."""
    return add_client_rate_features(add_client_trust_label(client_dataset))


def split_dataset(dataset, feature_columns, label_col="trust_level", test_size=0.2, random_state=42):
    """Stratified train/test split. Deterministic for a given random_state, so training
    and evaluation can each rebuild the same held-out test set."""
    return train_test_split(
        dataset[feature_columns],
        dataset[label_col],
        test_size=test_size,
        random_state=random_state,
        stratify=dataset[label_col],
    )


def split_worker_dataset(worker_dataset, test_size=0.2, random_state=42):
    return split_dataset(
        prepare_worker_dataset(worker_dataset), WORKER_FEATURE_COLUMNS, test_size=test_size, random_state=random_state
    )


def split_client_dataset(client_dataset, test_size=0.2, random_state=42):
    return split_dataset(
        prepare_client_dataset(client_dataset), CLIENT_FEATURE_COLUMNS, test_size=test_size, random_state=random_state
    )


def train_random_forest(
    dataset, feature_columns, label_col="trust_level", test_size=0.2, random_state=42, params=None
):
    """Split a labeled dataset and train a Random Forest classifier on it."""
    X_train, X_test, y_train, y_test = split_dataset(
        dataset, feature_columns, label_col=label_col, test_size=test_size, random_state=random_state
    )

    model = RandomForestClassifier(random_state=random_state, **(params or DEFAULT_PARAMS))
    model.fit(X_train, y_train)

    return model, X_train, X_test, y_train, y_test


def train_worker_model(worker_dataset, test_size=0.2, random_state=42, params=None):
    """Label and train the worker trust-scoring model."""
    return train_random_forest(
        prepare_worker_dataset(worker_dataset),
        WORKER_FEATURE_COLUMNS,
        test_size=test_size,
        random_state=random_state,
        params=params,
    )


def train_client_model(client_dataset, test_size=0.2, random_state=42, params=None):
    """Label and train the client trust-scoring model."""
    return train_random_forest(
        prepare_client_dataset(client_dataset),
        CLIENT_FEATURE_COLUMNS,
        test_size=test_size,
        random_state=random_state,
        params=params,
    )


def tune_random_forest(X_train, y_train, param_grid=PARAM_GRID, cv=5, random_state=42):
    """Grid-search Random Forest hyperparameters with stratified k-fold cross-validation
    (macro F1) on the training split only, leaving the test set untouched for evaluation.

    The returned search's best_estimator_ is refit on the whole training split.
    """
    search = GridSearchCV(
        RandomForestClassifier(random_state=random_state),
        param_grid,
        cv=StratifiedKFold(n_splits=cv, shuffle=True, random_state=random_state),
        scoring="f1_macro",
        n_jobs=-1,
    )
    search.fit(X_train, y_train)
    return search


def tune_worker_model(worker_dataset, param_grid=PARAM_GRID, cv=5, random_state=42):
    X_train, _, y_train, _ = split_worker_dataset(worker_dataset, random_state=random_state)
    return tune_random_forest(X_train, y_train, param_grid=param_grid, cv=cv, random_state=random_state)


def tune_client_model(client_dataset, param_grid=PARAM_GRID, cv=5, random_state=42):
    X_train, _, y_train, _ = split_client_dataset(client_dataset, random_state=random_state)
    return tune_random_forest(X_train, y_train, param_grid=param_grid, cv=cv, random_state=random_state)


def _main():
    data_dir = Path(__file__).resolve().parent.parent / "data" / "processed"

    for role, tune in [("worker", tune_worker_model), ("client", tune_client_model)]:
        dataset = pd.read_csv(data_dir / f"{role}_features.csv")
        search = tune(dataset)
        path = save_model(search.best_estimator_, role, MODEL_VERSION)
        print(f"{role}: best params {search.best_params_}, CV macro F1 {search.best_score_:.3f}; saved to {path}")


if __name__ == "__main__":
    _main()
