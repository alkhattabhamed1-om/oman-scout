(function () {
  try {
    var d = document.documentElement;
    var theme = localStorage.getItem('scout.theme');
    var lang = localStorage.getItem('scout.lang');
    if (theme) d.setAttribute('data-theme', theme);
    if (!lang) lang = ((navigator.language || '').slice(0, 2) === 'ar') ? 'ar' : 'en';
    d.lang = lang;
    d.dir = lang === 'ar' ? 'rtl' : 'ltr';
  } catch (e) { /* storage blocked: defaults apply */ }
})();
