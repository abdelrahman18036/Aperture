const THEME_SCRIPT = `(function(){try{var d=document.documentElement,k="aperture-theme",p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var r=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;d.dataset.themePreference=p;d.dataset.theme=r;d.classList.toggle("dark",r==="dark");d.style.colorScheme=r}catch(e){}})()`;

/** Resolves the stored theme before first paint, without making layout dynamic. */
function ThemeScript(): React.JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

export { ThemeScript };
