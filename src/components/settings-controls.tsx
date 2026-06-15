import { cn } from "@/lib/utils";
import { useId, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SettingsSectionHeaderProps {
  label: string;
  className?: string;
}

export function SettingsSectionHeader({ label, className }: SettingsSectionHeaderProps) {
  return (
    <div className={cn("pt-2 pb-1", className)}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
        {label}
      </p>
    </div>
  );
}

interface SettingsToggleProps {
  icon: ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "data-testid"?: string;
}

export function SettingsToggle({
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  "data-testid": testId,
}: SettingsToggleProps) {
  const labelId = useId();
  const descriptionId = description ? `${labelId}-desc` : undefined;

  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-colors text-start min-h-[44px]",
        "bg-muted/40 hover:bg-muted/70 motion-safe:active:scale-[0.98]"
      )}
    >
      <span className="flex-shrink-0 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p id={labelId} className="text-sm font-medium text-foreground leading-tight">
          {label}
        </p>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div
        aria-hidden
        className={cn(
          "relative flex-shrink-0 w-12 h-7 rounded-full transition-colors duration-200",
          checked ? "bg-primary" : "bg-muted-foreground/40"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </div>
    </button>
  );
}

interface SettingsSelectOption {
  value: string;
  label: string;
}

interface SettingsSelectProps {
  icon: ReactNode;
  label: string;
  description?: string;
  value: string;
  options: SettingsSelectOption[];
  onValueChange: (value: string) => void;
  "data-testid"?: string;
  /** BCP-47 lang for rows whose text is a fixed language regardless of UI
   *  locale (e.g. the language picker is always Hebrew). Lets screen readers
   *  switch pronunciation engines — WCAG 3.1.2 Language of Parts. */
  lang?: string;
}

export function SettingsSelect({
  icon,
  label,
  description,
  value,
  options,
  onValueChange,
  "data-testid": testId,
  lang,
}: SettingsSelectProps) {
  const labelId = useId();
  const descriptionId = description ? `${labelId}-desc` : undefined;

  return (
    <div lang={lang} className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-muted/40 min-h-[44px]">
      <span className="flex-shrink-0 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p id={labelId} className="text-sm font-medium text-foreground leading-tight">
          {label}
        </p>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          className="w-auto min-w-[120px] h-11 text-xs"
          data-testid={testId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
