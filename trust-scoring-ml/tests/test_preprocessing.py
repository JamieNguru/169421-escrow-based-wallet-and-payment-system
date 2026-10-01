import json

import pandas as pd

from src.preprocessing import (
    clean_amount,
    encode_use_chip,
    flag_errors,
    load_transactions,
    merge_mcc_descriptions,
)


def test_clean_amount_strips_dollar_and_comma():
    df = pd.DataFrame({"amount": ["$1,234.56", "$-77.00", "$0.00"]})

    result = clean_amount(df)

    assert result["amount"].tolist() == [1234.56, -77.00, 0.00]
    assert result["amount"].dtype == float


def test_flag_errors_marks_non_null_errors():
    df = pd.DataFrame({"errors": [None, "Bad PIN", None, "Insufficient Balance"]})

    result = flag_errors(df)

    assert result["has_error"].tolist() == [0, 1, 0, 1]


def test_flag_errors_classifies_error_types_including_combined_errors():
    df = pd.DataFrame(
        {
            "errors": [
                None,
                "Insufficient Balance",
                "Bad CVV",
                "Bad PIN,Insufficient Balance",
                "Technical Glitch",
                "Bad Zipcode,Technical Glitch",
            ]
        }
    )

    result = flag_errors(df)

    assert result["has_error"].tolist() == [0, 1, 1, 1, 1, 1]
    assert result["funds_error"].tolist() == [0, 1, 0, 1, 0, 0]
    assert result["credential_error"].tolist() == [0, 0, 1, 1, 0, 1]
    assert result["technical_error"].tolist() == [0, 0, 0, 0, 1, 1]


def test_encode_use_chip_one_hot_encodes_with_channel_prefix():
    df = pd.DataFrame({"use_chip": ["Chip Transaction", "Swipe Transaction", "Chip Transaction"]})

    result = encode_use_chip(df)

    assert "channel_Chip Transaction" in result.columns
    assert "channel_Swipe Transaction" in result.columns
    assert "use_chip" not in result.columns
    assert result["channel_Chip Transaction"].tolist() == [True, False, True]


def test_merge_mcc_descriptions_matches_known_codes_and_leaves_unknown_as_nan(tmp_path):
    mcc_path = tmp_path / "mcc_codes.json"
    mcc_path.write_text(json.dumps({"5812": "Eating Places and Restaurants"}), encoding="utf-8")

    df = pd.DataFrame({"mcc": [5812, 9999]})

    result = merge_mcc_descriptions(df, mcc_path)

    assert result.loc[result["mcc"] == 5812, "mcc_description"].iloc[0] == "Eating Places and Restaurants"
    assert result.loc[result["mcc"] == 9999, "mcc_description"].isna().all()


def test_load_transactions_selects_columns_and_parses_date(tmp_path):
    csv_path = tmp_path / "transactions_data.csv"
    csv_path.write_text(
        "id,date,client_id,card_id,amount,use_chip,merchant_id,mcc,errors,extra_column\n"
        "1,2020-01-01 00:01:00,10,20,$5.00,Chip Transaction,30,5812,,ignored\n",
        encoding="utf-8",
    )

    result = load_transactions(csv_path)

    assert "extra_column" not in result.columns
    assert list(result.columns) == [
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
    assert pd.api.types.is_datetime64_any_dtype(result["date"])
