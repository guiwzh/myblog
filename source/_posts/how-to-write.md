---
title: 如何在这个博客上发文章
date: 2026-04-28 11:00:00
tags:
  - 教程
  - 博客
categories:
  - 帮助
description: 一份给未来自己看的发文操作手册。
top: true
---

## 发文最简流程

只需要三步：

```bash
# 1. 在 source/_posts/ 目录下新建一个 md 文件
#    （或者用命令：hexo new "文章标题"）

# 2. 写完后保存

# 3. 推送
git add .
git commit -m "新文章: xxx"
git push
```

`git push` 后约 30 秒，文章会自动出现在网站上。Vercel 会自动构建并部署。

## 文章开头的 Front Matter

每篇 md 文件开头有一段 YAML 元数据，告诉 Hexo 这篇文章的标题、日期、标签等：

```yaml
---
title: 文章标题
date: 2026-04-28 10:00:00
tags:
  - 标签一
  - 标签二
categories:
  - 分类
description: 一句话描述（用于 SEO 和列表预览）
cover: https://example.com/封面图.jpg   # 可选
top: true   # 可选，置顶文章
---
```

如果用 `hexo new "标题"` 命令创建文章，Front Matter 会自动按 `scaffolds/post.md` 模板生成，不用手动写。

## Markdown 常用语法速查

```markdown
# 一级标题  (文章里别用，标题已在 front matter)
## 二级标题
### 三级标题

**加粗**  *斜体*  ~~删除线~~

> 引用块

- 无序列表
1. 有序列表

[链接文字](https://example.com)
![图片描述](图片地址)

`行内代码`

​```js
// 代码块
console.log('hello')
​```

| 表头 | 表头 |
| --- | --- |
| 内容 | 内容 |
```

## 在文章里放图片

两种方式，推荐第二种：

**方式一：放进仓库**
把图片放到 `source/img/` 目录，文章里用 `![alt](/img/xxx.png)` 引用。

**方式二：图床（推荐）**
图片传到图床（比如 [PicGo](https://picgo.github.io/PicGo-Doc/) + GitHub / 腾讯 COS / 七牛云），引用外链：
```markdown
![alt](https://your-cdn.com/xxx.png)
```
这样仓库不会越来越大。

## 本地预览（可选）

写完后想先看看效果再推送：

```bash
npm run server
# 浏览器打开 http://localhost:4000
```

实时刷新，所见即所得。

