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
        avg_hours_between_transactions=("hours_since_prev", "mean"),
    ).reset_index()

    client_agg["error_rate"] = client_agg["error_count"] / client_agg["transaction_count"]
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


def build_worker_dataset(client_agg):
    """Derive the synthetic worker trust dataset from role-assigned client aggregates."""
    worker_df = client_agg[client_agg["role"] == "worker"].copy()
    worker_df["job_completion_rate"] = 1 - worker_df["error_rate"]
    worker_df["dispute_count"] = worker_df["error_count"]
    worker_df["response_time_hours"] = worker_df["avg_hours_between_transactions"]
    worker_df["total_jobs"] = worker_df["transaction_count"]
    return worker_df[WORKER_COLUMNS].reset_index(drop=True)


def build_client_dataset(client_agg):
    """Derive the synthetic client trust dataset from role-assigned client aggregates."""
    client_df = client_agg[client_agg["role"] == "client"].copy()
    client_df["payment_completion_rate"] = 1 - client_df["error_rate"]
    client_df["escrow_release_time_hours"] = client_df["avg_hours_between_transactions"]
    client_df["refund_requests"] = client_df["error_count"]
    client_df["total_jobs_paid"] = client_df["transaction_count"]
    return client_df[CLIENT_COLUMNS].reset_index(drop=True)


def build_worker_and_client_datasets(transactions, seed=42):
    """Run the full feature engineering pipeline: time features, aggregation, role split."""
    transactions = add_time_features(transactions)
    client_agg = aggregate_client_behavior(transactions)
    client_agg = assign_synthetic_roles(client_agg, seed=seed)
    return build_worker_dataset(client_agg), build_client_dataset(client_agg)
