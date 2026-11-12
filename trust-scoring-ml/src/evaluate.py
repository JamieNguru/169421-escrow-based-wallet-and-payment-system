"""Evaluate trust-scoring classifiers: precision, recall, F1, and ROC-AUC."""

from pathlib import Path

import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

from src.feature_engineering import TRUST_LEVELS
from src.model_io import load_model
from src.train import MODEL_VERSION, split_client_dataset, split_worker_dataset


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


def _main():
    data_dir = Path(__file__).resolve().parent.parent / "data" / "processed"

    for role, split in [("worker", split_worker_dataset), ("client", split_client_dataset)]:
        _, X_test, _, y_test = split(pd.read_csv(data_dir / f"{role}_features.csv"))
        metrics = evaluate_model(load_model(role, MODEL_VERSION), X_test, y_test)
        print(f"{role}: " + ", ".join(f"{k}={v:.3f}" for k, v in metrics.items()))


if __name__ == "__main__":
    _main()
