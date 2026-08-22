import { useRef, type CSSProperties, type ChangeEvent } from "react";
import { Platform, StyleSheet, TextInput as NativeTextInput, type StyleProp, type TextStyle } from "react-native";

type WebDateTimeInputProps = {
  type: "date" | "time";
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
};

function toWebInputStyle(style: StyleProp<TextStyle>) {
  const resolved = (StyleSheet.flatten(style) ?? {}) as TextStyle & Record<string, unknown>;
  const paddingHorizontal = resolved.paddingHorizontal;
  const paddingVertical = resolved.paddingVertical;

  return {
    boxSizing: "border-box",
    appearance: "auto",
    fontFamily: '-apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    paddingLeft: paddingHorizontal ?? resolved.paddingLeft,
    paddingRight: paddingHorizontal ?? resolved.paddingRight,
    paddingTop: paddingVertical ?? resolved.paddingTop,
    paddingBottom: paddingVertical ?? resolved.paddingBottom,
    borderWidth: resolved.borderWidth,
    borderStyle: resolved.borderWidth ? "solid" : undefined,
    borderColor: resolved.borderColor,
    borderRadius: resolved.borderRadius,
    backgroundColor: resolved.backgroundColor,
    color: resolved.color,
    fontSize: resolved.fontSize,
    fontWeight: resolved.fontWeight,
    lineHeight: resolved.lineHeight,
    width: resolved.width,
    flexGrow: resolved.flex ? 1 : resolved.flexGrow,
    flexShrink: resolved.flex ? 1 : resolved.flexShrink,
    flexBasis: resolved.flex ? 0 : undefined,
    minWidth: resolved.minWidth ?? 0,
    alignSelf: resolved.alignSelf,
  } as CSSProperties;
}

function formatPickerValue(type: WebDateTimeInputProps["type"], value: string) {
  if (type === "date") {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return value;
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(year, month - 1, day),
    );
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
}

function PickerIcon({ type }: Pick<WebDateTimeInputProps, "type">) {
  if (type === "date") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function WebDateTimeInput({ type, value, onChangeText, placeholder, style }: WebDateTimeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (Platform.OS === "web") {
    const controlStyle = toWebInputStyle(style);

    return (
      <div style={{ ...controlStyle, position: "relative", display: "flex", alignItems: "center" }}>
        <button
          type="button"
          aria-label={`Choose ${type}`}
          onClick={() => {
            const input = inputRef.current;
            if (!input) return;

            try {
              input.showPicker?.();
            } catch {
              input.click();
            }

            if (typeof input.showPicker !== "function") {
              input.click();
            }
          }}
          style={{
            appearance: "none",
            alignItems: "center",
            background: "transparent",
            border: 0,
            color: "inherit",
            cursor: "pointer",
            display: "flex",
            font: "inherit",
            gap: 8,
            justifyContent: "space-between",
            margin: 0,
            minWidth: 0,
            padding: 0,
            textAlign: "left",
            width: "100%",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value ? formatPickerValue(type, value) : placeholder}
          </span>
          <PickerIcon type={type} />
        </button>
        <input
          ref={inputRef}
          aria-hidden="true"
          tabIndex={-1}
          type={type}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChangeText(event.currentTarget.value)}
          style={{ height: 1, opacity: 0, pointerEvents: "none", position: "absolute", width: 1 }}
        />
      </div>
    );
  }

  return <NativeTextInput value={value} onChangeText={onChangeText} placeholder={placeholder} editable={false} style={style} />;
}
