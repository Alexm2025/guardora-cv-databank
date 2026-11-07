// Applied before the page draws, so there is no flash of the wrong theme.
(function () {
  var t = null;
  try { t = localStorage.getItem('gd-theme'); } catch (e) { /* storage blocked */ }
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
