"""Check whether the synthetic trust proxy features correlate with real fraud outcomes.

trust_level (see feature_engineering.add_trust_label) is derived from the same proxy
features the models are trained on, so model accuracy against it is circular. This
module checks the proxy features against train_fraud_labels.json, a real,
independently-collected fraud outcome per transaction that was never used anywhere
else in the pipeline, as an external validity signal.
"""

import json
from pathlib import Path

import pandas as pd
from scipy.stats import spearmanr

from src.feature_engineering import TRUST_LEVELS, add_client_trust_label, add_worker_trust_label

TRUST_LEVEL_ORDINAL = {level: i for i, level in enumerate(TRUST_LEVELS)}


def load_client_fraud_rates(data_dir):
    """Compute each client's real fraud rate from train_fraud_labels.json.

    Uses a Series.map lookup rather than a DataFrame merge to keep peak memory
    down on the ~13.3M-row transactions file.
    """
    data_dir = Path(data_dir)

    transactions = pd.read_csv(
        data_dir / "transactions_data.csv",
        usecols=["id", "client_id"],
        dtype={"id": "int32", "client_id": "int32"},
    )

    with open(data_dir / "train_fraud_labels.json", "r", encoding="utf-8") as f:
        fraud_labels = json.load(f)["target"]

    fraud_series = pd.Series(
        {int(k): (v == "Yes") for k, v in fraud_labels.items()}, name="is_fraud"
    )
    del fraud_labels

    transactions["is_fraud"] = transactions["id"].map(fraud_series)
    del fraud_series
    transactions = transactions.dropna(subset=["is_fraud"])
    transactions["is_fraud"] = transactions["is_fraud"].astype(bool)

    return transactions.groupby("client_id").agg(
        real_fraud_rate=("is_fraud", "mean"),
        real_labeled_transactions=("is_fraud", "count"),
    ).reset_index()


def correlate_trust_with_real_fraud(dataset, fraud_rates, label_col="trust_level"):
    """Correlate a dataset's trust_level (ordinal) with real per-client fraud rate."""
    merged = dataset.merge(fraud_rates, on="client_id", how="inner")
    merged["trust_ordinal"] = merged[label_col].map(TRUST_LEVEL_ORDINAL)

    correlation, p_value = spearmanr(merged["trust_ordinal"], merged["real_fraud_rate"])
    group_means = merged.groupby(label_col, observed=True)["real_fraud_rate"].mean().reindex(TRUST_LEVELS)

    return {
        "n_clients": len(merged),
        "spearman_correlation": correlation,
        "p_value": p_value,
        "mean_real_fraud_rate_by_trust_level": group_means.to_dict(),
    }


def _print_report(name, result):
    print(f"\n{name} (n={result['n_clients']})")
    print(f"  Spearman correlation (trust vs real fraud rate): {result['spearman_correlation']:.3f} (p={result['p_value']:.4f})")
    print("  Mean real fraud rate by trust_level:")
    for level, rate in result["mean_real_fraud_rate_by_trust_level"].items():
        print(f"    {level}: {rate:.4f}")


def _main():
    root = Path(__file__).resolve().parent.parent
    raw_dir = root / "data"
    processed_dir = root / "data" / "processed"

    print("Loading real fraud labels and computing per-client fraud rates...")
    fraud_rates = load_client_fraud_rates(raw_dir)

    worker_dataset = add_worker_trust_label(pd.read_csv(processed_dir / "worker_features.csv"))
    client_dataset = add_client_trust_label(pd.read_csv(processed_dir / "client_features.csv"))

    _print_report("Worker dataset", correlate_trust_with_real_fraud(worker_dataset, fraud_rates))
    _print_report("Client dataset", correlate_trust_with_real_fraud(client_dataset, fraud_rates))


if __name__ == "__main__":
    _main()
