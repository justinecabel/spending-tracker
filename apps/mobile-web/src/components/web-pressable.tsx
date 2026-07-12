import type { ComponentProps } from "react";
import { Platform, Pressable as NativePressable } from "react-native";

type WebPressableProps = ComponentProps<typeof NativePressable>;

/**
 * React Native Web's Pressability layer can drop `onPress` handlers in an
 * exported static bundle. Use React's direct web click handler for the web
 * build while preserving the native `onPress` behavior for other platforms.
 */
export function WebPressable({ onPress, accessibilityRole, ...props }: WebPressableProps) {
  const interactionProps =
    Platform.OS === "web"
      ? ({ onClick: onPress } as Record<string, unknown>)
      : { onPress };

  return (
    <NativePressable
      {...props}
      {...interactionProps}
      accessibilityRole={accessibilityRole ?? "button"}
    />
  );
}
