"""Evaluate the v2 trust models: baselines, confusion matrix, per-class metrics, variability.

v2 labels are a deterministic rule (realistic.trust_points) on the same features the forest
sees, so the rule itself is the natural baseline. Both are scored on a synthetic-heavy test
set, which shows the forest reproduces the rule, not that the rule is valid for real users.
"""

import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

from src.feature_engineering import TRUST_LEVELS
from src.model_io import load_model
from src.realistic import COLUMNS, REALISTIC_MODEL_VERSION, SEED, build_dataset, real_profiles, trust_level, trust_points

REPEAT_SEEDS = [42, 1, 2, 3, 4]


def make_forest(seed):
    """The same forest realistic.train_role fits."""
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=2, random_state=seed)


def split(dataset, role, seed):
    return train_test_split(
        dataset[COLUMNS[role]].astype(float), dataset["trust_level"], test_size=0.2, random_state=seed, stratify=dataset["trust_level"]
    )


def rule_baseline(role, X):
    """Predict with the labelling rule itself, no learning."""
    completion, issues, timing = (X[col] for col in COLUMNS[role])
    return trust_level(trust_points(role, completion, issues, timing))


def scores(y_true, y_pred):
    return {
        "accuracy": float(np.mean(np.asarray(y_true) == np.asarray(y_pred))),
        "macro_f1": f1_score(y_true, y_pred, labels=TRUST_LEVELS, average="macro", zero_division=0),
        "balanced_accuracy": balanced_accuracy_score(y_true, y_pred),
    }


def repeated_runs(role, dataset, seeds=REPEAT_SEEDS):
    """Retrain on several different splits and score forest, rule and majority baselines."""
    rows = {"forest": [], "train_accuracy": [], "rule": [], "majority": []}
    for seed in seeds:
        X_train, X_test, y_train, y_test = split(dataset, role, seed)
        forest = make_forest(seed).fit(X_train, y_train)
        majority = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)
        rows["forest"].append(scores(y_test, forest.predict(X_test)))
        rows["train_accuracy"].append(forest.score(X_train, y_train))
        rows["rule"].append(scores(y_test, rule_baseline(role, X_test)))
        rows["majority"].append(scores(y_test, majority.predict(X_test)))
    return rows


def _summarise(runs, key):
    values = np.array([run[key] for run in runs])
    return f"{values.mean():.3f} +/- {values.std():.3f}"


def _main():
    for role in COLUMNS:
        dataset = build_dataset(role)
        n_real = len(real_profiles(role))
        print(f"\n=== {role} (v2) ===")
        print(f"rows: {len(dataset)} ({n_real} real-derived, {len(dataset) - n_real} synthetic)")
        print("label counts:", dataset["trust_level"].value_counts().reindex(TRUST_LEVELS).to_dict())

        X_train, X_test, y_train, y_test = split(dataset, role, SEED)
        y_pred = load_model(role, REALISTIC_MODEL_VERSION).predict(X_test)
        print(f"\nSaved model on the seed-{SEED} test set (n={len(y_test)}); rows actual, columns predicted:")
        print(" " * 8 + "".join(f"{level:>8}" for level in TRUST_LEVELS))
        for level, row in zip(TRUST_LEVELS, confusion_matrix(y_test, y_pred, labels=TRUST_LEVELS)):
            print(f"{level:>8}" + "".join(f"{count:>8}" for count in row))
        print(classification_report(y_test, y_pred, labels=TRUST_LEVELS, zero_division=0))

        runs = repeated_runs(role, dataset)
        print(f"Mean +/- std over {len(REPEAT_SEEDS)} splits/seeds ({REPEAT_SEEDS}):")
        for name in ["forest", "rule", "majority"]:
            for metric in ["accuracy", "macro_f1", "balanced_accuracy"]:
                print(f"  {name:>8} {metric:<18} {_summarise(runs[name], metric)}")
        train_acc = np.array(runs["train_accuracy"])
        print(f"  forest train accuracy {train_acc.mean():.3f} (gap to test accuracy shows overfitting)")

        cv = cross_val_score(
            make_forest(SEED),
            dataset[COLUMNS[role]].astype(float),
            dataset["trust_level"],
            cv=StratifiedKFold(5, shuffle=True, random_state=SEED),
            scoring="f1_macro",
        )
        print(f"  5-fold CV macro F1 {cv.mean():.3f} +/- {cv.std():.3f}")


if __name__ == "__main__":
    _main()
