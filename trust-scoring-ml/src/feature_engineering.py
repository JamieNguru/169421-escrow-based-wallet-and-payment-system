"""Derive time features and synthetic worker/client trust datasets from cleaned transactions."""

import numpy as np
import pandas as pd

WORKER_COLUMNS = ["client_id", "job_completion_rate", "dispute_count", "response_time_hours", "total_jobs"]
CLIENT_COLUMNS = [
    "client_id",
    "payment_completion_rate",
    "escrow_release_time_hours",
    "refund_requests",
    "total_jobs_paid",
]


def add_time_features(transactions):
    """Derive hour, day_of_week, month, and is_weekend from the date column."""
    transactions = transactions.copy()
    transactions["hour"] = transactions["date"].dt.hour
    transactions["day_of_week"] = transactions["date"].dt.dayofweek
    transactions["month"] = transactions["date"].dt.month
    transactions["is_weekend"] = transactions["day_of_week"].isin([5, 6]).astype(int)
    return transactions


def aggregate_client_behavior(transactions):
    """Aggregate each client_id's real transaction behaviour into proxy features."""
    transactions = transactions.sort_values(["client_id", "date"]).copy()
    transactions["prev_date"] = transactions.groupby("client_id")["date"].shift(1)
    transactions["hours_since_prev"] = (
        transactions["date"] - transactions["prev_date"]
    ).dt.total_seconds() / 3600

    client_agg = transactions.groupby("client_id").agg(
        transaction_count=("id", "count"),
        total_amount=("amount", "sum"),
        avg_amount=("amount", "mean"),
        error_count=("has_error", "sum"),
        funds_error_count=("funds_error", "sum"),
        credential_error_count=("credential_error", "sum"),
        avg_hours_between_transactions=("hours_since_prev", "mean"),
    ).reset_index()

    client_agg["error_rate"] = client_agg["error_count"] / client_agg["transaction_count"]
    client_agg["funds_error_rate"] = client_agg["funds_error_count"] / client_agg["transaction_count"]
    client_agg["credential_error_rate"] = client_agg["credential_error_count"] / client_agg["transaction_count"]
    client_agg["avg_hours_between_transactions"] = client_agg[
        "avg_hours_between_transactions"
    ].fillna(client_agg["avg_hours_between_transactions"].median())

    return client_agg


def assign_synthetic_roles(client_agg, seed=42):
    """Randomly assign each client a worker or client role (reproducible with a fixed seed)."""
    client_agg = client_agg.copy()
    rng = np.random.default_rng(seed=seed)
    client_agg["role"] = rng.choice(["worker", "client"], size=len(client_agg))
    return client_agg


# Completion and dispute/refund features come from different error types (insufficient
# balance vs. credential errors), so they are independent rather than mirror images of one
# failure rate. Technical glitches are system noise and count towards neither.


def build_worker_dataset(client_agg):
    """Derive the synthetic worker trust dataset from role-assigned client aggregates."""
    worker_df = client_agg[client_agg["role"] == "worker"].copy()
    worker_df["job_completion_rate"] = 1 - worker_df["funds_error_rate"]
    worker_df["dispute_count"] = worker_df["credential_error_count"]
    worker_df["response_time_hours"] = worker_df["avg_hours_between_transactions"]
    worker_df["total_jobs"] = worker_df["transaction_count"]
    return worker_df[WORKER_COLUMNS].reset_index(drop=True)


def build_client_dataset(client_agg):
    """Derive the synthetic client trust dataset from role-assigned client aggregates."""
    client_df = client_agg[client_agg["role"] == "client"].copy()
    client_df["payment_completion_rate"] = 1 - client_df["funds_error_rate"]
    client_df["escrow_release_time_hours"] = client_df["avg_hours_between_transactions"]
    client_df["refund_requests"] = client_df["credential_error_count"]
    client_df["total_jobs_paid"] = client_df["transaction_count"]
    return client_df[CLIENT_COLUMNS].reset_index(drop=True)


def build_worker_and_client_datasets(transactions, seed=42):
    """Run the full feature engineering pipeline: time features, aggregation, role split."""
    transactions = add_time_features(transactions)
    client_agg = aggregate_client_behavior(transactions)
    client_agg = assign_synthetic_roles(client_agg, seed=seed)
    return build_worker_dataset(client_agg), build_client_dataset(client_agg)


TRUST_LEVELS = ["Low", "Medium", "High"]


def _min_max_normalize(series):
    """Scale a series to [0, 1]; a constant series (max == min) normalizes to all zeros."""
    value_range = series.max() - series.min()
    if value_range == 0:
        return pd.Series(0.0, index=series.index)
    return (series - series.min()) / value_range


def add_trust_label(df, completion_col, issue_count_col, time_col, total_col, label_col="trust_level"):
    """Derive a Low/Medium/High trust label from a completion rate, an issue rate, and a
    time metric, since no ground-truth trust label exists for this synthetic data.

    completion_col is treated as already a 0-1 rate. issue_count_col is divided by
    total_col to get a rate, and time_col is used directly; both are min-max normalized
    (lower is better for both) and combined with completion_col into a composite score,
    which is then split into equal-sized tertiles.
    """
    df = df.copy()
    issue_rate = df[issue_count_col] / df[total_col]

    norm_issue_rate = _min_max_normalize(issue_rate)
    norm_time = _min_max_normalize(df[time_col])

    score = df[completion_col] - 0.5 * norm_issue_rate - 0.3 * norm_time
    df[label_col] = pd.qcut(score, q=3, labels=TRUST_LEVELS)
    return df


def add_worker_trust_label(worker_dataset):
    """Add a trust_level label to the worker dataset from completion rate, disputes, and response time."""
    return add_trust_label(
        worker_dataset,
        completion_col="job_completion_rate",
        issue_count_col="dispute_count",
        time_col="response_time_hours",
        total_col="total_jobs",
    )


def add_client_trust_label(client_dataset):
    """Add a trust_level label to the client dataset from completion rate, refunds, and release time."""
    return add_trust_label(
        client_dataset,
        completion_col="payment_completion_rate",
        issue_count_col="refund_requests",
        time_col="escrow_release_time_hours",
        total_col="total_jobs_paid",
    )


def add_worker_rate_features(worker_dataset):
    """Add dispute_rate (dispute_count / total_jobs) so models see a scale-invariant
    rate instead of a raw count that depends on job volume."""
    df = worker_dataset.copy()
    df["dispute_rate"] = df["dispute_count"] / df["total_jobs"]
    return df


def add_client_rate_features(client_dataset):
    """Add refund_rate (refund_requests / total_jobs_paid) so models see a scale-invariant
    rate instead of a raw count that depends on job volume."""
    df = client_dataset.copy()
    df["refund_rate"] = df["refund_requests"] / df["total_jobs_paid"]
    return df
