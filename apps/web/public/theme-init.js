(() => {
  let stored = null;
  try {
    stored = localStorage.getItem("junctio-theme");
  } catch {
    stored = null;
  }
  const dark = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
})();
