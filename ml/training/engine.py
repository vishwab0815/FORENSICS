"""Training loop shared by the image and audio detectors."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.common import CsvLogger, save_json
from ml.evaluation.metrics import compute_metrics


@dataclass
class TrainConfig:
    epochs: int = 15
    lr: float = 1e-4
    weight_decay: float = 1e-5
    patience: int = 4  # early stopping on validation loss
    device: str = "cpu"
    checkpoint_path: Path = Path("checkpoints/model.pt")
    log_path: Path = Path("checkpoints/training_log.csv")
    model_version: str = "v1.0.0"
    extra_metadata: dict = field(default_factory=dict)


def train_model(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    config: TrainConfig,
    pos_weight: float | None = None,
) -> dict:
    """Fine-tune ``model`` with BCE loss, early stopping on validation loss.

    Saves the best-scoring checkpoint (not the last epoch's) together with the
    metadata the serving layer reads back: version, backbone, metrics.
    """
    device = torch.device(config.device)
    model.to(device)

    criterion = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor([pos_weight], device=device) if pos_weight else None
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=config.lr, weight_decay=config.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=1
    )

    logger = CsvLogger(
        config.log_path,
        ["epoch", "train_loss", "val_loss", "val_accuracy", "val_auc", "val_f1", "lr"],
    )

    best_loss = float("inf")
    best_metrics: dict = {}
    epochs_without_improvement = 0

    for epoch in range(1, config.epochs + 1):
        train_loss = _run_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, probabilities, labels = _evaluate(model, val_loader, criterion, device)
        metrics = compute_metrics(labels, probabilities)

        current_lr = optimizer.param_groups[0]["lr"]
        logger.log(
            epoch=epoch,
            train_loss=round(train_loss, 5),
            val_loss=round(val_loss, 5),
            val_accuracy=round(metrics["accuracy"], 4),
            val_auc=round(metrics["auc_roc"], 4),
            val_f1=round(metrics["f1"], 4),
            lr=current_lr,
        )
        print(
            f"epoch {epoch:3d}/{config.epochs} | train {train_loss:.4f} | val {val_loss:.4f} "
            f"| acc {metrics['accuracy']:.4f} | auc {metrics['auc_roc']:.4f} "
            f"| f1 {metrics['f1']:.4f} | eer {metrics['eer']:.4f}"
        )
        scheduler.step(val_loss)

        if val_loss < best_loss - 1e-5:
            best_loss = val_loss
            best_metrics = metrics
            epochs_without_improvement = 0
            _save_checkpoint(model, config, epoch, metrics)
            print(f"  ↳ new best; checkpoint saved to {config.checkpoint_path}")
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= config.patience:
                print(f"Early stopping: validation loss flat for {config.patience} epochs.")
                break

    summary = {
        "best_val_loss": best_loss,
        "best_val_metrics": best_metrics,
        "epochs_run": epoch,
        "checkpoint": str(config.checkpoint_path),
        "model_version": config.model_version,
        **config.extra_metadata,
    }
    save_json(Path(config.checkpoint_path).with_suffix(".summary.json"), summary)
    return summary


def _run_epoch(model, loader, criterion, optimizer, device) -> float:
    model.train()
    total_loss, seen = 0.0, 0
    for inputs, targets in loader:
        inputs, targets = inputs.to(device), targets.to(device)
        optimizer.zero_grad(set_to_none=True)
        outputs = model(inputs)
        loss = criterion(outputs, targets)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        optimizer.step()

        total_loss += loss.item() * inputs.size(0)
        seen += inputs.size(0)
    return total_loss / max(seen, 1)


@torch.no_grad()
def _evaluate(model, loader, criterion, device) -> tuple[float, np.ndarray, np.ndarray]:
    model.eval()
    total_loss, seen = 0.0, 0
    all_probabilities, all_labels = [], []

    for inputs, targets in loader:
        inputs, targets = inputs.to(device), targets.to(device)
        outputs = model(inputs)
        total_loss += criterion(outputs, targets).item() * inputs.size(0)
        seen += inputs.size(0)
        all_probabilities.append(torch.sigmoid(outputs).cpu().numpy().ravel())
        all_labels.append(targets.cpu().numpy().ravel())

    return (
        total_loss / max(seen, 1),
        np.concatenate(all_probabilities) if all_probabilities else np.array([]),
        np.concatenate(all_labels) if all_labels else np.array([]),
    )


def predict(model: nn.Module, loader: DataLoader, device: str = "cpu"):
    """Return ``(probabilities, labels)`` for a whole loader."""
    criterion = nn.BCEWithLogitsLoss()
    _, probabilities, labels = _evaluate(model, loader, criterion, torch.device(device))
    return probabilities, labels


def _save_checkpoint(model: nn.Module, config: TrainConfig, epoch: int, metrics: dict) -> None:
    """Persist weights plus the metadata the API surfaces in reports."""
    path = Path(config.checkpoint_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "version": config.model_version,
            "epoch": epoch,
            "val_accuracy": round(metrics["accuracy"], 4),
            "val_auc": round(metrics["auc_roc"], 4),
            "val_eer": round(metrics["eer"], 4),
            **config.extra_metadata,
        },
        path,
    )
