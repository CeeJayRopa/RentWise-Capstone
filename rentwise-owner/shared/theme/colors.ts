export const colors = {
  ink: "#0B2B22",
  emerald: "#0E6B54",
  emeraldBright: "#17A67F",
  emeraldSoft: "#DCEFE7",
  gold: "#C9A227",
  goldSoft: "#F4E9C7",
  parchment: "#F7F5EF",
  mist: "#EEF3F0",
  white: "#FFFFFF",

  textPrimary: "#0B2B22",
  textSecondary: "#5B6B63",
  textMuted: "#8C988F",
  textInverse: "#F7F5EF",

  border: "#E3E0D6",
  borderStrong: "#CFCABC",

  success: "#17A67F",
  successSoft: "#DCEFE7",
  warning: "#B8791E",
  warningSoft: "#F6E7CE",
  error: "#B2403B",
  errorSoft: "#F5DEDC",

  overlay: "rgba(11, 43, 34, 0.55)",
} as const;

export type ColorToken = keyof typeof colors;
