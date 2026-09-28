"""Train the worker and client trust-scoring Random Forest classifiers."""

from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

from src.feature_engineering import add_client_trust_label, add_worker_trust_label
from src.model_io import save_model

MODEL_VERSION = "v1"

WORKER_FEATURE_COLUMNS = ["job_completion_rate", "dispute_count", "response_time_hours", "total_jobs"]
CLIENT_FEATURE_COLUMNS = [
    "payment_completion_rate",
    "escrow_release_time_hours",
    "refund_requests",
    "total_jobs_paid",
]


def train_random_forest(dataset, feature_columns, label_col="trust_level", test_size=0.2, random_state=42):
    """Split a labeled dataset and train a Random Forest classifier on it."""
    X = dataset[feature_columns]
    y = dataset[label_col]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state, stratify=y
    )

    model = RandomForestClassifier(n_estimators=200, random_state=random_state)
    model.fit(X_train, y_train)

    return model, X_train, X_test, y_train, y_test


def train_worker_model(worker_dataset, test_size=0.2, random_state=42):
    """Label and train the worker trust-scoring model."""
    labeled = add_worker_trust_label(worker_dataset)
    return train_random_forest(labeled, WORKER_FEATURE_COLUMNS, test_size=test_size, random_state=random_state)


def train_client_model(client_dataset, test_size=0.2, random_state=42):
    """Label and train the client trust-scoring model."""
    labeled = add_client_trust_label(client_dataset)
    return train_random_forest(labeled, CLIENT_FEATURE_COLUMNS, test_size=test_size, random_state=random_state)


def _main():
    data_dir = Path(__file__).resolve().parent.parent / "data" / "processed"

    worker_dataset = pd.read_csv(data_dir / "worker_features.csv")
    client_dataset = pd.read_csv(data_dir / "client_features.csv")

    worker_model, _, worker_X_test, _, worker_y_test = train_worker_model(worker_dataset)
    print(f"Worker model trained on {len(worker_dataset)} rows; test accuracy: {worker_model.score(worker_X_test, worker_y_test):.3f}")
    worker_path = save_model(worker_model, "worker", MODEL_VERSION)
    print(f"Saved worker model to {worker_path}")

    client_model, _, client_X_test, _, client_y_test = train_client_model(client_dataset)
    print(f"Client model trained on {len(client_dataset)} rows; test accuracy: {client_model.score(client_X_test, client_y_test):.3f}")
    client_path = save_model(client_model, "client", MODEL_VERSION)
    print(f"Saved client model to {client_path}")


if __name__ == "__main__":
    _main()
