"use client";

import { useSyncExternalStore } from "react";
import { DARK_QUERY, THEME_STORAGE_KEY } from "./theme-script";

export type ThemeChoice = "system" | "light" | "dark";

const listeners = new Set<() => void>();

const read = (): ThemeChoice => {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
};

const apply = (choice: ThemeChoice) => {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => apply(read());
  media.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
  };
};

export const setTheme = (choice: ThemeChoice) => {
  if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
  else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  apply(choice);
  listeners.forEach((listener) => listener());
};

export const useThemeChoice = () =>
  useSyncExternalStore(subscribe, read, () => "system" as ThemeChoice);
