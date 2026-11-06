export const THEME_STORAGE_KEY = "fluxgate-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs inline in <head>, before first paint, so a stored dark theme never flashes light. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("${DARK_QUERY}").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}})()`;
