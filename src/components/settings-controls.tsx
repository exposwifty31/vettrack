import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
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
  return (
    <button
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-colors text-left",
        "bg-muted/40 hover:bg-muted/70 motion-safe:active:scale-[0.98]"
      )}
    >
      <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div
        className={cn(
          "relative flex-shrink-0 w-12 h-7 rounded-full transition-colors duration-200",
          checked ? "bg-primary" : "bg-muted-foreground/30"
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
}

export function SettingsSelect({
  icon,
  label,
  description,
  value,
  options,
  onValueChange,
  "data-testid": testId,
}: SettingsSelectProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-muted/40">
      <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          className="w-auto min-w-[120px] h-9 text-xs"
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
