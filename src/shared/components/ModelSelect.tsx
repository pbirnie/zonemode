import React from "react";
import type { AIProvider } from "../config";

interface AIModel {
  id: string;
  name?: string;
}

interface ModelSelectProps {
  provider: AIProvider | null;
  models: AIModel[];
  selectedModel: string | null;
  isLoading: boolean;
  onChange: (modelId: string) => void;
  className?: string;
  /** When true, first option is an empty placeholder until the user picks a model. */
  allowEmptyOption?: boolean;
}

export const ModelSelect: React.FC<ModelSelectProps> = ({
  provider,
  models,
  selectedModel,
  isLoading,
  onChange,
  className = "",
  allowEmptyOption = false,
}) => {
  if (!provider || models.length === 0) return null;

  const trimmedSelected = (selectedModel ?? "").trim();
  const listedIds = new Set(models.map((m) => m.id.trim()));
  const savedModelNotInList =
    trimmedSelected.length > 0 && !listedIds.has(trimmedSelected);
  const matchedByTrim = models.find((m) => m.id.trim() === trimmedSelected);
  const selectValue = isLoading
    ? ""
    : matchedByTrim
      ? matchedByTrim.id
      : trimmedSelected;

  return (
    <div className="settings-section">
      <label htmlFor="model" className="settings-label">
        AI Model
      </label>
      <div className="select-wrapper">
        <select
          id="model"
          className={`model-select ${className}`}
          value={selectValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading}
        >
          {isLoading ? (
            <option value="" disabled>
              Loading models…
            </option>
          ) : (
            <>
              {allowEmptyOption ? (
                <option value="">— Select a model —</option>
              ) : null}
              {savedModelNotInList ? (
                <option value={trimmedSelected}>
                  {trimmedSelected} (saved)
                </option>
              ) : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </>
          )}
        </select>
      </div>
    </div>
  );
};
