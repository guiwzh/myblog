(function () {
  var NOTICE =
    '评论须知：评论通过 GitHub 账号登录发表，内容以公开形式存储于本站 GitHub 仓库的 Discussions 中，所有人可见。' +
    '请文明发言，严禁发布违法、政治敏感、广告营销、人身攻击等内容；违规评论将被删除，情节严重者保留追究责任的权利。';

  function insertNotice() {
    var container = document.getElementById('post-comment');
    if (!container) return;
    if (container.querySelector('.comment-notice')) return;

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

  document.addEventListener('DOMContentLoaded', insertNotice);
  document.addEventListener('pjax:complete', insertNotice);
})();
