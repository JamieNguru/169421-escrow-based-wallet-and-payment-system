"""Generate the standard set of report figures for both trust-scoring models."""

from pathlib import Path

import pandas as pd

from src.external_validation import correlate_trust_with_real_fraud, load_client_fraud_rates
from src.feature_engineering import add_client_trust_label, add_worker_trust_label
from src.plots import (
    plot_confusion_matrix,
    plot_feature_importance,
    plot_fraud_rate_by_trust_and_volume,
    plot_roc_curves,
)
from src.model_io import load_model
from src.train import (
    CLIENT_FEATURE_COLUMNS,
    MODEL_VERSION,
    WORKER_FEATURE_COLUMNS,
    split_client_dataset,
    split_worker_dataset,
)


def generate_role_figures(role_name, model, X_test, y_test, feature_columns, fraud_result, figures_dir):
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)

    plot_confusion_matrix(
        y_test, y_pred, f"{role_name} model - confusion matrix", figures_dir / f"{role_name.lower()}_confusion_matrix.png"
    )
    plot_roc_curves(
        y_test, y_proba, model.classes_, f"{role_name} model - ROC curves (one-vs-rest)", figures_dir / f"{role_name.lower()}_roc_curves.png"
    )
    plot_feature_importance(
        model, feature_columns, f"{role_name} model - feature importance", figures_dir / f"{role_name.lower()}_feature_importance.png"
    )
    plot_fraud_rate_by_trust_and_volume(
        fraud_result["mean_real_fraud_rate_by_volume_band"],
        f"{role_name}s: real fraud rate by trust level, within volume bands",
        figures_dir / f"{role_name.lower()}_fraud_rate_by_trust_and_volume.png",
    )


def _main():
    root = Path(__file__).resolve().parent.parent
    processed_dir = root / "data" / "processed"
    figures_dir = root / "reports" / "figures"
    figures_dir.mkdir(parents=True, exist_ok=True)

    worker_dataset = pd.read_csv(processed_dir / "worker_features.csv")
    client_dataset = pd.read_csv(processed_dir / "client_features.csv")

    print("Loading real fraud labels...")
    fraud_rates = load_client_fraud_rates(root / "data")

    _, worker_X_test, _, worker_y_test = split_worker_dataset(worker_dataset)
    worker_fraud_result = correlate_trust_with_real_fraud(add_worker_trust_label(worker_dataset), fraud_rates)
    generate_role_figures(
        "Worker",
        load_model("worker", MODEL_VERSION),
        worker_X_test,
        worker_y_test,
        WORKER_FEATURE_COLUMNS,
        worker_fraud_result,
        figures_dir,
    )

    _, client_X_test, _, client_y_test = split_client_dataset(client_dataset)
    client_fraud_result = correlate_trust_with_real_fraud(add_client_trust_label(client_dataset), fraud_rates)
    generate_role_figures(
        "Client",
        load_model("client", MODEL_VERSION),
        client_X_test,
        client_y_test,
        CLIENT_FEATURE_COLUMNS,
        client_fraud_result,
        figures_dir,
    )

    print(f"Saved 8 figures to {figures_dir}")


if __name__ == "__main__":
    _main()
