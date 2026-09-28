"""Evaluate trust-scoring classifiers: precision, recall, F1, and ROC-AUC."""

from pathlib import Path

import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

from src.feature_engineering import TRUST_LEVELS
from src.train import train_client_model, train_worker_model


def evaluate_model(model, X_test, y_test):
    """Compute accuracy, macro precision/recall/F1, and macro one-vs-rest ROC-AUC."""
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)

    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, y_pred, labels=TRUST_LEVELS, average="macro", zero_division=0
    )
    roc_auc = roc_auc_score(
        y_test, y_proba, labels=model.classes_, multi_class="ovr", average="macro"
    )

    return {
        "accuracy": model.score(X_test, y_test),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "roc_auc": roc_auc,
    }


def evaluate_worker_model(worker_dataset, test_size=0.2, random_state=42):
    """Train and evaluate the worker trust-scoring model."""
    model, _, X_test, _, y_test = train_worker_model(worker_dataset, test_size=test_size, random_state=random_state)
    return evaluate_model(model, X_test, y_test)


def evaluate_client_model(client_dataset, test_size=0.2, random_state=42):
    """Train and evaluate the client trust-scoring model."""
    model, _, X_test, _, y_test = train_client_model(client_dataset, test_size=test_size, random_state=random_state)
    return evaluate_model(model, X_test, y_test)


def _print_report(name, metrics):
    print(f"{name}: " + ", ".join(f"{k}={v:.3f}" for k, v in metrics.items()))


def _main():
    data_dir = Path(__file__).resolve().parent.parent / "data" / "processed"

    worker_dataset = pd.read_csv(data_dir / "worker_features.csv")
    client_dataset = pd.read_csv(data_dir / "client_features.csv")

    _print_report("Worker model", evaluate_worker_model(worker_dataset))
    _print_report("Client model", evaluate_client_model(client_dataset))


if __name__ == "__main__":
    _main()
