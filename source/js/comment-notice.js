(function () {
  var NOTICE =
    '评论须知：评论通过 GitHub 账号登录发表，内容以公开形式存储于本站 GitHub 仓库的 Discussions 中，所有人可见。' +
    '请文明发言，严禁发布违法、政治敏感、广告营销、人身攻击等内容；违规评论将被删除，情节严重者保留追究责任的权利。';

  var REPO = 'guiwzh/myblog';
  var FAIL_TIMEOUT = 8000;

  function insertNotice() {
    var container = document.getElementById('post-comment');
    if (!container) return;
    if (!container.querySelector('.comment-notice')) {
      var notice = document.createElement('div');
      notice.className = 'comment-notice';
      notice.textContent = NOTICE;
      var head = container.querySelector('.comment-head');
      if (head && head.nextSibling) {
        container.insertBefore(notice, head.nextSibling);
      } else {
        container.insertBefore(notice, container.firstChild);
      }
    }
    setupFallback();
  }

  function giscusLoaded() {
    return !!document.querySelector('#giscus-wrap iframe.giscus-frame');
  }

  function setupFallback() {
    var wrap = document.getElementById('giscus-wrap');
    if (!wrap || wrap.dataset.fallbackArmed) return;
    wrap.dataset.fallbackArmed = '1';

    var armed = false;
    var arm = function () {
      if (armed) return;
      armed = true;
      setTimeout(function () {
        if (!giscusLoaded()) showFallback(wrap);
      }, FAIL_TIMEOUT);
    };

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) {
          arm();
          io.disconnect();
        }
      });
      io.observe(wrap);
    } else {
      arm();
    }

    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function () {
        if (giscusLoaded()) {
          removeFallback();
          mo.disconnect();
        }
      });
      mo.observe(wrap, { childList: true, subtree: true });
    }
  }

  function removeFallback() {
    var el = document.querySelector('.comment-fallback');
    if (el) el.parentNode.removeChild(el);
  }

  function showFallback(wrap) {
    if (document.querySelector('.comment-fallback')) return;
    if (giscusLoaded()) return;

    var q = encodeURIComponent(location.pathname);
    var url = 'https://github.com/' + REPO + '/discussions?discussions_q=' + q;

    var box = document.createElement('div');
    box.className = 'comment-fallback';

    var span = document.createElement('span');
    span.textContent =
      '评论区加载失败 —— 评论系统依赖 GitHub，当前网络可能无法访问（移动网络下较常见）。' +
      '你可以切换网络后刷新，或前往 ';

    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'GitHub Discussions';

    var tail = document.createElement('span');
    tail.textContent = ' 查看与参与本文评论。';

    box.appendChild(span);
    box.appendChild(a);
    box.appendChild(tail);
    wrap.parentNode.insertBefore(box, wrap);
  }

  document.addEventListener('DOMContentLoaded', insertNotice);
  document.addEventListener('pjax:complete', insertNotice);
})();
