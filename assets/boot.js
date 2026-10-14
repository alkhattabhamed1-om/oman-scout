// Runs before first paint: apply the saved language, theme, text size, density and motion setting.
(function () {
  try {
    var d = document.documentElement;
    var get = function (k) { return localStorage.getItem('scout.' + k); };
    var theme = get('theme'), lang = get('lang'), scale = get('textScale'), dens = get('density'), motion = get('motion');
    if (theme === 'light' || theme === 'dark') d.setAttribute('data-theme', theme);
    if (!lang) lang = ((navigator.language || '').slice(0, 2) === 'ar') ? 'ar' : 'en';
    d.lang = lang;
    d.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (scale === 's' || scale === 'l') d.setAttribute('data-scale', scale);
    if (dens === 'compact') d.setAttribute('data-density', 'compact');
    if (motion === 'reduce') d.setAttribute('data-motion', 'reduce');
  } catch (e) { /* storage blocked: defaults apply */ }
})();
