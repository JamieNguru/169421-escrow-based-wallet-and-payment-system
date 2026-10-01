"""Standard report figures for the trust-scoring models: static PNGs for the capstone write-up."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, roc_curve

from src.feature_engineering import TRUST_LEVELS

# Reference palette (dataviz skill default), light mode.
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRIDLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
SURFACE = "#fcfcfb"

# Ordinal ramp (Low -> High), one hue, light -> dark; step 250/400/650.
TRUST_LEVEL_RAMP = {"Low": "#86b6ef", "Medium": "#3987e5", "High": "#104281"}

# Sequential blue ramp for heatmaps (near-zero recedes toward the surface).
SEQUENTIAL_CMAP = "Blues"

# First three categorical slots (validated all-pairs safe in both modes).
CATEGORICAL_SLOTS = {"Low": "#2a78d6", "Medium": "#eb6834", "High": "#1baf7a"}


def _new_figure(figsize=(6, 4.5)):
    fig, ax = plt.subplots(figsize=figsize, facecolor=SURFACE)
    ax.set_facecolor(SURFACE)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(BASELINE)
    ax.spines["bottom"].set_color(BASELINE)
    ax.tick_params(colors=INK_SECONDARY)
    return fig, ax


def plot_fraud_rate_by_trust(mean_fraud_rate_by_level, title, save_path):
    """Bar chart of mean real fraud rate per trust_level."""
    fig, ax = _new_figure()

    levels = [level for level in TRUST_LEVELS if level in mean_fraud_rate_by_level]
    values = [mean_fraud_rate_by_level[level] for level in levels]
    colors = [TRUST_LEVEL_RAMP[level] for level in levels]

    bars = ax.bar(levels, values, color=colors, width=0.6)
    for bar, value in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            f"{value:.4f}",
            ha="center",
            va="bottom",
            fontsize=9,
            color=INK_PRIMARY,
        )

    ax.set_ylabel("Mean real fraud rate", color=INK_SECONDARY)
    ax.set_xlabel("Predicted trust level", color=INK_SECONDARY)
    ax.set_title(title, color=INK_PRIMARY, fontsize=12, fontweight="bold")
    ax.yaxis.grid(True, color=GRIDLINE, linewidth=0.8)
    ax.set_axisbelow(True)

    fig.tight_layout()
    fig.savefig(save_path, dpi=200)
    plt.close(fig)


def plot_confusion_matrix(y_test, y_pred, title, save_path):
    """Heatmap confusion matrix over the fixed Low/Medium/High label order."""
    matrix = confusion_matrix(y_test, y_pred, labels=TRUST_LEVELS)

    fig, ax = plt.subplots(figsize=(5, 4.5), facecolor=SURFACE)
    im = ax.imshow(matrix, cmap=SEQUENTIAL_CMAP)

    ax.set_xticks(range(len(TRUST_LEVELS)))
    ax.set_yticks(range(len(TRUST_LEVELS)))
    ax.set_xticklabels(TRUST_LEVELS, color=INK_SECONDARY)
    ax.set_yticklabels(TRUST_LEVELS, color=INK_SECONDARY)
    ax.set_xlabel("Predicted", color=INK_SECONDARY)
    ax.set_ylabel("Actual", color=INK_SECONDARY)
    ax.set_title(title, color=INK_PRIMARY, fontsize=12, fontweight="bold")

    threshold = matrix.max() / 2
    for i in range(matrix.shape[0]):
        for j in range(matrix.shape[1]):
            color = "white" if matrix[i, j] > threshold else INK_PRIMARY
            ax.text(j, i, str(matrix[i, j]), ha="center", va="center", color=color, fontsize=10)

    fig.colorbar(im, ax=ax, shrink=0.8, label="Count")
    fig.tight_layout()
    fig.savefig(save_path, dpi=200)
    plt.close(fig)


def plot_roc_curves(y_test, y_proba, classes, title, save_path):
    """One-vs-rest ROC curve per trust level."""
    fig, ax = _new_figure()

    for level in TRUST_LEVELS:
        class_index = list(classes).index(level)
        y_true_binary = (np.asarray(y_test) == level).astype(int)
        fpr, tpr, _ = roc_curve(y_true_binary, y_proba[:, class_index])
        ax.plot(fpr, tpr, color=CATEGORICAL_SLOTS[level], linewidth=2, label=level)

    ax.plot([0, 1], [0, 1], color=BASELINE, linewidth=1, linestyle="--")
    ax.set_xlabel("False positive rate", color=INK_SECONDARY)
    ax.set_ylabel("True positive rate", color=INK_SECONDARY)
    ax.set_title(title, color=INK_PRIMARY, fontsize=12, fontweight="bold")
    ax.legend(frameon=False, labelcolor=INK_SECONDARY)
    ax.grid(True, color=GRIDLINE, linewidth=0.8)
    ax.set_axisbelow(True)

    fig.tight_layout()
    fig.savefig(save_path, dpi=200)
    plt.close(fig)


def plot_feature_importance(model, feature_names, title, save_path):
    """Horizontal bar chart of Random Forest feature importances, sorted descending."""
    importances = model.feature_importances_
    order = np.argsort(importances)

    fig, ax = _new_figure(figsize=(6, 3.5))
    ax.barh(
        [feature_names[i] for i in order],
        [importances[i] for i in order],
        color=CATEGORICAL_SLOTS["Low"],
    )
    ax.set_xlabel("Importance", color=INK_SECONDARY)
    ax.set_title(title, color=INK_PRIMARY, fontsize=12, fontweight="bold")
    ax.xaxis.grid(True, color=GRIDLINE, linewidth=0.8)
    ax.set_axisbelow(True)

    fig.tight_layout()
    fig.savefig(save_path, dpi=200)
    plt.close(fig)


def plot_tuning_heatmap(cv_results, title, save_path):
    """Heatmap of mean cross-validated macro F1 for each n_estimators x max_depth pair."""
    results = pd.DataFrame(
        {
            "max_depth": [str(p["max_depth"]) for p in cv_results["params"]],
            "n_estimators": [p["n_estimators"] for p in cv_results["params"]],
            "score": cv_results["mean_test_score"],
        }
    )
    grid = results.pivot(index="max_depth", columns="n_estimators", values="score")
    # Shallowest first, with "None" (no depth limit) last.
    depth_order = sorted(grid.index, key=lambda d: float("inf") if d == "None" else int(d))
    grid = grid.reindex(depth_order)

    fig, ax = plt.subplots(figsize=(5.5, 4), facecolor=SURFACE)
    im = ax.imshow(grid.values, cmap=SEQUENTIAL_CMAP)

    ax.set_xticks(range(len(grid.columns)))
    ax.set_yticks(range(len(grid.index)))
    ax.set_xticklabels(grid.columns, color=INK_SECONDARY)
    ax.set_yticklabels(grid.index, color=INK_SECONDARY)
    ax.set_xlabel("Number of trees (n_estimators)", color=INK_SECONDARY)
    ax.set_ylabel("Maximum depth (max_depth)", color=INK_SECONDARY)
    ax.set_title(title, color=INK_PRIMARY, fontsize=12, fontweight="bold")

    threshold = (np.nanmin(grid.values) + np.nanmax(grid.values)) / 2
    for i in range(grid.shape[0]):
        for j in range(grid.shape[1]):
            value = grid.values[i, j]
            color = "white" if value > threshold else INK_PRIMARY
            ax.text(j, i, f"{value:.3f}", ha="center", va="center", color=color, fontsize=10)

    fig.colorbar(im, ax=ax, shrink=0.8, label="Mean CV macro F1")
    fig.tight_layout()
    fig.savefig(save_path, dpi=200)
    plt.close(fig)
