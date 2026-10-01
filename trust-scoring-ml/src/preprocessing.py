"""Load and clean raw transaction data."""

import json
from pathlib import Path

import pandas as pd

TRANSACTION_COLUMNS = [
    "id",
    "date",
    "client_id",
    "card_id",
    "amount",
    "use_chip",
    "merchant_id",
    "mcc",
    "errors",
]


# Compact dtypes keep the 13.3M-row file to a few hundred MB in memory.
TRANSACTION_DTYPES = {
    "id": "int32",
    "client_id": "int16",
    "card_id": "int16",
    "merchant_id": "int32",
    "mcc": "int16",
    "use_chip": "category",
}


def load_transactions(path):
    """Load the raw transactions CSV, keeping only the columns needed downstream."""
    transactions = pd.read_csv(path, usecols=TRANSACTION_COLUMNS, dtype=TRANSACTION_DTYPES)
    transactions = transactions[TRANSACTION_COLUMNS]
    transactions["date"] = pd.to_datetime(transactions["date"])
    return transactions


def clean_amount(transactions):
    """Strip the '$' and ',' from the amount column and cast to float."""
    transactions = transactions.copy()
    transactions["amount"] = (
        transactions["amount"]
        .str.replace("$", "", regex=False)
        .str.replace(",", "", regex=False)
        .astype(float)
    )
    return transactions


def flag_errors(transactions):
    """Add a binary has_error flag from the errors column."""
    transactions = transactions.copy()
    transactions["has_error"] = transactions["errors"].notna().astype(int)
    return transactions


def encode_use_chip(transactions):
    """One-hot encode the use_chip channel column."""
    return pd.get_dummies(transactions, columns=["use_chip"], prefix="channel")


def merge_mcc_descriptions(transactions, mcc_codes_path):
    """Merge in merchant category descriptions from mcc_codes.json."""
    with open(mcc_codes_path, "r", encoding="utf-8") as f:
        mcc_codes = json.load(f)

    mcc_lookup = pd.DataFrame(
        {
            "mcc": [int(k) for k in mcc_codes.keys()],
            "mcc_description": pd.Categorical(list(mcc_codes.values())),
        }
    ).astype({"mcc": transactions["mcc"].dtype})
    return transactions.merge(mcc_lookup, on="mcc", how="left")


def load_and_clean_transactions(data_dir):
    """Run the full load + clean pipeline: load, clean amount, flag errors, encode channel, merge MCC."""
    data_dir = Path(data_dir)
    transactions = load_transactions(data_dir / "transactions_data.csv")
    transactions = clean_amount(transactions)
    transactions = flag_errors(transactions)
    transactions = encode_use_chip(transactions)
    transactions = merge_mcc_descriptions(transactions, data_dir / "mcc_codes.json")
    return transactions
