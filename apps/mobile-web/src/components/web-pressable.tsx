import type { ComponentProps } from "react";
import { Platform, Pressable as NativePressable, View } from "react-native";

type WebPressableProps = ComponentProps<typeof NativePressable>;

/**
 * React Native Web's Pressability layer can drop `onPress` handlers in an
 * exported static bundle. Render a plain View with React's direct click
 * handler on web while preserving native `onPress` behavior elsewhere.
 */
export function WebPressable({ onPress, accessibilityRole, ...props }: WebPressableProps) {
  if (Platform.OS === "web") {
    return (
      <View
        {...(props as ComponentProps<typeof View>)}
        {...({ onClick: onPress } as Record<string, unknown>)}
        accessibilityRole={accessibilityRole ?? "button"}
      />
    );
  }

  return (
    <NativePressable
      {...props}
      accessibilityRole={accessibilityRole ?? "button"}
      onPress={onPress}
    />
  );
}
